import { setupFullscreen } from "./fullscreen.js";
import { createAquarium } from "./world.js";
import { createFish, loadFishModels } from "./fish.js";
import { mountQuality, quality, modelDetail, reliefStep } from "./quality.js";
import { createPuffs, createSparks, createStream } from "./effects.js";
import { createFilter } from "./filter.js";
import { createAudio } from "./audio.js";
import { createControls } from "./controls.js";
import { hostGame, joinGame, createHostEngine } from "./peer.js";
import { hostRendezvous, joinRendezvous } from "./rendezvous.js";
import { BUILD } from "./build.js";
import { fishName } from "./names.js";
import {
  CODE_LENGTH,
  SYMBOLS,
  newCode,
  parseCode,
  spellCode,
  symbolsOf,
} from "./codes.js";
import {
  CONFIG as C,
  SPECIES,
  PROTOCOL,
  DIFFICULTY,
  tier,
  radius,
  direction,
  clamp,
  wrap,
  speciesLabel,
  outweighs,
  FILTER,
} from "../../shared/config.js";
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
  const detail = modelDetail(quality.value);
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
// quality.js owns the value and remembers it; this only reacts to it.
quality.addEventListener("change", loadModels);
// Two copies, one setting. The menu's sits in the header where it always did
// and keeps its dropdown; the one in the pause dialog is why the header's can
// disappear during play, and it is flat - five rows outright, because a popup
// inside a panel that scrolls on a phone was clipped however it was laid out.
mountQuality($("quality-menu"), () => audio.play("click"));
mountQuality($("quality-play"), () => audio.play("click"), { flat: true });
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
// Installable, and playable with no network: solo already runs entirely in the
// tab, so caching the files is the last piece. Registration is deliberately
// fire-and-forget — the game must work exactly the same if it fails, and
// service workers need a secure context, so plain-http LAN play simply skips it.
if ("serviceWorker" in navigator && window.isSecureContext)
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register("sw.js")
      .catch((error) => console.info("Offline support unavailable:", error)),
  );
// Which build is serving us, shown on the menu so a deploy can be confirmed
// without guessing. Read from the site rather than baked into the page: BUILD
// below is what this copy of the code was stamped with, and the point is to
// catch the case where those two disagree. Relative, so it works under a
// project Pages subpath too, and the service worker keeps it uncached.
const ask = (url) =>
  fetch(url, { cache: "no-store" }).then((r) =>
    r.ok ? r.json() : Promise.reject(new Error(r.status)),
  );
// tools/build-static.mjs writes version.json beside the page. Serving the
// repo directly for development has no such file, which is why "build unknown"
// below is a normal thing to see rather than a fault.
ask("version.json")
  .then(({ version, started, protocol }) => {
    // `version` is the build being served; BUILD is the build this page is
    // made of. When they disagree, something between the two — the HTTP cache
    // or an installed service worker — is still handing out old code, and
    // reporting the served number would be a straight lie: it is the case the
    // line exists to catch.
    const stale = BUILD !== "dev" && version !== BUILD;
    $("version").textContent = stale
      ? `build ${BUILD} · TAP FOR THE NEW ONE`
      : `build ${version}`;
    $("version").classList.toggle("stale", stale);
    const when = new Date(started);
    $("version").title = stale
      ? `This page is running build ${BUILD}, but build ${version} is deployed. Tap to reload.`
      : `Build ${version}, protocol ${protocol}, running since ` +
        (isNaN(when) ? started : when.toLocaleString());
    if (stale)
      $("version").onclick = () =>
        // Drop the worker's copy too, and wait for it: a reload that overtakes
        // the deletions just serves the same files back. Best effort either
        // way — the reload happens however the cleanup goes.
        Promise.resolve()
          .then(() => caches?.keys())
          .then((all) =>
            Promise.all((all ?? []).map((key) => caches.delete(key))),
          )
          .catch(() => {})
          .finally(() => location.reload());
  })
  .catch(() => {
    // Say it is unknown rather than show a stale or invented version.
    $("version").textContent = "build unknown";
    $("version").title = "Could not find a build number to report.";
  });
