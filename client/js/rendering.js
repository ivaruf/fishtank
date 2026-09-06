// Babylon scaling is inverse: 0.5 draws two pixels per CSS pixel. Ultra
// supersamples 1.5x beyond the display's own density, capped at 3x.
export function hardwareScaling(mode, devicePixelRatio = 1) {
  const dpr = Math.max(1, devicePixelRatio);
  if (mode === "ultra") return 1 / Math.min(dpr * 1.5, 3);
  const cap = { battery: 1, balanced: 1.5, sharp: 2 }[mode] ?? 1.5;
  return 1 / Math.min(dpr, cap);
}
// The clownfish has authored tiers; other fish retain standard/HD models.
export const modelDetail = (mode) =>
  ({ battery: "low", balanced: "standard", sharp: "high", ultra: "hd" })[
    mode
  ] ?? "standard";
