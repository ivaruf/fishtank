import test from "node:test";
import assert from "node:assert/strict";

// Enough DOM to build the picker into. Only what quality.js touches: children,
// classes, dataset, attributes, focus and events.
class Node extends EventTarget {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.hidden = false;
    this.focused = 0;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  focus() {
    this.focused++;
    document.activeElement = this;
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  // A plain EventTarget does not bubble, and the keydown handling under test
  // is bound to the row group while a player's key lands on whichever row has
  // focus. So this walks up the parents itself.
  bubble(type, props) {
    const event = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(props))
      Object.defineProperty(event, k, { value: v });
    for (let at = this; at; at = at.parent) {
      EventTarget.prototype.dispatchEvent.call(at, event);
      if (event.cancelBubble) break;
    }
    return event;
  }
}
const document = Object.assign(new Node("body"), {
  createElement: (tag) => new Node(tag),
  activeElement: null,
});
globalThis.document = document;
globalThis.localStorage = undefined;
const { mountQuality, quality, TIERS } =
  await import("../client/js/quality.js");
const fire = (target, type, props = {}) => target.bubble(type, props);
// The mount puts the row group straight into the slot: there is no wrapper and
// no trigger, because nothing opens.
const mount = (slot) => {
  document.append(slot);
  mountQuality(slot);
  const list = slot.children[0];
  return { list, options: list.children };
};
const ticked = (p) =>
  p.options.find((o) => o.getAttribute("aria-checked") === "true")?.dataset
    .tier;

test("the rows are a radio group, and picking one sets the value", () => {
  const p = mount(new Node());
  assert.equal(p.options.length, TIERS.length, "every tier gets a row");
  assert.equal(p.list.getAttribute("role"), "radiogroup");
  assert.equal(p.options[0].getAttribute("role"), "radio");
  assert.equal(p.list.hidden, false, "nothing is hidden behind a popup");
  assert.equal(ticked(p), "balanced", "the current tier is marked");

  const potato = p.options.find((o) => o.dataset.tier === "potato");
  potato.onclick();
  assert.equal(quality.value, "potato", "picking sets the value");
  assert.equal(ticked(p), "potato", "the tick moves");
  assert.ok(potato.focused > 0, "the row keeps the focus it was given");
  quality.set("balanced");
});

test("two mounted groups are two views of one setting", () => {
  const a = mount(new Node()),
    b = mount(new Node());
  a.options.find((o) => o.dataset.tier === "ultra").onclick();
  assert.equal(quality.value, "ultra");
  assert.equal(ticked(b), "ultra", "the other group's tick moves too");
  b.options.find((o) => o.dataset.tier === "battery").onclick();
  assert.equal(ticked(a), "battery", "and it works in both directions");
  quality.set("balanced");
});

test("arrow keys walk the rows and wrap", () => {
  const p = mount(new Node());
  quality.set("potato");
  p.options[0].focus();
  assert.equal(document.activeElement.dataset.tier, "potato", "starts here");
  fire(p.list, "keydown", { key: "ArrowDown" });
  assert.equal(document.activeElement.dataset.tier, "battery");
  fire(p.list, "keydown", { key: "ArrowUp" });
  assert.equal(document.activeElement.dataset.tier, "potato");
  fire(p.list, "keydown", { key: "ArrowUp" });
  assert.equal(document.activeElement.dataset.tier, "ultra", "and it wraps");
  quality.set("balanced");
});

test("escape is left alone: the panel behind the rows owns it", () => {
  const p = mount(new Node());
  // Nothing here opens, so nothing here consumes the key. In the pause panel
  // Escape means "back to the game", and a picker that swallowed it - as the
  // dropdown had to - would take that away.
  const event = fire(p.list, "keydown", { key: "Escape" });
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.cancelBubble, false, "and it reaches the dialog");
});