// How long the camera lingers on the predator before the banner appears.
const DEATH_CAM_SECONDS = 2.2;
// The radius at mass 200, past which the follow camera starts giving ground
// faster - see the note where `back` is worked out.
const BIG_FISH = radius(200);
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
// Rolled once a session and offered as the placeholder, so the field reads as
// a suggestion rather than a demand. Typing replaces it, as a placeholder
// does; not typing sends it, which is what `playerName` below is for.
$("name").placeholder = fishName();
const playerName = () => $("name").value.trim() || $("name").placeholder;
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
    thumb.src = `assets/thumbs/${species}.png`;
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
const preview = $("fish-preview");
const previewLight = new B.HemisphericLight(
  "preview fill",
  B.Vector3.Up(),
  scene,
);
const mobilePreview = matchMedia("(pointer: coarse)");
const previewHint = preview.querySelector("span");
const syncPreview = () => {
  const touch = mobilePreview.matches;
  previewLight.intensity = touch ? 2.1 : 1.5;
  // The gesture worth naming is the one this device has.
  previewHint.textContent = touch
    ? "Your fish · drag to turn · pinch to zoom"
    : "Your fish · drag to turn · scroll to zoom";
};
mobilePreview.addEventListener("change", syncPreview);
syncPreview();
previewLight.diffuse = new B.Color3(1, 0.96, 0.88);
previewLight.groundColor = new B.Color3(0.48, 0.65, 0.7);
previewLight.specular = new B.Color3(0.25, 0.25, 0.25);
previewLight.renderPriority = 100;
previewLight.setEnabled(false);
// Turning the fish and getting closer to it. The drag is inverted from the
// obvious mapping on purpose: dragging right pushes the near side of the fish
// away from you rather than swinging it with the cursor, which is how looking
// at an object in your hands works and is what everyone tried first.
const ZOOM = { min: 0.55, max: 2.4 };
const spin = {
  // Every pointer currently down, so two of them can be a pinch. One is a
  // turn, two is a zoom, and dropping back to one becomes a turn again.
  pointers: new Map(),
  x: 0,
  y: 0,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  pinch: 0,
  touched: false,
};
function releasePreview() {
  for (const id of spin.pointers.keys())
    if (preview.hasPointerCapture(id)) preview.releasePointerCapture(id);
  spin.pointers.clear();
  spin.pinch = 0;
  preview.classList.remove("grabbing");
}
// The gap between two fingers, or 0 unless there are exactly two.
const spread = () => {
  if (spin.pointers.size !== 2) return 0;
  const [a, b] = [...spin.pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
preview.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || spin.pointers.size >= 2) return;
  // Catch the idle sway where it stands, so grabbing it never jumps.
  if (!spin.touched) spin.yaw = Math.sin(time * 0.45) * 0.55;
  spin.touched = true;
  spin.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  spin.x = event.clientX;
  spin.y = event.clientY;
  spin.pinch = spread();
  preview.setPointerCapture(event.pointerId);
  preview.classList.add("grabbing");
  event.preventDefault();
});
preview.addEventListener("pointermove", (event) => {
  const at = spin.pointers.get(event.pointerId);
  if (!at) return;
  at.x = event.clientX;
  at.y = event.clientY;
  const gap = spread();
  if (gap) {
    // Pinching: the ratio of the gap to the gap it started at, so the fish
    // tracks the fingers rather than drifting at a rate.
    if (spin.pinch)
      spin.zoom = clamp(spin.zoom * (gap / spin.pinch), ZOOM.min, ZOOM.max);
    spin.pinch = gap;
    return;
  }
  spin.yaw -= (event.clientX - spin.x) * 0.012;
  spin.pitch = clamp(spin.pitch - (event.clientY - spin.y) * 0.01, -1.3, 1.3);
  spin.x = event.clientX;
  spin.y = event.clientY;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  preview.addEventListener(type, (event) => {
    if (!spin.pointers.delete(event.pointerId)) return;
    if (preview.hasPointerCapture(event.pointerId))
      preview.releasePointerCapture(event.pointerId);
    // A finger lifted out of a pinch leaves one behind, and turning has to
    // resume from where that one is rather than from where the other was.
    spin.pinch = 0;
    const left = [...spin.pointers.values()][0];
    if (left) {
      spin.x = left.x;
      spin.y = left.y;
    } else preview.classList.remove("grabbing");
  });
// Exponential, so every notch of the wheel is the same proportional step
// whatever the zoom already is, and deltaMode is honoured because a line-mode
// wheel reports single digits where a pixel-mode one reports hundreds.
preview.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    spin.touched = true;
    const lines = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    spin.zoom = clamp(
      spin.zoom * Math.exp(-lines * 0.0012),
      ZOOM.min,
      ZOOM.max,
    );
  },
  { passive: false },
);
window.addEventListener("blur", releasePreview);
function hideHero() {
  releasePreview();
  preview.hidden = true;
  previewLight.setEnabled(false);
  previewLight.includedOnlyMeshes = [];
  hero?.dispose();
  hero = null;
}
function showHero(dt) {
  if (hero && hero.species !== chosenSpecies) hideHero();
  if (!hero) {
    hero = createFish(scene, chosenSpecies, false, 0, true);
    previewLight.includedOnlyMeshes = hero.root.getChildMeshes();
    previewLight.setEnabled(true);
    hero.species = chosenSpecies;
    hero.swim.speedRatio = 0.9;
  }
  preview.hidden = false;
  const canvas = $("game"),
    bounds = preview.getBoundingClientRect(),
    screen = canvas.getBoundingClientRect(),
    forward = camera.getDirection(B.Vector3.Forward()),
    halfHeight = Math.tan(camera.fov / 2) * 10,
    halfWidth = (halfHeight * screen.width) / screen.height,
    x = ((bounds.left + bounds.width / 2 - screen.left) / screen.width) * 2 - 1,
    y = 1 - ((bounds.top + bounds.height / 2 - screen.top) / screen.height) * 2;
  previewLight.direction.copyFrom(
    forward.scale(-1).add(camera.getDirection(B.Vector3.Up())),
  );
  hero.root.position.copyFrom(
    camera.position
      .add(forward.scale(10))
      .add(camera.getDirection(B.Vector3.Right()).scale(x * halfWidth))
      .add(camera.getDirection(B.Vector3.Up()).scale(y * halfHeight)),
  );
  hero.root.rotation.set(
    spin.touched ? spin.pitch : Math.sin(time * 0.8) * 0.06,
    Math.atan2(forward.x, forward.z) +
      Math.PI / 2 +
      0.55 +
      (spin.touched ? spin.yaw : Math.sin(time * 0.45) * 0.55),
    0,
  );
  hero.root.scaling.setAll(
    (Math.min(bounds.width, bounds.height) / screen.height) *
      halfHeight *
      0.65 *
      spin.zoom,
  );
  hero.update(dt);
}
let leavePromptOpen = false;
function openGameMenu() {
  if (!myId || $("hud").hidden || leavePromptOpen) return;
  leavePromptOpen = true;
  controls.setActive(false);
  // Alone in the tank, this really is a pause: the host stops the world. The
  // host decides that, not this - World.setPaused refuses with anyone else in
  // the water - so the request is sent either way and the panel says which of
  // the two it got, because a panel labelled "paused" over a tank that is
  // still hunting you is worse than one that never claimed to be.
  const alone = state?.players.length === 1;
  network?.request("PAUSE", { on: true });
  $("pause-tag").textContent = alone ? "PAUSED" : "FISHTANK";
  $("leave-dialog").showModal();
}
function continueGame() {
  leavePromptOpen = false;
  network?.request("PAUSE", { on: false });
  $("leave-dialog").close();
  syncControls(
    state?.players.find((p) => p.id === myId),
    state?.phase,
  );
  $("game").focus();
}
$("continue").onclick = continueGame;
$("leave-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  continueGame();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.repeat && !leavePromptOpen) {
    event.preventDefault();
    openGameMenu();
  }
});
// Browsers consume Escape when releasing pointer lock.
let wasPointerLocked = false;
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === $("game");
  if (
    wasPointerLocked &&
    !locked &&
    state?.phase === "playing" &&
    state.players.find((p) => p.id === myId)?.alive &&
    !portrait.matches
  )
    openGameMenu();
  wasPointerLocked = locked;
});
document.querySelector(".brand").addEventListener("click", (event) => {
  if (myId) {
    event.preventDefault();
    openGameMenu();
  }
});
function leave(message = "") {
  leavePromptOpen = false;
  $("leave-dialog").close();
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
  stopSignalling();
  $("peer-hint").textContent = "";
  $("menu").hidden = false;
  $("hud").hidden = true;
  $("games").hidden = true;
  $("lobby").hidden = true;
  $("overlay").hidden = true;
  $("touch").hidden = true;
  $("error").textContent = message;
  $("connection").textContent = "";
  audio.music("menu");
}
// mode "single" plays immediately; "multiplayer" needs a tank, either the one
// the player picked or, with room omitted, whichever the server has space in.
// The callbacks every transport shares. `current` is read lazily because a
// transport's own object does not exist yet when these are built, and `kind`
// only changes the label: a snapshot means the same thing however it arrived.
function handlers(current, kind) {
  const solo = kind === "solo";
  return {
    onWelcome(id, protocol, roomName) {
      myId = id;
      joining = false;
      document.body.classList.add("playing");
      $("game").focus();
      clearFish();
      $("menu").hidden = true;
      $("games").hidden = true;
      $("hud").hidden = false;
      $("error").textContent = "";
      touchMode = matchMedia("(pointer:coarse)").matches;
      // The zones themselves are put up by syncControls, on the first snapshot
      // that says a round is actually running - welcome lands in the lobby,
      // whose buttons they would otherwise be covering.
      controls.setTouchMode(touchMode);
      audio.music("game");
      // With a code to give out, the code is the whole line. A host can still
      // be joined mid-round, so it stays on screen once the lobby is gone -
      // and it is the thing someone reads out loud, which "YOUR TANK · CODE"
      // in front of it did nothing for but wrap it onto two lines.
      $("connection").textContent = invite
        ? `Code: ${spellCode(invite.code)}`
        : solo
          ? "Solo aquarium"
          : (roomName ?? "A friend's tank");
      // Host and guest are two browsers with two copies of this code, so a
      // mismatch means one of them has not reloaded. It is the guest that can
      // see both numbers, so it is the guest that says so.
      if (protocol !== PROTOCOL) {
        console.warn(
          `The host speaks protocol ${protocol}, this tank expects ${PROTOCOL}. One of you is on an older build; reload both.`,
        );
        $("connection").textContent = "Different builds — reload both";
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
        visuals.get(e.predator)?.grow(e.grew ?? 1);
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
      if (network !== current()) return;
      // The only thing that can close now is the peer link: the host closed
      // its tab, or the connection died. Either way there is nothing to
      // reconnect to, so send them back to the menu rather than imply there is.
      leave("The tank closed. Host one, or join a friend again.");
    },
  };
}
function closePanel() {
  $("games").hidden = true;
}
$("join").onclick = () => {
  audio.play("click");
  if (network) return;
  $("games").hidden = false;
  peerNote("");
  drawPicked();
};
// Peer to peer, which is now the only kind of multiplayer there is. One player
// hosts the simulation and the others connect straight to them, which is what
// lets a static site run multiplayer at all - and what let the server go.
let signalling = null;
// The code this device is hosting under, if it is hosting: the lobby and the
// HUD both show it, because a host who cannot find their own code again has
// nothing to invite anyone with.
let invite = null;
// A host that falls asleep stops answering its own code, so ask the device to
// stay awake while it is hosting. Best effort by design: not every browser has
// this, and the game must not care if the request is refused.
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    /* Denied or unsupported: the lobby still warns if the code drops. */
  }
}
function stopSignalling() {
  try {
    signalling?.close();
  } catch {
    /* Already gone. */
  }
  try {
    wakeLock?.release();
  } catch {
    /* Already released. */
  }
  wakeLock = null;
  signalling = null;
  invite = null;
}
function peerNote(text) {
  $("peer-hint").textContent = text;
}
// Dive in: host a tank and wait in the lobby. There is no separate solo path
// any more, and there does not need to be - a tank with nobody in it is a solo
// run, and one that a friend joins is not, which is the same tank either way.
// It also means a friend can still arrive after you have started, which the
// old local-only solo game could never allow.
$("dive").onclick = async () => {
  audio.play("click");
  if (network || joining) return;
  closePanel();
  const code = newCode();
  invite = { code, mode: "opening", detail: "" };
  const host = hostGame({
    // A tank you host is a tank you are inviting people to, so it waits in the
    // lobby like a server tank rather than dropping you into a round alone —
    // and a round nobody could join is what a friend's code hits when the
    // host, seeing no lobby, backs out to the menu and tears the tank down.
    lobby: true,
    // In a worker, so looking at another tab does not freeze everyone else.
    engine: createHostEngine,
    join: { name: playerName(), species: chosenSpecies },
    ...handlers(() => host, "peer"),
  });
  network = host;
  try {
    signalling = await hostRendezvous(code, (id, channel) =>
      host.accept(id, channel),
    );
    invite = {
      code,
      mode: signalling.mode,
      detail: signalling.detail,
      note: "",
    };
    // Holding a code is not the same as still holding it: the rendezvous tells
    // us when it drops, so the lobby can stop claiming the code works.
    signalling.watch?.(({ note }) => {
      if (!invite) return;
      invite.note = note;
      if (state) updateUI();
    });
    keepAwake();
    if (state) updateUI();
  } catch (error) {
    // The lobby's own reach line says this, and says it where the code is.
    invite = { code, mode: "failed", detail: error.message, note: "" };
    if (state) updateUI();
  }
};
async function joinPeer(code) {
  if (network || joining) return;
  joining = true;
  peerNote(`Looking for ${spellCode(code)}…`);
  try {
    const found = await joinRendezvous(code);
    signalling = found;
    joining = false;
    peerNote(`Joined ${spellCode(code)}.`);
    const guest = joinGame({
      join: { name: playerName(), species: chosenSpecies },
      channel: found.channel,
      ...handlers(() => guest, "peer"),
    });
    network = guest;
  } catch (error) {
    joining = false;
    stopSignalling();
    peerNote(error.message);
    // A wrong code has to be cheap to recover from, so clear it and leave the
    // pad ready rather than making them undo every tap.
    field.value = "";
    drawPicked();
  }
}
// The field is the code, and the only place it is kept. The keys write words
// into it, the slots draw whatever it currently says, and Undo takes a word
// off the end - so tapping and typing are one value rather than two that have
// to be kept in step. Whichever way it was entered, Join reads the field.
const field = $("peer-code");
// Tapping the last picture no longer joins by itself. It saved a press, and it
// spent it on joining a room the player had not finished choosing: a mistyped
// third picture became a failed connection instead of a tap of Undo.
function words() {
  return field.value
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}
function drawPicked() {
  const symbols = symbolsOf(field.value).slice(0, CODE_LENGTH);
  $("dialpad-picked").textContent =
    symbols.map((s) => s?.icon ?? "?").join("") +
    "·".repeat(Math.max(0, CODE_LENGTH - symbols.length));
  const full = symbols.length >= CODE_LENGTH;
  $("dialpad-back").disabled = !symbols.length;
  for (const key of $("dialpad-keys").children) key.disabled = full;
}
field.addEventListener("input", drawPicked);
for (const symbol of SYMBOLS) {
  const key = document.createElement("button");
  key.type = "button";
  key.textContent = symbol.icon;
  // The picture is the label on screen; the name is the label for a screen
  // reader, and for anyone whose font has no glyph for it.
  key.setAttribute("aria-label", symbol.name);
  key.title = symbol.name;
  key.onclick = () => {
    if (network || joining) return;
    const so_far = words();
    if (so_far.length >= CODE_LENGTH) return;
    audio.play("click");
    field.value = [...so_far, symbol.name].join("-");
    drawPicked();
  };
  $("dialpad-keys").append(key);
}
$("dialpad-back").onclick = () => {
  audio.play("click");
  field.value = words().slice(0, -1).join("-");
  drawPicked();
};
$("join-peer").onclick = () => {
  audio.play("click");
  if (network || joining) return;
  const code = parseCode(field.value);
  if (!code) return peerNote("Three pictures, or their words.");
  joinPeer(code);
};
drawPicked();
$("copy-code").onclick = async () => {
  audio.play("click");
  const text = invite ? spellCode(invite.code) : "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    $("copy-code").textContent = "Copied!";
  } catch {
    // No clipboard permission, or an insecure context on the LAN. The code is
    // selectable on screen either way, so say that rather than fail silently.
    $("copy-code").textContent = "Select it above to copy";
  }
  setTimeout(() => ($("copy-code").textContent = "Copy the code"), 2000);
};
$("games-back").onclick = () => {
  audio.play("click");
  closePanel();
};
$("leave").onclick = openGameMenu;
$("confirm-leave").onclick = () => {
  audio.play("click");
  leave();
};
// A new game means back to the lobby, not straight into another round: the
// code is on screen there, the match length can change, and anyone watching
// the results can still join. The host's world decides that - see
// World.nextRound - so this only has to ask.
$("next-round").onclick = () => {
  audio.play("click");
  network?.request("NEXT_ROUND");
};
$("overlay-leave").onclick = () => {
  audio.play("click");
  leave();
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
// The slider's range is the table's length, so adding a tier to
// shared/config.js is the whole change - there is no second place that says
// how many there are.
$("lobby-difficulty").max = String(DIFFICULTY.length);
$("lobby-difficulty").value = String(C.difficulty);
$("lobby-difficulty").addEventListener("pointerdown", () => (dragging = true));
$("lobby-difficulty").addEventListener("pointerup", () => (dragging = false));
$("lobby-difficulty").addEventListener("input", () => {
  showDifficulty(Number($("lobby-difficulty").value));
  network?.request("SETTINGS", {
    difficulty: Number($("lobby-difficulty").value),
  });
});
// Named, described, and announced by name: a slider reading "3 of 5" tells a
// player nothing about what they just chose.
function showDifficulty(level) {
  const chosen = tier(level);
  $("lobby-level").textContent = chosen.name;
  $("lobby-level-note").textContent = chosen.blurb;
  $("lobby-difficulty").setAttribute("aria-valuetext", chosen.name);
}
// Lobby panel: who is in, who is ready, the host's match length and
// difficulty, and start.
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
  // Only a host has a code to give out, and only it knows how far that code
  // reaches: a tabs-only fallback looks exactly like success until a friend on
  // another device tries it, so say so here rather than let them find out.
  $("lobby-invite").hidden = !invite;
  if (invite) {
    // Both forms, always: the pictures for whoever is going to tap them in,
    // the words underneath for whoever is going to paste or read them out.
    $("lobby-icons").textContent = symbolsOf(invite.code)
      .map((s) => s?.icon ?? "?")
      .join("");
    $("lobby-code").textContent = spellCode(invite.code);
    $("lobby-reach").textContent =
      invite.mode === "tabs"
        ? `⚠ This code only reaches other tabs in this browser — ${invite.detail}`
        : invite.mode === "failed"
          ? `⚠ ${invite.detail} Nobody can join with this code.`
          : invite.mode === "opening"
            ? "Opening the tank…"
            : "They tap these three under Join game.";
  }
  const minutes = Math.round(lobby.duration / 60);
  if (!dragging) $("lobby-slider").value = String(minutes);
  $("lobby-slider").disabled = !iAmHost;
  $("lobby-minutes").textContent = `${minutes} min`;
  // Everyone sees what they are about to swim into, host or not; only the host
  // can move it. Not while a thumb is on it, or the host's own drag fights the
  // snapshot coming back.
  const level = lobby.difficulty ?? C.difficulty;
  if (!dragging) $("lobby-difficulty").value = String(level);
  $("lobby-difficulty").disabled = !iAmHost;
  showDifficulty(level);
  const mine = ready.has(myId);
  // Alone in a tank you are hosting, there is nobody to be ready for: readying
  // yourself is a press that can only ever have one answer, so it answers
  // itself and Start is the only thing left. Sent from here rather than at
  // join time because the player has to exist in the simulation first, and
  // this runs on the snapshot that proves it does.
  const alone = state.players.length === 1 && iAmHost;
  if (alone && !mine) network?.request("READY", { ready: true });
  $("ready").hidden = alone;
  $("ready").textContent = mine ? "Ready ✓" : "I'm ready";
  $("ready").setAttribute("aria-pressed", String(mine));
  $("start").hidden = !iAmHost;
  $("start").disabled = !allReady;
  $("lobby-title").textContent = alone
    ? "Your tank"
    : allReady
      ? "Everyone is ready"
      : "Waiting for the shoal";
  // The lobby already shows who is in, who is ready and the code to share, so
  // this line only says the thing the buttons cannot.
  $("lobby-hint").textContent = alone
    ? "Start now, or share the code and wait."
    : iAmHost
      ? allReady
        ? ""
        : "Start once everyone is ready."
      : allReady
        ? `Waiting for ${state.players.find((p) => p.id === lobby.host)?.name ?? "the host"}.`
        : "Mark yourself ready.";
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
    $("overlay-actions").hidden = false;
  } else if (!me.alive) {
    // Being eaten is not the end of anything: the respawn counter is already
    // running, so this card offers nothing to press.
    $("overlay-actions").hidden = true;
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
  const live =
    !!me?.alive && phase === "playing" && !portrait.matches && !leavePromptOpen;
  controls.setActive(live);
  // The steer and look zones cover the entire screen and swallow every tap,
  // and they sit above the results, lobby and join panels, which are not the
  // HUD's children and so are not on the HUD's layer. Left up between rounds
  // they made those panels' buttons impossible to press on a tablet - the
  // round would end and nothing on screen would answer. They belong to a
  // round in progress, so they live exactly as long as one.
  $("touch").hidden = !touchMode || !live;
}
portrait.addEventListener("change", () => {
  syncControls(
    state?.players.find((p) => p.id === myId),
    state?.phase,
  );
  requestAnimationFrame(() => engine.resize());
});
// Adaptive resolution, checked a couple of times a second on Babylon's own
// smoothed frame rate. Slow devices quietly draw fewer pixels instead of
// asking anyone to find the quality menu, and ease back when they can.
let reliefAt = 0,
  relief = 1;
