// Where the hard scenery stands, and what a fish is allowed to swim through.
//
// This has to be shared. The client draws the wreck and the server decides
// whether you fit under the arch, and if those two ever disagree the game lies
// to the player about a wall. So the placement table lives here, the client
// reads it to put meshes in the tank, and the simulation reads it to stop
// fish - one table, two readers, no chance of drift.
//
// The whole physics of it: every solid thing is a box or a squashed blob, and
// a fish is a sphere of radius(mass). That is all, and it is enough to make an
// arch behave the way an arch should. Nothing anywhere says "small fish may
// pass"; a small fish fits between the legs and under the lintel and a big one
// does not, because that is what its radius does. The crossover for the arch
// as placed is mass 32.7, and it is the lintel rather than the legs that
// closes: a fish needs room between the sand and the underside, and its
// centre cannot go below r + 0.5. Fish start at mass 8, so the arch stops
// being a shortcut after four or five meals and has to be gone over instead.
// Test asserts it, so moving the arch or changing growth will say so.
//
// Not the real meshes. Those are hundreds of triangles apiece and the server
// has no business loading a GLB to find out where a plank is. The boxes are
// authored from the same measurements the models were built to, in the model's
// own units, so a placement's scale carries them along with it.
import { FILTER, PLANTS, radius } from "./config.js";
// Deterministic noise, shared so the client's rocks and the collision boxes
// around them are drawn from one sequence rather than two that agree by luck.
export function noise(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
// A plant tucked against the kelp cluster it belongs to, so the dressing
// follows the cover if those cluster positions ever move.
const foot = (cluster, dx, dz) => ({
  x: PLANTS[cluster].x + dx,
  z: PLANTS[cluster].z + dz,
});
// Every placement: which asset, where on the sand, which way it faces and how
// far up from authoring scale, since the pack is authored at about a fish and
// a half tall. Origins sit at substrate level in the exports, so y is 0 for
// all of them. Positions keep clear of the filter's corner and of the loose
// rocks below, which is why they read as odd numbers rather than a tidy grid.
export const SCENERY = Object.freeze(
  [
    // Landmarks. The wreck and the arch are big enough to navigate by; both
    // face the middle of the tank, so a fish swimming in from open water meets
    // the holed side of the hull and the mouth of the passage rather than a
    // blank flank.
    { asset: "little-shipwreck", x: -19, z: -13, yaw: 0.97, scale: 3 },
    { asset: "stone-arch", x: 21, z: 16, yaw: 0.92, scale: 3 },
    { asset: "branching-driftwood", x: -26, z: 5, yaw: 1.7, scale: 3 },
    { asset: "branching-driftwood", x: 11, z: -26, yaw: -1.15, scale: 2.3 },
    { asset: "weathered-amphora", x: 26, z: -8, yaw: 0.8, scale: 3 },
    { asset: "weathered-amphora", x: -6, z: -28, yaw: -0.4, scale: 2.3 },
    // Planting at the foot of eight of the thirteen kelp clusters. Not all
    // thirteen: a tank where every cluster is dressed the same way looks
    // stamped out, and the bare ones give the eye somewhere to rest.
    { asset: "ribbon-grass", ...foot(0, 1.6, 1.4), yaw: 0.4, scale: 3 },
    { asset: "ribbon-grass", ...foot(1, 1.6, -1.8), yaw: 2.2, scale: 2.6 },
    { asset: "ribbon-grass", ...foot(3, -1.2, -1.5), yaw: -0.9, scale: 2.8 },
    { asset: "broadleaf-plant", ...foot(2, -1.4, -1.6), yaw: 1.1, scale: 2.6 },
    { asset: "broadleaf-plant", ...foot(4, 1.5, -1.3), yaw: -1.4, scale: 2.2 },
    { asset: "broadleaf-plant", ...foot(8, 1.4, -1.3), yaw: 2.6, scale: 2.4 },
    { asset: "red-stem-plant", ...foot(6, 1.3, -1.2), yaw: 0.2, scale: 3 },
    { asset: "red-stem-plant", ...foot(5, -1.5, -1.3), yaw: -2, scale: 2.6 },
  ].map(Object.freeze),
);
// The solid part of each hard asset, as boxes in the model's own units and
// axes: centre then half-extents, Y up, the asset facing +Z before its yaw.
// Anything not listed here is soft on purpose - the three plants are dressing,
// and the filter housing must stay swimmable or nobody could reach its button.
//
// The gaps are as deliberate as the boxes. The wreck is a shell, not a solid:
// its far flank and both ends stop a fish, but the holed near side is only
// blocked by the bottom strake it kept, so a fish clears that low sill or
// drops in over the open top - which is the wreck's whole appeal. The arch is
// two legs and a lintel, leaving a gate 1.42 by 1.19 in model units, 4.3 by
// 3.6 once placed. Thin things - twigs, the amphora's handles, the wreck's
// ribs and rope - are left out; a fish brushing a twig should not stop dead.
export const HARD = Object.freeze({
  "little-shipwreck": Object.freeze(
    [
      // The planked flank, the one a fish cannot get through.
      { x: 0.08, y: 0.58, z: -0.58, hx: 1.78, hy: 0.38, hz: 0.23 },
      { x: 1.72, y: 0.45, z: 0, hx: 0.18, hy: 0.45, hz: 0.35 }, // bow
      { x: -1.47, y: 0.45, z: 0, hx: 0.23, hy: 0.45, hz: 0.5 }, // stern
      // All that is left of the near flank where the hull staved in.
      { x: 0.1, y: 0.3, z: 0.48, hx: 0.9, hy: 0.1, hz: 0.13 },
    ].map(Object.freeze),
  ),
  "stone-arch": Object.freeze(
    [
      { x: -1.12, y: 0.6, z: 0, hx: 0.41, hy: 0.6, hz: 0.5 },
      { x: 1.12, y: 0.6, z: 0, hx: 0.41, hy: 0.6, hz: 0.5 },
      { x: 0, y: 1.51, z: 0, hx: 1.05, hy: 0.32, hz: 0.5 },
    ].map(Object.freeze),
  ),
  // The trunk and its thick roots. The branch reaching for the surface is a
  // finger's width and stays soft.
  "branching-driftwood": Object.freeze([
    Object.freeze({ x: -0.32, y: 0.4, z: 0, hx: 0.88, hy: 0.4, hz: 0.35 }),
  ]),
  "weathered-amphora": Object.freeze([
    Object.freeze({ x: 0, y: 0.78, z: 0, hx: 0.6, hy: 0.78, hz: 0.6 }),
  ]),
});
// The loose rocks. Drawn here rather than in the client so the boxes and the
// boulders are the same boulders: client/js/world.js builds its meshes from
// this table. Twenty-two ringing the tank and nine scattered inside, minus any
// that would land in the filter's corner.
//
// The draw order is load-bearing. buildKelp shares this generator, so the
// client re-runs drawRocks purely to leave the sequence where the kelp has
// always found it; change the order of these calls and the kelp moves.
// How far out a boulder's surface lies in one direction, as a multiple of its
// nominal radius. Layered sines on a unit sphere: the client displaces its
// twelve-segment sphere with exactly this, and the collision below evaluates
// it along the ray it is pushing a fish out on, so the stone you can see and
// the stone you cannot swim into are the same stone.
//
// It matters more than it looks. The range is 0.6 to 1.4, so a smooth
// ellipsoid cut to the average would let a fish sink half a metre into every
// bulge - which is exactly what it did.
export function rockBump(x, y, z, seed) {
  return (
    1 +
    0.16 * Math.sin(3.1 * x + seed) +
    0.13 * Math.sin(2.6 * y + seed * 1.7 + x) +
    0.11 * Math.sin(3.6 * z + seed * 0.6 + y)
  );
}
// The most any of those three terms can add, so the cheap bounding-sphere
// reject below cannot reject a bulge that really is in the way.
const BUMPIEST = 1.4;
export function drawRocks(rnd) {
  const spots = [];
  for (let i = 0; i < 22; i++) {
    const a = i * 2.39996 + 0.7;
    spots.push([
      Math.sin(a) * (30 + rnd() * 3),
      Math.cos(a) * (30 + rnd() * 3),
    ]);
  }
  for (let i = 0; i < 9; i++)
    spots.push([(rnd() - 0.5) * 50, (rnd() - 0.5) * 50]);
  // Keep the filter's corner clear of rubble.
  const clear = ([x, z]) => Math.hypot(x - FILTER.x, z - FILTER.z) > 8;
  return spots.filter(clear).map(([x, z]) => {
    // seed shapes the mesh's displacement and is the client's business; the
    // scaling is what the collision blob is cut from.
    const seed = rnd() * 20,
      size = 0.9 + rnd() * 1.6,
      sx = size * (1 + rnd() * 0.8),
      sy = size * (0.55 + rnd() * 0.45),
      sz = size * (0.8 + rnd() * 0.6);
    return Object.freeze({
      x,
      z,
      y: sy * 0.55,
      sx,
      sy,
      sz,
      yaw: rnd() * Math.PI,
      seed,
    });
  });
}
export const ROCKS = Object.freeze(drawRocks(noise(29)));
// One flat list of world-space volumes, built once at load. `blob` is a rock:
// a squashed sphere with rockBump's dents and bulges on it, which is the shape
// the client draws, so it is the shape a fish is stopped by. `box` is
// everything authored. Each carries the yaw's sine and cosine and a bounding
// radius, so the hot loop below is arithmetic and no lookups.
export const OBSTACLES = Object.freeze([
  ...ROCKS.map((r) =>
    Object.freeze({
      blob: true,
      x: r.x,
      y: r.y,
      z: r.z,
      // The rock's full scaling. It used to be shrunk to 0.86 of it to keep
      // the fish from stopping short in open water, which was the wrong fix
      // for the right worry: the mesh bulges to 1.4 in places, so the shrunk
      // ellipsoid let a fish swim visibly into the stone. rockBump in the
      // resolver is the right fix.
      rx: r.sx,
      ry: r.sy,
      rz: r.sz,
      sin: Math.sin(r.yaw),
      cos: Math.cos(r.yaw),
      seed: r.seed,
      reach: Math.max(r.sx, r.sy, r.sz) * BUMPIEST,
    }),
  ),
  ...SCENERY.flatMap((spot) =>
    (HARD[spot.asset] ?? []).map((b) => {
      const sin = Math.sin(spot.yaw),
        cos = Math.cos(spot.yaw),
        s = spot.scale;
      return Object.freeze({
        blob: false,
        // The box's own centre, carried out of model space by the placement.
        x: spot.x + (b.x * cos + b.z * sin) * s,
        y: b.y * s,
        z: spot.z + (-b.x * sin + b.z * cos) * s,
        sin,
        cos,
        hx: b.hx * s,
        hy: b.hy * s,
        hz: b.hz * s,
        reach: Math.hypot(b.hx, b.hy, b.hz) * s,
      });
    }),
  ),
]);
// Push a fish out of anything it has ended up inside. Called once per fish per
// tick from World.move, after the tank bounds, for players and wild fish alike:
// wild fish swimming through a hull the player has to go round would give the
// whole thing away.
//
// Depenetration rather than a swept test. At the tank's top speed a fish
// covers 0.23 units in a tick against volumes metres across, so there is
// nothing to tunnel through, and resolving overlap is both cheaper and kinder:
// only the component pushing into the surface is removed, so a fish swimming
// at a hull slides along it instead of sticking to it.
//
// Returns null, or the total correction it applied - which is a surface normal
// in all but name, and is what lets a wild fish turn away from whatever it
// walked into instead of grinding at it until its next decision comes round.
// Resting contact is not a collision. Without this margin a fish that has
// already been pushed onto a surface lands a hair inside it in floating point,
// reports a hit with a correction of nothing, and a wild fish sliding along a
// rock re-decides its heading every single tick.
const TOUCHING = 1e-6;
export function pushOutOfScenery(f, r = radius(f.mass)) {
  const fromX = f.x,
    fromY = f.y,
    fromZ = f.z;
  let hit = false;
  for (const o of OBSTACLES) {
    const dx = f.x - o.x,
      dy = f.y - o.y,
      dz = f.z - o.z;
    // Cheap reject on the bounding sphere before any real work.
    const far = o.reach + r;
    if (dx * dx + dy * dy + dz * dz > far * far) continue;
    if (o.blob) {
      // Un-rotate first. Babylon scales and then rotates, so undoing it goes
      // the other way about; a rock is squashed *and* turned, so skipping its
      // yaw would squash the fish along the wrong axis.
      const rx = dx * o.cos - dz * o.sin,
        rz = dx * o.sin + dz * o.cos;
      // Into the unit-sphere space of the ellipsoid grown by the fish's own
      // radius, where the stone's surface is one function call away.
      const ax = o.rx + r,
        ay = o.ry + r,
        az = o.rz + r,
        ux = rx / ax,
        uy = dy / ay,
        uz = rz / az,
        length = Math.hypot(ux, uy, uz);
      if (length === 0) {
        // Dead centre, with no ray to leave along. Up: a boulder here is
        // wider than it is tall and sits on the sand, so up is both the
        // shortest way out and the only one that cannot bury the fish.
        f.y = o.y + ay;
        hit = true;
        continue;
      }
      // Where the stone actually is in this direction, dents and bulges and
      // all - the same displacement the client's mesh is built with, so what
      // stops a fish is what the player can see. A plain ellipsoid here is
      // what let one swim into the side of a rock.
      const k = 1 / length;
      const surface = rockBump(ux * k, uy * k, uz * k, o.seed);
      if (length >= surface - TOUCHING) continue;
      // Out along the ray it came in on. On a squashed rock that is not the
      // shortest way out, but it is a stable one: it cannot leave the fish
      // inside, and it never flips direction between ticks the way a
      // nearest-face push does across a diagonal.
      const out = surface * k;
      const px = ux * ax * out,
        pz = uz * az * out;
      f.x = o.x + px * o.cos + pz * o.sin;
      f.y = o.y + uy * ay * out;
      f.z = o.z + -px * o.sin + pz * o.cos;
      hit = true;
      continue;
    }
    // Into the box's frame, where it is axis aligned.
    const lx = dx * o.cos - dz * o.sin,
      lz = dx * o.sin + dz * o.cos;
    // Overlap with the box grown by the fish's radius. Square corners rather
    // than rounded: at an exact corner this stops a fish a little early, which
    // is a fair price for never letting one squeeze through an edge.
    const px = o.hx + r - Math.abs(lx),
      py = o.hy + r - Math.abs(dy),
      pz = o.hz + r - Math.abs(lz);
    if (px <= TOUCHING || py <= TOUCHING || pz <= TOUCHING) continue;
    // Least overlap is the nearest way out, so the fish leaves by the face it
    // arrived at.
    let cx = 0,
      cy = 0,
      cz = 0;
    if (px <= py && px <= pz) cx = lx < 0 ? -px : px;
    else if (py <= pz) cy = dy < 0 ? -py : py;
    else cz = lz < 0 ? -pz : pz;
    f.x += cx * o.cos + cz * o.sin;
    f.y += cy;
    f.z += -cx * o.sin + cz * o.cos;
    hit = true;
  }
  return hit ? { x: f.x - fromX, y: f.y - fromY, z: f.z - fromZ } : null;
}
