import test from "node:test";
import assert from "node:assert/strict";
import { World, canEat } from "../server/game/world.js";
import { CONFIG as C, radius } from "../shared/config.js";
function setup() {
  const w = new World(() => 0.5),
    p = w.addPlayer("one", "One");
  p.protection = 0;
  Object.assign(p, { x: 0, y: 15, z: 0, yaw: 0, pitch: 0 });
  return { w, p };
}
test("size comparison and mouth collision exclude tails and protected fish", () => {
  const { p } = setup();
  const prey = { ...p, id: "prey", mass: 2, z: 1 };
  assert.equal(canEat(p, prey), true);
  assert.equal(canEat(prey, p), false);
  assert.equal(canEat(p, { ...prey, z: -2 }), false);
  assert.equal(canEat(p, { ...prey, protection: 1 }), false);
  assert.equal(canEat(p, { ...prey, alive: false }), false);
});
test("eating grows predator once and respawns NPC", () => {
  const { w, p } = setup();
  w.npcs = [
    {
      ...p,
      id: "npc",
      npc: true,
      mass: 2,
      z: 1,
      decision: 10,
      turn: 0,
      vertical: 0,
    },
  ];
  w.tick(0);
  assert.equal(p.mass, 9.5);
  assert.equal(p.score, 20);
  assert.equal(w.npcs[0].alive, false);
  w.tick(0);
  assert.equal(p.mass, 9.5);
  w.tick(6);
  assert.equal(w.npcs[0].alive, true);
});
test("PvP death and respawn restore small size and protect spawn", () => {
  const { w, p } = setup();
  w.npcs = [];
  p.mass = 40;
  const victim = w.addPlayer("two", "Two");
  Object.assign(victim, { x: 0, y: 15, z: 2, yaw: 0, pitch: 0, protection: 0 });
  w.tick(0);
  assert.equal(victim.alive, false);
  assert.equal(victim.killedBy, "One");
  w.tick(C.respawnDelay + 0.1);
  assert.equal(victim.alive, true);
  assert.equal(victim.mass, C.startMass);
  assert.ok(victim.protection > 0);
});
test("movement stays inside tank at every edge", () => {
  const { w, p } = setup();
  w.npcs = [];
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5])
    for (const pitch of [-1, 0, 1]) {
      p.yaw = yaw;
      p.pitch = pitch;
      for (let i = 0; i < 100; i++) {
        w.setInput(p.id, { forward: 1, strafe: 0, yaw, pitch });
        w.tick(0.1);
      }
      const r = radius(p.mass);
      assert.ok(Math.abs(p.x) <= C.width / 2 - r);
      assert.ok(Math.abs(p.z) <= C.depth / 2 - r);
      assert.ok(p.y >= r + 0.5 && p.y <= C.height - r);
    }
});
test("round ends, freezes, then resets score and mass", () => {
  const { w, p } = setup();
  p.mass = 50;
  p.score = 500;
  w.remaining = 0.01;
  w.tick(0.02);
  assert.equal(w.phase, "results");
  const z = p.z;
  w.tick(1);
  assert.equal(p.z, z);
  w.tick(C.intermission);
  assert.equal(w.phase, "playing");
  assert.equal(p.mass, C.startMass);
  assert.equal(p.score, 0);
  assert.equal(w.round, 2);
  assert.equal(w.npcs.length, C.npcCount);
});
test("NPCs move and empty rooms pause", () => {
  const w = new World(() => 0.5);
  const before = w.npcs[0].z;
  w.tick(1);
  assert.equal(w.npcs[0].z, before);
  w.addPlayer("p", "P");
  w.tick(1);
  assert.notEqual(w.npcs[0].z, before);
});

test("players can stand still, move along camera aim, strafe, and stop", () => {
  const { w, p } = setup();
  w.npcs = [];
  const initial = [p.x, p.y, p.z];
  w.tick(0.1);
  assert.deepEqual([p.x, p.y, p.z], initial);
  w.setInput(p.id, { forward: 1, strafe: 0, yaw: Math.PI / 2, pitch: 0.5 });
  w.tick(0.1);
  assert.ok(p.x > initial[0] && p.y > initial[1]);
  assert.ok(Math.abs(p.z - initial[2]) < 1e-8);
  w.setInput(p.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
  const stopped = [p.x, p.y, p.z];
  w.tick(0.1);
  assert.deepEqual([p.x, p.y, p.z], stopped);
  w.setInput(p.id, { forward: 0, strafe: 1, yaw: 0, pitch: 1 });
  w.tick(0.1);
  assert.ok(p.x > stopped[0]);
  assert.equal(p.y, stopped[1]);
});
test("stale movement input expires and respawns clear held input", () => {
  const { w, p } = setup();
  w.npcs = [];
  w.setInput(p.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  w.tick(0.1);
  const position = [p.x, p.y, p.z];
  w.tick(C.inputTimeout + 0.1);
  assert.deepEqual([p.x, p.y, p.z], position);
  w.setInput(p.id, { forward: 1, strafe: 1, yaw: 0, pitch: 0 });
  w.spawn(p);
  assert.equal(p.input.forward, 0);
  assert.equal(p.input.strafe, 0);
});
