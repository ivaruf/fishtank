export const CONFIG = Object.freeze({
  width: 72,
  height: 30,
  depth: 72,
  startMass: 8,
  speed: 7,
  turnSpeed: 3.5,
  inputTimeout: 0.35,
  npcCount: 100,
  // Heavier eats lighter, full stop: with 1 the food chain is binary and only
  // an exact tie (two fresh spawns) leaves two fish neutral to each other.
  eatRatio: 1,
  growth: 0.75,
  // Wild fish large enough to eat a player drift toward one this close (plus
  // their own radius) and swim a little faster while doing so.
  npcHuntRange: 9,
  npcHuntSpeed: 1.3,
  roundLength: 120,
  // Long enough to watch yourself get eaten and still read the banner.
  respawnDelay: 5,
  spawnProtection: 3,
  tickRate: 30,
  broadcastRate: 15,
  maxPlayers: 8,
});
// Bumped whenever snapshots or join messages change shape, so a client can
// tell when it is talking to a server process started from older code.
export const PROTOCOL = 2;
export const radius = (mass) => Math.cbrt(mass) * 0.48;
export const outweighs = (predator, prey) =>
  predator.mass > prey.mass * CONFIG.eatRatio;
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
// Kelp clusters across the tank. A fish low enough inside one is hidden from
// hunters; the client grows the same clusters so cover looks like cover.
export const PLANTS = Object.freeze(
  Array.from({ length: 13 }, (_, i) => {
    // Golden-angle spiral; the reach permutation spreads clusters evenly.
    const angle = i * 2.39996,
      reach = 5 + ((i * 7) % 13) * 2;
    return Object.freeze({
      x: Math.round(Math.cos(angle) * reach * 10) / 10,
      z: Math.round(Math.sin(angle) * reach * 10) / 10,
      radius: 3 + (i % 3) * 0.9,
      height: 9 + (i % 4) * 3,
    });
  }),
);
export const inCover = (fish) =>
  PLANTS.some(
    (p) =>
      fish.y < p.height && Math.hypot(fish.x - p.x, fish.z - p.z) < p.radius,
  );
