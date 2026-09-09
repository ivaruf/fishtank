// The graphics setting: one value, one place it is stored, and however many
// places it is drawn.
//
// It is an EventTarget with a `value`, and that shape is deliberate. world.js,
// sand.js and environment.js were each handed the `<select>` itself and
// listened to it for "change", so presenting the same two things means none of
// them had to learn that the dropdown became a row of buttons - or that the
// dropdown is gone.
//
// Gone because there is one place to draw this now: the panel the gear opens,
// which is on every screen. There used to be two, never on screen together - a
// dropdown in the header for the menu, and these same five rows behind the
// pause panel during play - so the header carried a settings control at all
// times and the setting had two looks. Mounting it more than once is still
// safe: every mounted group redraws from here, so views cannot disagree.
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
    for (const list of lists) draw(list);
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
// Every mounted row group, so all of them redraw when the value changes and
// two views cannot drift apart.
const lists = new Set();
function draw(list) {
  for (const option of list.children)
    option.setAttribute(
      "aria-checked",
      String(option.dataset.tier === quality.value),
    );
}
// Five rows outright, which a `<select>` could not give us either way: its
// popup is drawn by the operating system and is the one part of a form that no
// amount of CSS reaches, and a native option cannot carry a line of
// explanation. So these are real buttons in a radio group - keyboard, focus
// ring and screen reader all still work.
//
// Outright rather than behind a disclosure, because there is no longer a
// screen where the room exists for one. The pause panel's copy was clipped or
// unreachable in three separate arrangements - absolutely positioned it was
// cut off by the panel's own scroll box, in the scroll it made the panel
// taller than the phone - and games/CLAUDE.md had the answer to why none of
// them worked: "if a control is only ever set once, a row of buttons beats a
// dropdown anyway". Five choices, set once. Nothing here opens, so nothing
// here can be clipped, and Escape belongs to the panel: there it means "back
// to the game".
export function mountQuality(container, onPick = () => {}) {
  // No wrapper element: it existed to be the positioning context a popup hung
  // off, and there is no popup.
  const list = document.createElement("div");
  list.className = "picker-list";
  // A radio group, not a menu: the reader should say "2 of 5" rather than
  // announce a popup that does not exist.
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "Graphics quality");
  for (const tier of TIERS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "picker-option";
    option.dataset.tier = tier.id;
    option.setAttribute("role", "radio");
    option.title = tier.long;
    const name = document.createElement("b");
    name.textContent = tier.label;
    const note = document.createElement("small");
    note.textContent = tier.note;
    option.append(name, note);
    option.onclick = () => {
      onPick();
      quality.set(tier.id);
      // The row that was tapped keeps the focus; there is nothing to hand it
      // back to.
      option.focus();
    };
    list.append(option);
  }
  // Arrow keys walk the group and wrap, which is what a radio group owes a
  // keyboard. Bound to the list, where the rows' own keys bubble to.
  list.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const options = [...list.children];
    const at = options.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (at + step + options.length) % options.length;
    options[at < 0 ? 0 : next].focus();
  });
  container.replaceChildren(list);
  lists.add(list);
  draw(list);
  return list;
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
