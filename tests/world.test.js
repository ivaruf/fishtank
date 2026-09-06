import test from "node:test";
import assert from "node:assert/strict";
import { World, canEat } from "../server/game/world.js";
import {
  CONFIG as C,
  FILTER,
  PLANTS,
  inCover,
  radius,
  wrap,
} from "../shared/config.js";
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
  // Binary: any weight advantage is enough, and only a dead tie is neutral.
  assert.equal(canEat(p, { ...prey, mass: p.mass - 0.1 }), true);
  assert.equal(canEat(p, { ...prey, mass: p.mass }), false);
  assert.equal(canEat({ ...prey, mass: p.mass + 0.1, yaw: Math.PI }, p), true);
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
  w.setInput(p.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  w.tick(1);
  w.tick(60);
  assert.equal(p.z, z, "results freeze the tank");
  assert.equal(w.phase, "results", "no round starts on its own");
  assert.equal(w.nextRound(), true);
  assert.equal(w.nextRound(), false, "only from the results screen");
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
test("a wild fish big enough to eat a player does so, is named, and the player respawns", () => {
  const { w, p } = setup();
  const giant = {
    id: "giant",
    npc: true,
    color: 2,
    species: "pufferfish",
    mass: 20,
    x: 0,
    y: 15,
    z: -1.2,
    yaw: 0,
    pitch: 0,
    alive: true,
    protection: 0,
    decision: 10,
    turn: 0,
    vertical: 0,
  };
  w.npcs = [giant];
  w.tick(0);
  assert.equal(p.alive, false);
  assert.equal(p.killedBy, "a wild pufferfish");
  assert.equal(giant.mass, 20 + C.startMass * C.growth);
  assert.deepEqual(
    w.events.filter((e) => e.type === "PLAYER_EATEN"),
    [{ type: "PLAYER_EATEN", predator: "giant", prey: "one" }],
  );
  w.tick(C.respawnDelay + 0.1);
  assert.equal(p.alive, true);
  assert.equal(p.mass, C.startMass);
});
test("small or protected fish are safe from wild predators", () => {
  const { w, p } = setup();
  const giant = {
    id: "giant",
    npc: true,
    color: 0,
    species: "shark",
    mass: 20,
    x: 0,
    y: 15,
    z: -1.2,
    yaw: 0,
    pitch: 0,
    alive: true,
    protection: 0,
    decision: 10,
    turn: 0,
    vertical: 0,
  };
  w.npcs = [{ ...giant, mass: 7 }];
  w.tick(0);
  assert.equal(p.alive, true);
  w.npcs = [giant];
  p.protection = 1;
  w.tick(0);
  assert.equal(p.alive, true);
});
test("kelp hides players from hunters but not from a fish that swims into them", () => {
  const { w, p } = setup();
  const kelp = PLANTS[0];
  Object.assign(p, { x: kelp.x, y: 2, z: kelp.z });
  assert.equal(inCover(p), true);
  const tallest = Math.max(...PLANTS.map((k) => k.height));
  assert.equal(inCover({ ...p, y: tallest + 1 }), false);
  const hunter = {
    id: "hunter",
    npc: true,
    color: 1,
    species: "shark",
    mass: 20,
    x: kelp.x,
    y: 2,
    z: kelp.z - 6,
    yaw: Math.PI,
    pitch: 0,
    alive: true,
    protection: 0,
    decision: 10,
    turn: 0,
    vertical: 0,
  };
  w.npcs = [hunter];
  for (let i = 0; i < 10; i++) w.tick(0.1);
  assert.equal(hunter.hunting, false, "hidden player is not hunted");
  assert.equal(hunter.yaw, Math.PI, "hunter keeps wandering");
  assert.equal(w.snapshot().players[0].hidden, true);
  // Contact still counts: put the hunter's mouth on the hidden player.
  Object.assign(hunter, { z: kelp.z - 1.2, yaw: 0 });
  w.tick(0);
  assert.equal(p.alive, false);
});
test("big wild fish turn toward nearby smaller players; small ones ignore them", () => {
  const { w, p } = setup();
  const away = Math.PI;
  const npc = (id, mass) => ({
    id,
    npc: true,
    color: 1,
    species: "betta",
    mass,
    x: 0,
    y: 15,
    z: -6,
    yaw: away,
    pitch: 0,
    alive: true,
    protection: 0,
    decision: 10,
    turn: 0,
    vertical: 0,
  });
  const hunter = npc("hunter", 20),
    grazer = npc("grazer", 3),
    distant = { ...npc("distant", 20), z: -25 };
  w.npcs = [hunter, grazer, distant];
  for (let i = 0; i < 10; i++) w.tick(0.1);
  assert.ok(Math.abs(wrap(hunter.yaw)) < Math.PI - 0.5, "hunter turns");
  assert.equal(hunter.hunting, true);
  assert.equal(grazer.yaw, away);
  assert.equal(distant.yaw, away);
  assert.ok(hunter.z > grazer.z, "hunter also swims faster");
});
test("the filter is dead for a minute, then zaps the heaviest fish per press with a recharge", () => {
  const { w, p } = setup();
  w.npcs = [];
  const giant = w.addPlayer("giant", "Giant");
  Object.assign(giant, { x: 20, y: 15, z: -20, mass: 200, protection: 0 });
  const press = () => {
    Object.assign(p, { ...FILTER.button });
    w.tick(1 / 30);
    Object.assign(p, { x: 0, y: 15, z: 0 });
    w.tick(1 / 30);
  };
  press();
  assert.ok(
    w.events.some((e) => e.type === "BUZZ"),
    "too early only buzzes",
  );
  assert.ok(!w.events.some((e) => e.type === "ZAP"));
  assert.equal(giant.mass, 200);
  w.remaining = C.roundLength - FILTER.armAfter;
  w.tick(1 / 30);
  assert.ok(w.events.some((e) => e.type === "FILTER_ARMED"));
  assert.equal(w.snapshot().filter.armed, true);
  press();
  const zap = w.events.find((e) => e.type === "ZAP");
  assert.equal(zap?.target, "giant");
  assert.equal(zap?.by, "one");
  assert.equal(giant.mass, 140, "loses 30%");
  assert.ok(giant.stunned > FILTER.stun - 0.1);
  assert.equal(w.snapshot().filter.cooldown, FILTER.cooldown);
  const chunks = w.npcs.filter((n) => n.chunk);
  assert.equal(chunks.length, 12);
  assert.ok(
    chunks.every(
      (n) => n.species === giant.species && n.mass <= FILTER.chunkMass,
    ),
  );
  assert.ok(
    chunks.reduce((s, n) => s + n.mass, 0) <= 60,
    "food never exceeds what was lost",
  );
  // Stunned fish do not move; the button only buzzes while recharging.
  w.setInput(giant.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  const frozen = [giant.x, giant.z];
  w.tick(0.5);
  assert.deepEqual([giant.x, giant.z], frozen);
  w.events.length = 0;
  press();
  assert.ok(
    w.events.some((e) => e.type === "BUZZ") &&
      !w.events.some((e) => e.type === "ZAP"),
  );
  w.tick(FILTER.cooldown);
  press();
  assert.equal(
    w.events.filter((e) => e.type === "ZAP").length,
    1,
    "zaps again after the recharge",
  );
  assert.equal(giant.mass, 98);
  // Eating a chunk removes it for good.
  const snack = chunks[0];
  Object.assign(snack, { x: 0, y: 15, z: 1, alive: true });
  Object.assign(p, { x: 0, y: 15, z: 0, yaw: 0, pitch: 0 });
  w.tick(0);
  assert.ok(!w.npcs.includes(snack));
});
test("alone, the filter zaps the heaviest wild fish", () => {
  const { w, p } = setup();
  const big = w.npcs.reduce((x, y) => (y.mass > x.mass ? y : x), w.npcs[0]);
  const before = big.mass;
  // The seeded tank stacks every NPC at the centre; wait by the filter instead.
  Object.assign(p, { x: FILTER.x, y: 4, z: FILTER.z - 8 });
  w.remaining = C.roundLength - FILTER.armAfter;
  w.tick(1 / 30);
  Object.assign(p, { ...FILTER.button });
  w.tick(1 / 30);
  assert.equal(w.events.find((e) => e.type === "ZAP")?.target, big.id);
  assert.ok(big.mass < before && big.stunned > 0);
});
test("a lobby room waits for everyone ready and the host's start, then returns to the lobby after results", () => {
  const w = new World(() => 0.5, { lobby: true });
  const a = w.addPlayer("a", "Host"),
    b = w.addPlayer("b", "Guest");
  assert.equal(w.phase, "lobby");
  assert.equal(w.host, "a");
  assert.ok(!a.alive && !b.alive, "nobody swims in the lobby");
  const npcZ = w.npcs[0].z;
  w.tick(1);
  assert.equal(w.phase, "lobby");
  assert.notEqual(
    w.npcs[0].z,
    npcZ,
    "wild fish keep swimming behind the lobby",
  );
  assert.equal(w.start("b"), false, "only the host starts");
  assert.equal(w.start("a"), false, "not before everyone is ready");
  assert.equal(w.setDuration("b", 60), false, "only the host sets the length");
  assert.equal(w.setDuration("a", 240), true);
  assert.equal(w.setDuration("a", 5000), true);
  assert.equal(w.lobby.duration, 300, "clamped to five minutes");
  w.setDuration("a", 240);
  w.setReady("a", true);
  assert.equal(w.start("a"), false);
  w.setReady("b", true);
  assert.deepEqual(w.snapshot().lobby, {
    host: "a",
    duration: 240,
    ready: ["a", "b"],
  });
  assert.equal(w.start("a"), true);
  assert.equal(w.phase, "playing");
  assert.equal(w.remaining, 240);
  assert.ok(a.alive && b.alive);
  assert.equal(w.start("a"), false, "start is a lobby action");
  // Round ends: results, then next round means back to the lobby, not straight in.
  w.remaining = 0.01;
  w.tick(0.02);
  assert.equal(w.phase, "results");
  assert.equal(w.nextRound(), true);
  assert.equal(w.phase, "lobby");
  assert.equal(w.round, 2);
  assert.deepEqual(w.snapshot().lobby.ready, []);
  assert.ok(!a.alive && !b.alive);
  // The host leaving hands the crown to the next player.
  w.removePlayer("a");
  assert.equal(w.host, "b");
  assert.equal(w.setDuration("b", 60), true);
  // Solo rooms never see a lobby.
  const solo = new World(() => 0.5);
  solo.addPlayer("s", "Solo");
  assert.equal(solo.phase, "playing");
  assert.equal(solo.snapshot().lobby, undefined);
});
