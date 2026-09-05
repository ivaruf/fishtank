import { setupFullscreen } from "./fullscreen.js";
import { createAquarium } from "./world.js";
import { createFish, loadFishModels } from "./fish.js";
import { createPuffs } from "./effects.js";
import { createControls } from "./controls.js";
import { connect } from "./networking.js";
import {
  CONFIG as C,
  SPECIES,
  PROTOCOL,
  radius,
  direction,
  clamp,
  wrap,
  speciesLabel,
} from "/shared/config.js";
const B = window.BABYLON,
  $ = (id) => document.getElementById(id);
let aquarium;
try {
  aquarium = createAquarium($("game"));
} catch (e) {
  $("error").textContent =
    "This aquarium needs WebGL. Please enable hardware acceleration or try another browser.";
  throw e;
}
const { engine, scene, camera } = aquarium,
  puffs = createPuffs(scene),
  controls = createControls($("game"), () => {
    if (network && myId) network.send(controls.read());
  }),
  visuals = new Map();
setupFullscreen(() => engine.resize());
// Fish drawn before the Blender models arrive are rebuilt once they are cached.
loadFishModels(scene).then(({ failed }) => {
  if (failed.length)
    console.warn(`Using procedural fish for: ${failed.join(", ")}`);
  clearFish();
});
let network = null,
  myId = null,
  state = null,
  joining = false,
  time = 0,
  toastUntil = 0,
  lastSend = 0;
