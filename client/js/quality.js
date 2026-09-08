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
    {
      id: "potato",
      label: "Potato",
      note: "The tank as it looked in the first week: a wireframe frame, a grid on the sand, flat colours and no room beyond the glass. For an old tablet, or for a laugh.",
    },
    {
      id: "battery",
      label: "Battery saver",
      note: "One render pixel per screen pixel, simplest fish.",
    },
    {
      id: "balanced",
      label: "Balanced",
      note: "The default. Up to 1.5 render pixels per screen pixel.",
    },
    {
      id: "sharp",
      label: "Sharper",
      note: "Up to 2 pixels, denser fish, and the authored seabed, office and filter detail.",
    },
    {
      id: "ultra",
      label: "Ultra",
      note: "Supersampled past the display's own density, and the densest of everything.",
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
    for (const row of rows) draw(row);
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
const rows = new Set();
function draw(row) {
  for (const button of row.children)
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.tier === quality.value),
    );
}
// Renders the picker into a container, and keeps it in step with every other
// one. Buttons rather than a `<select>`: an OS dropdown belongs to no game,
// and a setting with five values that each want a sentence of explanation is
// better as a row that can carry one.
export function mountQuality(container, onPick = () => {}) {
  container.replaceChildren(
    ...TIERS.map((tier) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tier";
      button.dataset.tier = tier.id;
      button.textContent = tier.label;
      button.title = tier.note;
      button.onclick = () => {
        onPick();
        quality.set(tier.id);
      };
      return button;
    }),
  );
  rows.add(container);
  draw(container);
  return container;
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
