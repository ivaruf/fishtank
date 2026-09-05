import test from "node:test";
import assert from "node:assert/strict";
import { createControls } from "../client/js/controls.js";

class Element extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.pointers = new Set();
    this.knob = { style: {} };
  }
  querySelector() {
    return this.knob;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 112, height: 112 };
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
test("desktop stops on release; dual sticks track independent fingers and clear on focus loss", () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document;
  const win = new EventTarget(),
    doc = new EventTarget(),
    canvas = new Element();
  const move = new Element(),
    look = new Element();
  doc.getElementById = (id) => (id === "move-stick" ? move : look);
  globalThis.window = win;
  globalThis.document = doc;
  try {
    const controls = createControls(canvas);
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
    dispatch(move, "pointerdown", { pointerId: 1, clientX: 56, clientY: 10 });
    dispatch(look, "pointerdown", { pointerId: 2, clientX: 100, clientY: 56 });
    const before = controls.read();
    const after = controls.read(0.1);
    assert.equal(after.forward, 1);
    assert.ok(after.yaw > before.yaw);
    dispatch(look, "pointerup", { pointerId: 2 });
    assert.equal(controls.read().forward, 1);
    const angle = controls.read().yaw;
    assert.equal(controls.read(0.1).yaw, angle);
    dispatch(move, "pointercancel", { pointerId: 1 });
    assert.equal(controls.read().forward, 0);
    dispatch(move, "pointerdown", { pointerId: 3, clientX: 56, clientY: 56 });
    assert.equal(Math.abs(controls.read().forward), 0);
    dispatch(win, "keydown", { key: "d" });
    dispatch(win, "blur");
    assert.equal(controls.read().strafe, 0);
    assert.equal(move.pointers.size, 0);
    controls.setActive(false);
    dispatch(win, "keydown", { key: "w" });
    assert.equal(controls.read().forward, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