// Checked at startup rather than the first time frames dip. This contract was
// broken for several commits - setRelief went onto the kelp builder's object,
// which also has an animate() - and no test or fast machine ever reached the
// call, so only an older iPad found it. A missing method is now a loud failure
// on every load instead of a crash that needs slow hardware to reproduce.
if (typeof aquarium.setRelief !== "function")
  throw new TypeError(
    "createAquarium must expose setRelief() for adaptive resolution",
  );
function adaptResolution(now) {
  if (now - reliefAt < 2000) return;
  reliefAt = now;
  const next = reliefStep(relief, engine.getFps());
  if (next !== relief && aquarium.setRelief(next)) {
    console.info(
      `Adaptive resolution: ${engine.getFps().toFixed(0)} fps, drawing at 1/${next.toFixed(2)} scale.`,
    );
    relief = next;
  }
}
engine.runRenderLoop(() => {
  if (portrait.matches) return;
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  time += dt;
  aquarium.animate(dt);
  const now = performance.now();
  adaptResolution(now);
  const me = state?.players.find((p) => p.id === myId);
  const input = controls.read();
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
    // The camera looks where the player is aiming, on touch exactly as on
    // desktop: one scheme, one camera.
    const d = direction(input);
    // The follow distance decides how much of the growth survives to the
    // screen, because backing away as the fish gets bigger subtracts from the
    // thing it is trying to frame. It was 7 + r * 3, then 8.6 + r * 1.5; at
    // 0.8 it gives up a fifth of what it used to. Together with the exponent
    // in config.js - mass is no longer the cube of the visible size - a strong
    // round reads about 3.4x its spawn size where it used to read 2.2x.
    //
    // The constant is chosen to hold the spawn framing exactly: at the spawn
    // radius of 0.96 this is 10.04 units back, which is what it has always
    // been. A player who never eats sees no change at all.
    //
    // Past mass 200 the frame is more fish than tank, and flying something you
    // cannot see around is not the reward for having grown - so from there the
    // camera gives ground faster, 1.9 units for every unit of radius instead
    // of 0.8. It is a change of slope and not a jump, because the extra term
    // starts at zero, and the lerp below smooths even that. At the 900 cap the
    // fish fills about 40% of the frame's height rather than 51%, and it is
    // still visibly growing on the way there.
    const back = 9.3 + r * 0.8 + Math.max(0, r - BIG_FISH) * 1.1;
    const desired = new B.Vector3(
      p.x - d.x * back,
      p.y + 2 + r * 0.4 - d.y * back,
      p.z - d.z * back,
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
    // Look further ahead the bigger the fish, or a grown one sits in the
    // middle of the frame with its own body across the view.
    const ahead = 2 + r * 1.2;
    camera.setTarget(
      p.add(new B.Vector3(d.x * ahead, d.y * (ahead * 0.7), d.z * ahead)),
    );
  } else {
    camera.position.set(Math.sin(time * 0.035) * 8, 13, -28);
    camera.setTarget(new B.Vector3(1, 11, 0));
    if (network) hideHero();
    else showHero(dt);
  }
  scene.render();
});
