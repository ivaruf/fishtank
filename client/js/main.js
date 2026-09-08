import { setupFullscreen } from "./fullscreen.js";
import { createAquarium } from "./world.js";
import { createFish, loadFishModels } from "./fish.js";
import { mountQuality, quality, modelDetail, reliefStep } from "./quality.js";
import { createPuffs, createSparks, createStream } from "./effects.js";
import { createFilter } from "./filter.js";
import { createAudio } from "./audio.js";
import { createControls } from "./controls.js";
import { playLocally } from "./local.js";
import { hostGame, joinGame, createHostEngine } from "./peer.js";
import { hostRendezvous, joinRendezvous } from "./rendezvous.js";
import { BUILD } from "./build.js";
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
// Two rows, one setting. The menu's sits in the header where it always did;
// the one in the pause dialog is why the header's can disappear during play.
for (const at of ["quality-menu", "quality-play"])
  mountQuality($(at), () => audio.play("click"));
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
const syncPreviewLight = () => {
  previewLight.intensity = mobilePreview.matches ? 2.1 : 1.5;
};
mobilePreview.addEventListener("change", syncPreviewLight);
syncPreviewLight();
previewLight.diffuse = new B.Color3(1, 0.96, 0.88);
previewLight.groundColor = new B.Color3(0.48, 0.65, 0.7);
previewLight.specular = new B.Color3(0.25, 0.25, 0.25);
previewLight.renderPriority = 100;
previewLight.setEnabled(false);
const spin = { pointer: null, x: 0, y: 0, yaw: 0, pitch: 0, touched: false };
function releasePreview() {
  if (spin.pointer !== null && preview.hasPointerCapture(spin.pointer))
    preview.releasePointerCapture(spin.pointer);
  spin.pointer = null;
  preview.classList.remove("grabbing");
}
preview.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || spin.pointer !== null) return;
  spin.pointer = event.pointerId;
  spin.x = event.clientX;
  spin.y = event.clientY;
  if (!spin.touched) spin.yaw = Math.sin(time * 0.45) * 0.55;
  spin.touched = true;
  preview.setPointerCapture(event.pointerId);
  preview.classList.add("grabbing");
  event.preventDefault();
});
preview.addEventListener("pointermove", (event) => {
  if (event.pointerId !== spin.pointer) return;
  spin.yaw += (event.clientX - spin.x) * 0.012;
  spin.pitch = clamp(spin.pitch + (event.clientY - spin.y) * 0.01, -1.3, 1.3);
  spin.x = event.clientX;
  spin.y = event.clientY;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  preview.addEventListener(type, (event) => {
    if (event.pointerId === spin.pointer) releasePreview();
  });
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
    (Math.min(bounds.width, bounds.height) / screen.height) * halfHeight * 0.65,
  );
  hero.update(dt);
}
let leavePromptOpen = false;
function openGameMenu() {
  if (!myId || $("hud").hidden || leavePromptOpen) return;
  leavePromptOpen = true;
  controls.setActive(false);
  $("leave-dialog").showModal();
}
function continueGame() {
  leavePromptOpen = false;
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
      $("touch").hidden = !touchMode;
      controls.setTouchMode(touchMode);
      audio.music("game");
      $("connection").textContent = solo
        ? "● SOLO AQUARIUM · OFFLINE"
        : `● ${(roomName ?? "a friend's tank").toUpperCase()}`;
      // A host can still be joined mid-round, so keep the code on screen: the
      // menu that showed it is gone once the round starts.
      if (invite)
        $("connection").textContent += ` · CODE ${spellCode(invite.code)}`;
      // Host and guest are two browsers with two copies of this code, so a
      // mismatch means one of them has not reloaded. It is the guest that can
      // see both numbers, so it is the guest that says so.
      if (protocol !== PROTOCOL) {
        console.warn(
          `The host speaks protocol ${protocol}, this tank expects ${PROTOCOL}. One of you is on an older build; reload both.`,
        );
        $("connection").textContent = "● DIFFERENT BUILDS · RELOAD BOTH";
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
// Solo runs the same World in this tab: no socket, no traffic, no latency, and
// it keeps working with the network gone. It is also the only way in that needs
// nothing but this device.
function diveInSolo() {
  if (joining || network) return;
  joining = true;
  $("error").textContent = "";
  const connection = playLocally({
    join: { name: $("name").value, mode: "single", species: chosenSpecies },
    ...handlers(() => connection, "solo"),
  });
  network = connection;
}
// The friend panel. There is no server to ask what games exist, so there is
// no list to draw: you either host a tank or you tap in the code for one.
function closePanel() {
  $("games").hidden = true;
}
$("solo").onclick = () => {
  audio.play("click");
  closePanel();
  diveInSolo();
};
$("multi").onclick = () => {
  audio.play("click");
  if (network) return;
  $("games").hidden = false;
  peerNote("");
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
$("host-peer").onclick = async () => {
  audio.play("click");
  if (network || joining) return;
  const code = newCode();
  invite = { code, mode: "opening", detail: "" };
  peerNote(`Setting up ${spellCode(code)}…`);
  const host = hostGame({
    // A tank you host is a tank you are inviting people to, so it waits in the
    // lobby like a server tank rather than dropping you into a round alone —
    // and a round nobody could join is what a friend's code hits when the
    // host, seeing no lobby, backs out to the menu and tears the tank down.
    lobby: true,
    // In a worker, so looking at another tab does not freeze everyone else.
    engine: createHostEngine,
    join: { name: $("name").value, species: chosenSpecies },
    ...handlers(() => host, "peer"),
    onPeers: (n) => peerNote(`Code ${spellCode(code)} · ${n} fish in the tank`),
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
    peerNote(
      signalling.mode === "tabs"
        ? `Code ${spellCode(code)}, but this only reaches other tabs here: ${signalling.detail}`
        : `Code ${spellCode(code)} · tell a friend (${signalling.detail})`,
    );
    if (state) updateUI();
  } catch (error) {
    invite = { code, mode: "failed", detail: error.message, note: "" };
    peerNote(error.message);
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
    peerNote(
      `Playing in ${spellCode(code)}. The tank runs on your friend's device.`,
    );
    const guest = joinGame({
      join: { name: $("name").value, species: chosenSpecies },
      channel: found.channel,
      ...handlers(() => guest, "peer"),
    });
    network = guest;
  } catch (error) {
    joining = false;
    stopSignalling();
    peerNote(error.message);
    // A wrong code has to be cheap to recover from, so leave the pad empty and
    // ready rather than making them undo every tap.
    picked.length = 0;
    drawPicked();
  }
}
$("join-peer").onclick = () => {
  audio.play("click");
  if (network || joining) return;
  const code = parseCode($("peer-code").value);
  if (!code)
    return peerNote(
      "That is not a code. Tap the three pictures, or type them as words.",
    );
  joinPeer(code);
};
// The dialpad. Tapping the fourth picture joins on the spot: this is here for
// a player who finds typing hard, and "now press Join" is exactly the extra
// step that was worth removing. A mistake costs one tap of Undo, or nothing at
// all once the attempt fails and the pad clears itself.
const picked = [];
function drawPicked() {
  $("dialpad-picked").textContent =
    picked.map((s) => s.icon).join("") +
    "·".repeat(CODE_LENGTH - picked.length);
  $("dialpad-back").disabled = !picked.length;
}
for (const symbol of SYMBOLS) {
  const key = document.createElement("button");
  key.type = "button";
  key.textContent = symbol.icon;
  // The picture is the label on screen; the name is the label for a screen
  // reader, and for anyone whose font has no glyph for it.
  key.setAttribute("aria-label", symbol.name);
  key.title = symbol.name;
  key.onclick = () => {
    if (network || joining || picked.length >= CODE_LENGTH) return;
    audio.play("click");
    picked.push(symbol);
    drawPicked();
    if (picked.length === CODE_LENGTH)
      joinPeer(picked.map((s) => s.name).join("-"));
  };
  $("dialpad-keys").append(key);
}
$("dialpad-back").onclick = () => {
  audio.play("click");
  picked.pop();
  drawPicked();
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
            : "They can tap the three pictures, or type the words, in “Play with a friend” on any device.";
  }
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
  controls.setActive(
    !!me?.alive && phase === "playing" && !portrait.matches && !leavePromptOpen,
  );
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
    // The follow distance is what decides whether growing is visible at all,
    // and it used to be 7 + r * 3 - three units back for every one unit of
    // radius gained, so it cancelled most of the growth as it happened. Over
    // the whole mass range, 8 to the 1800 cap, a fish went from filling 19% of
    // the screen to 46%: 225 times the mass for 2.4 times the size, with a
    // hard ceiling of 65% however big you ever got.
    //
    // 8.6 + r * 1.5 keeps the spawn framing almost exactly as it was and
    // halves the cancellation above it: a good round now reads 19% -> 30%
    // instead of 19% -> 27%, and the cap fills two thirds of the frame. Mass
    // is still the cube of the thing you can see, so the rest of the feeling
    // has to come from the pop in fish.js.
    const back = 8.6 + r * 1.5;
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
