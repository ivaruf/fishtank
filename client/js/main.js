import { setupFullscreen } from "./fullscreen.js";
import { createAquarium } from "./world.js";
import { createFish } from "./fish.js";
import { createControls } from "./controls.js";
import { connect } from "./networking.js";
import { radius, direction } from "/shared/config.js";
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
  controls = createControls($("game"), () => {
    if (network && myId) network.send(controls.read());
  }),
  visuals = new Map();
setupFullscreen(() => engine.resize());
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
  npc: true,
  mass: 3 + (i % 7),
  alive: true,
  x: Math.sin(i * 2.4) * 15,
  y: 4 + (i % 6) * 3,
  z: Math.cos(i * 2.4) * 15,
  yaw: i,
  pitch: 0,
}));
function clearFish() {
  for (const v of visuals.values()) v.dispose();
  visuals.clear();
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
    onWelcome(id) {
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
      if (next.events.some((e) => e.predator === myId)) {
        toastUntil = performance.now() + 1400;
        $("toast").textContent = "A little bigger. A little bolder. +";
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
  const ids = new Set(fish.map((f) => f.id));
  for (const [id, v] of visuals)
    if (!ids.has(id)) {
      v.dispose();
      visuals.delete(id);
    }
  for (const f of fish) {
    let v = visuals.get(f.id);
    if (!v) {
      v = createFish(scene, f.color, f.npc);
      v.root.position.set(f.x, f.y, f.z);
      v.root.rotation.set(-f.pitch, f.yaw, 0);
      visuals.set(f.id, v);
    }
    v.root.setEnabled(f.alive);
    if (!f.alive) continue;
    const alpha = 1 - Math.exp(-dt * 12);
    v.root.position = B.Vector3.Lerp(
      v.root.position,
      new B.Vector3(f.x, f.y, f.z),
      alpha,
    );
    v.root.rotation.y +=
      Math.atan2(
        Math.sin(f.yaw - v.root.rotation.y),
        Math.cos(f.yaw - v.root.rotation.y),
      ) * alpha;
    v.root.rotation.x += (-f.pitch - v.root.rotation.x) * alpha;
    v.root.scaling.setAll(radius(f.mass));
    v.tail.rotation.y = Math.sin(time * (f.npc ? 8 : 11) + f.color) * 0.35;
  }
  const me = state?.players.find((p) => p.id === myId),
    v = me && visuals.get(me.id);
  if (v) {
    const d = direction(input),
      r = radius(me.mass),
      p = v.root.position;
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
  }
  scene.render();
});
