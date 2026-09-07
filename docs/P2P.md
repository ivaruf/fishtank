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
`CompressionStream` support. The shape would be a roster of names, species and
colours sent reliably when players change, plus a per-frame binary of the
numeric state only — which is the A3 idea from the network worklist, made
mandatory by this transport rather than merely nice.

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

## Signalling

The server that already exists relays it: only OFFER, ANSWER and ICE, only
between sockets in the same signalling room, so it cannot become a general
message bus. A socket that only signals never joins a game room, holds no
seat, and costs a few hundred bytes. Once peers connect it is not involved
again. `chooseSignalling` picks a relay when one is configured (a
`meta[name="signal-url"]`) or same-origin, and otherwise falls back to
`BroadcastChannel`, telling the player plainly that this only reaches other
tabs — so a failed cross-device attempt is not a mystery.

A real data-channel-only offer framed to 849 bytes, comfortably inside the
socket's 2 KB payload guard, with candidates trickling separately.

**For Pages, this needs pointing somewhere.** Add
`<meta name="signal-url" content="wss://<the-render-host>/ws">` to
`client/index.html`, or the static build falls back to same-tab only.

## What is left

Item 5, the binary snapshot codec. Nothing else from the work order.

## Cheating

The host can cheat, because the host is authoritative. For "my kid wants to
show his friends", that is an entirely acceptable threat model.
