import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../shared/world.js";
import {
  OBSTACLES,
  ROCKS,
  SCENERY,
  drawRocks,
  noise,
  pushOutOfScenery,
} from "../shared/scenery.js";
import { CONFIG as C, FILTER, radius } from "../shared/config.js";
// A fish is only ever a position and a mass to the collision code.
const fish = (x, y, z, mass = C.startMass) => ({ x, y, z, mass });
const free = (x, y, z, mass) => !pushOutOfScenery(fish(x, y, z, mass));
// Somewhere in this column a fish of this mass can float clear, under a
// ceiling. Used instead of hand-picked coordinates so the tests still mean
// what they say if a box moves by a few centimetres.
function clearHeight(x, z, mass, ceiling) {
  const r = radius(mass);
  for (let y = r + 0.5; y < ceiling; y += 0.01)
    if (free(x, y, z, mass)) return y;
  return null;
}
const arch = SCENERY.find((s) => s.asset === "stone-arch");
const wreck = SCENERY.find((s) => s.asset === "little-shipwreck");
// The lintel's underside, and the top of the crown, in world units.
const UNDER_ARCH = 1.19 * arch.scale,
  OVER_ARCH = 1.83 * arch.scale;

// The whole point of the work: the arch is a gate that closes as you grow, and
// nothing in the code says so - it falls out of the fish's radius.
test("a small fish ducks under the arch and a grown one has to go over", () => {
  assert.ok(
    clearHeight(arch.x, arch.z, C.startMass, UNDER_ARCH),
    "a fresh fish fits through the arch",
  );
  assert.equal(
    clearHeight(arch.x, arch.z, 45, UNDER_ARCH),
    null,
    "a mass-45 fish cannot get under the lintel",
  );
  // Blocked from the shortcut, not from the tank: over the crown is open.
  assert.ok(
    free(arch.x, OVER_ARCH + radius(45) + 0.5, arch.z, 45),
    "a grown fish can still swim over the arch",
  );
  // Where the gate closes. Growth is 0.75 of what you eat, so this is four or
  // five meals from a start of 8: if that beat moves, this number moves.
  let pass = 1,
    stop = 400;
  for (let i = 0; i < 44; i++) {
    const mid = (pass + stop) / 2;
    if (clearHeight(arch.x, arch.z, mid, UNDER_ARCH)) pass = mid;
    else stop = mid;
  }
  assert.ok(
    Math.abs(pass - 32.7) < 1,
    `arch closes at mass ${pass.toFixed(1)}, expected about 32.7`,
  );
});

test("the wreck is a shell: a small fish gets inside, a big one cannot", () => {
  const inside = (mass) => {
    // Sweep the hull's own footprint rather than guessing a point in it.
    for (let dx = -1.2; dx <= 1.2; dx += 0.1)
      for (let dz = -0.3; dz <= 0.3; dz += 0.1) {
        const x =
            wreck.x +
            (dx * Math.cos(wreck.yaw) + dz * Math.sin(wreck.yaw)) * wreck.scale,
          z =
            wreck.z +
            (-dx * Math.sin(wreck.yaw) + dz * Math.cos(wreck.yaw)) *
              wreck.scale;
        const y = clearHeight(x, z, mass, 0.9 * wreck.scale);
        if (y !== null) return { x, y, z };
      }
    return null;
  };
  assert.ok(inside(2), "a wild minnow can be in among the ribs");
  assert.equal(inside(120), null, "a mass-120 fish cannot be inside the hull");
  // The planked flank is solid from outside, whatever the size.
  const flankX =
      wreck.x +
      (0.08 * Math.cos(wreck.yaw) - 0.58 * Math.sin(wreck.yaw)) * wreck.scale,
    flankZ =
      wreck.z +
      (-0.08 * Math.sin(wreck.yaw) - 0.58 * Math.cos(wreck.yaw)) * wreck.scale;
  assert.ok(
    pushOutOfScenery(fish(flankX, 0.58 * wreck.scale, flankZ, 2)),
    "the far flank stops even the smallest fish",
  );
});

