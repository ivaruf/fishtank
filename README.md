# Fishtank

A tiny 3D aquarium game: swim, eat smaller fish, grow, and try not to become lunch. Babylon.js, vanilla JavaScript, Blender-made fish, and an authoritative Node/WebSocket server. No build step or external runtime CDN.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm start
```

Open http://localhost:3000. Type a name and pick which of the seven fish you want to be; the choice is remembered and the chosen fish swims large beside the menu. Then choose **Dive in solo** for a private aquarium or **Play with friends** for the shared tank. Restart the server after pulling changes: the client compares protocol numbers on join and shows "server is an older build" in the header if a stale process is still running. Open two browser windows and select multiplayer in both to play together. Solo uses the exact same server simulation in an isolated room.

For LAN play, other devices open `http://HOST_LOCAL_IP:3000` on the same network. On macOS, find the host IP in System Settings → Network → connected interface → Details. Allow Node incoming connections if the OS firewall asks. The host plays using localhost. No port forwarding is necessary on LAN. `PORT=3001 npm start` changes the port. Internet deployment should use HTTPS with WebSocket upgrade support; the client automatically uses WSS under HTTPS.

## Controls and rules

- W/S move forward/backward along your camera aim. A/D strafe left/right. Release movement controls to stand still. Aim up or down and hold W to change depth.
- Move the mouse over the aquarium to aim. Click the aquarium to capture the pointer for unlimited turning; Esc releases it. Hover aiming remains available if pointer lock is unavailable.
- On touch devices, use the left analogue stick to move and the right stick to aim. Both support simultaneous fingers and return to neutral independently. Landscape gives the best layout; portrait remains usable with a rotation hint.
- Tap the ⛶ button beside the resolution setting to enter fullscreen; tap it again to exit. It keeps the HUD and touch sticks visible and is shown when the browser supports page fullscreen.
- Input clears on focus loss, and the server stops movement after 350 ms without fresh input. Movement diagonals are normalized; partial stick deflection gives partial speed.
- Swim headfirst into a smaller fish to eat it. Required mass advantage: 1.35×. Visual radius grows with the cube root of mass. Larger fish swim slightly slower.
- Wild fish play by the same rule against you: any with 1.35× your mass can eat you, and those drift toward smaller players within about nine units, swimming a little faster while they do. Give the big ones room. Fish you can eat look a touch brighter; fish that can eat you look darker.
- Eating plays a forward lunge with a puff of bubbles; the eaten fish rolls over, tumbles and shrinks into the predator's mouth before it vanishes.
- New and respawning players have three seconds of protection: they cannot eat or be eaten. Eaten players return after three seconds. Score survives death.
- Five-minute rounds rank players by score, then mass. Results also show the largest fish. A new round starts after twelve seconds.
- Leave tank returns to the menu. After a connection failure, join again to start as a new fish.

## Architecture

`server.js` serves an allowlisted client/shared/vendor surface and hosts WebSockets. `server/game/world.js` owns movement, NPC wandering and hunting, head-biased collisions, growth, deaths, respawning, and rounds. It simulates at 30 Hz and publishes at 15 Hz. Idle rooms pause; empty private rooms are removed. Shared tuning values live in `shared/config.js`.

`client/js/world.js` creates the aquarium. `fish.js` loads the three Blender fish once and hands out GPU-instanced copies with bite, death and threat-tint hooks; `effects.js` owns the shared bubble-puff particles; meshes do not decide collisions. `controls.js` reads keyboard/touch intentions. `networking.js` handles messages. `main.js` interpolates positions and angles, smooths the camera, and updates safe text-only UI. No client prediction or lag compensation is implemented.

Protocol: JSON client `JOIN {name, mode, species}` and `INPUT {forward, strafe, yaw, pitch}` with normalized movement axes and camera angles in radians. Server `WELCOME {id, protocol}`, `WORLD_STATE {round, phase, remaining, players, npcs, events}`, and `ERROR {message}`. Events contain `NPC_EATEN` / `PLAYER_EATEN {predator, prey}` or `ROUND_END`; the predator may be a wild fish, in which case the prey's `killedBy` reads like “a wild blue tang”. Full snapshots carry joins, departures, respawns, scores, and round transitions. Server ignores client position, size, and score claims, and replaces an unknown species with a valid one. Every fish in a snapshot carries its `species`. Payloads are limited to 2 KB; dead connections are cleaned up with ping/pong and slow clients skip snapshots.

## Tests

