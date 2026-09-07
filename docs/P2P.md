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

## The finding that shapes everything: background tabs

**A host whose tab is not in front stops simulating for everyone.** Browsers
throttle `setInterval` in background tabs, and measured over the same fifteen
seconds:

| host tab   | snapshots delivered | round timer | guest moved |
| ---------- | ------------------- | ----------- | ----------- |
| background | 3                   | frozen      | 0.23 units  |
| foreground | 62                  | counting    | 4.66 units  |

So if the host switches app, locks their tablet, or just looks at another tab,
the whole game freezes for every player. This is not a bug in the transport; it
is what browser-hosted authority means.

The fix is to run the world in a **Web Worker**. `shared/world.js` has no DOM
dependencies — that is what let it move client-side in the first place — so it
can move again, and worker timers are throttled far less aggressively. It would
also get the simulation off the host's render thread, which matters because the
host is doing strictly more work than anyone else.

Until that is done, a host has to keep the tab in front, and the UI should say
so plainly rather than letting the game mysteriously freeze.

## The other blocker: snapshots are too big for a data channel

A snapshot is 17.2 KB of JSON. The interoperable SCTP message limit is 16 KB,
and on an unreliable channel a single lost fragment loses the whole message. We
also lose `permessage-deflate` entirely, because data channels do not compress:
the WebSocket build gets 1.8 KB a frame, this gets 17.2 KB.

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

## Still to do for GitHub Pages

Pages serves a project site from `/<repo>/`, and **every path in the app is
absolute**: `/js/`, `/shared/`, `/css/`, `/assets/`, `/vendor/`,
`/manifest.webmanifest`, and `main.js` even does
`import … from "/shared/config.js"`. All of it 404s under a subpath. Making
them relative is mechanical but touches the service worker's precache list, the
audio base path and the module imports.

Also missing on Pages, which has no server:

- `/healthz` does not exist, so the build line says "build unknown". A deploy
  workflow could write a small `version.json` instead.
- The `/vendor/` Babylon fallback has no `node_modules` to serve from. The
  workflow should copy those two files into the published output, or the CDN
  becomes a hard dependency.
- Signalling needs `relaySignalling` pointed at something. A Worker, or the
  Render server that already exists.

## Cheating

The host can cheat, because the host is authoritative. For "my kid wants to
show his friends", that is an entirely acceptable threat model.
