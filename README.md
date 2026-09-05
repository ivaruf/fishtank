# Fishtank

A tiny 3D aquarium game: swim, eat smaller fish, grow, and try not to become lunch. Babylon.js, vanilla JavaScript, and an authoritative Node/WebSocket server. No build step or external runtime CDN.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm start
```

Open http://localhost:3000. Choose **Dive in solo** for a private aquarium or **Play with friends** for the shared tank. Open two browser windows and select multiplayer in both to play together. Solo uses the exact same server simulation in an isolated room.

For LAN play, other devices open `http://HOST_LOCAL_IP:3000` on the same network. On macOS, find the host IP in System Settings → Network → connected interface → Details. Allow Node incoming connections if the OS firewall asks. The host plays using localhost. No port forwarding is necessary on LAN. `PORT=3001 npm start` changes the port. Internet deployment should use HTTPS with WebSocket upgrade support; the client automatically uses WSS under HTTPS.

## Controls and rules

- W/S move forward/backward along your camera aim. A/D strafe left/right. Release movement controls to stand still. Aim up or down and hold W to change depth.
- Move the mouse over the aquarium to aim. Click the aquarium to capture the pointer for unlimited turning; Esc releases it. Hover aiming remains available if pointer lock is unavailable.
- On touch devices, use the left analogue stick to move and the right stick to aim. Both support simultaneous fingers and return to neutral independently. Landscape gives the best layout; portrait remains usable with a rotation hint.
- Tap the ⛶ button beside the resolution setting to enter fullscreen; tap it again to exit. It keeps the HUD and touch sticks visible and is shown when the browser supports page fullscreen.
- Input clears on focus loss, and the server stops movement after 350 ms without fresh input. Movement diagonals are normalized; partial stick deflection gives partial speed.
- Swim headfirst into a smaller fish to eat it. Required mass advantage: 1.35×. Visual radius grows with the cube root of mass. Larger fish swim slightly slower.
- New and respawning players have three seconds of protection: they cannot eat or be eaten. Eaten players return after three seconds. Score survives death.
- Five-minute rounds rank players by score, then mass. Results also show the largest fish. A new round starts after twelve seconds.
- Leave tank returns to the menu. After a connection failure, join again to start as a new fish.

## Architecture

`server.js` serves an allowlisted client/shared/vendor surface and hosts WebSockets. `server/game/world.js` owns movement, NPC wandering, head-biased collisions, growth, deaths, respawning, and rounds. It simulates at 30 Hz and publishes at 15 Hz. Idle rooms pause; empty private rooms are removed. Shared tuning values live in `shared/config.js`.

`client/js/world.js` creates the aquarium. `fish.js` is the replaceable procedural rendering factory; meshes do not decide collisions. `controls.js` reads keyboard/touch intentions. `networking.js` handles messages. `main.js` interpolates positions and angles, smooths the camera, and updates safe text-only UI. No client prediction or lag compensation is implemented.

Protocol: JSON client `JOIN {name, mode}` and `INPUT {forward, strafe, yaw, pitch}` with normalized movement axes and camera angles in radians. Server `WELCOME {id}`, `WORLD_STATE {round, phase, remaining, players, npcs, events}`, and `ERROR {message}`. Events contain `NPC_EATEN` / `PLAYER_EATEN {predator, prey}` or `ROUND_END`. Full snapshots carry joins, departures, respawns, scores, and round transitions. Server ignores client position, size, and score claims. Payloads are limited to 2 KB; dead connections are cleaned up with ping/pong and slow clients skip snapshots.

## Tests

```sh
npm test
```

Tests cover eating thresholds/head collision, protection, growth, NPC movement and respawn, PvP death and respawn, all tank boundaries, round transitions, HTTP assets, two real WebSocket clients, private solo rooms, malformed messages, authority, and disconnect/reconnect.

Manual browser check: join multiplayer in two windows, move and aim independently, eat small NPCs, compare growth across windows, then eat a smaller player. Verify stopping on key release, dual-stick movement and aiming on a phone, respawn, and results after five minutes. Browser/device coverage is not implied by automated server tests.

## Future Blender assets

Place assets in `client/assets/models/`. Export glTF Binary (`.glb`), apply scale/transforms, use a body-centered origin, and keep exported forward along +Z, up +Y. Design a fish around a two-unit body length, then apply gameplay radius on its parent transform. Confirm orientation after export and correct it on a visual child transform if needed. Keep the gameplay-facing root +Z-forward.

The Babylon glTF loader is served locally. Replace `createFish` internals with `BABYLON.SceneLoader.ImportMeshAsync('', '/assets/models/', 'fish.glb', scene)` and parent the imported meshes to a transform node while preserving the factory's root/animation/disposal contract (adapt the synchronous factory for loading or cache models before joining). Recommended animation clip names: `swim`, `idle`, `accelerate`, `bite`, `death`. Keep mesh geometry independent of server collision rules.

This first prototype uses decorative plants and rocks without obstacle collision. NPCs wander and provide food; PvP is the current source of death. It targets small LAN games, not hardened public matchmaking.

## Rendering and mobile resolution

The browser downloads JavaScript and renders the aquarium locally on its GPU. Only gameplay state is exchanged while playing; the server does not stream video or meshes. Preloading affects startup, not the visual fidelity of an already loaded scene.

The resolution selector offers Battery saver (1 render pixel per CSS pixel), Balanced (up to 1.5), and Sharper (up to 2), capped by the display pixel ratio. Babylon uses the inverse hardware scaling factor. The initial prototype mistakenly reduced resolution as device pixel ratio increased; this is corrected. Higher resolution can cost frame rate on slower phones. The procedural models and simple lighting remain placeholders.

Automated control tests cover keyboard release, mouse aim without movement, simultaneous independent stick pointers, cancellation, dead zones, and focus loss. A physical Android/iOS check is still needed to assess touch feel and GPU performance.
