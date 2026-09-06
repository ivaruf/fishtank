import test from "node:test";
import assert from "node:assert/strict";
import { movementVector, parseInput } from "../shared/movement.js";
import {
  hardwareScaling,
  modelDetail,
  reliefStep,
  RELIEF,
} from "../client/js/rendering.js";

test("camera-relative diagonals do not exceed speed and analogue magnitude survives", () => {
  for (const yaw of [0, 1, 2, 3])
    for (const pitch of [-1, 0, 1]) {
      const v = movementVector({ forward: 1, strafe: 1, yaw, pitch });
      assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-10);
    }
  const v = movementVector({ forward: 0.25, strafe: 0, yaw: 0, pitch: 0 });
  assert.equal(v.z, 0.25);
  assert.equal(
    movementVector({ forward: -1, strafe: 0, yaw: 0, pitch: 0 }).z,
    -1,
  );
});
test("invalid inputs are rejected, finite axes and aim are bounded", () => {
  assert.equal(parseInput({ forward: NaN, strafe: 0, yaw: 0, pitch: 0 }), null);
  assert.equal(
    parseInput({ forward: 1, strafe: 0, yaw: Infinity, pitch: 0 }),
    null,
  );
  assert.equal(parseInput({ turn: 1, pitch: 0 }), null);
  const input = parseInput({
    forward: 100,
    strafe: -100,
    yaw: Math.PI * 10,
    pitch: 9,
  });
  assert.equal(input.forward, 1);
  assert.equal(input.strafe, -1);
  assert.ok(Math.abs(input.yaw) < 1e-10);
  assert.equal(input.pitch, 1.35);
});
test("high-DPI screens render above CSS resolution with bounded quality choices", () => {
  assert.equal(hardwareScaling("balanced", 3), 1 / 1.5);
  assert.equal(hardwareScaling("sharp", 3), 0.5);
  assert.equal(hardwareScaling("battery", 3), 1);
  assert.equal(hardwareScaling("sharp", 1), 1);
  // Ultra supersamples past the display density but stays bounded.
  assert.equal(hardwareScaling("ultra", 1), 1 / 1.5);
  assert.equal(hardwareScaling("ultra", 2), 1 / 3);
  assert.equal(hardwareScaling("ultra", 4), 1 / 3);
  assert.equal(modelDetail("ultra"), "hd");
  assert.equal(modelDetail("sharp"), "high");
  assert.equal(modelDetail("balanced"), "standard");
  assert.equal(modelDetail("battery"), "low");
});

// Adaptive resolution must converge, not oscillate: a frame rate parked inside
// the dead band has to leave the relief factor exactly where it is.
test("adaptive resolution steps down when slow, recovers when fast, and holds in between", () => {
  // Nothing measured yet: never guess.
  assert.equal(reliefStep(1, 0), 1);
  assert.equal(reliefStep(1, undefined), 1);

  // Slow frames give up pixels, down to a floor.
  assert.ok(reliefStep(1, 25) > 1, "a slow device draws fewer pixels");
  let relief = 1;
  for (let i = 0; i < 50; i++) relief = reliefStep(relief, 20);
  assert.equal(relief, RELIEF.MAX, "relief stops at its floor");

  // Fast frames hand the pixels back, no further than the tier itself.
  for (let i = 0; i < 50; i++) relief = reliefStep(relief, 60);
  assert.equal(relief, 1, "never sharper than the chosen tier");

  // Anything inside the dead band is left alone, so it cannot hunt.
  for (const fps of [RELIEF.LOW, 48, RELIEF.HIGH]) {
    assert.equal(reliefStep(1.45, fps), 1.45, `holds steady at ${fps} fps`);
  }
  // A rate that would sit between two steps still settles rather than cycling.
  let seen = new Set();
  relief = 1;
  for (let i = 0; i < 40; i++) {
    relief = reliefStep(relief, relief > 1.2 ? 58 : 30);
    seen.add(relief);
  }
  assert.ok(seen.size <= 4, `settles into a small range, saw ${[...seen]}`);
});
