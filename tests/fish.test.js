import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SPECIES, speciesOf } from "../shared/config.js";
// fish.js reads the browser global; the UMD bundles run headless on NullEngine.
const require = createRequire(import.meta.url);
const BABYLON = require("babylonjs");
globalThis.BABYLON = BABYLON;
require("babylonjs-loaders");
globalThis.window = Object.assign(new EventTarget(), { BABYLON });
const { createFish, loadFishModels } = await import("../client/js/fish.js");
function headless() {
  const engine = new BABYLON.NullEngine(),
    scene = new BABYLON.Scene(engine);
  scene.useConstantAnimationDeltaTime = true;
  new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 0, -6), scene);
  new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  return { engine, scene };
}
const fromDisk = (scene) => (species) =>
  BABYLON.LoadAssetContainerAsync(
    new Uint8Array(
      readFileSync(
        new URL(`../client/assets/models/${species}.glb`, import.meta.url),
      ),
    ),
    scene,
    { pluginExtension: ".glb" },
  );
function worldZ(fish) {
  const meshes = fish.root.getChildMeshes().filter((m) => m.getTotalVertices());
  const boxes = meshes.map((m) => {
    m.computeWorldMatrix(true);
    return m.getBoundingInfo().boundingBox;
  });
  return {
    nose: Math.max(...boxes.map((b) => b.maximumWorld.z)),
    tail: Math.min(...boxes.map((b) => b.minimumWorld.z)),
  };
}
// Bite lunges then settles; death tumbles, shrinks and reports when it is over.
function checkAnimations(fish) {
  assert.equal(fish.update(0.1), false);
  assert.equal(fish.pose.position.z, 0);
  fish.bite();
  assert.equal(fish.update(0.1), false);
  assert.ok(fish.pose.position.z > 0.1, "bite lunges forward");
  assert.ok(fish.pose.scaling.z > 1, "bite stretches the body");
  fish.update(0.5);
  assert.equal(fish.pose.position.z, 0);
  assert.equal(fish.pose.scaling.z, 1);
  fish.die("predator");
  assert.equal(fish.eatenBy, "predator");
  assert.equal(fish.update(0.2), true);
  assert.ok(fish.pose.scaling.x < 1 && fish.pose.rotation.z > 0);
  fish.bite();
  assert.equal(fish.pose.position.z, 0, "no bite while dying");
  assert.equal(fish.update(1), false);
  fish.reset();
  assert.equal(fish.pose.scaling.x, 1);
  assert.equal(fish.pose.rotation.z, 0);
  assert.equal(fish.eatenBy, null);
}
test("Blender fish load, face +Z, share instanced geometry, swim, tint and dispose cleanly", async () => {
  const { engine, scene } = headless();
  try {
    const result = await loadFishModels(scene, fromDisk(scene));
    assert.deepEqual(result, { loaded: SPECIES, failed: [] });
    const baseline = { meshes: scene.meshes.length, groups: 0 };
    for (const [color, species] of SPECIES.entries()) {
      assert.equal(speciesOf(color), species);
      assert.equal(speciesOf(color + SPECIES.length), species);
      const fish = createFish(scene, color, false);
      fish.root.position.set(3, 4, 5);
      fish.root.computeWorldMatrix(true);
      const meshes = fish.root.getChildMeshes();
      const instances = meshes.filter(
        (m) => m.getClassName() === "InstancedMesh",
      );
      assert.ok(instances.length > 0);
      for (const m of meshes)
        if (m.material)
          assert.equal(m.material.getClassName(), "StandardMaterial");
      const { nose, tail } = worldZ(fish);
      assert.ok(nose > 5.8, `${species} nose ahead of origin: ${nose}`);
      assert.ok(tail < 3.6, `${species} tail behind origin: ${tail}`);
      assert.ok(meshes.some((m) => m.name === "player crest"));
      assert.ok(fish.swim.isStarted);
      const pivot = fish.swim.targetedAnimations[0].target;
      const before = pivot.rotationQuaternion.clone();
      for (let i = 0; i < 12; i++) scene.render();
      assert.ok(!pivot.rotationQuaternion.equals(before), "tail wags");
      // Threat tint rides a per-instance color the standard shader picks up.
      const color4 = () => instances[0].instancedBuffers.instanceColor;
      fish.tint(-1);
      assert.ok(color4().r < 0.7 && color4().g < color4().b);
      fish.tint(1);
      assert.ok(color4().r > 1.1);
      fish.tint(0);
      assert.deepEqual([color4().r, color4().g, color4().b], [1, 1, 1]);
      assert.match(
        instances[0].sourceMesh.subMeshes[0].effect.defines,
        /INSTANCESCOLOR/,
      );
      checkAnimations(fish);
      fish.dispose();
    }
    assert.equal(scene.meshes.length, baseline.meshes);
    assert.equal(scene.animationGroups.length, baseline.groups);
    const a = createFish(scene, 1, true),
      b = createFish(scene, 1, true);
    const sources = (fish) =>
      fish.root
        .getChildMeshes()
        .filter((m) => m.sourceMesh)
        .map((m) => m.sourceMesh.uniqueId)
        .sort();
    assert.ok(sources(a).length > 0);
    assert.deepEqual(sources(a), sources(b));
    assert.ok(!a.root.getChildMeshes().some((m) => m.name === "player crest"));
    a.tint(-1);
    b.tint(1);
    const shade = (fish) =>
      fish.root.getChildMeshes().find((m) => m.sourceMesh).instancedBuffers
        .instanceColor.r;
    assert.ok(shade(a) < 1 && shade(b) > 1, "instances tint independently");
    a.dispose();
    b.dispose();
  } finally {
    engine.dispose();
  }
});
test("missing models fall back to a procedural fish with the same contract", () => {
  const { engine, scene } = headless();
  try {
    const fish = createFish(scene, 4, true);
    const meshes = fish.root.getChildMeshes();
    assert.ok(meshes.length > 3);
    assert.ok(meshes.every((m) => m.getClassName() === "Mesh"));
    assert.ok(fish.swim.isStarted);
    const tail = meshes.find((m) => m.name === "tail");
    const before = tail.rotation.y;
    for (let i = 0; i < 12; i++) scene.render();
    assert.notEqual(tail.rotation.y, before);
    const skin = meshes.find((m) => m.name === "body").material;
    const base = skin.diffuseColor.clone();
    fish.tint(-1);
    assert.ok(skin.diffuseColor.r < base.r);
    fish.tint(0);
    assert.ok(skin.diffuseColor.equals(base));
    checkAnimations(fish);
    fish.dispose();
    assert.equal(scene.meshes.length, 0);
    assert.equal(scene.materials.length, 0);
  } finally {
    engine.dispose();
  }
});
