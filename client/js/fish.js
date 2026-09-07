import { SPECIES } from "../../shared/config.js";
const B = window.BABYLON;
export const palette = [
  "#edb45e",
  "#72cab7",
  "#db8c92",
  "#91bce0",
  "#c8d981",
  "#bb9bd5",
  "#f4de9b",
  "#81d3e1",
];
export function material(scene, name, color, emissive = 0) {
  const m = new B.StandardMaterial(name, scene);
  m.diffuseColor =
    typeof color === "string" ? B.Color3.FromHexString(color) : color;
  m.specularColor = new B.Color3(0.15, 0.2, 0.17);
  m.emissiveColor = m.diffuseColor.scale(emissive);
  return m;
}
const BITE_TIME = 0.6,
  DEATH_TIME = 0.7;
// Threat cue tints: food a touch brighter and warmer, threats darker and cooler.
const NEUTRAL = new B.Color3(1, 1, 1),
  EDIBLE = new B.Color3(1.25, 1.2, 1.05),
  DANGER = new B.Color3(0.55, 0.5, 0.6),
  INSTANCE_COLOR = B.VertexBuffer.ColorInstanceKind;
// Blender fish exported by tools/blender/create_fish.py: +Z forward, +Y up,
// ~2-unit body, a "Tail" pivot carrying the swim clip.
const models = new WeakMap(),
  crests = new WeakMap(),
  maws = new WeakMap(),
  crowns = new WeakMap();
