# Peer-to-peer experiment

Branch `p2p_experiment`, started 2026-09-07. One player hosts the simulation
and the others connect straight to them, so a static site with no game server
can run multiplayer. Everything below was measured, not assumed.

## What works

`client/js/peer.js` is host-authoritative and knows nothing about WebRTC. It
talks to "channels" — anything with `send(value)`, `onMessage`, `onClose` — so
the protocol is unit-tested in Node with fake channel pairs, and the same code
runs over a real `RTCDataChannel`.

The host runs `shared/world.js`, the very same class the Node server runs and
the same one solo already runs. Guests send input and receive snapshots. That
means the rules cannot diverge between transports: there is one simulation.

`client/js/webrtc.js` is the real connection, with signalling deliberately
pluggable, because signalling is the only thing a static site cannot do alone:

- `broadcastSignalling` — `BroadcastChannel`, so two tabs in one browser find
  each other with no third party at all. Used by the local test.
- `relaySignalling` — any WebSocket that echoes messages within a room. The
  existing Node server can do it; so can a Worker. Needed for real devices.

Verified with two real tabs, two `RTCPeerConnection`s and no server in the game
loop: the guest is seated, both sides see the same 100-fish world, the host
moves the guest's fish in response to its input, a guest's claimed mass is
ignored, a leaving guest frees its seat, a full tank is refused, and closing
the host tells guests "Host left" rather than freezing them.

## Background tabs, found and fixed

**A host whose tab was not in front stopped simulating for everyone.** Browsers
throttle `setInterval` in background tabs, measured over the same fifteen
seconds with the simulation in the page:

| host tab   | snapshots delivered | round timer | guest moved |
| ---------- | ------------------- | ----------- | ----------- |
| background | 3                   | frozen      | 0.23 units  |
| foreground | 62                  | counting    | 4.66 units  |

The simulation now runs in a Web Worker (`client/js/host-worker.js`), which
`shared/world.js` allows because it has no DOM dependencies — the same
property that let it move client-side for solo. Worker timers are not
throttled the same way, and it also gets the simulation off the host's render
thread, which matters because the host does strictly more work than any guest.

Re-measured with the host tab deliberately left in the background: the guest's
round timer ran 1:48 to 1:33 across fifteen seconds, so the tank keeps living
while the host looks elsewhere.

`hostGame` drives an engine rather than a `World` directly, and the two
engines — in the page, or in a worker — sit behind the same small surface. The
protocol has one implementation and cannot drift between them; the in-page one
is what the Node tests exercise.

## Snapshot size: a bandwidth problem, and a portability risk

Correcting an earlier version of this document, which called the 16 KB data
channel message limit a proven blocker. It is not: 17.2 KB messages flowed
fine Chrome to Chrome in testing, and every stall observed turned out to be
the background throttling above. 16 KB is the _interoperable_ limit, so
Safari to Chrome remains a genuine risk to check on real devices — but it has
not been seen to fail here.

What is certain is the bandwidth. A snapshot is 17.2 KB of JSON and data
channels do not compress, so `permessage-deflate` is gone: the WebSocket build
sends 1.8 KB a frame, this sends 17.2 KB.

Measured, one frame of 104 fish:

| encoding                         | size    |
| -------------------------------- | ------- |
| JSON, as sent today              | 17.2 KB |
| JSON + per-message deflate       | 3.1 KB  |
| JSON + deflate with context (WS) | 1.8 KB  |
| hand-packed binary               | 1.4 KB  |

Host **upload**, since the host sends to every peer:

| peers | JSON as-is  | binary     |
| ----- | ----------- | ---------- |
| 3     | 6.3 Mbit/s  | 0.5 Mbit/s |
| 7     | 14.8 Mbit/s | 1.2 Mbit/s |
| 15    | 31.7 Mbit/s | 2.6 Mbit/s |

Binary packing is therefore not a nicety here, it is required: it fixes the
size limit and the bandwidth at once, with no dependency on
`CompressionStream` support.

### Done: shared/snapshot-codec.js

A roster of ids, names, species and colours on the reliable lane, sent as a
delta only when the cast changes, plus a per-frame binary of numbers on the
lossy lane. Every frame carries the roster version it was packed against and a
guest drops any frame it cannot read yet — the two lanes have no ordering
guarantee between each other, and one dropped frame at 15 Hz is invisible.

Measured in the suite, 116 fish with 16 players, and then on a real connection
between two separate browsers through the public broker:

|        | per frame | 3 peers    | 15 peers    |
| ------ | --------- | ---------- | ----------- |
| JSON   | 19.8 KB   | 7.3 Mbit/s | 36.6 Mbit/s |
| packed | 1.6 KB    | 0.6 Mbit/s | 3.0 Mbit/s  |

