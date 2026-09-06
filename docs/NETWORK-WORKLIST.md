# Network and caching worklist

Created 2026-09-06, updated the same day after shipping A1, A2, B0, B1, B2 and
B4. Two separate problems: the live WebSocket stream during a round, and asset
delivery on load. Every number below was measured on this repo, not estimated.
Work in small batches; each item is independently shippable and independently
verifiable.

## Status

**Live stream: done.** A snapshot went from 26.2 KB to **1.8 KB on the wire**,
measured end-to-end by counting bytes read off a real TCP socket. That paid for
raising `maxPlayers` from 8 to 16. A3–A5 are downgraded; see below.

**Asset delivery: done bar one item.** Babylon's 7.9 MB moved to a pinned,
SRI-locked CDN with the local copy kept as a working fallback, and everything
the host still serves is brotli-compressed from an in-memory cache and
revalidated by content hash. **B3 (hashed immutable URLs) is all that remains**,
and it is an optimisation rather than a fix.

## Baseline

Snapshot of a full 8-player tank with 100 wild fish, `broadcastRate` 15 Hz:

| What                          | Before A1/A2                                                | Now                                  |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| One snapshot, uncompressed    | 26.2 KB                                                     | 18.6 KB                              |
| One snapshot, **on the wire** | 26.2 KB                                                     | **1.8 KB**                           |
| Egress, one full tank (8)     | 25.8 Mbit/s                                                 | **1.7 Mbit/s**                       |
| Egress, three full tanks (24) | 77.3 Mbit/s                                                 | **5.3 Mbit/s**                       |
| Server CPU, 24 players        | 6% of one core                                              | 25% of one core                      |
| WebSocket compression         | **off** (`ws` default)                                      | on, context kept between messages    |
| Cold page load, host traffic  | ~14 MB                                                      | **under 1 MB** (7.9 MB on the CDN)   |
| HTTP compression              | **none**                                                    | brotli, gzip fallback, 65–77%        |
| HTTP revalidation             | `no-cache`, **no ETag** — every reload refetches every byte | `no-cache` + sha256 ETag, empty 304s |

`node tools/measure-traffic.mjs` reproduces the field breakdown, but note it now
measures the **post-A2** code, so its raw figure is ~18 KB rather than the 26.2
KB starting point recorded here.

Where the original 26.2 KB went, per field across all 108 encoded fish:

| Field                      | Share | Note                                         |
| -------------------------- | ----- | -------------------------------------------- |
| `pitch` `yaw`              | 20.8% | full float precision, e.g. 17 digits         |
| `x` `y` `z`                | 27.6% | full float precision                         |
| `mass`                     | 9.8%  | full float precision                         |
| `species`                  | 8.7%  | a string, repeated every tick, never changes |
| `protection` `respawn`     | 11.3% | countdowns the client could run itself       |
| `id` `npc` `color` `alive` | 19.2% | `npc`/`color` never change after spawn       |
| `name` `hidden` `score`    | 1.2%  |                                              |

**Over half the stream is float precision nobody can see**, and another ~30% is
per-fish constants resent 15 times a second.

## Part A — live traffic

Do these in order; each was measured on top of the ones before it.

| Done | Item                                                                                                                                                                                                                                                   | Result                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [x]  | **A1. Enable `perMessageDeflate` on the WebSocket server.** Config only, no protocol or client change. Context is deliberately kept between messages.                                                                                                  | **90%** off the wire (18.6 → 1.8 KB)           |
| [x]  | **A2. Quantise floats in `World.snapshot()`'s `encode`.** Positions 2dp (1 cm), angles 3dp (~0.06°), mass 2dp, timers 2dp.                                                                                                                             | 26.2 → 18.6 KB raw, and it makes A1 far better |
| [ ]  | **A3. Stop resending per-fish constants.** _Downgraded — measure again before building._ Deflate's cross-message context already removes almost all of this: stripping `name`/`species`/`color`/`npc` takes the wire frame from only 1.8 KB to 1.7 KB. | ~6% for a roster message and client-side merge |
| [ ]  | **A4. Let the client run `protection` and `respawn` down itself.** Same caveat as A3 — these are highly compressible repeated values, so measure the wire, not the raw JSON, before building.                                                          | likely small; unmeasured                       |
| [ ]  | **A5. Delta encoding.** Only send fish whose quantised state changed. At 1.8 KB a frame the remaining prize is small and the cost (per-client baseline state) is high. Probably not worth it.                                                          | not recommended                                |

### What A1 and A2 actually did

- **Mass at 2dp, not 1dp as first planned.** 1dp would widen the "looks
  neutral" band to ±0.05 mass, so a fish could appear neutral in the threat
  tint and still eat you. 2dp costs about 0.4% of the snapshot and keeps the
  client's food-or-danger cue faithful to the server's own comparison.
- **Quantisation lives only in `encode`.** `wire()` in `shared/world.js`
  rounds on the way out; `f.x`, `f.mass` and friends keep full doubles, so
  rounding can never feed back into movement or into `outweighs`.
  `tests/world.test.js` asserts both halves: wire values respect their decimal
  budget, and live simulation state does not.
- **Context takeover is the whole game for A1.** Consecutive snapshots are
  near-identical, so keeping the zlib context between messages gives 1.8 KB a
  frame against 3.1 KB if it is reset per message. The usual memory-saving
  tweak of shrinking the window to 10 bits measured **worse than no
  compression at all** (3.7 KB), so the window stays at its default. The cost
  is roughly a quarter megabyte of zlib state per connection — a few megabytes
  at 24 players.
- **CPU went from 6% to 25% of one core** at 24 players across three tanks,
  measured against clients that decline compression on the same build. Four
  times the CPU, but 25% of a single core at the player cap in exchange for
  ~72 Mbit/s of uplink is a clear trade, because bandwidth was the binding
  constraint and CPU was not.
