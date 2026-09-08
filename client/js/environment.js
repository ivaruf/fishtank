import { FILTER } from "../../shared/config.js";
const B = window.BABYLON;
export const environmentTier = (quality) =>
  ({ sharp: "high", ultra: "ultra" })[quality] ?? null;

// Additive authored layers leave the lightweight office and working zapper intact.
// Only the selected tier lives in memory. A late download cannot resurrect details
// after the player switches back to Battery Saver or leaves the scene.
export function createEnvironmentDetails(
  scene,
  select,
  load = (name, tier) =>
    B.LoadAssetContainerAsync(`assets/environment/${name}-${tier}.glb`, scene),
) {
  let version = 0,
    active = [],
    disposed = false;
  function clear() {
    for (const container of active) container.dispose();
    active = [];
  }
  async function refresh() {
    const request = ++version;
    clear();
    const tier = environmentTier(select.value);
    if (!tier || disposed) return;
    await Promise.all(
      ["office", "zapper"].map(async (name) => {
        let container;
        try {
          container = await load(name, tier);
          if (disposed || version !== request) {
            container.dispose();
            return;
          }
          const converted = new Map();
          for (const mesh of container.meshes) {
            mesh.isPickable = false;
            const source = mesh.material;
            if (!source) continue;
            if (!converted.has(source)) {
              const m = new B.StandardMaterial(`${name} ${source.name}`, scene);
              const color =
                source.albedoColor?.toGammaSpace() ??
                new B.Color3(0.5, 0.5, 0.5);
              m.diffuseColor = color.scale(0.65);
              m.emissiveColor = color.scale(name === "office" ? 0.28 : 0.12);
              m.specularColor = new B.Color3(0.16, 0.18, 0.18);
              m.specularPower = 40;
              m.fogEnabled = name !== "office";
              converted.set(source, m);
            }
            mesh.material = converted.get(source);
          }
          // Transfer ownership so switching quality disposes converted materials too.
          for (const source of container.materials) source.dispose();
          container.materials = [...converted.values()];
          // Babylon's left-handed glTF root mirrors X. These layers use the
          // room's authored world coordinates, so undo that mirror explicitly.
          for (const root of container.rootNodes) root.scaling.x *= -1;
          if (name === "zapper") {
            for (const root of container.rootNodes) {
              root.position.x += FILTER.x;
              root.position.z += FILTER.z;
            }
          }
          container.addAllToScene();
          for (const mesh of container.meshes) mesh.freezeWorldMatrix();
          active.push(container);
        } catch (error) {
          container?.dispose();
          if (!disposed && version === request)
            console.warn(
              `Could not load ${name} ${tier}; keeping the base model.`,
              error,
            );
        }
      }),
    );
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
