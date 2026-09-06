// Babylon scaling is inverse: 0.5 draws two pixels per CSS pixel. Ultra
// supersamples 1.5x beyond the display's own density, capped at 3x.
export function hardwareScaling(mode, devicePixelRatio = 1) {
  const dpr = Math.max(1, devicePixelRatio);
  if (mode === "ultra") return 1 / Math.min(dpr * 1.5, 3);
  const cap = { battery: 1, balanced: 1.5, sharp: 2 }[mode] ?? 1.5;
  return 1 / Math.min(dpr, cap);
}
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
// Upgraded species have authored tiers; other fish retain standard/HD models.
export const modelDetail = (mode) =>
  ({ battery: "low", balanced: "standard", sharp: "high", ultra: "hd" })[
    mode
  ] ?? "standard";
