import { setupFullscreen } from "./fullscreen.js";
import { createAquarium } from "./world.js";
import { createFish, loadFishModels } from "./fish.js";
import { modelDetail } from "./rendering.js";
import { createPuffs, createSparks, createStream } from "./effects.js";
import { createFilter } from "./filter.js";
import { createAudio } from "./audio.js";
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
  outweighs,
  FILTER,
} from "/shared/config.js";
const B = window.BABYLON,
  $ = (id) => document.getElementById(id);
// The quality choice survives reloads; restore it before the engine reads it.
try {
  const saved = localStorage.getItem("fishtank.quality");
  if ([...$("resolution").options].some((o) => o.value === saved))
    $("resolution").value = saved;
} catch {
  /* Storage unavailable: keep the default. */
}
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
  sparks = createSparks(scene),
  filter = createFilter(scene, aquarium.glow, sparks),
  controls = createControls($("game"), () => {
    if (network && myId) network.send(controls.read());
  }),
  visuals = new Map();
createStream(scene, filter.spout);
setupFullscreen(() => engine.resize());
// Sound: browsers only start audio after a gesture, so unlock on the first one.
const audio = createAudio();
for (const type of ["pointerdown", "keydown"])
  window.addEventListener(type, () => audio.unlock(), { capture: true });
function syncMute() {
  const on = audio.muted,
    label = on ? "Unmute sound" : "Mute sound";
  $("mute").textContent = on ? "🔇" : "🔊";
  $("mute").setAttribute("aria-pressed", String(on));
  $("mute").setAttribute("aria-label", label);
  $("mute").title = label;
}
$("mute").addEventListener("click", () => {
  audio.setMuted(!audio.muted);
  syncMute();
  audio.play("click");
});
syncMute();
audio.music("menu");
// Fish drawn before the Blender models arrive are rebuilt once they are cached.
// Quality swaps in the authored model tiers; loads are chained so the last choice
// always wins even if the player flips the selector quickly.
let modelsLoading = Promise.resolve(),
  loadedDetail = null;
function loadModels() {
  const detail = modelDetail($("resolution").value);
  if (detail === loadedDetail) return;
  loadedDetail = detail;
  modelsLoading = modelsLoading
    .then(() => loadFishModels(scene, undefined, detail))
    .then(({ failed }) => {
      if (failed.length)
        console.warn(`Using procedural fish for: ${failed.join(", ")}`);
      clearFish();
    });
}
loadModels();
$("resolution").addEventListener("change", () => {
  try {
    localStorage.setItem("fishtank.quality", $("resolution").value);
  } catch {
    /* Not remembered this time. */
  }
  loadModels();
});
let network = null,
  myId = null,
  state = null,
  joining = false,
  time = 0,
  toastUntil = 0,
  lastSend = 0,
  lastDanger = 0,
  deathCam = null,
  touchMode = false,
  leaderId = null;
// Touch camera: settles in behind the fish's own heading instead of an aim.
const follow = { yaw: 0, pitch: 0 };
// How long the camera lingers on the predator before the banner appears.
const DEATH_CAM_SECONDS = 2.2;
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
// On short landscape phones the picker is a one-row carousel.
const carousel = matchMedia("(max-height: 520px) and (orientation: landscape)");
function revealSpecies(option) {
  if (!carousel.matches || !option) return;
  // Scroll only the strip, never the panel around it.
  const strip = $("species"),
    box = strip.getBoundingClientRect(),
    card = option.getBoundingClientRect();
  strip.scrollTo({
    left:
      strip.scrollLeft + (card.left - box.left) - (box.width - card.width) / 2,
    behavior: "smooth",
  });
}
for (const nav of document.querySelectorAll(".species-nav"))
  nav.addEventListener("click", () => {
    audio.play("click");
    const strip = $("species"),
      card = strip.firstElementChild?.getBoundingClientRect().width ?? 56;
    strip.scrollBy({
      left: Number(nav.dataset.dir) * card * 3,
      behavior: "smooth",
    });
  });
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
      audio.play("click");
      chosenSpecies = species;
      revealSpecies(option);
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
    // Long single-word names may break before "fish" on narrow cards.
    name.textContent = speciesLabel(species).replace(
      /^(.{6,})fish$/,
      "$1\u00adfish",
    );
    option.append(input, thumb, name);
    return option;
  }),
);
// After layout, and again if the phone turns, bring the chosen fish into view.
const revealChosen = () =>
  revealSpecies(
    document.querySelector('input[name="species"]:checked')?.parentElement,
  );