// Where each model's nose ends (+Z), so the cartoon maw sits on the mouth.
const NOSE = {
  clownfish: 1.04,
  "blue-tang": 1.0,
  pufferfish: 0.93,
  angelfish: 0.8,
  goldfish: 0.88,
  betta: 0.98,
  shark: 0.89,
  butterflyfish: 1.04,
  lionfish: 0.97,
  wrasse: 1.11,
  seahorse: 0.81,
  "manta-ray": 0.84,
  "royal-gramma": 1.02,
  triggerfish: 1.03,
};
function shared(map, scene, make) {
  if (!map.has(scene)) map.set(scene, make());
  return map.get(scene);
}
// Species with authored low/high tiers in tools/blender/create_fish.py's
// DETAIL_MODULES; the rest resolve every tier to standard or HD.
export const DETAILED_SPECIES = new Set([
  "clownfish",
  "blue-tang",
  "pufferfish",
  "goldfish",
  "betta",
  "angelfish",
  "butterflyfish",
  "wrasse",
  "royal-gramma",
  "triggerfish",
  "lionfish",
  "seahorse",
  "manta-ray",
  "shark",
]);
const modelsFor = (scene) => {
  if (!models.has(scene)) models.set(scene, new Map());
  return models.get(scene);
};
// Load every species once into an asset container. Fish are then GPU instances
// sharing geometry and materials, so a hundred fish cost a handful of draw calls.
// Upgraded species use low/standard/high/hd; others use standard or HD. A
// reload swaps the whole set at once and disposes the previous models, so the
// caller must rebuild any fish created from them afterwards.
export const modelUrl = (species, detail = "standard") => {
  const suffix =
    detail === "hd"
      ? "-hd"
      : DETAILED_SPECIES.has(species) && ["low", "high"].includes(detail)
        ? `-${detail}`
        : "";
  return `assets/models/${species}${suffix}.glb`;
};
export async function loadFishModels(
  scene,
  load = (species, detail) =>
    B.LoadAssetContainerAsync(modelUrl(species, detail), scene),
  detail = "standard",
) {
  const failed = [],
    next = new Map();
  await Promise.all(
    SPECIES.map(async (species) => {
      try {
        let container;
        try {
          container = await load(species, detail);
        } catch (error) {
          if (detail === "standard") throw error;
          console.warn(`No ${detail} model for "${species}"; using standard`);
          container = await load(species, "standard");
        }
        prepare(container, scene, species, detail);
        next.set(species, container);
      } catch (error) {
        failed.push(species);
        console.warn(`Fish model "${species}" failed to load`, error);
      }
    }),
  );
  for (const container of modelsFor(scene).values()) container.dispose();
  models.set(scene, next);
  return { loaded: SPECIES.filter((s) => next.has(s)), failed, detail };
}
function prepare(container, scene, species, detail) {
  // The glTF loader auto-plays the first clip on the hidden source model.
  for (const group of container.animationGroups) group.stop();
  // The scene has no environment texture, so swap the exported PBR materials
  // for the same StandardMaterial look as the rest of the aquarium. glTF base
  // colors are linear; StandardMaterial expects gamma space. The two lights add
  // up to ~2.6x on upward faces, which clips pale colors to white, so the fish
  // take only part of their color from lighting and the rest as same-hue
  // emissive: tops sit near the authored color, sides fall to ~70%.
  const converted = new Map();
  for (const mesh of container.meshes) {
    const pbr = mesh.material;
    if (!pbr) continue;
    if (!converted.has(pbr)) {
      const base = (pbr.albedoColor ?? B.Color3.White()).toGammaSpace();
      const m = material(scene, pbr.name, base.scale(0.3));
      m.emissiveColor = base.scale(0.4);
      if (DETAILED_SPECIES.has(species) && detail !== "low") {
        // Preserve authored roughness as a wet highlight without changing the
        // shared instance-color shader or washing out the painted stripes.
        const roughness = pbr.roughness ?? 0.4;
        m.specularPower = 12 + (1 - roughness) * 96;
        const gloss = detail === "hd" ? 0.36 : detail === "high" ? 0.26 : 0.18;
        m.specularColor = new B.Color3(gloss, gloss * 0.95, gloss * 0.85);
      }
      converted.set(pbr, m);
    }
    mesh.material = converted.get(pbr);
  }
  for (const pbr of converted.keys()) pbr.dispose();
  container.materials = [...new Set(converted.values())];
  // A per-instance color buffer lets the threat cue tint each fish while all
  // fish of a species still draw as one instanced batch.
  for (const mesh of container.meshes) {
    if (!mesh.getTotalVertices()) continue;
    mesh.registerInstancedBuffer(INSTANCE_COLOR, 4);
    mesh.instancedBuffers[INSTANCE_COLOR] = new B.Color4(1, 1, 1, 1);
  }
}
// species picks the model; color only feeds the procedural fallback palette.
export function createFish(
  scene,
  species,
  npc = false,
  color = 0,
  preview = false,
) {
  // Server state drives root; bite and death animations play on pose.
  const root = new B.TransformNode("fish", scene),
    pose = new B.TransformNode("pose", scene);
  pose.parent = root;
  const model = modelsFor(scene).get(species);
  const body = model
    ? instantiate(model, pose, preview)
    : procedural(scene, pose, color);
  if (!npc) {
    if (!crests.has(scene))
      crests.set(scene, material(scene, "crest", "#e4ffc3", 0.7));
    const crest = B.MeshBuilder.CreateSphere(
      "player crest",
      { segments: 6, diameter: 0.28 },
      scene,
    );
    crest.position.set(0, 1.22, 0.05);
    crest.parent = pose;
    crest.material = crests.get(scene);
  }
  // A dark cartoon maw that only shows while the fish chomps.
  const mouth = B.MeshBuilder.CreateSphere(
    "maw",
    { segments: 6, diameter: 1 },
    scene,
  );
  mouth.parent = pose;
  const mouthY =
    model && species === "seahorse"
      ? 0.61
      : model && species === "shark"
        ? -0.24
        : -0.08;
  mouth.position.set(0, mouthY, (model ? (NOSE[species] ?? 1) : 1.2) - 0.02);
  mouth.scaling.set(0.34, 0.02, 0.16);
  mouth.material = shared(maws, scene, () => {
    const m = material(scene, "maw", "#0b1013");
    m.specularColor = new B.Color3(0.05, 0.05, 0.05);
    return m;
  });
  mouth.setEnabled(false);
  // A little gold crown marks the round's current leader.
  let crown = null;
  if (!npc) {
    const gold = shared(crowns, scene, () =>
      material(scene, "crown", "#f2c14e", 0.6),
    );
    crown = B.MeshBuilder.CreateCylinder(
      "crown",
      { height: 0.2, diameterTop: 0.5, diameterBottom: 0.4, tessellation: 8 },
      scene,
    );
    crown.position.set(0, 1.58, 0.05);
    crown.parent = pose;
    crown.material = gold;
    for (let i = 0; i < 4; i++) {
      const point = B.MeshBuilder.CreateCylinder(
        "crown point",
        { height: 0.18, diameterTop: 0, diameterBottom: 0.12, tessellation: 4 },
        scene,
      );
      const a = (i / 4) * Math.PI * 2;
      point.position.set(Math.sin(a) * 0.2, 0.19, Math.cos(a) * 0.2);
      point.parent = crown;
      point.material = gold;
    }
    crown.setEnabled(false);
  }
  const { swim } = body;
  swim.start(true, 1);
  if (swim.isStarted)
    swim.goToFrame(swim.from + Math.random() * (swim.to - swim.from));
  let bite = -1,
    death = -1,
    deathLength = DEATH_TIME,
    jolting = false;
  const tint = new B.Color3();
  const fish = {
    root,
    pose,
    mouth,
    crown,
    swim,
    wasAlive: false,
    threat: 0,
    eatenBy: null,
    bite() {
      if (death >= 0) return;
      bite = 0;
      mouth.setEnabled(true);
      swim.speedRatio = 4;
    },
    // seconds stretches the swallow, used for the player's own death cam.
    die(predator = null, seconds = DEATH_TIME) {
      fish.eatenBy = predator;
      death = 0;
      deathLength = seconds;
      bite = -1;
    },
    reset() {
      bite = death = -1;
      fish.eatenBy = null;
      mouth.setEnabled(false);
      pose.position.setAll(0);
      pose.rotation.setAll(0);
      pose.scaling.setAll(1);
    },
    // Stunned by the zapper: twitch until it wears off.
    jolt(on) {
      if (jolting && !on) {
        pose.rotation.z = 0;
        pose.position.x = 0;
      }
      jolting = on;
    },
    // Advances bite and death animations; true while a death is still playing.
    update(dt) {
      if (jolting && death < 0) {
        pose.rotation.z = (Math.random() - 0.5) * 0.4;
        pose.position.x = (Math.random() - 0.5) * 0.14;
      }
      if (death >= 0) {
        mouth.setEnabled(false);
        death += dt;
        const t = Math.min(1, death / deathLength);
        // Roll belly-up, tumble and shrink away as the predator swallows.
        pose.rotation.z = t * t * 7;
        pose.rotation.x = t * 1.5;
        pose.scaling.setAll(Math.max(0.001, 1 - t * t));
        if (t < 1) return true;
        death = -1;
      } else if (bite >= 0) {
        bite += dt;
        const t = bite / BITE_TIME;
        if (t >= 1) {
          bite = -1;
          pose.position.z = 0;
          pose.rotation.x = 0;
          pose.scaling.setAll(1);
          mouth.setEnabled(false);
        } else {
          // Cartoon chomp: rear back with the maw gaping, snap shut past
          // neutral with a squash, then settle while lunging forward.
          const gape =
              t < 0.55
                ? Math.sin(((t / 0.55) * Math.PI) / 2)
                : Math.max(0, 1 - (t - 0.55) / 0.1),
            snap =
              t > 0.55 && t < 0.85 ? Math.sin(((t - 0.55) / 0.3) * Math.PI) : 0,
            lunge = Math.sin(Math.PI * Math.min(1, t / 0.9));
          pose.position.z = lunge * 0.5;
          pose.rotation.x = -gape * 0.35 + snap * 0.25;
          pose.scaling.set(
            1 + gape * 0.05 - snap * 0.14,
            1 + gape * 0.14 - snap * 0.12,
            1 + gape * 0.2 + snap * 0.14,
          );
          mouth.scaling.set(
            0.34 + gape * 0.14,
            0.02 + gape * 0.46,
            0.16 + gape * 0.08,
          );
          mouth.position.y = mouthY - gape * 0.18;
        }
      }
      return false;
    },
    setCrown(on) {
      crown?.setEnabled(on);
    },
    // threat: -1 it can eat me … 0 neutral … 1 I can eat it.
    tint(threat) {
      if (threat > 0) B.Color3.LerpToRef(NEUTRAL, EDIBLE, threat, tint);
      else B.Color3.LerpToRef(NEUTRAL, DANGER, -threat, tint);
      body.tint(tint);
    },
    dispose() {
      swim.dispose();
      body.dispose();
      root.dispose();
    },
  };
  return fish;
}
function instantiate(container, parent, preview = false) {
  const entries = container.instantiateModelsToScene((name) => name, false, {
    // The menu preview needs its own meshes for isolated studio lighting.
    doNotInstantiate: preview,
  });
  for (const node of entries.rootNodes) node.parent = parent;
  const instances = parent
    .getChildMeshes()
    .filter((m) => m.instancedBuffers?.[INSTANCE_COLOR]);
  for (const m of instances)
    m.instancedBuffers[INSTANCE_COLOR] = new B.Color4(1, 1, 1, 1);
  const swim =
    entries.animationGroups.find((g) => /swim/i.test(g.name)) ??
    entries.animationGroups[0] ??
    new B.AnimationGroup("swim", parent.getScene());
  return {
    swim,
    tint(color) {
      for (const m of instances)
        m.instancedBuffers[INSTANCE_COLOR].set(color.r, color.g, color.b, 1);
    },
    dispose() {
      for (const g of entries.animationGroups) if (g !== swim) g.dispose();
    },
  };
}
// Fallback when a model is missing or has not finished loading yet.
function procedural(scene, parent, color) {
  const skin = material(scene, "skin", palette[color % palette.length], 0.12),
    white = material(scene, "eyes", "#fff5d9", 0.25),
    black = material(scene, "pupils", "#102b30"),
    base = skin.diffuseColor.clone();
  function sphere(name, scale, pos, mat) {
    const mesh = B.MeshBuilder.CreateSphere(
      name,
      { segments: 8, diameter: 2 },
      scene,
    );
    mesh.scaling.set(...scale);
    mesh.position.set(...pos);
    mesh.parent = parent;
    mesh.material = mat;
    return mesh;
  }
  sphere("body", [0.58, 0.75, 1.25], [0, 0, 0], skin);
  const tail = sphere("tail", [0.12, 0.65, 0.5], [0, 0, -1.35], skin);
  tail.rotation.x = 0.25;
  sphere("dorsal", [0.07, 0.5, 0.55], [0, 0.55, -0.15], skin);
  for (const side of [-1, 1]) {
    sphere(
      "fin",
      [0.5, 0.07, 0.32],
      [side * 0.52, -0.2, -0.15],
      skin,
    ).rotation.z = side * 0.3;
    sphere("eye", [0.2, 0.23, 0.23], [side * 0.45, 0.22, 0.72], white);
    sphere("pupil", [0.11, 0.14, 0.13], [side * 0.57, 0.23, 0.84], black);
  }
  const wag = new B.Animation(
    "wag",
    "rotation.y",
    60,
    B.Animation.ANIMATIONTYPE_FLOAT,
    B.Animation.ANIMATIONLOOPMODE_CYCLE,
  );
  wag.setKeys(
    [0, 0.3, 0, -0.3, 0].map((value, i) => ({ frame: i * 15, value })),
  );
  const swim = new B.AnimationGroup("swim", scene);
  swim.addTargetedAnimation(wag, tail);
  return {
    swim,
    tint(color) {
      base.multiplyToRef(color, skin.diffuseColor);
    },
    dispose() {
      for (const m of [skin, white, black]) m.dispose();
    },
  };
}