const demos = Array.from({ length: 18 }, (_, i) => ({
  id: `demo-${i}`,
  color: i % 5,
  species: SPECIES[i % SPECIES.length],
  npc: true,
  mass: 3 + (i % 7),
  alive: true,
  x: Math.sin(i * 2.4) * 15,
  y: 4 + (i % 6) * 3,
  z: Math.cos(i * 2.4) * 15,
  yaw: i,
  pitch: 0,
}));
// Species picker: one card per model, remembered between visits.
let chosenSpecies = SPECIES[0];
try {
  const saved = localStorage.getItem("fishtank.species");
  if (SPECIES.includes(saved)) chosenSpecies = saved;
} catch {
  /* Private mode or blocked storage: keep the default. */
}
$("species").replaceChildren(
  ...SPECIES.map((species) => {
    const option = document.createElement("label");
    option.className = "species-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "species";
    input.value = species;
    input.checked = species === chosenSpecies;
    input.addEventListener("change", () => {
      chosenSpecies = species;
      try {
        localStorage.setItem("fishtank.species", species);
      } catch {
        /* Not remembered this time. */
      }
    });
    const thumb = document.createElement("img");
    thumb.src = `/assets/thumbs/${species}.png`;
    thumb.alt = "";
    thumb.width = 58;
    thumb.height = 48;
    const name = document.createElement("span");
    name.textContent = speciesLabel(species);
    option.append(input, thumb, name);
    return option;
  }),
);
function clearFish() {
  for (const v of visuals.values()) v.dispose();
  visuals.clear();
  hideHero();
}
// The chosen species swims large beside the menu until the player dives in.
let hero = null;
function hideHero() {
  hero?.dispose();
  hero = null;
}
function showHero(dt) {
  if (hero && hero.species !== chosenSpecies) hideHero();
  if (!hero) {
    hero = createFish(scene, chosenSpecies, false);
    hero.species = chosenSpecies;
    hero.swim.speedRatio = 0.9;
  }
  const wide = engine.getRenderWidth() > engine.getRenderHeight(),
    forward = camera.getDirection(B.Vector3.Forward());
  hero.root.position.copyFrom(
    camera.position
      .add(forward.scale(10))
      .add(camera.getDirection(B.Vector3.Right()).scale(wide ? 4.3 : 0.9))
      .add(
        camera
          .getDirection(B.Vector3.Up())
          .scale((wide ? -0.1 : 3.5) + Math.sin(time * 1.1) * 0.15),
      ),
  );
  // Three-quarter view that slowly swings between profile and face-on.
  hero.root.rotation.set(
    Math.sin(time * 0.8) * 0.06,
    Math.atan2(forward.x, forward.z) +
      Math.PI / 2 +
      0.55 +
      Math.sin(time * 0.45) * 0.55,
    0,
  );
  hero.root.scaling.setAll(wide ? 2 : 1.15);
  hero.update(dt);
}
function leave(message = "") {
  controls.setActive(false);
  document.body.classList.remove("playing");
  network?.close();
  network = null;
  myId = null;
  state = null;
  joining = false;
  clearFish();
  $("menu").hidden = false;
  $("hud").hidden = true;
  $("overlay").hidden = true;
  $("touch").hidden = true;
  $("error").textContent = message;
  $("connection").textContent = "● YOUR NEXT ADVENTURE";
}
function join(mode) {
  if (joining || network) return;
  joining = true;
  $("error").textContent = "Connecting…";
  const connection = connect({
    name: $("name").value,
    mode,
    species: chosenSpecies,
    onWelcome(id, protocol) {
      myId = id;
      joining = false;
      document.body.classList.add("playing");
      $("game").focus();
      clearFish();
      $("menu").hidden = true;
      $("hud").hidden = false;
      $("error").textContent = "";
      $("touch").hidden = !matchMedia("(pointer:coarse)").matches;
      $("connection").textContent =
        mode === "single" ? "● SOLO AQUARIUM" : "● LAN MULTIPLAYER";
      if (protocol !== PROTOCOL) {
        console.warn(
          `Server speaks protocol ${protocol}, this client expects ${PROTOCOL}. Restart the server (npm start).`,
        );
        $("connection").textContent = "● SERVER IS AN OLDER BUILD · RESTART IT";
      }
    },
    onState(next) {
      const before = state?.players.find((p) => p.id === myId);
      const me = next.players.find((p) => p.id === myId);
      if (
        me &&
        (!before || (!before.alive && me.alive) || next.round !== state?.round)
      )
        controls.orient(me.yaw, me.pitch);
      controls.setActive(!!me?.alive && next.phase === "playing");
      state = next;
      updateUI();
      for (const e of next.events) {
        if (!e.prey) continue;
        visuals.get(e.predator)?.bite();
        const prey = visuals.get(e.prey);
        if (prey) {
          prey.die(e.predator);
          puffs.burst(prey.root.position, prey.root.scaling.x);
        }
        if (e.predator === myId) {
          toastUntil = performance.now() + 1400;
          $("toast").textContent = "A little bigger. A little bolder. +";
        }
      }
    },
    onError(message) {
      $("error").textContent = message;
    },
    onClose() {
      if (network === connection)
        leave("Connection closed. Dive in again to reconnect.");
    },
  });
  network = connection;
}
$("solo").onclick = () => join("single");
$("multi").onclick = () => join("multiplayer");
$("leave").onclick = () => leave();
function updateUI() {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  $("mass").textContent = me.mass.toFixed(1);
  $("score").textContent = me.score;
  $("timer").textContent =
    `${Math.floor(Math.max(0, state.remaining) / 60)}:${String(Math.floor(Math.max(0, state.remaining) % 60)).padStart(2, "0")}`;
  $("count").textContent = `· ${state.players.length}`;
  const ranked = [...state.players].sort(
    (a, b) => b.score - a.score || b.mass - a.mass,
  );
  $("leaders").replaceChildren(
    ...ranked.slice(0, 8).map((p) => {
      const li = document.createElement("li");
      li.textContent = p.name + (p.id === myId ? " (you)" : "");
      const score = document.createElement("span");
      score.textContent = p.score;
      li.append(score);
      return li;
    }),
  );
  $("overlay").hidden = me.alive && state.phase === "playing";
  if (state.phase === "results") {
    $("overlay-tag").textContent = `ROUND ${state.round} COMPLETE`;
    $("overlay-title").textContent = `${ranked[0]?.name || "Nobody"} wins!`;
    const largest = [...state.players].sort((a, b) => b.mass - a.mass)[0];
    $("overlay-text").textContent =
      `Largest fish: ${largest.name} · ${largest.mass.toFixed(1)} mass\nYour score: ${me.score}\nNext round in ${Math.ceil(state.remaining)}s`;
  } else if (!me.alive) {
    $("overlay-tag").textContent = "THERE’S ALWAYS A BIGGER FISH";
    $("overlay-title").textContent = "You became lunch.";
    $("overlay-text").textContent =
      `Eaten by ${me.killedBy}\nBack in the water in ${Math.ceil(me.respawn)}s`;
  }
}
// Where a fish's mouth is right now, or null if it is not being shown.
function mouth(v) {
  if (!v?.root.isEnabled()) return null;
  const d = direction({ yaw: v.root.rotation.y, pitch: -v.root.rotation.x });
  return v.root.position.add(
    new B.Vector3(d.x, d.y, d.z).scale(v.root.scaling.x * 0.8),
  );
}
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  time += dt;
  aquarium.animate(dt);
  const now = performance.now();
  const input = controls.read(dt);
  if (network && myId && now - lastSend > 50) {
    network.send(input);
    lastSend = now;
  }
  $("toast").hidden = now > toastUntil;
  const fish = state
    ? [...state.npcs, ...state.players]
    : demos.map((f, i) => ({
        ...f,
        x: Math.sin(time * 0.13 + i * 2.4) * 18,
        z: Math.cos(time * 0.13 + i * 2.4) * 18,
        yaw: time * 0.13 + i * 2.4 + Math.PI / 2,
      }));
  const me = state?.players.find((p) => p.id === myId);
  const ids = new Set(fish.map((f) => f.id));
  for (const [id, v] of visuals)
    if (!ids.has(id)) {
      v.dispose();
      visuals.delete(id);
    }
  const alpha = 1 - Math.exp(-dt * 12),
    settle = 1 - Math.exp(-dt * 5);
  for (const f of fish) {
    let v = visuals.get(f.id);
    if (!v) {
      // Snapshots from an older server carry no species; stay deterministic.
      v = createFish(
        scene,
        f.species ?? SPECIES[f.color % SPECIES.length],
        f.npc,
        f.color,
      );
      visuals.set(f.id, v);
    }
    if (f.alive && !v.wasAlive) {
      // Fresh spawn: appear in place rather than streak across the tank.
      v.reset();
      v.root.position.set(f.x, f.y, f.z);
      v.root.rotation.set(-f.pitch, f.yaw, 0);
    }
    v.wasAlive = f.alive;
    const dying = v.update(dt);
    v.root.setEnabled(f.alive || dying);
    if (!f.alive && !dying) continue;
    const r = radius(f.mass);
    // Prey drifts into its predator's mouth while the death animation plays.
    const target = f.alive
      ? new B.Vector3(f.x, f.y, f.z)
      : (mouth(visuals.get(v.eatenBy)) ?? v.root.position);
    // Distance closed this frame approximates the fish's speed for the tail.
    const speed =
      (B.Vector3.Distance(v.root.position, target) * alpha) /
      Math.max(dt, 0.001);
    v.root.position = B.Vector3.Lerp(v.root.position, target, alpha);
    v.root.rotation.y += wrap(f.yaw - v.root.rotation.y) * alpha;
    v.root.rotation.x += (-f.pitch - v.root.rotation.x) * alpha;
    v.root.scaling.setAll(r);
    v.swim.speedRatio +=
      (clamp(0.4 + (speed * 0.2) / Math.sqrt(r), 0.4, 2.4) -
        v.swim.speedRatio) *
      settle;
    // Subtle cue: food looks a touch brighter, threats a touch darker.
    let threat = 0;
    if (me?.alive && f.id !== myId) {
      if (f.mass >= me.mass * C.eatRatio) threat = -1;
      else if (me.mass >= f.mass * C.eatRatio) threat = 1;
    }
    v.threat += (threat - v.threat) * settle;
    v.tint(v.threat);
  }
  const mine = me && visuals.get(me.id);
  if (mine) {
    const d = direction(input),
      r = radius(me.mass),
      p = mine.root.position;
    const desired = new B.Vector3(
      p.x - d.x * (7 + r * 3),
      p.y + 2 + r * 0.4 - d.y * (7 + r * 3),
      p.z - d.z * (7 + r * 3),
    );
    desired.x = Math.max(-35, Math.min(35, desired.x));
    desired.y = Math.max(1.5, Math.min(29, desired.y));
    desired.z = Math.max(-35, Math.min(35, desired.z));
    camera.position = B.Vector3.Lerp(
      camera.position,
      desired,
      1 - Math.exp(-dt * 20),
    );
    camera.setTarget(p.add(new B.Vector3(d.x * 3, d.y * 2, d.z * 3)));
  } else {
    camera.position.set(Math.sin(time * 0.035) * 8, 13, -28);
    camera.setTarget(new B.Vector3(1, 11, 0));
    if (network) hideHero();
    else showHero(dt);
  }
  scene.render();
});
