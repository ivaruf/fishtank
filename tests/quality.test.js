import test from "node:test";
import assert from "node:assert/strict";

// Enough DOM to build a dropdown into. Only what quality.js touches: children,
// classes, dataset, attributes, hidden, focus and events.
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
  querySelector(selector) {
    const [, name, value] = selector.match(/\[([\w-]+)="([^"]+)"\]/) ?? [];
    return this.descendants().find((n) => n.getAttribute(name) === value);
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  contains(node) {
    return node === this || this.descendants().includes(node);
  }
  // A plain EventTarget does not bubble, and the keydown handling under test
  // is bound to the picker's root while a player's key lands on whichever row
  // has focus. So this walks up the parents itself, and stops where
  // stopPropagation says to, which is the behaviour being relied on.
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
const parts = (slot) => {
  const picker = slot.children[0];
  return {
    picker,
    trigger: picker.children[0],
    label: picker.children[0].children[1],
    list: picker.children[1],
    options: picker.children[1].children,
  };
};
const open = (p) => p.trigger.getAttribute("aria-expanded") === "true";

test("the dropdown opens, picks, marks the choice and closes itself", () => {
  const slot = new Node();
  document.append(slot);
  mountQuality(slot);
  const p = parts(slot);
  assert.equal(p.options.length, TIERS.length);
  assert.equal(p.label.textContent, "Balanced", "shows the current tier");
  assert.equal(open(p), false, "starts closed");
  assert.equal(p.list.hidden, true);

  p.trigger.onclick();
  assert.equal(open(p), true, "the trigger opens it");
  assert.equal(p.list.hidden, false);
  // Opening lands focus on the current row, so a keypress goes somewhere sane.
  const chosen = p.options.find(
    (o) => o.getAttribute("aria-checked") === "true",
  );
  assert.equal(chosen.dataset.tier, "balanced");
  assert.ok(chosen.focused > 0, "focus starts on the current tier");

  p.options.find((o) => o.dataset.tier === "potato").onclick();
  assert.equal(quality.value, "potato", "picking sets the value");
  assert.equal(p.label.textContent, "Potato", "and relabels the trigger");
  assert.equal(open(p), false, "and closes");
  assert.equal(
    p.options.find((o) => o.getAttribute("aria-checked") === "true").dataset
      .tier,
    "potato",
    "the tick moves",
  );
  // Clicking the trigger again toggles rather than reopening.
  p.trigger.onclick();
  assert.equal(open(p), true);
  p.trigger.onclick();
  assert.equal(open(p), false, "a second press closes it");
  quality.set("balanced");
});

test("two dropdowns are two views of one setting", () => {
  const menu = new Node(),
    pause = new Node();
  document.append(menu, pause);
  mountQuality(menu);
  mountQuality(pause);
  const a = parts(menu),
    b = parts(pause);
  a.trigger.onclick();
  a.options.find((o) => o.dataset.tier === "ultra").onclick();
  assert.equal(quality.value, "ultra");
  assert.equal(b.label.textContent, "Ultra", "the other one relabels too");
  assert.equal(
    b.options.find((o) => o.getAttribute("aria-checked") === "true").dataset
      .tier,
    "ultra",
    "and its tick moves",
  );
  // Only one list may be open: opening the second closes the first.
  b.trigger.onclick();
  a.trigger.onclick();
  assert.equal(open(a), true);
  assert.equal(open(b), false, "opening one closes the other");
  quality.set("balanced");
});

test("escape closes the list without closing the panel behind it", () => {
  const slot = new Node();
  document.append(slot);
  mountQuality(slot);
  const p = parts(slot);
  p.trigger.onclick();
  // The pause panel is a <dialog>, and closing it is the default action of
  // Escape: without preventDefault one key would dismiss both.
  const event = fire(p.list, "keydown", { key: "Escape" });
  assert.equal(open(p), false, "escape closes the list");
  assert.equal(event.defaultPrevented, true, "and keeps the panel open");
  assert.ok(p.trigger.focused > 0, "focus returns to the trigger");
});

test("arrow keys walk the list and wrap", () => {
  const slot = new Node();
  document.append(slot);
  mountQuality(slot);
  const p = parts(slot);
  quality.set("potato");
  p.trigger.onclick();
  assert.equal(document.activeElement.dataset.tier, "potato", "starts here");
  fire(p.list, "keydown", { key: "ArrowDown" });
  assert.equal(document.activeElement.dataset.tier, "battery");
  fire(p.list, "keydown", { key: "ArrowUp" });
  assert.equal(document.activeElement.dataset.tier, "potato");
  fire(p.list, "keydown", { key: "ArrowUp" });
  assert.equal(document.activeElement.dataset.tier, "ultra", "and it wraps");
  quality.set("balanced");
});

test("a tap anywhere else closes an open list", () => {
  const slot = new Node(),
    elsewhere = new Node();
  document.append(slot, elsewhere);
  mountQuality(slot);
  const p = parts(slot);
  p.trigger.onclick();
  assert.equal(open(p), true);
  fire(document, "pointerdown", { target: elsewhere });
  assert.equal(open(p), false, "an outside tap closes it");
  p.trigger.onclick();
  fire(document, "pointerdown", { target: p.options[0] });
  assert.equal(open(p), true, "a tap inside does not");
  quality.set("balanced");
});