```sh
npm test
```

Tests cover eating thresholds/head collision, protection, growth, NPC movement, hunting and predation, respawn, PvP death and respawn, all tank boundaries, round transitions, HTTP assets including the `.glb` models, two real WebSocket clients, private solo rooms, malformed messages, authority, and disconnect/reconnect. `tests/fish.test.js` loads the real model files on Babylon's NullEngine and checks orientation, instancing, material conversion, the swim clip, bite and death animation state, threat tints through the per-instance color buffer, disposal, and the procedural fallback.

Manual browser check: join multiplayer in two windows, move and aim independently, eat small NPCs, compare growth across windows, then eat a smaller player. Verify stopping on key release, dual-stick movement and aiming on a phone, respawn, and results after five minutes. Browser/device coverage is not implied by automated server tests.

## Blender fish models

Seven stylized fish live in `client/assets/models/` as glTF Binary: clownfish, blue tang, pufferfish, angelfish, goldfish, betta, and shark. Their Blender sources are in `assets/blender/`, `docs/*.png` are studio renders, and `client/assets/thumbs/*.png` are the small transparent renders the species picker shows. Everything is generated by `tools/blender/create_fish.py` (tested with Blender 5.2):

```sh
# Everything, or just some species, or only the menu thumbnails from saved .blend files
blender --background --factory-startup --python tools/blender/create_fish.py
blender --background --factory-startup --python tools/blender/create_fish.py -- betta shark
blender --background --factory-startup --python tools/blender/create_fish.py -- --thumbnails-only clownfish
```

Each file has a root node, a static `BodyMesh`, and a `Tail` pivot whose child fan is animated by a one-second looping wag. Fish face +Z with +Y up around a two-unit body; gameplay radius is applied on the parent transform in the client. Materials are plain PBR colors without textures.

At startup `fish.js` loads all three into Babylon asset containers via the locally served glTF loader. Every fish in the tank is then created with `instantiateModelsToScene` using GPU instances, so a hundred NPCs share three sets of geometry and a couple of dozen draw calls. Since the scene has no environment texture, the exported PBR materials are converted to the same `StandardMaterial` setup as the rocks and plants. Linear glTF colors are gamma-converted, and because the tank's two lights add up to roughly 2.6x on upward faces, each fish material takes 30% of its color from lighting and 40% as same-hue emissive so pale species like the pufferfish keep their color instead of clipping to white. Players choose their species in the menu and send it with `JOIN`; the server validates it, assigns NPC species round-robin, and includes `species` in every snapshot, so all clients agree. Players carry a small glowing crest so they can be told apart from NPCs. The exported swim clip is cloned per fish, started at a random phase, and its speed follows how fast the fish is moving, so idle fish only idle-wag. Each fish has a root node carrying the server transform and a child pose node for client-side bite lunges and death tumbles, so the models need no extra clips. The threat cue writes a per-instance color (`instanceColor`), which the standard shader multiplies into the final color while keeping every fish of a species in one instanced batch.

If a model fails to load the factory falls back to the earlier procedural sphere fish with the same root/swim/dispose contract, and the console names the missing species. To add a species, add a branch to the Blender script, run it for that kind, and append the name to `SPECIES` in `shared/config.js`; the picker, the server, and the loader all read that list. The Blender exporter currently names the clip `Animation` rather than `swim`; the client accepts either and takes the first clip it finds.

This first prototype uses decorative plants and rocks without obstacle collision. NPCs wander and provide food, and the large ones hunt players who stray close. It targets small LAN games, not hardened public matchmaking.

## Rendering and mobile resolution

The browser downloads JavaScript and renders the aquarium locally on its GPU. Only gameplay state is exchanged while playing; the server does not stream video or meshes. Preloading affects startup, not the visual fidelity of an already loaded scene.

The resolution selector offers Battery saver (1 render pixel per CSS pixel), Balanced (up to 1.5), and Sharper (up to 2), capped by the display pixel ratio. Babylon uses the inverse hardware scaling factor. The initial prototype mistakenly reduced resolution as device pixel ratio increased; this is corrected. Higher resolution can cost frame rate on slower phones. The Blender fish are roughly five times the triangle count of the old procedural spheres but are hardware instanced; lighting is still a simple hemispheric and directional pair.

Automated control tests cover keyboard release, mouse aim without movement, simultaneous independent stick pointers, cancellation, dead zones, and focus loss. A physical Android/iOS check is still needed to assess touch feel and GPU performance.
