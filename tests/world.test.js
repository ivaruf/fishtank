import test from "node:test";
import assert from "node:assert/strict";
import { World, canEat } from "../shared/world.js";
import {
  CONFIG as C,
  DIFFICULTY,
  FILTER,
  PLANTS,
  PREDATORS,
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

// Seed a tank at one difficulty without going through a lobby.
function tankAt(level, random = Math.random) {
  const w = new World(random);
  w.difficulty = level;
  w.seedNPCs();
  return w;
}
// The rule the slider must never break, at any setting: there is always
// plenty smaller than you. A tank you cannot get started in is not difficult,
// it is broken - and the trench is the tier where that is easy to get wrong.
//
// The other half is the bug the whole shape exists to fix. The two flat bands
// this replaced topped out at mass 27, which a player cleared in about twenty
// meals, and from there up nothing in the tank was too big to eat: growing
// changed nothing a player could do, which is why it never felt like growing.
test("every difficulty leaves food on the table and something above you", () => {
  for (let level = 1; level <= DIFFICULTY.length; level++) {
    const { name } = DIFFICULTY[level - 1];
    const w = tankAt(level);
    const edible = w.npcs.filter((n) => n.mass < C.startMass).length;
    const above = w.npcs.filter((n) => n.mass >= C.startMass).length;
    // Never more than a host's uplink was sized for.
    assert.ok(w.npcs.length <= C.npcCount, `${name} seeds ${w.npcs.length}`);
    assert.ok(edible >= 40, `${name} leaves only ${edible} edible at a spawn`);
    assert.ok(above >= 3, `${name} has only ${above} above a spawn`);
    // The heavy end looks the part wherever a tier's tail reaches: a
    // sixteen-unit clownfish would undercut the whole ladder.
    for (const n of w.npcs)
      if (n.mass > 60)
        assert.ok(PREDATORS.includes(n.species), `${name}: ${n.species}`);
  }
});
test("difficulty is monotonic: harder is bigger fish and more of them", () => {
  const heaviest = [],
    threats = [];
  for (let level = 1; level <= DIFFICULTY.length; level++) {
    const w = tankAt(level, () => 0.5);
    heaviest.push(Math.round(Math.max(...w.npcs.map((n) => n.mass))));
    threats.push(w.npcs.filter((n) => n.mass >= C.startMass).length);
  }
  for (let i = 1; i < DIFFICULTY.length; i++) {
    assert.ok(heaviest[i] > heaviest[i - 1], `heaviest: ${heaviest}`);
    assert.ok(threats[i] >= threats[i - 1], `above a spawn: ${threats}`);
  }
  // One draw per percentile, so a tier's counts hold round to round instead of
  // being left to luck - a trench that happened to seed no big fish would be
  // the old bug back for one round with nothing to show why. Within one,
  // rather than exactly: the boundary percentile can still land either side of
  // a given mass.
  const a = tankAt(3).npcs.filter((n) => n.mass >= 100).length;
  const b = tankAt(3).npcs.filter((n) => n.mass >= 100).length;
  assert.ok(Math.abs(a - b) <= 1, `${a} then ${b} above mass 100`);
});
test("only the host sets difficulty, and it lands on the next round", () => {
  const w = new World(() => 0.5, { lobby: true });
  w.addPlayer("a", "Host");
  w.addPlayer("b", "Guest");
  assert.equal(w.setDifficulty("b", 5), false, "a guest cannot set it");
  assert.equal(w.setDifficulty("a", 5), true);
  assert.equal(w.lobby.difficulty, 5);
  // Clamped into the table rather than trusted: this arrives over a wire.
  w.setDifficulty("a", 99);
  assert.equal(w.lobby.difficulty, DIFFICULTY.length);
  w.setDifficulty("a", -3);
  assert.equal(w.lobby.difficulty, 1);
  assert.equal(w.setDifficulty("a", NaN), false, "nonsense is refused");
  assert.equal(w.lobby.difficulty, 1, "and changes nothing");
  // The tier chosen in the lobby is the tank the round is seeded from.
  w.setDifficulty("a", DIFFICULTY.length);
  w.setReady("a", true);
  w.setReady("b", true);
  assert.equal(w.start("a"), true);
  assert.equal(w.difficulty, DIFFICULTY.length);
  assert.equal(w.npcs.length, DIFFICULTY.at(-1).npcs);
  // And a round in progress is never re-tuned underneath the players in it.
  assert.equal(w.setDifficulty("a", 1), false);
  assert.equal(w.difficulty, DIFFICULTY.length);
});
test("alone in the tank the menu stops it; with company it cannot", () => {
  const { w, p } = setup();
  const z = p.z,
    clock = w.remaining;
  w.setInput(p.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  assert.equal(w.setPaused(p.id, true), true);
  w.tick(1);
  assert.equal(p.z, z, "the water is still");
  assert.equal(w.remaining, clock, "and so is the round's clock");
  assert.equal(w.setPaused(p.id, false), true);
  w.tick(0.1);
  assert.notEqual(p.z, z, "and moves again after");
  // Somebody else in the water takes the pause away and cannot ask for one:
  // freezing a tank for everyone because one player opened a menu is not a
  // pause, and a guest arriving must never find still water it cannot start.
  w.setPaused(p.id, true);
  const two = w.addPlayer("two", "Two");
  assert.equal(w.paused, false);
  assert.equal(w.setPaused(p.id, true), false);
  assert.equal(w.setPaused(two.id, true), false);
  w.remaining = 50;
  w.tick(1);
  assert.ok(w.remaining < 50, "so the round runs on for both of them");
});
test("a meal is a mouthful: one fish cannot multiply you", () => {
  const { w, p } = setup();
  w.npcs = [];
  const whale = w.addPlayer("whale", "Whale");
  Object.assign(whale, { mass: 400, x: 0, y: 15, z: 40, protection: 0 });
  p.mass = 20;
  w.eat(p, whale);
  // Uncapped this was 20 + 400 * 0.75, or sixteen times the eater.
  assert.equal(p.mass, 20 + 20 * C.bite * C.growth);
  // Score is the whole animal: the hunt earned that.
  assert.equal(p.score, Math.round(400 * 10));
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
  // The bite cap applies to wild fish as well: this pufferfish takes a
  // mouthful of its own mass times bite, not the whole eight-mass player.
  const mouthful = Math.min(C.startMass, 20 * C.bite) * C.growth;
  assert.equal(giant.mass, 20 + mouthful);
  assert.deepEqual(
    w.events.filter((e) => e.type === "PLAYER_EATEN"),
    [
      {
        type: "PLAYER_EATEN",
        predator: "giant",
        prey: "one",
        label: "One",
        grew: +mouthful.toFixed(1),
      },
    ],
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
    difficulty: C.difficulty,
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

// Snapshots are quantised at the wire boundary only: keeping full doubles in
// the simulation but short decimals on the wire is most of the ~93% bandwidth
// saving, so guard both halves of that bargain.
test("snapshots quantise floats for the wire without touching the simulation", () => {
  const w = new World(Math.random);
  for (let i = 0; i < C.maxPlayers; i++) w.addPlayer(`p${i}`, `Player ${i}`);
  for (let i = 0; i < 40; i++) w.tick(1 / C.tickRate);
  const snap = w.snapshot();
  const decimals = (n) => (String(n).split(".")[1] ?? "").length;
  const budget = { x: 2, y: 2, z: 2, yaw: 3, pitch: 3, mass: 2 };
  for (const f of [...snap.players, ...snap.npcs])
    for (const [field, places] of Object.entries(budget))
      assert.ok(
        decimals(f[field]) <= places,
        `${field}=${f[field]} exceeds ${places} decimals on the wire`,
      );
  // The authoritative state keeps full precision, or rounding would feed back
  // into movement and into who outweighs whom.
  const live = [...w.players.values(), ...w.npcs];
  assert.ok(
    live.some((f) => decimals(f.x) > 2 || decimals(f.yaw) > 3),
    "simulation state should not be rounded",
  );
  // A regression guard on size, per fish so it survives changes to maxPlayers
  // or npcCount: un-quantising, or adding a field to every fish, shows up here
  // before it shows up on someone's uplink.
  const fish = snap.players.length + snap.npcs.length;
  const perFish = JSON.stringify(snap).length / fish;
  assert.ok(
    perFish < 200,
    `${perFish.toFixed(0)} bytes per fish on the wire, across ${fish} fish`,
  );
});
