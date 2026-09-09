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
  // A mouthful, not the whole animal: one meal can only ever be this share of
  // your own mass, whatever you just swallowed.
  //
  // Without it the long tail below turns into a rocket. Gain is a share of the
  // prey's mass and prey can be almost your own size, so eating the biggest
  // thing you can reach multiplies you by about 1.75 every time - and because
  // a wild fish's speed is 2.4 + 1/r, the biggest fish in the tank is also the
  // slowest and the easiest to catch. A player who hunts upward hit the cap in
  // ten meals, which is the same "growing stopped meaning anything" in a
  // different disguise. Capped, a maximum meal is +26% mass and +11% radius:
  // plainly visible, and about twenty of them from spawn to the cap.
  bite: 0.35,
  // The wild population's shape: mass = wildHeaviest ^ (random ^ wildTail),
  // log-uniform bent hard toward the small end, so most of the tank is fry,
  // the tail keeps climbing, and wildHeaviest is a ceiling rather than a
  // fat-tail surprise.
  //
  // It replaced two flat bands, 1-4 and 5-27. Their whole range was cleared in
  // about twenty meals - inside a two-minute round - and from mass 27 up not
  // one fish in the tank was too big to eat, so growing past it changed
  // nothing a player could do. That, not the arithmetic of size, is why
  // growing never meant anything.
  //
  // This shape leaves 87 of the 100 edible at spawn, about seven still above
  // you at mass 30, and three above you at 100. Five fish are big enough to be
  // drawn as predators, the heaviest around 230.
  //
  // The tail is there to be climbed, not to crowd the tank, and it took two
  // passes to believe that: 600 with a tail of 3 put fourteen big fish in the
  // water and 600 with 5 put nine, both of which played as an aquarium full of
  // sharks. Five reads as "there are a few things in here that will eat you",
  // which is the whole job. Note the spawn is now *safer* than the two flat
  // bands this replaced - thirteen fish outweigh a fresh player where twenty
  // two used to - so what makes the tank feel dangerous is that the few big
  // ones are genuinely big, not that there are many of them.
  wildHeaviest: 250,
  wildTail: 7,
  // Where growing stops. The fish is 16 units long here and move() has kept it
  // off the glass, which leaves a 13-unit band of water to swim in: past this
  // the tank stops being a tank. It was 1800, which was never reachable and so
  // never a decision.
  massCap: 900,
  // Wild fish large enough to eat a player drift toward one this close (plus
  // half their own radius) and swim a little faster while doing so. The radius
  // term is there so a big fish does not have to bump its nose on you before
  // it notices - but it was the whole radius, and once radius() took a steeper
  // exponent that quietly turned into a 15-unit aggravation range for the
  // heaviest fish in a tank 72 across. Half of a bigger number is the range
  // this was tuned at.
  npcHuntRange: 9,
  npcHuntSpeed: 1.3,
  roundLength: 120,
  // Long enough to watch yourself get eaten and still read the banner.
  respawnDelay: 5,
  spawnProtection: 3,
  tickRate: 30,
  broadcastRate: 15,
  // What one device is willing to host. It is the host's own CPU and uplink
  // that this protects, not a server's: sixteen fish at 15 Hz over a data
  // channel costs it about 200 KB/s, which a laptop shrugs at and a phone
  // does not. Snapshot packing is in docs/P2P.md.
  maxPlayers: 16,
});
// Bumped whenever snapshots or join messages change shape, so a guest can tell
// when it has connected to a host running older code than itself.
//
// 9 is not a shape change: radius() took a new exponent. The host stays
// authoritative for who eats whom, so a stale guest would still play a correct
// game - it would just draw every fish in the tank at the wrong size, on its
// own screen only, with no way to tell. A visible contract is a contract, and
// "DIFFERENT BUILDS · RELOAD BOTH" is a better answer than two people
// describing different tanks to each other.
export const PROTOCOL = 9;
// Mass is a volume and a fish is a thing you look at, so the honest exponent
// is a third - and a third is exactly why growing never read on screen: it
// makes mass the cube of the only thing a player can see, so thirteen times
// the mass buys 2.4 times the size and the follow camera cancels a fifth of
// even that. 0.45 is deliberately not physical. The coefficient pins a fresh
// spawn to the 0.96 radius it has always had, so nothing about the start
// changes - the framing, the hitbox and the speed penalty at spawn are all
// what they were; what changes is everything after it. At mass 200 the radius
// goes 2.81 -> 4.09, and a good round now reads about 3.4x its spawn size
// instead of 2.2x.
export const radius = (mass) => Math.pow(mass, 0.45) * 0.377;
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
  "butterflyfish",
  "lionfish",
  "wrasse",
  "seahorse",
  "manta-ray",
  "royal-gramma",
  "triggerfish",
]);
// The species the heavy end of the wild population is drawn from, so the fish
// that outweighs you looks like a fish that outweighs you. All of them are in
// SPECIES above, which stays the single source of truth for what may be sent
// over the wire.
export const PREDATORS = Object.freeze([
  "shark",
  "manta-ray",
  "lionfish",
  "triggerfish",
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
// The faulty filter in the back-left corner. Dead for the first minute of a
// round, then its red button zaps the heaviest player (heaviest wild fish
// when playing alone): stunned, shrunk, the lost mass scattered as food. It
// needs a recharge between presses, so being the biggest fish stays risky.
export const FILTER = Object.freeze({
  x: -31,
  z: 31,
  button: Object.freeze({ x: -31, y: 4, z: 28.4 }),
  buttonRadius: 2.2,
  armAfter: 60,
  cooldown: 15,
  shrink: 0.7,
  stun: 2.5,
  // Food chunks stay small enough for a fresh spawn to eat.
  chunkMass: 3,
});
export const onButton = (fish) =>
  Math.hypot(
    fish.x - FILTER.button.x,
    fish.y - FILTER.button.y,
    fish.z - FILTER.button.z,
  ) <
  FILTER.buttonRadius + radius(fish.mass) * 0.6;
export const inCover = (fish) =>
  PLANTS.some(
    (p) =>
      fish.y < p.height && Math.hypot(fish.x - p.x, fish.z - p.z) < p.radius,
  );