test("a rock pushes a fish out along the way it came in", () => {
  const rock = ROCKS[ROCKS.length - 1];
  const f = fish(rock.x, rock.y, rock.z + 0.1, C.startMass);
  const push = pushOutOfScenery(f);
  assert.ok(push, "a fish inside a boulder is moved");
  assert.ok(f.z > rock.z, "and moved out the side it entered");
  assert.equal(
    pushOutOfScenery(f),
    null,
    "one pass is enough: it is outside afterwards",
  );
  // Every boulder is solid at its own centre, and none of them is enormous.
  for (const r of ROCKS) {
    assert.ok(pushOutOfScenery(fish(r.x, r.y, r.z, 2)), "rock is solid");
    assert.ok(Math.max(r.sx, r.sy, r.sz) < 5, "rock is a rock, not a reef");
  }
});

test("swimming into a hull slides along it rather than sticking", () => {
  const w = new World(() => 0.5),
    p = w.addPlayer("one", "One");
  p.protection = 0;
  // Sat against the far flank, aimed into it and along it at once.
  Object.assign(p, {
    x: wreck.x,
    y: 1.5,
    z: wreck.z,
    yaw: wreck.yaw + Math.PI,
    pitch: 0,
    input: { forward: 1, strafe: 1, yaw: wreck.yaw + Math.PI, pitch: 0 },
    inputAge: 0,
  });
  const before = { x: p.x, z: p.z };
  for (let i = 0; i < 30; i++) w.move(p, 1 / 30, C.speed, { x: 0, y: 0, z: 0 });
  // Nothing to prove about direction here, only that a second of pushing into
  // scenery leaves the fish in the tank and out of the boxes.
  assert.equal(pushOutOfScenery(p), null, "never left inside a box");
  assert.ok(Math.abs(p.x) < C.width / 2 && Math.abs(p.z) < C.depth / 2);
  assert.ok(
    Math.hypot(p.x - before.x, p.z - before.z) < 40,
    "and was not flung across the tank",
  );
});

test("the filter, the kelp and the plants all stay swimmable", () => {
  // The button is gameplay: if scenery ever blocks it the round breaks.
  assert.ok(
    free(FILTER.button.x, FILTER.button.y, FILTER.button.z, 400),
    "the biggest fish in the tank can still reach the red button",
  );
  for (let y = 1; y < 10; y += 0.5)
    assert.ok(free(FILTER.x, y, FILTER.z, 200), "the filter's corner is clear");
  // Plants are dressing, not obstacles.
  for (const spot of SCENERY) {
    if (!/grass|plant/.test(spot.asset)) continue;
    assert.ok(
      free(spot.x, 2, spot.z, C.startMass),
      `${spot.asset} does not block anything`,
    );
  }
});

test("nobody spawns inside the scenery", () => {
  let n = 0;
  for (let seed = 0; seed < 200; seed++) {
    const w = new World(() => ((seed * 37) % 100) / 100);
    const f = { mass: C.startMass, npc: false };
    w.spawn(f);
    assert.equal(pushOutOfScenery(f), null, "spawned in open water");
    n++;
  }
  // And a full tank of wild fish, drawn from real randomness.
  const w = new World(Math.random);
  w.seedNPCs();
  for (const f of w.npcs)
    assert.equal(pushOutOfScenery(f), null, "wild fish spawned in the clear");
  assert.ok(n === 200 && w.npcs.length === C.npcCount);
});

test("the rock table is the one the client draws from", () => {
  // The client re-runs drawRocks on its own generator to keep the kelp where
  // it was, so the two draws have to agree exactly.
  assert.deepEqual(drawRocks(noise(29)), ROCKS);
  assert.equal(OBSTACLES.length, ROCKS.length + 11);
  // Nothing anywhere may reach outside the glass.
  for (const o of OBSTACLES) {
    assert.ok(Math.abs(o.x) + o.reach < C.width / 2 + 4, "inside the tank");
    assert.ok(Math.abs(o.z) + o.reach < C.depth / 2 + 4, "inside the tank");
  }
});