- **`PROTOCOL` is now 6.** The client surfaces a mismatch as "server is an
  older build".
- **Smoothness verified, not assumed.** Sampling a fish's rendered position
  for 90 frames while swimming: 0 stalled frames and a max/avg per-frame
  movement ratio of 1.40, where a quantisation sawtooth would spike it.
  Per-frame movement is ~0.068 units against a ±0.005 unit rounding error.

### Where the remaining headroom is

A1+A2 already beat the original A1–A3 projection, so Part A is close to done.
The saving also paid for a bigger game: **`maxPlayers` went from 8 to 16** on
the back of these numbers. Re-measured at the new cap, a snapshot still costs
**1.8 KB on the wire** (20.3 KB uncompressed), so a full 16-player tank runs at
3.6 Mbit/s and three of them at about 11 Mbit/s. CPU at the new maximum of 48
players is 36% of one core against 11% uncompressed — sub-linear, since 24
players cost 25%.

**Part B is largely done too.** B0, B1, B2 and B4 shipped: Babylon's 7.9 MB
moved to a pinned, SRI-locked CDN with the local copy kept as a working
fallback, and everything the host still serves is brotli-compressed from an
in-memory cache and revalidated by content hash. A cold load went from ~14 MB
to well under 1 MB of host traffic, and a reload costs a handful of empty
`304`s. **B3 is the only item left**, and it is an optimisation rather than a
fix.

## Part B — asset delivery and caching

The requirement is "cache hard, but always check, and invalidate on update".
Two mechanisms, used for different files:

| Done | Item                                                                                                                                                                                              | Effect                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [x]  | **B0. Load Babylon from a pinned CDN with a local fallback.** jsDelivr at the exact installed version, SRI-locked, with the `/vendor/` copy still wired as fallback.                              | **7.9 MB off the host entirely**          |
| [x]  | **B1. Compress HTTP responses** (brotli quality 5, gzip fallback, honouring `Accept-Encoding`, `Vary: Accept-Encoding`). Skips `.png`/`.m4a` and anything under 1 KB.                             | HTML/CSS/JS 65–77%, GLBs 76%              |
| [x]  | **B2. Strong `ETag` from a sha256 content hash, keeping `Cache-Control: no-cache`.** The "always check" path: the browser revalidates every time and gets an empty `304` when nothing changed.    | reload → 0-byte bodies                    |
| [x]  | **B4. Precompressed in-memory cache**, one entry per file per process, holding the hash plus the brotli and gzip bodies. Built lazily on first request, with the entry surface warmed at startup. | brotli CPU paid once, not per request     |
| [ ]  | **B3. Content-hashed URLs + `immutable` for the fish models**, via a manifest the client resolves through. The only remaining item: it would drop even the revalidation round trip.               | removes ~50 conditional requests per load |

### How the two cache modes divide

- **`no-cache` + ETag** for `index.html`, `client/js/*`, `client/css/*`,
  `shared/*` — small files that change often. Always a round trip, but the body
  only moves when the hash changes. This alone satisfies "we always need to
  check".
- **hashed URL + `max-age=31536000, immutable`** for `client/assets/models/*`
  and `/vendor/*` — 36 MB of models and 8 MB of vendor code that change only
  when the fish are rebuilt. A rebuild changes the hash, which changes the URL,
  which invalidates the cache with no stale-content risk.

Keep the entry point (`index.html`) on the `no-cache` path so a hashed manifest
can never strand a client on an old bundle.

### Notes and risks

- B3 must not introduce a build step — the README's "no build step or external
  runtime CDN" is a design constraint. Generate the hash manifest in
  `createGameServer()` at startup by hashing files on disk, serve both the
  hashed and plain URL for each asset, and expose the manifest to the client so
  `fish.js` can resolve `clownfish.glb` → `clownfish.<hash>.glb`.
- `tests/network.test.js` asserts `cache-control: no-cache` on `/`. B2 keeps
  that header, so the assertion stays valid; B3 changes it only for hashed
  asset URLs.
- Hashing 36 MB of models at every server start costs a moment. Hash lazily on
  first request per file, or hash size+mtime rather than content, and confirm
  startup time stays acceptable.

## Measured dead end — do not build this

**Spatial interest management (only send wild fish near the player) is not
worth it here.** Measured, per client:

| Cull radius | Wild fish still sent |                  |
| ----------- | -------------------- | ---------------- |
| 15 units    | 16 / 100             | heavy pop-in     |
| 25 units    | 44 / 100             | visible pop-in   |
| 30 units    | 61 / 100             | modest saving    |
| 40 units    | 86 / 100             | almost no saving |

The tank's diagonal is only 106 units, so fish are legitimately visible from
most of it and anything tight enough to save real bytes causes pop-in. Worse,
it forces a per-client snapshot, which loses the current serialize-once-and-
broadcast design and multiplies encode cost by the player count. A1–A3 achieve
far more for far less risk. Revisit only if the tank or `npcCount` grows a lot.

## Verification

- Re-run the measurement harness after each item and record the new numbers in
  the baseline table above. Do not claim a saving that has not been measured.
- Server CPU: a room-tick currently costs ~0.12 ms and one core sustains a few
  hundred active rooms, so there is headroom — but A1 adds per-message
  compression, which is per client, not per room. Measure it.
- Visual check after A2 and A4: fish must still move smoothly and death and
  respawn timing must look unchanged. Use the headless Chrome loop.
- `node --test` must stay green throughout; extend `tests/network.test.js` with
  a snapshot-size assertion so a future change cannot silently undo this.

## Commands

```sh
node --test tests/network.test.js
PORT=3123 node server.js
```
