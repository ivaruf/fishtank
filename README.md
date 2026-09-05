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
- On touch devices your fish always swims. Touch and drag anywhere on the left half to steer: a stick appears under your thumb and its direction is where you go relative to the camera, which follows in behind your fish. Drag up or down on the right half to rise or dive; let go and the fish levels out. A gentle bite assist nudges you toward lighter fish straight ahead. Landscape gives the best layout; portrait remains usable with a rotation hint.
- Tap the ⛶ button beside the resolution setting to enter fullscreen; tap it again to exit. It keeps the HUD and touch sticks visible and is shown when the browser supports page fullscreen.
- Input clears on focus loss, and the server stops movement after 350 ms without fresh input. Movement diagonals are normalized; partial stick deflection gives partial speed.
- Swim headfirst into a lighter fish to eat it. The food chain is binary: anything heavier than you can eat you and anything lighter is food, so every fish is either brighter (food) or darker (danger); only an exact tie, such as two fresh spawns, is neutral. Visual radius grows with the cube root of mass. Larger fish swim slightly slower.
- Wild fish play by the same rule against you: any heavier one can eat you, and those drift toward lighter players within about nine units, swimming a little faster while they do. Give the big ones room. Other players' names float above their fish, except while they hide in the kelp.
- Duck into a kelp forest to hide: low inside one of the thirteen clusters you are not hunted and the HUD says so, though a fish that blunders into you still eats you. Cluster positions live in `shared/config.js` so server and client agree.
- Eating is a cartoon chomp: the head rears back with the mouth gaping wide, snaps shut with a squash and a puff of bubbles, and the eaten fish rolls over, tumbles and shrinks into the predator's mouth before it vanishes.
- New and respawning players have three seconds of protection: they cannot eat or be eaten. When you are eaten the camera swings to the predator's mouth to watch it chew you down before "You became lunch" appears; you return after five seconds. Score survives death.
- Two-minute rounds rank players by score, then mass, so no lead lasts long; the current leader wears a small gold crown (and a 👑 on their name label) for everyone to see. Results also show the largest fish and stay up until someone presses **Start the next round**.
- Leave tank returns to the menu. After a connection failure, join again to start as a new fish.

## Architecture

`server.js` serves an allowlisted client/shared/vendor surface and hosts WebSockets. `server/game/world.js` owns movement, NPC wandering and hunting, head-biased collisions, growth, deaths, respawning, and rounds. It simulates at 30 Hz and publishes at 15 Hz. Idle rooms pause; empty private rooms are removed. Shared tuning values live in `shared/config.js`.

`client/js/world.js` creates the aquarium (speckled sand, noise-displaced rocks, kelp forests whose merged vertices sway every frame, a framed glass tank with a light bar and a rippling surface) and the evening office it stands in, all procedural geometry with small canvas-drawn textures. The tank's light bar is a spot light and the desk and floor lamps are point lights with a glow layer, over a faint blue ambient; room materials ignore the water fog so they read as air beyond the glass. `fish.js` loads the three Blender fish once and hands out GPU-instanced copies with bite, death and threat-tint hooks; `effects.js` owns the shared bubble-puff particles; meshes do not decide collisions. `controls.js` reads keyboard/touch intentions. `networking.js` handles messages. `main.js` interpolates positions and angles, smooths the camera, and updates safe text-only UI. No client prediction or lag compensation is implemented.

Protocol: JSON client `JOIN {name, mode, species}`, `INPUT {forward, strafe, yaw, pitch}` with normalized movement axes and camera angles in radians, and `NEXT_ROUND` from the results screen. Server `WELCOME {id, protocol}`, `WORLD_STATE {round, phase, remaining, players, npcs, events}`, and `ERROR {message}`. Events contain `NPC_EATEN` / `PLAYER_EATEN {predator, prey}` or `ROUND_END`; the predator may be a wild fish, in which case the prey's `killedBy` reads like “a wild blue tang”. Full snapshots carry joins, departures, respawns, scores, and round transitions. Server ignores client position, size, and score claims, and replaces an unknown species with a valid one. Every fish in a snapshot carries its `species`. Payloads are limited to 2 KB; dead connections are cleaned up with ping/pong and slow clients skip snapshots.

## Tests

```sh
npm test
```

Tests cover eating thresholds/head collision, protection, growth, NPC movement, hunting and predation, kelp cover, respawn, PvP death and respawn, all tank boundaries, round transitions, HTTP assets including the `.glb` models, two real WebSocket clients, private solo rooms, malformed messages, authority, and disconnect/reconnect. `tests/fish.test.js` loads the real model files on Babylon's NullEngine and checks orientation, instancing, material conversion, the swim clip, bite and death animation state, threat tints through the per-instance color buffer, disposal, and the procedural fallback.

Manual browser check: join multiplayer in two windows, move and aim independently, eat small NPCs, compare growth across windows, then eat a smaller player. Verify stopping on key release, dual-stick movement and aiming on a phone, respawn, and results after two minutes. Browser/device coverage is not implied by automated server tests.

## Blender fish models

Seven stylized fish live in `client/assets/models/` as glTF Binary: clownfish, blue tang, pufferfish, angelfish, goldfish, betta, and shark, each as a standard `.glb` and a denser `-hd.glb` for the Ultra quality setting. Their Blender sources are in `assets/blender/`, `docs/*.png` are studio renders, and `client/assets/thumbs/*.png` are the small transparent renders the species picker shows. Everything is generated by `tools/blender/create_fish.py` (tested with Blender 5.2):

