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
