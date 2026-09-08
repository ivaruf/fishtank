// The authored sand floor: one seamless 8 x 8 tile from
// tools/blender/create_sand.py, laid nine by nine over the tank's 72 x 72 sand
// at the top two quality settings only.
//
// It replaces the flat procedural plane rather than joining it - the tile
// ripples about 5 cm either side of y = 0, so a plane left visible underneath
// would poke through every trough. The plane is hidden, not removed, because
// dropping back to Balanced has to bring it straight back.
//
// Same lifecycle as environment.js next door, for the same reasons: only the
// selected tier is ever in memory, a download that lands after the player has
// switched away is thrown out rather than shown, and a failed load leaves the
// tank standing on the floor it already had.
const B = window.BABYLON;
// The tile is 8 units square and the tank floor is 72, so nine fit exactly.
// Both numbers are the Blender script's; change them together or not at all.
const TILE = 8,
  ACROSS = 9;
export const sandTier = (quality) =>
  ({ sharp: "high", ultra: "ultra" })[quality] ?? null;
export function createSandFloor(
  scene,
  select,
  plain,
  load = (tier) =>
    B.LoadAssetContainerAsync(`assets/sand/sand-tile-${tier}.glb`, scene),
) {
  let version = 0,
    container = null,
    tiles = [],
    disposed = false;
  function clear() {
    for (const entries of tiles) entries.dispose();
    tiles = [];
    // The container owns the converted material and both textures by the time
    // this runs, so this is what actually frees the four megabytes.
    container?.dispose();
    container = null;
    plain.setEnabled(true);
  }
  async function refresh() {
    const request = ++version;
    clear();
    const tier = sandTier(select.value);
    if (!tier || disposed) return;
    let loaded;
    try {
      loaded = await load(tier);
      if (disposed || version !== request) {
        loaded.dispose();
        return;
      }
      standardize(loaded, scene);
      tiles = spread(loaded);
      container = loaded;
      plain.setEnabled(false);
    } catch (error) {
      loaded?.dispose();
      if (!disposed && version === request)
        console.warn(
          `Could not load the ${tier} sand; keeping the plain floor.`,
          error,
        );
    }
  }
  select.addEventListener("change", refresh);
  const ready = refresh();
  function dispose() {
    disposed = true;
    ++version;
    select.removeEventListener("change", refresh);
    clear();
  }
  scene.onDisposeObservable.addOnce(dispose);
  return { ready, refresh, dispose };
}
// The one conversion in this game that has to carry its textures across. The
// fish and scenery converters read albedoColor and throw the rest away, which
// for sand would discard the entire point of it, so this one moves the base
// colour and the grain normal map over by hand.
function standardize(container, scene) {
  const converted = new Map();
  for (const mesh of container.meshes) {
    const pbr = mesh.material;
    if (!pbr) continue;
    if (!converted.has(pbr)) {
      const m = new B.StandardMaterial("authored sand", scene);
      m.diffuseTexture = pbr.albedoTexture;
      m.bumpTexture = pbr.bumpTexture;
      // A normal map is data, not a picture: sampled as sRGB its vectors come
      // out skewed and the grain lights wrongly. Blender writes it as
      // Non-Color and it has to stay that way here.
      if (m.bumpTexture) m.bumpTexture.gammaSpace = false;
      // Brightness is split between lighting and emissive, the same trick the
      // fish use, because the floor's problem is its range rather than its
      // level: the hood spot is a cone from 36 units up, so the middle of the
      // sand gets about 2.7x and the corners fall outside the cone and get
      // only the 0.4 ambient. Taken from lighting alone the centre clips white
      // while the corners go black. Emissive is a floor under the whole
      // surface, and putting the base texture in that slot too means the lift
      // carries the grain instead of flattening it into a wash.
      //
      //   centre  0.40 x 0.6 x 2.7 + 0.45 x 0.6 = 0.92, just short of clipping
      //   corner  0.40 x 0.6 x 0.4 + 0.45 x 0.6 = 0.37, against 0.08 with no lift
      //
      // Grey rather than tinted, so the sand keeps the hue it was authored
      // with. Raise emissiveColor to brighten the dark edges, diffuseColor to
      // brighten the lit middle.
      m.diffuseColor = new B.Color3(0.4, 0.4, 0.4);
      m.emissiveTexture = pbr.albedoTexture;
      m.emissiveColor = new B.Color3(0.45, 0.45, 0.45);
      // Roughness 0.94 in the export: wet sand, barely a highlight. Matches
      // the specular the procedural sand already used.
      m.specularColor = new B.Color3(0.05, 0.05, 0.04);
      converted.set(pbr, m);
    }
    mesh.material = converted.get(pbr);
  }
  // Hand ownership to the container so a tier switch disposes the materials
  // it made as well. Disposing the PBR material leaves the textures alone -
  // they are still in container.textures, and still in use.
  for (const source of container.materials) source.dispose();
  container.materials = [...converted.values()];
}
// Nine by nine, centred on the tank, every tile a GPU instance of the one
// loaded mesh, so the whole floor is a single batch.
function spread(container) {
  const entries = [];
  const offset = ((ACROSS - 1) / 2) * TILE;
  for (let i = 0; i < ACROSS; i++)
    for (let j = 0; j < ACROSS; j++) {
      const copy = container.instantiateModelsToScene((name) => name, false, {
        doNotInstantiate: false,
      });
      const root = copy.rootNodes[0];
      // Instantiating the whole hierarchy keeps glTF's own root, which mirrors
      // one axis; placing the outer node leaves that mirror alone. It is
      // harmless here precisely because the tile is periodic - a mirrored edge
      // still matches its neighbour - and every tile is mirrored alike.
      root.position.set(i * TILE - offset, 0, j * TILE - offset);
      root.computeWorldMatrix(true);
      for (const mesh of root.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.computeWorldMatrix(true);
        mesh.freezeWorldMatrix();
      }
      entries.push(copy);
    }
  return entries;
}
