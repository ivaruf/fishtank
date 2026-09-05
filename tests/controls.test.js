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
      "depth-gauge": new Element(),
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
test("touch always swims, steers relative to the camera, dives by dragging and levels out", () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  try {
    const { win, zones, controls } = setup();
    const move = zones["move-zone"],
      dive = zones["depth-zone"];
    controls.setActive(true);
    controls.setTouchMode(true);
    controls.orient(0, 0);
    assert.equal(controls.read(0.1, 0).forward, 1, "swims with no input");
    assert.equal(controls.read(0.1, 0).strafe, 0);
    // Push the stick right: heading turns toward camera yaw + 90°, rate limited.
    dispatch(move, "pointerdown", { pointerId: 1, clientX: 200, clientY: 400 });
    assert.equal(
      zones["move-stick"].hidden,
      false,
      "stick appears under the thumb",
    );
    assert.equal(zones["move-stick"].style.left, "200px");
    dispatch(move, "pointermove", { pointerId: 1, clientX: 260, clientY: 400 });
    const turned = controls.read(0.25, 0).yaw;
    assert.ok(Math.abs(turned - 0.6) < 1e-9, `rate limited turn: ${turned}`);
    for (let i = 0; i < 10; i++) controls.read(0.25, 0);
    assert.ok(Math.abs(controls.read(0, 0).yaw - Math.PI / 2) < 1e-9);
    // With the camera already turned, the same push means "keep turning".
    assert.ok(controls.read(0.1, Math.PI / 2).yaw > Math.PI / 2);
    dispatch(move, "pointerup", { pointerId: 1 });
    assert.equal(zones["move-stick"].hidden, true);
    const held = controls.read(0.5, 0).yaw;
    assert.equal(
      controls.read(0.5, 0).yaw,
      held,
      "heading holds when released",
    );
    assert.equal(controls.read().forward, 1);
    // Drag up on the right to rise; release and the fish levels out.
    dispatch(dive, "pointerdown", { pointerId: 2, clientX: 700, clientY: 400 });
    dispatch(dive, "pointermove", { pointerId: 2, clientX: 700, clientY: 325 });
    const up = controls.read(0.1, 0).pitch;
    assert.ok(up > 0.5 && up < 0.6, `drag up rises: ${up}`);
    dispatch(dive, "pointerup", { pointerId: 2 });
    const p1 = controls.read(0.5, 0).pitch,
      p2 = controls.read(0.5, 0).pitch;
    assert.ok(p1 < up && p2 < p1 && p2 > 0, "pitch decays toward level");
    // Bite assist drifts the heading only while the thumb is idle.
    controls.assist({ yaw: held + 1, pitch: 0 });
    const nudged = controls.read(0.2, 0).yaw;
    assert.ok(nudged > held && nudged < held + 0.2);
    dispatch(move, "pointerdown", { pointerId: 3, clientX: 100, clientY: 300 });
    dispatch(move, "pointermove", { pointerId: 3, clientX: 100, clientY: 240 });
    controls.read(0.2, nudged);
    assert.ok(
      Math.abs(controls.read(0, nudged).yaw - nudged) < 1e-9,
      "stick overrides assist",
    );
    controls.assist(null);
    // Focus loss drops both thumbs.
    dispatch(win, "blur");
    assert.equal(move.pointers.size, 0);
    assert.equal(zones["move-stick"].hidden, true);
    controls.setTouchMode(false);
    assert.equal(controls.read().forward, 0, "desktop mode needs a key again");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
