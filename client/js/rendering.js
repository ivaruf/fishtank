// Babylon scaling is inverse: 0.5 draws two pixels per CSS pixel.
export function hardwareScaling(mode, devicePixelRatio = 1) {
  const cap = { battery: 1, balanced: 1.5, sharp: 2 }[mode] ?? 1.5;
  return 1 / Math.min(Math.max(1, devicePixelRatio), cap);
}