```sh
# Everything, or just some species, or only the menu thumbnails from saved .blend files
blender --background --factory-startup --python tools/blender/create_fish.py
blender --background --factory-startup --python tools/blender/create_fish.py -- betta shark
blender --background --factory-startup --python tools/blender/create_fish.py -- --thumbnails-only clownfish
blender --background --factory-startup --python tools/blender/create_fish.py -- --hd-only
```

Each file has a root node, a static `BodyMesh`, and a `Tail` pivot whose child fan is animated by a one-second looping wag. Fish face +Z with +Y up around a two-unit body; gameplay radius is applied on the parent transform in the client. Materials are plain PBR colors without textures.

At startup `fish.js` loads all three into Babylon asset containers via the locally served glTF loader. Every fish in the tank is then created with `instantiateModelsToScene` using GPU instances, so a hundred NPCs share three sets of geometry and a couple of dozen draw calls. Since the scene has no environment texture, the exported PBR materials are converted to the same `StandardMaterial` setup as the rocks and plants. Linear glTF colors are gamma-converted, and because the tank's two lights add up to roughly 2.6x on upward faces, each fish material takes 30% of its color from lighting and 40% as same-hue emissive so pale species like the pufferfish keep their color instead of clipping to white. Players choose their species in the menu and send it with `JOIN`; the server validates it, assigns NPC species round-robin, and includes `species` in every snapshot, so all clients agree. Players carry a small glowing crest so they can be told apart from NPCs. The exported swim clip is cloned per fish, started at a random phase, and its speed follows how fast the fish is moving, so idle fish only idle-wag. Each fish has a root node carrying the server transform and a child pose node for client-side bite lunges and death tumbles, so the models need no extra clips. The threat cue writes a per-instance color (`instanceColor`), which the standard shader multiplies into the final color while keeping every fish of a species in one instanced batch.

If a model fails to load the factory falls back to the earlier procedural sphere fish with the same root/swim/dispose contract, and the console names the missing species. To add a species, add a branch to the Blender script, run it for that kind, and append the name to `SPECIES` in `shared/config.js`; the picker, the server, and the loader all read that list. The Blender exporter currently names the clip `Animation` rather than `swim`; the client accepts either and takes the first clip it finds.

The plants, rocks, glass and office are decoration without obstacle collision. NPCs wander and provide food, and the large ones hunt players who stray close. It targets small LAN games, not hardened public matchmaking.

## Audio

Music and effects are Sonic Pi pieces in `tools/sonic-pi/`: a calm menu theme ("Below the surface", 60 bpm, 32-beat loop), a gameplay loop ("Feeding time", 100 bpm, 64 beats), and one-shots for your bite, being eaten, a fish eaten nearby (fades with distance), respawning, a predator swimming close (at most every six seconds), the round ending, and menu clicks. `client/js/audio.js` plays them through Web Audio: loops crossfade between menu and game, effects share a bus, and the 🔊 button in the header mutes everything and remembers it. Audio starts on the first click or key press, as browsers require.

Rendering needs Sonic Pi 5 installed (`/Applications/Sonic Pi.app`, override with `SONIC_PI_APP`), ffmpeg on the PATH, and the real audio device, so it cannot run in a sandbox and you will hear it render in real time:

```sh
SP="/Applications/Sonic Pi.app/Contents/Resources/app/server/native/ruby/bin/ruby"
"$SP" tools/sonic-pi/render.rb /tmp/fishtank-audio music-menu=70 music-game=83 chomp=2 eaten=3 nearby=1.5 respawn=2.5 round-end=4 click=1 danger=3
node tools/sonic-pi/encode.mjs /tmp/fishtank-audio client/assets/audio
```

`render.rb` is adapted from Sonic Pi's own headless recorder, which pings the daemon every 4 s although the daemon wants a keep-alive more often than every 3 s and otherwise stops the take; this one pings every second and records every piece in a single engine session. Music pieces open with a marker tick and play their loop twice; `encode.mjs` cuts the second pass to the exact loop length (so reverb tails wrap around), trims effects to their sound, peak-normalises to -1 dBFS, and writes AAC (`.m4a`), which every major browser decodes.

## Rendering and mobile resolution

The browser downloads JavaScript and renders the aquarium locally on its GPU. Only gameplay state is exchanged while playing; the server does not stream video or meshes. Preloading affects startup, not the visual fidelity of an already loaded scene.

The quality selector offers Battery saver (1 render pixel per CSS pixel), Balanced (up to 1.5), and Sharper (up to 2), capped by the display pixel ratio, plus Ultra, which supersamples at 1.5× the display's own density (capped at 3×) and swaps in the high-detail fish exports (`*-hd.glb`: roughly three times the geometry, so smoother bodies, rounder eyes, softer fin edges and finer fin rays). Models reload on the fly when the setting changes and the choice is remembered. Babylon uses the inverse hardware scaling factor. The initial prototype mistakenly reduced resolution as device pixel ratio increased; this is corrected. Higher resolution can cost frame rate on slower phones. The Blender fish are roughly five times the triangle count of the old procedural spheres but are hardware instanced; lighting is still a simple hemispheric and directional pair.

Automated control tests cover keyboard release, mouse aim without movement, touch steering relative to the camera with a rate-limited heading, always-on swimming, depth drag and auto-levelling, bite assist yielding to the thumb, and focus loss. A physical Android/iOS check is still needed to assess touch feel and GPU performance.
