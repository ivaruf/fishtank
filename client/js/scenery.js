// The Blender scenery pack: seven static assets in client/assets/scenery,
// built by tools/blender/create_scenery.py and standing on the sand.
//
// Decoration only, and deliberately so. Nothing here is an obstacle and
// nothing here is cover: the kelp clusters in shared/config.js are what the
// server hides a fish inside, because both ends have to agree about that, and
// they sway on their own in world.js. A wreck a player expects to hide behind
// would be a lie the server never told, so the wreck sits where it cannot be
// mistaken for shelter and the plants stand at the foot of real kelp instead.
//
// The pack is authored small - a plant is 1.5 to 2.7 units against a two-unit
// fish - so every placement carries the scale that makes it read at tank size,
// and the tank looks the same on every machine because the layout is a table
// rather than a random draw. If a load fails the tank simply does without that
// asset: the sand, rocks and kelp it is dressing are already there.
import { material } from "./fish.js";
import { PLANTS } from "../../shared/config.js";
const B = window.BABYLON;
// A plant tucked against the kelp cluster it belongs to, so the dressing
// follows the cover if those cluster positions ever move.
const foot = (cluster, dx, dz) => ({
  x: PLANTS[cluster].x + dx,
  z: PLANTS[cluster].z + dz,
});
// Every placement: which asset, where on the sand, which way it faces and how
// far up from authoring scale. Origins sit at substrate level in the exports,
// so y is 0 for all of them and the sand plane needs no per-asset offset.
// Positions keep clear of the filter's corner (-31, 31) and of the nine loose
// rocks world.js scatters inside the ring, which is why they read as odd
// numbers rather than a tidy grid.
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
export const sceneryUrl = (asset) => `assets/scenery/${asset}.glb`;
// Loads each distinct asset once and hands out GPU-instanced copies, the same
// bargain fish.js strikes: fourteen placements cost seven geometries. What it
// does not save is batches - an asset is dozens of separate little meshes, so
// the pack costs roughly 250 draw calls. If that ever shows up on a slow
// tablet, the lever is merging each asset down to one mesh per material, the
// way buildKelp already merges a forest into two. The load hook is injectable
// so a caller can feed the .glb files in from disk.
export async function loadScenery(
  scene,
  load = (asset) => B.LoadAssetContainerAsync(sceneryUrl(asset), scene),
) {
  const containers = new Map(),
    failed = [];
  await Promise.all(
    [...new Set(SCENERY.map((spot) => spot.asset))].map(async (asset) => {
      try {
        const container = await load(asset);
        standardize(container, scene);
        containers.set(asset, container);
      } catch (error) {
        failed.push(asset);
        console.warn(
          `Scenery "${asset}" failed to load; going without it`,
          error,
        );
      }
    }),
  );
  const placed = SCENERY.filter((spot) => containers.has(spot.asset)).map(
    (spot) => place(containers.get(spot.asset), spot),
  );
  return { placed, failed, containers };
}
// Same conversion the fish get, and for the same reason: the scene has no
// environment texture, so the exported PBR materials would be flat and dark
// beside the sand and rocks, which are StandardMaterial. glTF base colours are
// linear and StandardMaterial expects gamma space. The hood spot and the
// ambient reach about 2.6x on an upward face, so an authored colour taken
// wholly from lighting clips to white on top; splitting it between diffuse and
// same-hue emissive keeps terracotta and jade recognisable, with 0.32 x 2.6 +
// 0.3 landing near the authored colour on top and about half of it in shade.
// Slightly darker than the fish get, so a landmark never out-glows a fish
// swimming past it.
function standardize(container, scene) {
  const converted = new Map();
  for (const mesh of container.meshes) {
    const pbr = mesh.material;
    if (!pbr) continue;
    if (!converted.has(pbr)) {
      const base = (pbr.albedoColor ?? B.Color3.White()).toGammaSpace();
      const m = material(scene, pbr.name, base.scale(0.32));
      m.emissiveColor = base.scale(0.3);
      // Wet stone and glazed pottery catch the light bar; leaves barely do,
      // and the exported roughness is what tells them apart.
      const roughness = pbr.roughness ?? 0.72;
      m.specularColor = new B.Color3(0.09, 0.09, 0.085);
      m.specularPower = 12 + (1 - roughness) * 64;
      converted.set(pbr, m);
    }
    mesh.material = converted.get(pbr);
  }
  for (const pbr of converted.keys()) pbr.dispose();
  container.materials = [...new Set(converted.values())];
}
function place(container, { x, z, yaw, scale }) {
  // doNotInstantiate has to be said out loud: left off, Babylon defaults it to
  // true and clones the geometry for every placement, which is how the arch
  // and the three grass tufts quietly stopped sharing anything at all.
  const entries = container.instantiateModelsToScene((name) => name, false, {
    doNotInstantiate: false,
  });
  const root = entries.rootNodes[0];
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  root.scaling.setAll(scale);
  root.computeWorldMatrix(true);
  // Static decoration: work the matrices out once and then stop paying for
  // them every frame. Freezing has to come after the transform above, and it
  // is why nothing in this pack can be animated later without unfreezing.
  for (const mesh of root.getChildMeshes()) {
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }
  return root;
}
