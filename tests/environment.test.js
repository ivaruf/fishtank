import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  B = require("babylonjs");
globalThis.BABYLON = B;
globalThis.window = Object.assign(new EventTarget(), { BABYLON: B });
require("babylonjs-loaders");
const { createEnvironmentDetails, environmentTier } =
  await import("../client/js/environment.js");
function setup(value = "sharp") {
  const engine = new B.NullEngine(),
    scene = new B.Scene(engine),
    select = new EventTarget();
  select.value = value;
  return { engine, scene, select };
}
const disk = (scene) => (name, tier) =>
  B.LoadAssetContainerAsync(
    new Uint8Array(
      readFileSync(
        new URL(
          `../client/assets/environment/${name}-${tier}.glb`,
          import.meta.url,
        ),
      ),
    ),
    scene,
    { pluginExtension: ".glb" },
  );
test("authored details load, upgrade and fully disappear at low quality", async () => {
  const { engine, scene, select } = setup();
  const details = createEnvironmentDetails(scene, select, disk(scene));
  await details.ready;
  assert.ok(scene.meshes.length > 5);
  const high = scene.meshes.reduce((n, m) => n + m.getTotalVertices(), 0);
  const office = scene.materials.filter((m) => m.name.startsWith("office "));
  assert.ok(office.length);
  assert.ok(office.every((m) => !m.fogEnabled));
  const screen = scene.meshes.find((m) => m.name === "office Editor ink");
  assert.ok(screen);
  screen.computeWorldMatrix(true);
  assert.ok(
    screen.getBoundingInfo().boundingBox.minimumWorld.x > 130,
    "office screen details align with the desk on the positive-X wall",
  );
  const zapper = scene.meshes.filter((m) => m.name.startsWith("zapper "));
  assert.ok(zapper.length);
  for (const m of zapper) {
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    assert.ok(b.minimumWorld.x > -40 && b.maximumWorld.x < -20);
    assert.ok(b.minimumWorld.z > 20 && b.maximumWorld.z < 40);
  }
  select.value = "ultra";
  await details.refresh();
  assert.ok(scene.meshes.reduce((n, m) => n + m.getTotalVertices(), 0) > high);
  select.value = "battery";
  await details.refresh();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
  assert.equal(environmentTier("balanced"), null);
  assert.equal(environmentTier("unknown"), null);
  details.dispose();
  scene.dispose();
  engine.dispose();
});
test("late high-quality loads cannot reappear after switching to battery", async () => {
  const { engine, scene, select } = setup();
  const pending = [];
  let disposed = 0;
  const details = createEnvironmentDetails(
    scene,
    select,
    () => new Promise((resolve) => pending.push(resolve)),
  );
  select.value = "battery";
  await details.refresh();
  for (const resolve of pending)
    resolve({
      dispose() {
        disposed++;
      },
    });
  await details.ready;
  assert.equal(disposed, 2);
  assert.equal(scene.meshes.length, 0);
  details.dispose();
  scene.dispose();
  engine.dispose();
});