requestAnimationFrame(revealChosen);
carousel.addEventListener("change", () => requestAnimationFrame(revealChosen));
function toast(text, ms = 1400) {
  toastUntil = performance.now() + ms;
  $("toast").textContent = text;
}
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
  const canvas = $("game"),
    wide = canvas.clientWidth > canvas.clientHeight,
    // Short landscape phones: the form fills the screen, so keep the hero small
    // and tucked into the top-right corner.
    short = canvas.clientHeight < 520,
    forward = camera.getDirection(B.Vector3.Forward());
  if (wide && short) return hideHero();
  hero.root.position.copyFrom(
    camera.position
      .add(forward.scale(10))
      .add(
        camera
          .getDirection(B.Vector3.Right())
          .scale(wide ? (short ? 6.2 : 4.3) : 0.9),
      )
      .add(
        camera
          .getDirection(B.Vector3.Up())
          .scale(
            (wide ? (short ? 2.6 : 2.2) : 3.5) + Math.sin(time * 1.1) * 0.15,
          ),
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
  hero.root.scaling.setAll(wide ? (short ? 1.1 : 2) : 1.15);
  hero.update(dt);
}
function leave(message = "") {
  controls.setActive(false);
  controls.setTouchMode(false);
  touchMode = false;
  leaderId = null;
  document.body.classList.remove("playing");
  network?.close();
  network = null;
  myId = null;
  state = null;
  joining = false;
  deathCam = null;
  clearFish();
  $("menu").hidden = false;
  $("hud").hidden = true;
  $("lobby").hidden = true;
  $("overlay").hidden = true;
  $("touch").hidden = true;
  $("error").textContent = message;
  $("connection").textContent = "● YOUR NEXT ADVENTURE";
  audio.music("menu");
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
      touchMode = matchMedia("(pointer:coarse)").matches;
      $("touch").hidden = !touchMode;
      controls.setTouchMode(touchMode);
      audio.music("game");
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
      ) {
        controls.orient(me.yaw, me.pitch);
        follow.yaw = me.yaw;
        follow.pitch = 0;
      }
      if (before && !before.alive && me?.alive) {
        audio.play("respawn");
        deathCam = null;
      }
      syncControls(me, next.phase);
      state = next;
      updateUI();
      audio.music(next.phase === "lobby" ? "menu" : "game");
      for (const e of next.events) {
        if (e.type === "ROUND_END") audio.play("round-end");
        if (e.type === "FILTER_ARMED") {
          audio.play("pad");
          toast(
            "⚡ The filter is sparking. Hit its red button to zap the biggest fish.",
            3500,
          );
        }
        if (e.type === "BUZZ" && e.by === myId) audio.play("buzz");
        if (e.type === "ZAP") {
          audio.play("zap");
          const victim = [...next.players, ...next.npcs].find(
            (f) => f.id === e.target,
          );
          const who =
            e.target === myId
              ? "You got zapped"
              : `${victim?.npc ? `A wild ${speciesLabel(victim.species)}` : (victim?.name ?? "The big fish")} got zapped`;
          toast(`⚡ ${who}! ${e.lost} mass scattered as snacks`, 2600);
          const at = visuals.get(e.target)?.root.position;
          if (at) filter.zap(at);
        }
        if (!e.prey) continue;
        if (e.predator === myId) audio.play("chomp");
        else if (e.prey === myId) {
          audio.play("eaten");
          deathCam = {
            predator: e.predator,
            start: performance.now(),
            chews: 0,
            done: false,
            side: 0,
            look: camera.getTarget().clone(),
          };
        } else {
          // Someone else's meal: a pop that fades with distance from my fish.
          const at = visuals.get(e.prey)?.root.position,
            from = visuals.get(myId)?.root.position ?? camera.position;
          audio.play("nearby", {
            distance: at ? B.Vector3.Distance(at, from) : 0,
          });
        }
        visuals.get(e.predator)?.bite();
        const prey = visuals.get(e.prey);
        if (prey) {
          // The player's own swallow runs longer so the death cam can watch it.
          prey.die(e.predator, e.prey === myId ? 1.6 : undefined);
          puffs.burst(prey.root.position, prey.root.scaling.x);
        }
        if (e.predator === myId)
          toast(
            `Ate ${e.label ?? "a snack"}, grew ${(e.grew ?? 0).toFixed(1)}`,
          );
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
$("solo").onclick = () => {
  audio.play("click");
  join("single");
};
$("multi").onclick = () => {
  audio.play("click");
  join("multiplayer");
};
$("leave").onclick = () => {
  audio.play("click");
  leave();
};
$("next-round").onclick = () => {
  audio.play("click");
  network?.request("NEXT_ROUND");
};
$("ready").onclick = () => {
  audio.play("click");
  const mine = state?.lobby?.ready.includes(myId);
  network?.request("READY", { ready: !mine });
};
$("start").onclick = () => {
  audio.play("click");
  network?.request("START");
};
$("lobby-leave").onclick = () => {
  audio.play("click");
  leave();
};
$("lobby-slider").addEventListener("pointerdown", () => (dragging = true));
$("lobby-slider").addEventListener("pointerup", () => (dragging = false));
$("lobby-slider").addEventListener("input", () => {
  $("lobby-minutes").textContent = `${$("lobby-slider").value} min`;
  network?.request("SETTINGS", {
    duration: Number($("lobby-slider").value) * 60,
  });
});
// Lobby panel: who is in, who is ready, the host's match length, and start.
let dragging = false;
function updateLobby(me) {
  const lobby = state.lobby,
    inLobby = state.phase === "lobby" && !!lobby;
  $("lobby").hidden = !inLobby;
  if (!inLobby) return;
  const iAmHost = lobby.host === myId,
    ready = new Set(lobby.ready),
    allReady = state.players.every((p) => ready.has(p.id));
  $("lobby-count").textContent = `· ${state.players.length} IN`;
  $("lobby-players").replaceChildren(
    ...state.players.map((p) => {
      const li = document.createElement("li"),
        name = document.createElement("b"),
        flag = document.createElement("span");
      name.textContent =
        (p.id === lobby.host ? "👑 " : "") +
        p.name +
        (p.id === myId ? " (you)" : "");
      flag.className = "state" + (ready.has(p.id) ? " ready" : "");
      flag.textContent = ready.has(p.id) ? "READY ✓" : "NOT READY";
      li.append(name, flag);
      return li;
    }),
  );
  const minutes = Math.round(lobby.duration / 60);
  if (!dragging) $("lobby-slider").value = String(minutes);
  $("lobby-slider").disabled = !iAmHost;
  $("lobby-minutes").textContent = `${minutes} min`;
  const mine = ready.has(myId);
  $("ready").textContent = mine ? "Ready ✓" : "I'm ready";
  $("ready").setAttribute("aria-pressed", String(mine));
  $("start").hidden = !iAmHost;
  $("start").disabled = !allReady;
  $("lobby-title").textContent = allReady
    ? "Everyone is ready"
    : "Waiting for the shoal";
  $("lobby-hint").textContent = iAmHost
    ? allReady
      ? "You are the host. Hit start when you like."
      : "You are the host: set the match length, then start once everyone is ready."
    : allReady
      ? `Waiting for ${state.players.find((p) => p.id === lobby.host)?.name ?? "the host"} to start the game.`
      : "Mark yourself ready. The host starts the game once everyone is.";
}
function updateUI() {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  updateLobby(me);
  $("hud").hidden = state.phase === "lobby";
  $("mass").textContent = me.mass.toFixed(1);
  $("score").textContent = me.score;
  $("timer").textContent =
    `${Math.floor(Math.max(0, state.remaining) / 60)}:${String(Math.floor(Math.max(0, state.remaining) % 60)).padStart(2, "0")}`;
  $("count").textContent = `· ${state.players.length}`;
  $("cover").hidden = !me.hidden;
  const ranked = [...state.players].sort(
    (a, b) => b.score - a.score || b.mass - a.mass,
  );
  // The crown needs a clear leader: someone who has scored and is not tied.
  leaderId =
    ranked[0]?.score > 0 &&
    (ranked.length < 2 || ranked[0].score > ranked[1].score)
      ? ranked[0].id
      : null;
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
  $("overlay").hidden =
    state.phase === "lobby" ||
    (me.alive && state.phase === "playing") ||
    !!(deathCam && !deathCam.done);
  if (state.phase === "results") {
    $("overlay-tag").textContent = `ROUND ${state.round} COMPLETE`;
    $("overlay-title").textContent = `${ranked[0]?.name || "Nobody"} wins!`;
    const largest = [...state.players].sort((a, b) => b.mass - a.mass)[0];
    $("overlay-text").textContent =
      `Largest fish: ${largest.name} · ${largest.mass.toFixed(1)} mass\nYour score: ${me.score}`;
    $("next-round").hidden = false;
  } else if (!me.alive) {
    $("next-round").hidden = true;
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
// Other players' names float above their fish: HTML labels projected from 3D
// each frame, faded with distance and hidden while the player is in cover.
const labels = new Map();
function placeLabels() {
  const players = state?.players ?? [],
    seen = new Set(),
    canvas = $("game"),
    width = canvas.clientWidth,
    height = canvas.clientHeight,
    viewport = camera.viewport.toGlobal(width, height),
    transform = scene.getTransformMatrix(),
    forward = camera.getDirection(B.Vector3.Forward());
  for (const p of players) {
    if (p.id === myId) continue;
    seen.add(p.id);
    let label = labels.get(p.id);
    if (!label) {
      label = document.createElement("div");
      label.className = "label";
      $("labels").append(label);
      labels.set(p.id, label);
    }
    const text = (p.id === leaderId ? "👑 " : "") + p.name;
    if (label.textContent !== text) label.textContent = text;
    const v = visuals.get(p.id);
    if (!p.alive || p.hidden || !v?.root.isEnabled()) {
      label.hidden = true;
      continue;
    }
    const point = v.root.position.add(
      new B.Vector3(0, radius(p.mass) * 1.6 + 0.4, 0),
    );
    const onScreen = B.Vector3.Project(
      point,
      B.Matrix.IdentityReadOnly,
      transform,
      viewport,
    );
    const ahead = B.Vector3.Dot(point.subtract(camera.position), forward) > 0.5;
    if (
      !ahead ||
      onScreen.x < -60 ||
      onScreen.x > width + 60 ||
      onScreen.y < -30 ||
      onScreen.y > height + 30
    ) {
      label.hidden = true;
      continue;
    }
    label.hidden = false;
    label.style.transform = `translate(${onScreen.x.toFixed(1)}px, ${onScreen.y.toFixed(1)}px) translate(-50%, -100%)`;
    label.style.opacity = Math.max(
      0.3,
      1 - B.Vector3.Distance(point, camera.position) / 70,
    ).toFixed(2);
  }
  for (const [id, label] of labels)
    if (!seen.has(id)) {
      label.remove();
      labels.delete(id);
    }
}
// Touch bite assist: the nearest lighter fish inside a narrow cone ahead.
function biteAssist(me) {
  const heading = direction(me),
    reach = 7 + radius(me.mass) * 3;
  let best = null,
    nearest = Infinity;
  for (const f of [...state.npcs, ...state.players]) {
    if (f.id === me.id || !f.alive || !outweighs(me, f)) continue;
    const dx = f.x - me.x,
      dy = f.y - me.y,
      dz = f.z - me.z,
      dist = Math.hypot(dx, dy, dz);
    if (dist > reach || dist < 0.01 || dist >= nearest) continue;
    const along = (dx * heading.x + dy * heading.y + dz * heading.z) / dist;
    if (along < Math.cos(0.35)) continue;
    nearest = dist;
    best = {
      yaw: Math.atan2(dx, dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    };
  }
  return best;
}
// Death cam: swing to the predator's mouth from the side and watch it chew.
function deathCamera(dt, now) {
  const elapsed = (now - deathCam.start) / 1000,
    predator = visuals.get(deathCam.predator),
    anchor = predator?.root.isEnabled() ? predator : visuals.get(myId);
  if (!anchor) return;
  const yaw = anchor.root.rotation.y,
    forward = new B.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
    right = new B.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    focus = (anchor === predator && mouth(predator)) || anchor.root.position,
    span = 4 + anchor.root.scaling.x * 3;
  // Stay on the side the camera is already on so it never swings through the fish.
  if (!deathCam.side)
    deathCam.side =
      B.Vector3.Dot(camera.position.subtract(focus), right) >= 0 ? 1 : -1;
  const desired = focus
    .add(right.scale(deathCam.side * span * 0.9))
    .add(new B.Vector3(0, span * 0.35, 0))
    .subtract(forward.scale(span * 0.15));
  desired.x = clamp(desired.x, -35, 35);
  desired.y = clamp(desired.y, 1.5, 29);
  desired.z = clamp(desired.z, -35, 35);
  camera.position = B.Vector3.Lerp(
    camera.position,
    desired,
    1 - Math.exp(-dt * 4),
  );
  deathCam.look = B.Vector3.Lerp(deathCam.look, focus, 1 - Math.exp(-dt * 6));
  camera.setTarget(deathCam.look);
  // Two more visible chews while the meal goes down.
  if (predator && deathCam.chews < 2 && elapsed > 0.55 * (deathCam.chews + 1)) {
    deathCam.chews++;
    predator.bite();
    audio.play("chomp", { volume: 0.6 });
  }
  if (!deathCam.done && elapsed > DEATH_CAM_SECONDS) {
    deathCam.done = true;
    updateUI();
  }
}
// Portrait phones only see the rotate prompt: rendering pauses and the fish
// holds still until the phone is turned.
const portrait = matchMedia("(pointer: coarse) and (orientation: portrait)");
function syncControls(me, phase) {
  controls.setActive(!!me?.alive && phase === "playing" && !portrait.matches);
}
portrait.addEventListener("change", () => {
  syncControls(
    state?.players.find((p) => p.id === myId),
    state?.phase,
  );
  requestAnimationFrame(() => engine.resize());
});
engine.runRenderLoop(() => {
  if (portrait.matches) return;
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  time += dt;
  aquarium.animate(dt);
  const now = performance.now();
  const me = state?.players.find((p) => p.id === myId);
  if (touchMode) controls.assist(me?.alive ? biteAssist(me) : null);
  const input = controls.read(dt, follow.yaw);
  if (network && myId && now - lastSend > 50) {
    network.send(input);
    lastSend = now;
  }
  $("toast").hidden = now > toastUntil;
  filter.update(state?.filter, dt);
  const fish = state
    ? [...state.npcs, ...state.players]
    : demos.map((f, i) => ({
        ...f,
        x: Math.sin(time * 0.13 + i * 2.4) * 18,
        z: Math.cos(time * 0.13 + i * 2.4) * 18,
        yaw: time * 0.13 + i * 2.4 + Math.PI / 2,
      }));
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
      if (outweighs(f, me)) threat = -1;
      else if (outweighs(me, f)) threat = 1;
    }
    v.threat += (threat - v.threat) * settle;
    // A low warning when something that can eat me swims close.
    if (
      threat === -1 &&
      !me.hidden &&
      now - lastDanger > 6000 &&
      Math.hypot(f.x - me.x, f.y - me.y, f.z - me.z) < 10 + r
    ) {
      lastDanger = now;
      audio.play("danger");
    }
    v.tint(v.threat);
    if (!f.npc) v.setCrown(f.id === leaderId);
    v.jolt(f.stunned > 0);
    if (f.stunned > 0) sparks.burst(v.root.position, 2, r);
  }
  placeLabels();
  const mine = me?.alive && visuals.get(me.id);
  if (deathCam && me && !me.alive) deathCamera(dt, now);
  else if (mine) {
    const r = radius(me.mass),
      p = mine.root.position;
    let d;
    if (touchMode) {
      const k = 1 - Math.exp(-dt * 3);
      follow.yaw = wrap(
        follow.yaw + wrap(mine.root.rotation.y - follow.yaw) * k,
      );
      follow.pitch += (-mine.root.rotation.x * 0.5 - follow.pitch) * k;
      d = direction(follow);
    } else d = direction(input);
    const desired = new B.Vector3(
      p.x - d.x * (7 + r * 3),
      p.y + 2 + r * 0.4 - d.y * (7 + r * 3),
      p.z - d.z * (7 + r * 3),
    );
    desired.x = Math.max(-35, Math.min(35, desired.x));
    desired.y = Math.max(1.5, Math.min(29, desired.y));
    desired.z = Math.max(-35, Math.min(35, desired.z));
    // Never park the camera inside the filter canister in the corner.
    if (desired.x < FILTER.x + 3.5 && desired.z > FILTER.z - 3.5)
      desired.z = FILTER.z - 3.5;
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
