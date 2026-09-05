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
// Bumped whenever snapshots or join messages change shape, so a client can
// tell when it is talking to a server process started from older code.
export const PROTOCOL = 2;
export const radius = (mass) => Math.cbrt(mass) * 0.48;
export const direction = (fish) => ({
  x: Math.sin(fish.yaw) * Math.cos(fish.pitch),
  y: Math.sin(fish.pitch),
  z: Math.cos(fish.yaw) * Math.cos(fish.pitch),
});
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
// Blender models in client/assets/models, built by tools/blender/create_fish.py.
// Players pick one when they join; the server assigns NPCs and names wild
// predators, so this list is the single source of truth.
export const SPECIES = Object.freeze([
  "clownfish",
  "blue-tang",
  "pufferfish",
  "angelfish",
  "goldfish",
  "betta",
  "shark",
]);
export const speciesLabel = (species = "fish") =>
  String(species).replaceAll("-", " ");
