export const CONFIG = Object.freeze({
  width: 72,
  height: 30,
  depth: 72,
  startMass: 8,
  speed: 7,
  turnSpeed: 3.5,
  inputTimeout: 0.35,
  npcCount: 100,
  eatRatio: 1.35,
  growth: 0.75,
  // Wild fish large enough to eat a player drift toward one this close (plus
  // their own radius) and swim a little faster while doing so.
  npcHuntRange: 9,
  npcHuntSpeed: 1.3,
  roundLength: 300,
  intermission: 12,
  respawnDelay: 3,
  spawnProtection: 3,
  tickRate: 30,
  broadcastRate: 15,
  maxPlayers: 8,
});
export const radius = (mass) => Math.cbrt(mass) * 0.48;
export const direction = (fish) => ({
  x: Math.sin(fish.yaw) * Math.cos(fish.pitch),
  y: Math.sin(fish.pitch),
  z: Math.cos(fish.yaw) * Math.cos(fish.pitch),
});
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
// The server-assigned color picks the Blender model, so every client agrees
// and the server can name a wild predator.
export const SPECIES = ["clownfish", "blue-tang", "pufferfish"];
export const speciesOf = (color) =>
  SPECIES[Math.abs(color | 0) % SPECIES.length];
export const speciesLabel = (color) => speciesOf(color).replace("-", " ");
