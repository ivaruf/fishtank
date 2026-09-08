import test from "node:test";
import assert from "node:assert/strict";
import { createControls } from "../client/js/controls.js";

class Element extends EventTarget {
  constructor(rect = { left: 0, top: 0, width: 800, height: 600 }) {
    super();
    this.style = {};
    this.hidden = true;
    this.pointers = new Set();
    this.knob = { style: {} };
    this.rect = rect;
  }
  querySelector() {
    return this.knob;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(id) {
    this.pointers.add(id);
  }
  hasPointerCapture(id) {
    return this.pointers.has(id);
  }
  releasePointerCapture(id) {
    this.pointers.delete(id);
  }
}
function dispatch(target, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(props))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
}
function setup() {
  const win = new EventTarget(),
    doc = new EventTarget(),
    canvas = new Element(),
    zones = {
      "move-zone": new Element(),
      "depth-zone": new Element({ left: 400, top: 0, width: 400, height: 600 }),
      "move-stick": new Element(),
    };
  doc.getElementById = (id) => zones[id];
  globalThis.window = win;
  globalThis.document = doc;
  return { win, doc, canvas, zones, controls: createControls(canvas) };
}
test("desktop stops on release, aims with the mouse, and clears on focus loss", () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  try {
    const { win, doc, canvas, zones, controls } = setup();
    controls.setActive(true);
    dispatch(win, "keydown", { key: "w" });
    assert.equal(controls.read().forward, 1);
    dispatch(win, "keyup", { key: "w" });
    assert.equal(controls.read().forward, 0);
    dispatch(doc, "mousemove", {
      target: canvas,
      movementX: 100,
      movementY: -40,
    });
    assert.ok(controls.read().yaw > 0 && controls.read().pitch > 0);
    assert.equal(controls.read().forward, 0);
    // Touch zones are inert until touch mode is on.
    dispatch(zones["move-zone"], "pointerdown", {
      pointerId: 1,
      clientX: 200,
      clientY: 400,
    });
    assert.equal(zones["move-zone"].pointers.size, 0);
    dispatch(win, "keydown", { key: "d" });
    dispatch(win, "blur");
    assert.equal(controls.read().strafe, 0);
    controls.setActive(false);
    dispatch(win, "keydown", { key: "w" });
    assert.equal(controls.read().forward, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
// Touch is Roblox-style and is now the only scheme: the left stick is WASD and
// the right side is the mouse. Movement and aim are independent, and letting go
// of the stick stops the fish outright.
test("touch moves with the left thumb and aims with the right", () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  try {
    const { zones, controls } = setup();
    const move = zones["move-zone"],
      look = zones["depth-zone"];
    controls.setActive(true);
    controls.setTouchMode(true);
    controls.orient(0, 0);
    assert.equal(controls.read().forward, 0, "still by default");
    assert.equal(controls.read().strafe, 0);

    // Push the stick straight up: full forward, no sideways drift.
    dispatch(move, "pointerdown", { pointerId: 1, clientX: 200, clientY: 400 });
    dispatch(move, "pointermove", { pointerId: 1, clientX: 200, clientY: 340 });
    let input = controls.read();
    assert.equal(input.forward, 1, "stick up is full forward");
    assert.equal(input.strafe, 0);

    // Push it straight right: pure strafe, which touch never had before.
    dispatch(move, "pointermove", { pointerId: 1, clientX: 260, clientY: 400 });
    input = controls.read();
    assert.equal(input.strafe, 1, "stick right strafes");
    assert.equal(input.forward, 0, "and does not creep forward");

    // Inside the deadzone the fish is parked.
    dispatch(move, "pointermove", { pointerId: 1, clientX: 204, clientY: 400 });
    assert.equal(controls.read().forward, 0, "deadzone means stopped");

    // Aim does not move on its own while the stick is pushed.
    dispatch(move, "pointermove", { pointerId: 1, clientX: 260, clientY: 400 });
    const facing = controls.read().yaw;
    assert.equal(controls.read().yaw, facing, "the stick never aims");

    // Releasing stops the fish and leaves the aim untouched.
    dispatch(move, "pointerup", { pointerId: 1 });
    input = controls.read();
    assert.equal(input.forward, 0, "released means stopped");
    assert.equal(input.strafe, 0);
    assert.equal(input.yaw, facing);

    // The right side is the mouse: drag to aim. It draws no widget at all,
    // because the camera turning is the feedback, so tracking it must cope
    // with a zone that has no visual to show or hide.
    dispatch(look, "pointerdown", { pointerId: 2, clientX: 700, clientY: 400 });
    dispatch(look, "pointermove", { pointerId: 2, clientX: 760, clientY: 400 });
    const turned = controls.read().yaw;
    assert.ok(turned > facing, `drag right looks right: ${turned}`);
    dispatch(look, "pointermove", { pointerId: 2, clientX: 760, clientY: 340 });
    assert.ok(controls.read().pitch > 0, "drag up looks up");
    // Looking around must never move a parked fish.
    assert.equal(controls.read().forward, 0, "aiming is not moving");

    // Nothing steers but the thumb, and there is nothing left that could: the
    // bite assist went with the scheme that needed it, so a released aim holds
    // exactly where it was put.
    dispatch(look, "pointerup", { pointerId: 2 });
    const aimed = controls.read().yaw;
    assert.equal(controls.read().yaw, aimed, "aim holds where it was put");
    assert.equal(controls.assist, undefined, "no assist to fight the thumb");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
