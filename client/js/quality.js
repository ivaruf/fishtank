// The graphics setting: one value, one place it is stored, and however many
// places it is drawn.
//
// It is an EventTarget with a `value`, and that shape is deliberate. world.js,
// sand.js and environment.js were each handed the `<select>` itself and
// listened to it for "change", so presenting the same two things means none of
// them had to learn that the dropdown became a row of buttons - or that there
// is now more than one row of them.
//
// More than one, because the setting is wanted in two places that are never on
// screen together: on the menu before diving in, and behind the pause dialog
// during play, where it does not sit on top of the game the rest of the time.
// Two views of one value rather than two values: every mounted row re-renders
// from here, so they cannot disagree.
// Ordered cheapest first, which is the order they are drawn in.
export const TIERS = Object.freeze(
  [
    // The note is one short line because it has to sit under the label in a
    // dropdown row; the long version is the title, for a hover on a desktop.
    {
      id: "potato",
      label: "Potato",
      note: "Wireframe and flat colour, like week one",
      long: "The tank as it looked in its first week: a wireframe frame, a grid on the sand, flat colours and no room beyond the glass. For an old tablet, or for a laugh.",
    },
    {
      id: "battery",
      label: "Battery saver",
      note: "One pixel per pixel, simplest fish",
      long: "One render pixel per screen pixel, and the lightest authored fish.",
    },
    {
      id: "balanced",
      label: "Balanced",
      note: "The default",
      long: "Up to 1.5 render pixels per screen pixel, and the standard fish.",
    },
    {
      id: "sharp",
      label: "Sharper",
      note: "Denser fish, authored seabed and office",
      long: "Up to 2 render pixels per screen pixel, denser fish, and the authored seabed, office and filter detail.",
    },
    {
      id: "ultra",
      label: "Ultra",
      note: "Supersampled, densest of everything",
      long: "Supersampled past the display's own density, and the densest of everything.",
    },
  ].map(Object.freeze),
);
const DEFAULT = "balanced";
const KEY = "fishtank.quality";
const known = (id) => TIERS.some((t) => t.id === id);
class Quality extends EventTarget {
  #value = DEFAULT;
  constructor() {
    super();
    try {
      const saved = localStorage.getItem(KEY);
      if (known(saved)) this.#value = saved;
    } catch {
      /* Private mode or a blocked store: the default is a fine answer. */
    }
  }
  get value() {
    return this.#value;
  }
  set(id) {
    if (!known(id) || id === this.#value) return;
    this.#value = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* Not remembered this time, which is not worth telling anyone about. */
    }
    for (const picker of pickers) draw(picker);
    // "change" rather than a callback list: the listeners predate this module
    // and were written against a DOM element.
    this.dispatchEvent(new Event("change"));
  }
  // Cheapest to dearest, as a number, for anything that wants to compare
  // tiers rather than name them.
  get rank() {
    return TIERS.findIndex((t) => t.id === this.#value);
  }
  atLeast(id) {
    return this.rank >= TIERS.findIndex((t) => t.id === id);
  }
}
export const quality = new Quality();
// One entry per mounted dropdown: its trigger, the label inside it, and the
// list it opens. Every one of them redraws whenever the value changes, so two
// pickers on two screens cannot drift apart.
const pickers = new Set();
function draw(picker) {
  const tier = TIERS.find((t) => t.id === quality.value);
  picker.label.textContent = tier.label;
  picker.trigger.title = tier.long;
  for (const option of picker.list.children)
    option.setAttribute(
      "aria-checked",
      String(option.dataset.tier === quality.value),
    );
}
function open(picker, on) {
  picker.list.hidden = !on;
  picker.trigger.setAttribute("aria-expanded", String(on));
  if (on)
    // Start on the current tier, so an arrow key or a Return goes somewhere
    // sensible rather than to the top of the list.
    picker.list
      .querySelector('[aria-checked="true"]')
      ?.focus({ preventScroll: true });
}
const closeAll = (except) => {
  for (const picker of pickers) if (picker !== except) open(picker, false);
};
// One document listener for every picker: a tap anywhere else closes them.
// Pointerdown rather than click, so it fires before the trigger's own click
// and a second tap on the trigger still toggles rather than reopening.
//
// Attached on the first mount rather than at import. hardwareScaling and
// modelDetail below are pure and are imported by tests that have no DOM at
// all, and a `document` reference out here made this whole module refuse to
// load for them - which is exactly how it was found.
let watching = false;
function watchForOutsideTaps() {
  if (watching) return;
  watching = true;
  document.addEventListener("pointerdown", (event) => {
    for (const picker of pickers)
      if (!picker.root.contains(event.target)) open(picker, false);
  });
}
// A dropdown that matches the game, which a `<select>` cannot: its popup is
// drawn by the operating system and is the one part of a form that no amount
// of CSS reaches. So this is a disclosure button and a list of real buttons -
// keyboard, focus ring and screen reader all still work, and it can carry a
// line of explanation per row, which a native option cannot.
export function mountQuality(container, onPick = () => {}) {
  const root = document.createElement("div");
  root.className = "picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "picker-open";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  const eyebrow = document.createElement("span");
  eyebrow.className = "picker-eyebrow";
  eyebrow.textContent = "QUALITY";
  const label = document.createElement("span");
  label.className = "picker-value";
  const caret = document.createElement("span");
  caret.className = "picker-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  trigger.append(eyebrow, label, caret);
  const list = document.createElement("div");
  list.className = "picker-list";
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", "Graphics quality");
  list.hidden = true;
  const picker = { root, trigger, label, list };
  for (const tier of TIERS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "picker-option";
    option.dataset.tier = tier.id;
    option.setAttribute("role", "menuitemradio");
    option.title = tier.long;
    const name = document.createElement("b");
    name.textContent = tier.label;
    const note = document.createElement("small");
    note.textContent = tier.note;
    option.append(name, note);
    option.onclick = () => {
      onPick();
      quality.set(tier.id);
      open(picker, false);
      trigger.focus({ preventScroll: true });
    };
    list.append(option);
  }
  trigger.onclick = () => {
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    closeAll(picker);
    onPick();
    open(picker, !wasOpen);
  };
  // Escape closes the list. preventDefault matters in the pause dialog:
  // closing a `<dialog>` is the default action of Escape, so without it one
  // key would dismiss both the list and the panel behind it.
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      open(picker, false);
      trigger.focus({ preventScroll: true });
      return;
    }
    if (list.hidden || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const options = [...list.children];
    const at = options.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (at + step + options.length) % options.length;
    options[at < 0 ? 0 : next].focus({ preventScroll: true });
  });
  root.append(trigger, list);
  container.replaceChildren(root);
  pickers.add(picker);
  watchForOutsideTaps();
  draw(picker);
  return root;
}
// Babylon scaling is inverse: 0.5 draws two pixels per CSS pixel. Ultra
// supersamples 1.5x beyond the display's own density, capped at 3x; potato
// goes the other way and renders fewer pixels than the page has, which on a
// tablet is the single biggest thing available to give up.
export function hardwareScaling(mode, devicePixelRatio = 1) {
  const dpr = Math.max(1, devicePixelRatio);
  if (mode === "potato") return 1.7;
  if (mode === "ultra") return 1 / Math.min(dpr * 1.5, 3);
  const cap = { battery: 1, balanced: 1.5, sharp: 2 }[mode] ?? 1.5;
  return 1 / Math.min(dpr, cap);
}
// Upgraded species have authored tiers; other fish retain standard/HD. Potato
// takes the lightest authored silhouette there is.
export const modelDetail = (mode) =>
  ({
    potato: "low",
    battery: "low",
    balanced: "standard",
    sharp: "high",
    ultra: "hd",
  })[mode] ?? "standard";
// Adaptive resolution. Older tablets are fill-rate bound long before they run
// out of CPU, so when frames get slow the cheapest thing to give up is pixels:
// this returns a relief factor multiplied into the chosen tier's scaling, 1
// meaning "the tier's own resolution". The gap between LOW and HIGH is a dead
// band, so a frame rate hovering near the target cannot oscillate, and relief
// only ever eases back when there is real headroom.
export const RELIEF = { LOW: 40, HIGH: 56, STEP: 0.15, MAX: 2 };
export function reliefStep(relief, fps, limits = RELIEF) {
  const { LOW, HIGH, STEP, MAX } = limits;
  // A zero or absent reading means we have not measured yet; change nothing.
  if (!(fps > 0)) return relief;
  if (fps < LOW) return Math.min(MAX, Math.round((relief + STEP) * 100) / 100);
  if (fps > HIGH) return Math.max(1, Math.round((relief - STEP) * 100) / 100);
  return relief;
}
