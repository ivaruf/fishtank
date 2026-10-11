import { setupFullscreen } from "./screen.js";
import { t, locale, speciesName } from "./i18n.js";
import { createAquarium } from "./world.js";
import { createFish, loadFishModels, wornOutfit } from "./fish.js";
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
  outweighs,
  FILTER,
} from "../../shared/config.js";
const B = window.BABYLON,
  $ = (id) => document.getElementById(id);
// Every line this file writes into the page goes through say(), which keeps
// how to write it - an i18n key and its arguments, or a function that builds
// the words - beside the element. A language switch then says every one of
// them again in the other language, wherever it is on screen and however
// long ago it was written: the lobby's reach line, a join error, the toast
// that is still fading, the build line. Nothing is stored as a finished
// sentence, which is also why nothing here ever sends one to a peer.
const said = new Map();
function say(id, what, ...args) {
  const el = typeof id === "string" ? $(id) : id;
  if (what == null || what === "") {
    said.delete(el);
    el.textContent = "";
    return;
  }
  const words = typeof what === "function" ? what : () => t(what, ...args);
  said.set(el, words);
  el.textContent = words();
}
let aquarium;
try {
  aquarium = createAquarium($("game"));
} catch (e) {
  say("error", "error.webgl");
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
    label = t(on ? "mute.off" : "mute.on");

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
// One copy, in the panel the menu plate opens - which is every screen, so
// there is nowhere left that needs a second one. The header's dropdown went with it: it
// was a settings control living permanently in the chrome, in front of the two
// buttons that are not settings, and it was the widest thing in the pill on
// the one screen where the pill has least room.
mountQuality($("quality-play"), () => audio.play("click"));
// The two volume sliders beside it. `input` rather than `change`, so the bus
// follows the thumb and you are setting a level you can hear rather than
// guessing at a number - which is also why dragging either one clears the
// mute. A slider that does nothing until you find the button that is
// cancelling it is a slider nobody can use. Music needs no cue of its own:
// the loop is already playing and moving the thumb IS the demonstration.
function mountVolume(id, read, write, cue) {
  const input = $(id),
    value = $(`${id}-val`);
  input.value = String(Math.round(read() * 100));
  value.textContent = input.value;
  input.addEventListener("input", () => {
    value.textContent = input.value;
    write(Number(input.value) / 100);
    if (audio.muted) {
      audio.setMuted(false);
      syncMute();
    }
  });
  if (cue) input.addEventListener("change", cue);
}
mountVolume(
  "vol-music",
  () => audio.musicVolume,
  (v) => audio.setMusicVolume(v),
);
mountVolume(
  "vol-sfx",
  () => audio.sfxVolume,
  (v) => audio.setSfxVolume(v),
  // One cue when the thumb is let go, so the level you just chose is the level
  // you just heard.
  () => audio.play("click"),
);
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
// What the build line knows, kept so a language switch can say it again.
let served = null;
function paintVersion() {
  const line = $("version");
  if (!served) return;
  if (served.unknown) {
    line.textContent = t("build.unknown");
    line.title = t("build.unknownTitle");
    return;
  }
  const { version, started, protocol, stale } = served;
  line.textContent = stale
    ? t("build.stale", BUILD)
    : t("build.label", version);
  const when = new Date(started);
  line.title = stale
    ? t("build.staleTitle", BUILD, version)
    : t(
        "build.title",
        version,
        protocol,
        isNaN(when) ? started : when.toLocaleString(locale()),
      );
}
ask("version.json")
  .then(({ version, started, protocol }) => {
    // `version` is the build being served; BUILD is the build this page is
    // made of. When they disagree, something between the two — the HTTP cache
    // or an installed service worker — is still handing out old code, and
    // reporting the served number would be a straight lie: it is the case the
    // line exists to catch.
    const stale = BUILD !== "dev" && version !== BUILD;
    served = { version, started, protocol, stale };
    paintVersion();
    $("version").classList.toggle("stale", stale);
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
    served = { unknown: true };
    paintVersion();
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
// The die. It fills the field rather than rolling a new placeholder, because
// once you have asked for a name it is yours, and grey suggestion text would
// say the opposite. It also gets told what is on screen, so a roll never lands
// on the name that is already there and reads as a button that did nothing.
$("reroll-name").onclick = () => {
  audio.play("click");
  $("name").value = fishName(playerName());
};
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
    name.dataset.species = species;
    option.append(input, thumb, name);
    return option;
  }),
);
// The cards' names, in the current language. Long single-word names may
// break before "fish" - or "fisk" - on narrow cards.
function paintSpecies() {
  for (const name of document.querySelectorAll("#species [data-species]"))
    name.textContent = speciesName(name.dataset.species).replace(
      /^(.{6,})(fish|fisk)$/,
      "$1\u00ad$2",
    );
}
paintSpecies();
// After layout, and again if the phone turns, bring the chosen fish into view.
const revealChosen = () =>
  revealSpecies(
    document.querySelector('input[name="species"]:checked')?.parentElement,
  );