On the wire, two peers playing: **1352 bytes a frame**, 15.3 frames a second,
0.17 Mbit/s to one peer, no text messages at all in a quiet round. 91.9% off,
and a frame is now an order of magnitude inside the 16 KB interoperable limit
rather than above it.

Two things the tests caught that the design did not:

- **Headings are not wrapped.** A fish turning steadily was measured at -4.712
  rad, which an i16 at ×10000 clamps to a heading it is not facing. Wrapped
  before quantising now. Safe, because the client steers by
  `wrap(target - current)` and only the heading counts.
- **A delta stream has no beginning.** A peer seated mid-game only ever
  receives the changes since it arrived, so it decoded a tank containing
  itself and nothing else. `packer.full()` now goes out with the WELCOME.

## GitHub Pages: done

Every path in the app is relative now, and `tools/build-static.mjs` publishes
the repository's own shape — `client/` and `shared/` as siblings, with a
redirect at the root. That is the whole trick: `../../shared/x.js` then
resolves identically on disk and under `/<repo>/`, without relying on browsers
clamping `..` at the origin root, which the old paths were quietly depending
on. The build also copies Babylon out of `node_modules`, so the CDN stays a
fallback, and writes a `version.json` standing in for `/healthz`.

Verified by serving the output under a `/fishtank/` prefix and watching for
anything that escaped it: the redirect lands, no crash banner, 14 of 14
thumbnails resolve, 1416 instanced meshes means the real Blender fish rather
than the procedural fallback, and zero requests escape the subpath. Two bugs
only a subpath reveals turned up there: the model and thumbnail URLs are built
with template literals, so an earlier grep for absolute paths missed them and
the game had silently fallen back to procedural fish; and the service worker
was still registered from `/sw.js`, so it never installed.

`.github/workflows/pages.yml` builds and deploys on pushes to this branch.

## Signalling, with nothing of ours running

Two browsers cannot exchange WebRTC offers without a rendezvous, and that is
the only part a static site cannot do alone. Pointing it at our own Node
server was the obvious answer and the wrong one: on a free tier it sleeps, so
multiplayer would only work when somebody had already woken it.

`client/js/rendezvous.js` tries three, in order:

- **relay** — an explicit `meta[name="signal-url"]`, for running your own.
- **broker** — PeerJS's public broker. Nothing of ours runs, which is the
  point. Verified end to end with the Node server stopped entirely: a host
  minted a code, a guest on another tab found it through the broker, and both
  played.
- **tabs** — `BroadcastChannel`, which reaches other tabs in this browser and
  nothing else. A last resort, and the UI says so rather than looking broken.

A public broker is a real trade, and worth stating plainly:

- It is a third party with no promises. If it is down, no _new_ games can be
  started; games already connected are unaffected, because it carries no game
  traffic.
- It sees room codes and connection metadata. It never sees game data.
- It provides no TURN, so a minority of network situations - roughly the
  usual tenth - will fail to connect at all, with no fallback.
- Its id space is shared with every other PeerJS app, so codes are namespaced
  `fishtank-v1-` and six characters long, and a taken code is reported rather
  than silently failing.
- **It drops a peer whose heartbeat stops, and releases the id with it.** This
  one cost real debugging: hosting worked, and the same code minutes later was
  "no tank found" on the friend's device. Measured — freeze the host page for
  90 seconds, which is what a screen lock or an app switch does, and the code
  is gone, with the host's own page still showing an open lobby. So the host
  reclaims its id on `disconnected`, on a five-second beat, and on returning
  to visibility (the event alone is not enough: it can fire while the page is
  frozen, where the reconnect cannot get out). The lobby reports reachability
  rather than assuming it, the hosting device asks for a wake lock, and the
  guest's "no tank found" now mentions a sleeping host as a cause. Same test
  now passes across 90 frozen seconds.

The relay path is still there and still tested: a real data-channel-only
offer framed to 849 bytes, inside the socket's 2 KB payload guard, with
candidates trickling separately.

## What is left

The work order is done. Beyond it, the things that are genuinely hard rather than merely
undone:

- **No TURN.** Some pairs of networks will not connect, and there is no free
  way around it. A relay costs bandwidth by the gigabyte, which is what this
  whole exercise was avoiding.
- **The host must stay on the page.** The worker keeps the simulation running
  in a background tab, but a closed tab or a locked phone still ends the game
  for everyone. Host migration would need a full state handoff and fresh
  signalling between guests, who only hold connections to the host.
- **Same-network play still needs the internet** to shake hands, even for two
  devices on the same wifi. There is no browser-only way around that.

## Cheating

The host can cheat, because the host is authoritative. For "my kid wants to
show his friends", that is an entirely acceptable threat model.
