// Break a live snapshot down by field and test what each candidate
// optimisation would actually save. Run: node tools/measure-traffic.mjs
// Numbers here are the baseline recorded in docs/NETWORK-WORKLIST.md; re-run
// after each optimisation and update that table.
import { World } from "../shared/world.js";
import { CONFIG as C } from "../shared/config.js";
import zlib from "node:zlib";

const w = new World(Math.random, { lobby: false });
for (let i = 0; i < 8; i++) w.addPlayer(`p${i}`, `Player ${i}`);
for (let i = 0; i < 60; i++) w.tick(1 / C.tickRate);
const snap = w.snapshot();
const raw = JSON.stringify(snap);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(
  `snapshot: ${kb(raw.length)}  (${snap.npcs.length} npcs, ${snap.players.length} players)\n`,
);

// --- Per-field cost across every encoded fish -------------------------------
const fish = [...snap.players, ...snap.npcs];
const perField = {};
for (const f of fish)
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    perField[k] =
      (perField[k] ?? 0) +
      JSON.stringify(k).length +
      1 +
      JSON.stringify(v).length +
      1;
  }
console.log("field           bytes   share   note");
for (const [k, v] of Object.entries(perField).sort((a, b) => b[1] - a[1])) {
  const share = ((v / raw.length) * 100).toFixed(1).padStart(5);
  console.log(`${k.padEnd(14)}${String(v).padStart(6)}${share}%`);
}

// --- What each optimisation saves ------------------------------------------
const round = (n, d) => +n.toFixed(d);
// 1. Quantise: positions to 2dp (~1cm), angles to 3dp (~0.06deg), mass to 1dp.
const quantised = {
  ...snap,
  players: snap.players.map(q),
  npcs: snap.npcs.map(q),
};
function q(f) {
  const o = { ...f };
  for (const k of ["x", "y", "z"]) o[k] = round(o[k], 2);
  for (const k of ["yaw", "pitch"]) o[k] = round(o[k], 3);
  o.mass = round(o.mass, 1);
  if (o.protection !== undefined) o.protection = round(o.protection, 2);
  if (o.respawn !== undefined) o.respawn = round(o.respawn, 2);
  return o;
}
// 2. Drop fields that never change after spawn or are derivable client-side.
const STATIC = ["name", "species", "color", "npc"];
const stripped = {
  ...quantised,
  players: quantised.players.map(s),
  npcs: quantised.npcs.map(s),
};
function s(f) {
  const o = { ...f };
  for (const k of STATIC) delete o[k];
  for (const k of Object.keys(o))
    if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}
// 3. Interest management: only wild fish within R of any player.
const near = (r) => {
  const ps = snap.players.filter((p) => p.alive);
  return snap.npcs.filter((n) =>
    ps.some((p) => Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) < r),
  ).length;
};
const cases = [
  ["baseline", raw],
  ["+ quantised floats", JSON.stringify(quantised)],
  ["+ drop static/null fields", JSON.stringify(stripped)],
];
console.log(
  "\nvariant                      size    saving   +deflate   saving",
);
for (const [label, body] of cases) {
  const gz = zlib.deflateSync(Buffer.from(body)).length;
  console.log(
    `${label.padEnd(27)}${kb(body.length).padStart(8)}` +
      `${((1 - body.length / raw.length) * 100).toFixed(0).padStart(8)}%` +
      `${kb(gz).padStart(11)}` +
      `${((1 - gz / raw.length) * 100).toFixed(0).padStart(8)}%`,
  );
}
console.log("\ninterest management (wild fish actually near a player):");
for (const r of [20, 30, 40, 999])
  console.log(
    `  radius ${String(r).padEnd(4)} ${String(near(r)).padStart(4)} / ${snap.npcs.length} npcs`,
  );

// --- Egress projections -----------------------------------------------------
const best = zlib.deflateSync(Buffer.from(JSON.stringify(stripped))).length;
const mbit = (bytes, players) =>
  ((bytes * C.broadcastRate * players * 8) / 1e6).toFixed(1);
console.log(
  `\nfull 8-player tank egress: ${mbit(raw.length, 8)} Mbit/s now -> ${mbit(best, 8)} Mbit/s`,
);
console.log(
  `three full tanks:          ${mbit(raw.length, 24)} Mbit/s now -> ${mbit(best, 24)} Mbit/s`,
);