requestAnimationFrame(revealChosen);
carousel.addEventListener("change", () => requestAnimationFrame(revealChosen));
// A toast is said like everything else, so one still fading when the language
// changes finishes in the new one.
function toast(ms, what, ...args) {
  toastUntil = performance.now() + ms;
  say("toast", what, ...args);
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
  previewHint.textContent = t(touch ? "preview.touch" : "preview.mouse");
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
// Leaving the game itself, which is what the corner means on the menu where
// there is no tank to leave.
//
// ../../arcade/exit.js owns this question for the whole hub and it is the only
// thing that knows all of the answer, so it is asked rather than guessed at
// here. This file used to do its own half of it, and the half it did not do is
// the part that was wrong: "close the tab" in an ordinary tab, on a button the
// browser will not honour for any window a script did not open, which left the
// player reading an apology where they had pressed leave. The arcade is a URL.
// exit.js goes there.
const framed = () => {
  try {
    return window.top !== window.self;
  } catch {
    // A cross-origin parent throws on access, which is itself the answer.
    return true;
  }
};
// The words on both of the doors, written once. There are two ways out of this
// game - #menu-quit on the menu screen and #dialog-quit inside the panel - and
// they are the same door reached from two places, so they must not be able to
// say different things about where it goes. exit.js's verb() is the only
// thing that knows the answer; the fallback is reached only when exit.js is
// missing outright.
//
// Plain words, and deliberately not this game's own. A way out is the one
// control a player reaches for when they have stopped wanting to play, and
// "Leave fish tank" made them read a joke to find the handle. The aquarium
// does the talking everywhere else.
//
// Asked again on every language switch: verb() hands back one of the two
// words it is given, so it has to be given them in the language of the day.
const exitWords = () =>
  window.ArcadeExit?.verb({
    arcade: t("exit.arcade"),
    app: t("exit.close"),
  }) ?? t(framed() ? "exit.arcade" : "exit.close");
// `refused` is the one outcome we are still alive to see, and it now only
// happens to an installed app whose window the browser will not close - iOS,
// in practice. Framed hands back to the launcher and a tab navigates to the
// arcade; neither comes back here. The caller says so in its own way, because
// the two doors stand on different screens with different room to say it in.
function quitGame(refused) {
  const exit = window.ArcadeExit;
  if (exit) {
    exit.quit().then((how) => {
      if (how === "refused") refused();
    });
    return;
  }
  // exit.js is another repository's file and is allowed to be missing. Then
  // the best guess left is the history entry, which is what this did before
  // exit.js existed at all.
  if (framed()) history.back();
}
// Is there somewhere to go back to? Asked once, because neither answer can
// change under a running page: a frame does not unframe itself and a tab does
// not install itself.
//
// ONLY WHEN THERE IS SOMEWHERE TO GO, which is not the same question as
// whether quit() could do something: in a plain tab it could - the arcade is a
// URL and a navigation always works - but somebody who typed this game's own
// address did not come from the arcade and may never have heard of it. So: a
// launcher behind us, or an installed window that can genuinely close.
//
// ASKED THROUGH framed()/standalone() AND NOT THROUGH exit.js's own offers(),
// which says exactly this but is newer than both of them. The copy of exit.js
// that answers may be OLDER than this code - it is fetched from ../../arcade/,
// and a service worker on this shared origin can hand back a version cached
// long before offers() was written - and a guard built on the new name fails
// CLOSED there: the way out silently disappears, inside the arcade, where it
// is the one control that matters. This cost maxgear a release.
const exitOffered = (() => {
  const exit = window.ArcadeExit;
  return !!exit && (exit.framed() || exit.standalone());
})();
let leavePromptOpen = false;
// The menu plate in the corner opens this panel wherever you are: on the
// menu, in the lobby, mid-round. One button always goes back to what you were
// doing; mid-session a second takes you one step out of the round or the
// lobby, and the last one, #dialog-quit, takes you out of the game - so the
// corner means the same thing on all three screens. Escape opens it too, but
// only mid-session: on the menu screen Escape is the way out (onEscape,
// below).
function openGameMenu() {
  if (leavePromptOpen || portrait.matches) return;
  leavePromptOpen = true;
  controls.setActive(false);
  const inRound = !!state && state.phase !== "lobby";
  // Alone in a round this really is a pause: the host stops the world. The
  // host decides that, not this - World.setPaused refuses with anyone else in
  // the water - so the request is sent either way and the eyebrow says which
  // of the two it got, because a panel labelled "paused" over a tank that is
  // still hunting you is worse than one that never claimed to be.
  if (inRound) network?.request("PAUSE", { on: true });
  const alone = state?.players.length === 1;
  // MENU over a panel that has not stopped anything, PAUSE over one that has.
  // It said the game's own name until 2026-10-10, when the arcade's menus
  // went plain: a panel is named for what it is.
  say("pause-tag", inRound && alone ? "pause.paused" : "pause.menu");
  say("continue", inRound ? "resume" : "back");
  // On the menu screen there is no round or lobby to step out of, so the
  // panel is Settings with a Back and nothing else. It used to wear the way
  // out of the GAME here too, which put that door inside a second panel - and
  // the way out belongs at the top level of a screen, never behind another
  // layer (hub §2). The menu screen has its own #menu-quit for that.
  $("confirm-leave").hidden = !state;
  if (state) say("confirm-leave", inRound ? "leave.game" : "leave.lobby");
  // Mid-session the way out of the game sits right here, last, rather than
  // one screen further on behind "Leave game". Not offered on the menu
  // screen's face of this panel, for the reason above.
  $("dialog-quit").hidden = !(exitOffered && state);
  $("pause-note").hidden = true;
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
// ESCAPE GOES ONE STEP BACK, and from the menu screen that step is the arcade
// (hub §2). One handler for the whole game, so the key cannot mean two things
// at once, in this order:
//
//   in a text field          leaves the field and nothing else. The name box
//                            is on the menu screen, where Escape quits, and a
//                            player dismissing an autocomplete must not find
//                            themselves back in the arcade.
//   the panel is up          closes it: Continue, the run carries on (or
//                            resumes, where it was ours to pause). Handled here
//                            rather than left to the dialog's own `cancel`,
//                            because preventDefault() below is what stops the
//                            same press reaching anything else - the `cancel`
//                            listener stays for the close requests that are
//                            not keys, such as Android's back gesture.
//   the join panel is up     its Back.
//   mid-session              opens the panel. Pausing is the host's call and
//                            openGameMenu() only asks: alone in the water it
//                            stops, with company it does not and says MENU.
//   the menu screen          the same press as #menu-quit, and only when that
//                            button is there to press. Without it there is
//                            nowhere for Escape to go, so it does nothing.
//
// So Escape never throws a round away in one press: from a round it can only
// ever open the menu, and the menu's own way out is a button.
function onEscape() {
  if (leavePromptOpen) {
    continueGame();
    return;
  }
  if (!$("games").hidden) {
    $("games-back").click();
    return;
  }
  if (state) {
    openGameMenu();
    return;
  }
  const quit = $("menu-quit");
  if (!quit.hidden && !quit.disabled) quit.click();
}
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.repeat) return;
  event.preventDefault();
  const typing = event.target.closest?.("input, textarea, [contenteditable]");
  if (typing && typing.type !== "range") {
    typing.blur();
    return;
  }
  onEscape();
});
// Browsers consume Escape when releasing pointer lock, so an unlock during a
// round is how Escape reaches the menu at all.
//
// This deliberately no longer asks whether the player is alive. It used to,
// because death released the lock itself and the menu would have landed on top
// of the you-became-lunch card. Death keeps the lock now (syncControls), which
// leaves the player asking for the cursor back as the only thing that unlocks
// mid-round — and Escape while dead opens the menu on the first press instead
// of spending one press on the lock and needing a second.
let wasPointerLocked = false;
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === $("game");
  if (
    wasPointerLocked &&
    !locked &&
    state?.phase === "playing" &&
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
// `message` is an i18n key for the menu's error line, or nothing.
function leave(message = null) {
  leavePromptOpen = false;
  $("leave-dialog").close();
  controls.setActive(false);
  controls.setTouchMode(false);
  touchMode = false;
  leaderId = null;
  wasBiggest = false;
  document.body.classList.remove("playing");
  network?.close();
  network = null;
  myId = null;
  state = null;
  joining = false;
  deathCam = null;
  clearFish();
  stopSignalling();
  say("peer-hint", null);
  $("menu").hidden = false;
  $("hud").hidden = true;
  $("games").hidden = true;
  $("lobby").hidden = true;
  $("overlay").hidden = true;
  $("touch").hidden = true;
  say("error", message);
  say("connection", null);
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
      say("error", null);
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
      //
      // The transport's own room label is English and stays in the console:
      // a guest is always in a friend's tank, and says so in its own words.
      if (invite) say("connection", "conn.code", spellCode(invite.code));
      else say("connection", solo ? "conn.solo" : "conn.friend");
      // Host and guest are two browsers with two copies of this code, so a
      // mismatch means one of them has not reloaded. It is the guest that can
      // see both numbers, so it is the guest that says so.
      if (protocol !== PROTOCOL) {
        console.warn(
          `The host speaks protocol ${protocol}, this tank expects ${PROTOCOL}. One of you is on an older build; reload both.`,
        );
        say("connection", "conn.mismatch");
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
          toast(3500, "toast.filter");
        }
        if (e.type === "BUZZ" && e.by === myId) audio.play("buzz");
        if (e.type === "ZAP") {
          audio.play("zap");
          const victim = [...next.players, ...next.npcs].find(
            (f) => f.id === e.target,
          );
          // Who, decided now; the sentence, decided whenever it is said -
          // so a switch mid-toast says the same news in the other language.
          const self = e.target === myId,
            wild = victim?.npc ? victim.species : null,
            name = victim?.name,
            lost = e.lost;
          toast(2600, () =>
            t(
              "toast.zapped",
              self
                ? t("toast.you")
                : wild
                  ? t("toast.wild", speciesName(wild))
                  : (name ?? t("toast.bigFish")),
              lost,
            ),
          );
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
        if (e.predator === myId) {
          // The host sends what was eaten - a species or a player's name -
          // and never the phrase, which is this device's to build.
          const { species, name } = e,
            grew = (e.grew ?? 0).toFixed(1);
          toast(1400, () =>
            t(
              "toast.ate",
              species
                ? t("toast.meal", speciesName(species))
                : (name ?? t("toast.snack")),
              grew,
            ),
          );
        }
      }
    },
    // A host's refusal carries a key beside its English, so it is said in
    // this player's language rather than the host's.
    onError(message, key) {
      if (key) say("error", `error.${key}`);
      else say("error", "raw", message);
    },
    onClose() {
      if (network !== current()) return;
      // The only thing that can close now is the peer link: the host closed
      // its tab, or the connection died. Either way there is nothing to
      // reconnect to, so send them back to the menu rather than imply there is.
      leave("error.closed");
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
  peerNote(null);
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
// The join pad's one line: an i18n key and its arguments, or nothing.
function peerNote(key, ...args) {
  say("peer-hint", key, ...args);
}
// What a failed matchmaking step says: its own key where it has one, and its
// English message where it is something nobody anticipated.
const failure = (error) => error?.i18n ?? ["raw", error?.message ?? error];
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
  invite = { code, mode: "opening", detail: null };
  const host = hostGame({
    // A tank you host is a tank you are inviting people to, so it waits in the
    // lobby like a server tank rather than dropping you into a round alone —
    // and a round nobody could join is what a friend's code hits when the
    // host, seeing no lobby, backs out to the menu and tears the tank down.
    lobby: true,
    // In a worker, so looking at another tab does not freeze everyone else.
    engine: createHostEngine,
    join: { name: playerName(), species: chosenSpecies, outfit: wornOutfit() },
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
      note: null,
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
    invite = { code, mode: "failed", detail: failure(error), note: null };
    if (state) updateUI();
  }
};
async function joinPeer(code) {
  if (network || joining) return;
  joining = true;
  peerNote("peer.looking", spellCode(code));
  try {
    const found = await joinRendezvous(code);
    signalling = found;
    joining = false;
    peerNote("peer.joined", spellCode(code));
    const guest = joinGame({
      join: {
        name: playerName(),
        species: chosenSpecies,
        outfit: wornOutfit(),
      },
      channel: found.channel,
      ...handlers(() => guest, "peer"),
    });
    network = guest;
  } catch (error) {
    joining = false;
    stopSignalling();
    peerNote(...failure(error));
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
  if (!code) return peerNote("peer.need");
  joinPeer(code);
};
drawPicked();
$("copy-code").onclick = async () => {
  audio.play("click");
  const text = invite ? spellCode(invite.code) : "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    say("copy-code", "lobby.copied");
  } catch {
    // No clipboard permission, or an insecure context on the LAN. The code is
    // selectable on screen either way, so say that rather than fail silently.
    say("copy-code", "lobby.select");
  }
  setTimeout(() => say("copy-code", "lobby.copy"), 2000);
};
$("games-back").onclick = () => {
  audio.play("click");
  closePanel();
};
$("game-menu").onclick = openGameMenu;
// One step out of the round or the lobby and back to the menu screen. It is
// only shown mid-session; the way out of the game is #dialog-quit, below it.
$("confirm-leave").onclick = () => {
  audio.play("click");
  if (state) leave();
};
// The two doors out of the game, wired once: #menu-quit on the menu screen and
// #dialog-quit at the foot of the panel. Labelled by exitWords() through say(),
// so a language switch rewrites both, and written into their <span>s so the
// back arrow beside the words survives it. Only when exitOffered (above).
if (exitOffered) {
  const menuQuit = $("menu-quit");
  say("menu-quit-label", exitWords);
  menuQuit.hidden = false;
  menuQuit.onclick = () => {
    audio.play("click");
    quitGame(() => {
      // There is no note line on this screen, so the button says it itself
      // rather than leaving a control that looks like it did nothing.
      say("menu-quit-label", "exit.yourself");
      menuQuit.disabled = true;
    });
  };
  say("dialog-quit-label", exitWords);
  $("dialog-quit").onclick = () => {
    audio.play("click");
    quitGame(() => {
      // The panel has a line of its own for this, and it is only worth writing
      // if the panel is still up to read it in.
      if (!leavePromptOpen) return;
      say("pause-note", "exit.refused");
      $("pause-note").hidden = false;
    });
  };
}
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
  say("lobby-minutes", "lobby.minutes", $("lobby-slider").value);
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
//
// The words come from i18n.js by the tier's number, not from shared/config.js:
// the table's own names were places ("The trench"), and since 2026-10-10 the
// setting says plainly how hard it is while the line under it keeps the place.
function showDifficulty(level) {
  const n = DIFFICULTY.indexOf(tier(level)) + 1;
  say("lobby-level", `difficulty.${n}`);
  say("lobby-level-note", `difficulty.${n}.blurb`);
  $("lobby-difficulty").setAttribute("aria-valuetext", t(`difficulty.${n}`));
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
  // The roster's label, and the only count on this screen.
  $("lobby-count").textContent = t("lobby.count", state.players.length);
  $("lobby-players").replaceChildren(
    ...state.players.map((p) => {
      const li = document.createElement("li"),
        name = document.createElement("b"),
        flag = document.createElement("span");
      name.textContent =
        (p.id === lobby.host ? "👑 " : "") +
        (p.id === myId ? t("you", p.name) : p.name);
      flag.className = "state" + (ready.has(p.id) ? " ready" : "");
      flag.textContent = t(ready.has(p.id) ? "lobby.ready" : "lobby.notReady");
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
    const detail = invite.detail ? t(...invite.detail) : "";
    $("lobby-reach").textContent =
      invite.mode === "tabs"
        ? t("lobby.reachTabs", detail)
        : invite.mode === "failed"
          ? t("lobby.reachFailed", detail)
          : invite.mode === "opening"
            ? t("lobby.opening")
            : t("lobby.howTo");
  }
  const minutes = Math.round(lobby.duration / 60);
  if (!dragging) $("lobby-slider").value = String(minutes);
  $("lobby-slider").disabled = !iAmHost;
  say("lobby-minutes", "lobby.minutes", minutes);
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
  $("ready").textContent = t(mine ? "lobby.readyMine" : "lobby.imReady");
  $("ready").setAttribute("aria-pressed", String(mine));
  $("start").hidden = !iAmHost;
  $("start").disabled = !allReady;
  // Only when it has something to say. Alone in your own tank it had "Your
  // tank", which is a label for the screen you are looking at rather than news
  // about it - and the hint below already says what to do about being alone.
  // Hidden rather than blank: an empty h2 still takes its line.
  const title = alone ? "" : t(allReady ? "lobby.allReady" : "lobby.waiting");
  $("lobby-title").textContent = title;
  $("lobby-title").hidden = !title;
  // The lobby already shows who is in, who is ready and the code to share, so
  // this line only says the thing the buttons cannot.
  $("lobby-hint").textContent = alone
    ? t("lobby.hintAlone")
    : iAmHost
      ? allReady
        ? ""
        : t("lobby.hintHost")
      : allReady
        ? t(
            "lobby.hintWaitHost",
            state.players.find((p) => p.id === lobby.host)?.name ??
              t("lobby.theHost"),
          )
        : t("lobby.hintMark");
}
// Alone in the tank is the one case with a goal of its own, because "you win"
// is true whatever you did: be the biggest thing in the water when the clock
// stops. Everything below is that rule, read off the snapshot - the host sends
// every wild fish's mass already, so nothing new goes over the wire for it.
const solo = (s) => s.players.length === 1;
// The heaviest wild fish, counted whether or not it happens to be alive right
// now: an eaten one respawns at the same mass, so it is still what is in the
// tank and still what you have to beat.
const biggestWild = (s) =>
  s.npcs?.length
    ? s.npcs.reduce((big, n) => (n.mass > big.mass ? n : big))
    : { mass: 0, species: "fish" };
// Whether the top spot was held on the previous snapshot, so taking it is
// announced once rather than every frame. It can be lost again - the filter
// shrinks the biggest fish, and dying resets you - and taking it back says so
// again, which is the point of tracking the transition rather than a flag.
let wasBiggest = false;
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
      li.textContent = p.id === myId ? t("you", p.name) : p.name;
      const score = document.createElement("span");
      score.textContent = p.score;
      li.append(score);
      return li;
    }),
  );
  // Taking the top spot is worth saying out loud: the goal is invisible
  // otherwise, since the only sign of it is wild fish stopping being a threat.
  const onTop =
    solo(state) &&
    state.phase === "playing" &&
    me.alive &&
    me.mass >= biggestWild(state).mass;
  if (onTop && !wasBiggest) {
    toast(3200, "toast.biggest");
    audio.play("pad");
  }
  wasBiggest = onTop;
  $("overlay").hidden =
    state.phase === "lobby" ||
    (me.alive && state.phase === "playing") ||
    !!(deathCam && !deathCam.done);
  if (state.phase === "results") {
    $("overlay-tag").textContent = t("over.round", state.round);
    if (solo(state)) {
      // Alone, "you win" was true whatever you did, which is not a result.
      // The tank sets the bar instead: be the biggest thing in it when the
      // clock runs out.
      const rival = biggestWild(state);
      const won = me.mass >= rival.mass;
      $("overlay-title").textContent = t(
        won ? "over.biggest" : "over.outgrown",
      );
      $("overlay-text").textContent = won
        ? t("over.won", me.mass.toFixed(1), me.score)
        : t(
            "over.lost",
            speciesName(rival.species),
            rival.mass.toFixed(1),
            me.mass.toFixed(1),
            me.score,
          );
    } else {
      $("overlay-title").textContent = t(
        "over.wins",
        ranked[0]?.name || t("over.nobody"),
      );
      const largest = [...state.players].sort((a, b) => b.mass - a.mass)[0];
      $("overlay-text").textContent = t(
        "over.multi",
        largest.name,
        largest.mass.toFixed(1),
        me.score,
      );
    }
    $("overlay-actions").hidden = false;
  } else if (!me.alive) {
    // Being eaten is not the end of anything: the respawn counter is already
    // running, so this card offers nothing to press.
    $("overlay-actions").hidden = true;
    $("overlay-tag").textContent = t("over.deathTag");
    $("overlay-title").textContent = t("over.lunch");
    $("overlay-text").textContent = t(
      "over.eaten",
      killerName(me.killedBy),
      Math.ceil(me.respawn),
    );
  }
}
// Who ate you, from the id the host sends: a player by their own name, a wild
// fish by its species in this device's language. A predator who has since
// left the tank has no name to give, and gets an honest shrug.
function killerName(id) {
  const fish =
    state?.players.find((p) => p.id === id) ??
    state?.npcs.find((n) => n.id === id);
  if (!fish) return t("killer.unknown");
  return fish.npc ? t("killer.wild", speciesName(fish.species)) : fish.name;
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
  // Two different questions. Seated is whether the tank is yours to steer at
  // all; live is whether there is a fish on the other end of the controls
  // right now. Dying answers only the second, so it stops the input and keeps
  // the pointer: the you-became-lunch card has nothing to press, and the
  // respawn hands control straight back.
  const seated = phase === "playing" && !portrait.matches && !leavePromptOpen;
  const live = !!me?.alive && seated;
  controls.setActive(live, seated);
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
// A language switch, from the row in the menu panel. Everything is said again
// where it stands: no reload, nothing restarted, the panel left open, and a
// round in progress left exactly as it was - a networked one never stopped,
// and a solo one stays paused until Resume. i18n.js has already repainted the
// markup's own words; this is the part built at runtime.
document.addEventListener("arcade:lang", () => {
  audio.play("click");
  syncMute();
  syncPreview();
  paintVersion();
  paintSpecies();
  for (const [el, words] of said) el.textContent = words();
  // A suggested name is offered in the player's language. One they typed or
  // rolled is theirs, and is left alone.
  if (!$("name").value) $("name").placeholder = fishName();
  // The lobby, the HUD, the roster and the end-of-round card are all drawn
  // from the last snapshot, so drawing them again is the whole repaint.
  if (state) updateUI();
});
engine.runRenderLoop(() => {
  if (portrait.matches) return;
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  time += dt;
  aquarium.animate(dt);
  const now = performance.now();
  adaptResolution(now);
  const me = state?.players.find((p) => p.id === myId);
  // Before read(), so a turn held at the screen's edge is in the input that
  // goes out on this frame rather than the next one.
  controls.edgeLook(dt);
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
        false,
        f.id === myId,
        f.outfit,
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
