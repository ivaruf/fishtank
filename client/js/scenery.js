// The Blender scenery pack: seven static assets in client/assets/scenery,
// built by tools/blender/create_scenery.py and standing on the sand.
//
// This file only draws them. Where they stand is shared/scenery.js, because
// the hard ones stop fish and the simulation has to agree with the picture -
// see the boxes over there. What is *not* an obstacle is the three plants,
// which are dressing, and cover is still only the kelp clusters in
// shared/config.js: swimming behind the wreck hides you from nothing.
//
// If a load fails the tank simply does without that asset, and the collision
// stays regardless: a player on a slow connection meets the same walls, they
// just cannot see what they are.
import { material } from "./fish.js";
import { SCENERY } from "../../shared/scenery.js";
const B = window.BABYLON;
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
