import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SPECIES } from "../shared/config.js";
// fish.js reads the browser global; the UMD bundles run headless on NullEngine.
const require = createRequire(import.meta.url);
const BABYLON = require("babylonjs");
globalThis.BABYLON = BABYLON;
require("babylonjs-loaders");
globalThis.window = Object.assign(new EventTarget(), { BABYLON });
const { createFish, loadFishModels, modelUrl } =
  await import("../client/js/fish.js");
function headless() {
  const engine = new BABYLON.NullEngine(),
    scene = new BABYLON.Scene(engine);
  scene.useConstantAnimationDeltaTime = true;
  new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 0, -6), scene);
  new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
  return { engine, scene };
}
const fromDisk = (scene) => (species, detail) =>
  BABYLON.LoadAssetContainerAsync(
    new Uint8Array(
      readFileSync(
        new URL(`../client${modelUrl(species, detail)}`, import.meta.url),
      ),
    ),
    scene,
    { pluginExtension: ".glb" },
  );
const vertices = (fish) =>
  fish.root
    .getChildMeshes()
    .filter((m) => m.sourceMesh)
    .reduce((sum, m) => sum + m.sourceMesh.getTotalVertices(), 0);
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
  assert.equal(fish.mouth.isEnabled(), false, "maw hidden at rest");
  fish.bite();
  assert.equal(fish.update(0.15), false);
  assert.ok(fish.pose.position.z > 0.1, "bite lunges forward");
  assert.ok(fish.pose.scaling.z > 1, "bite stretches the body");
  assert.ok(fish.pose.rotation.x < -0.1, "head rears back while gaping");
  assert.ok(fish.mouth.isEnabled() && fish.mouth.scaling.y > 0.2, "maw gapes");
  fish.update(0.25);
  assert.ok(fish.pose.rotation.x > 0, "then snaps down");
  fish.update(0.5);
  assert.equal(fish.pose.position.z, 0);
  assert.equal(fish.pose.scaling.z, 1);
  assert.equal(fish.mouth.isEnabled(), false, "maw hidden after the chomp");
  fish.die("predator");
  assert.equal(fish.eatenBy, "predator");
  assert.equal(fish.update(0.2), true);
  assert.ok(fish.pose.scaling.x < 1 && fish.pose.rotation.z > 0);
  fish.bite();
  assert.equal(fish.pose.position.z, 0, "no bite while dying");
  assert.equal(fish.update(1), false);
  fish.die("slow", 2);
  assert.equal(fish.update(1), true, "a longer swallow is still going");
  assert.equal(fish.update(1.1), false);
  fish.reset();
  assert.equal(fish.pose.scaling.x, 1);
  assert.equal(fish.pose.rotation.z, 0);
  assert.equal(fish.eatenBy, null);
}
test("Blender fish load, face +Z, share instanced geometry, swim, tint and dispose cleanly", async () => {
  const { engine, scene } = headless();
  try {
    const result = await loadFishModels(scene, fromDisk(scene));
    assert.deepEqual(result, {
      loaded: SPECIES,
      failed: [],
      detail: "standard",
    });
    const baseline = { meshes: scene.meshes.length, groups: 0 };
    for (const [color, species] of SPECIES.entries()) {
      const fish = createFish(scene, species, false, color);
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
      // Faces +Z: nose ahead of the origin, tail behind it. Loose enough for
      // upright shapes such as a seahorse, strict enough to catch a flipped export.
      assert.ok(nose > 5.5, `${species} nose ahead of origin: ${nose}`);
      assert.ok(tail < 4.5, `${species} tail behind origin: ${tail}`);
      assert.ok(meshes.some((m) => m.name === "player crest"));
      assert.equal(fish.crown.isEnabled(), false, "no crown until leading");
      fish.setCrown(true);
      assert.equal(fish.crown.isEnabled(), true);
      fish.setCrown(false);
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
    const a = createFish(scene, "blue-tang", true, 1),
      b = createFish(scene, "blue-tang", true, 1);
    const sources = (fish) =>
      fish.root
        .getChildMeshes()
        .filter((m) => m.sourceMesh)
        .map((m) => m.sourceMesh.uniqueId)
        .sort();
    assert.ok(sources(a).length > 0);
    assert.deepEqual(sources(a), sources(b));
    assert.ok(!a.root.getChildMeshes().some((m) => m.name === "player crest"));
    assert.equal(a.crown, null, "wild fish never wear the crown");
    a.setCrown(true);
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
test("Ultra loads denser models for every species and swaps out the previous set", async () => {
  const { engine, scene } = headless();
  try {
    await loadFishModels(scene, fromDisk(scene), "standard");
    const standard = Object.fromEntries(
      SPECIES.map((s) => {
        const fish = createFish(scene, s, true);
        const count = vertices(fish);
        fish.dispose();
        return [s, count];
      }),
    );
    const stale = createFish(scene, "shark", true);
    const meshesBefore = scene.meshes.length;
    const result = await loadFishModels(scene, fromDisk(scene), "hd");
    assert.deepEqual(result, { loaded: SPECIES, failed: [], detail: "hd" });
    // The old set is gone, including the instances a stale fish still held.
    assert.ok(scene.meshes.length < meshesBefore);
    assert.equal(
      stale.root.getChildMeshes().filter((m) => m.sourceMesh).length,
      0,
    );
    stale.dispose();
    for (const species of SPECIES) {
      const fish = createFish(scene, species, true);
      assert.ok(
        vertices(fish) > standard[species] * 2,
        `${species}: hd ${vertices(fish)} vs standard ${standard[species]}`,
      );
      fish.dispose();
    }
  } finally {
    engine.dispose();
  }
});
test("missing models fall back to a procedural fish with the same contract", () => {
  const { engine, scene } = headless();
  try {
    const fish = createFish(scene, "unknown-fish", true, 4);
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
    // Only the per-scene shared maw material may remain.
    assert.deepEqual(
      scene.materials.map((m) => m.name),
      ["maw"],
    );
  } finally {
    engine.dispose();
  }
});

test("upgraded fish quality tiers change geometry and preserve animated instances", async () => {
  const { engine, scene } = headless();
  try {
    const previous = {};
    for (const detail of ["low", "standard", "high", "hd"]) {
      await loadFishModels(scene, fromDisk(scene), detail);
      for (const species of ["clownfish", "blue-tang", "pufferfish"]) {
        const fish = createFish(scene, species, true);
        assert.ok(
          vertices(fish) > (previous[species] ?? 0),
          `${species} ${detail} adds geometry`,
        );
        previous[species] = vertices(fish);
        assert.ok(
          fish.swim.targetedAnimations.length >=
            (detail === "high" || detail === "hd" ? 3 : 1),
        );
        fish.dispose();
      }
    }
    assert.equal(modelUrl("shark", "low"), modelUrl("shark", "standard"));
    assert.equal(modelUrl("shark", "high"), modelUrl("shark", "standard"));
  } finally {
    engine.dispose();
  }
});
