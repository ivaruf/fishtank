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
  // Long enough to read as a swell and short enough to fire again on the next
  // mouthful, since a good run of eating is several fish in a couple of
  // seconds and the pops should stack up rather than queue.
  GROW_TIME = 0.4,
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
// The gopher's outfit from the arcade, worn by your own fish and by the menu's
// picture of it (PROOF OF CONCEPT, 2026-10-07; the why is in
// arcade/js/wardrobe.js, and neonfox's fox does the same). A dynamic import
// because the module is another repository's: served without the arcade beside
// it, or blocked, it is a rejected promise and a fish with nothing on, never a
// module graph that failed to load. Fish created before it lands go undressed;
// the next one - a respawn, a new round, a turn of the species carousel - wears
// whatever was picked at the dresser, read fresh each time.
let wardrobe = null;
import(new URL("../../../arcade/js/wardrobe.js", import.meta.url).href).then(
  (module) => {
    wardrobe = module;
  },
  () => console.info("fishtank: no arcade wardrobe beside this game"),
);
// Where each species keeps its eyes, from the eyes() calls in
// tools/blender/create_fish.py: [socket half-spacing, height, depth]. The
// wardrobe's items are authored on the gopher's head, eyes at (+-0.127, 0.25,
// 0.307), facing +Z like these fish, so one transform per species carries the
// gopher's eye line onto the fish's and the face front onto its nose (NOSE).
const EYES = {
  clownfish: [0.32, 0.16, 0.73],
  "blue-tang": [0.235, 0.23, 0.7],
  pufferfish: [0.39, 0.27, 0.67],
  angelfish: [0.15, 0.2, 0.5],
  goldfish: [0.38, 0.17, 0.62],
  betta: [0.22, 0.15, 0.72],
  butterflyfish: [0.19, 0.2, 0.49],
  lionfish: [0.33, 0.18, 0.64],
  wrasse: [0.225, 0.115, 0.79],
  "royal-gramma": [0.235, 0.14, 0.73],
  triggerfish: [0.245, 0.25, 0.62],
  seahorse: [0.19, 0.77, 0.29],
  "manta-ray": [0.265, 0.1, 0.6],
  shark: [0.26, 0.12, 0.7],
};
// One size of gopher head for every fish, set by eye against a render of all
// fourteen species wearing everything. The anchor puts the gopher's eye line at
// the fish's eye height and the gopher's face front on the fish's nose, which
// lands a hat on the crown behind the eyes and a mustache at the mouth on every
// species without a per-species table - the eyewear is the one exception, below.
const OUTFIT_SCALE = 1.6;
const outfitPaint = new WeakMap();
// A gopher's eyes look forward and a fish's look sideways, so glasses built to
// sit across a face end up buried in a fish's forehead with its own eyes
// bulging out past the frames. Each lens is moved onto the eye on its own side
// instead, turned to face outward, a goggle per eye; the arms and bridge that
// only make sense across a face are dropped, and so is the monocle's chain,
// which hangs from a lens that is no longer where it was drawn from. All in
// anchor-local units, hence the divide by OUTFIT_SCALE.
function goggles(nodes, [width, eyeY, eyeZ], at) {
  const local = (v, o) => (v - o) / OUTFIT_SCALE;
  for (const id of ["sunglasses", "monocle"]) {
    for (const mesh of nodes[id]?.getChildMeshes(false) ?? []) {
      const lens = /frame|lens|rim/i.test(mesh.name);
      if (!lens) {
        mesh.dispose(false, false);
        continue;
      }
      const side = Math.sign(mesh.position.x) || 1;
      // Just proud of the pupil, which create_fish.py puts at width + 0.19.
      mesh.position.set(
        (side * (width + 0.26)) / OUTFIT_SCALE,
        local(eyeY + 0.015, at.y),
        local(eyeZ + 0.06, at.z),
      );
      // The rings were authored lying on their faces toward +Z (rotation.x a
      // quarter turn); a quarter turn about Z instead faces them along X.
      mesh.rotation.set(0, 0, Math.PI / 2);
      mesh.scaling.setAll(1.2);
    }
  }
}
// What to put on a fish, or null for nothing. Your own fish and its menu
// picture wear what this device picked; anyone else wears the outfit the host's
// roster says they joined in, rebuilt through selectAccessory so only items the
// wardrobe knows go on, one per slot - this is the allowlist cleanOutfit in
// shared/config.js leaves to the renderer.
function outfitFor(own, list) {
  if (!wardrobe) return null;
  let selection;
  if (own) selection = wardrobe.loadOutfit();
  else if (list?.length) {
    selection = Object.fromEntries(
      wardrobe.ACCESSORIES.map((item) => [item.id, false]),
    );
    for (const id of list) wardrobe.selectAccessory(selection, id, true);
  }
  return selection && Object.values(selection).some(Boolean) ? selection : null;
}
// The ids worn on this device, for the JOIN message. Empty until the wardrobe
// has loaded, which is milliseconds against the seconds anyone spends in the
// menu, and empty for good in a tank served without the arcade.
export function wornOutfit() {
  const selection = outfitFor(true);
  return selection
    ? wardrobe.ACCESSORIES.filter((item) => selection[item.id]).map(
        (item) => item.id,
      )
    : [];
}
function dress(scene, swell, species, selection) {
  const [, eyeY] = EYES[species] ?? [0.3, 0.15, 0.7];
  const nose = NOSE[species] ?? 1;
  const anchor = new B.TransformNode("outfit", scene);
  anchor.parent = swell;
  anchor.scaling.setAll(OUTFIT_SCALE);
  anchor.position.set(
    0,
    eyeY - 0.25 * OUTFIT_SCALE,
    nose - 0.42 * OUTFIT_SCALE,
  );
  const outfit = wardrobe.makeAccessories(anchor, scene, null);
  outfit.set(selection);
  goggles(outfit.nodes, EYES[species] ?? [0.3, 0.15, 0.7], anchor.position);
  // The wardrobe paints in PBR for the arcade's lighting; this tank is lit for
  // StandardMaterial (point lamps a PBR surface reads with a different falloff),
  // so every item is repainted in the tank's own material, one per colour per
  // scene, and the PBR originals go. What is not worn goes too.
  const paints = shared(outfitPaint, scene, () => new Map());
  const originals = new Set();
  for (const [id, node] of Object.entries(outfit.nodes)) {
    const meshes = node.getChildMeshes(false);
    for (const mesh of meshes) originals.add(mesh.material);
    if (!selection[id]) {
      node.dispose(false, false);
      continue;
    }
    for (const mesh of meshes) {
      const hex = mesh.material.albedoColor.toGammaSpace().toHexString();
      if (!paints.has(hex))
        paints.set(hex, material(scene, `outfit ${hex}`, hex, 0.15));
      mesh.material = paints.get(hex);
    }
  }
  for (const m of originals) m?.dispose();
}
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
// `own` is the viewer's own fish, and it wears neither of the two markers a
// player fish carries. Both exist to pick a player out of a hundred wild fish
// from across the tank - which is a thing everyone else needs and you never
// do. On your own fish they sit in the middle of your view, a hand's width
// above your head, and tell you what the HUD already says.
export function createFish(
  scene,
  species,
  npc = false,
  color = 0,
  preview = false,
  own = false,
  outfit = null,
) {
  // Three nodes, and the split matters. root carries the transform the
  // simulation sent. pose plays the bite lunge and the death tumble. swell
  // plays the growth pop and nothing else, which is the only reason it exists:
  // the pop and the bite both want to scale the fish, they overlap by design
  // (you grow the instant you bite), and two animations writing one scaling
  // fight. A node each and they compose for free.
  const root = new B.TransformNode("fish", scene),
    pose = new B.TransformNode("pose", scene),
    swell = new B.TransformNode("swell", scene);
  pose.parent = root;
  swell.parent = pose;
  const model = modelsFor(scene).get(species);
  const body = model
    ? instantiate(model, swell, preview)
    : procedural(scene, swell, color);
  // Both markers are for other people. Your own fish is `own`, and the menu's
  // preview is a picture of your own fish, so neither wears one.
  const marked = !npc && !own && !preview;
  const wearing = npc ? null : outfitFor(own || preview, outfit);
  // The crest and the crown float above the head, which is exactly where a top
  // hat or antennae go; lift both clear rather than lose either signal.
  const lift =
    wearing &&
    wardrobe.ACCESSORIES.some(
      (item) => item.slot === "head" && wearing[item.id],
    )
      ? 0.6
      : 0;
  if (marked) {
    if (!crests.has(scene))
      crests.set(scene, material(scene, "crest", "#e4ffc3", 0.7));
    const crest = B.MeshBuilder.CreateSphere(
      "player crest",
      { segments: 6, diameter: 0.28 },
      scene,
    );
    crest.position.set(0, 1.22 + lift, 0.05);
    crest.parent = swell;
    crest.material = crests.get(scene);
  }
  // A dark cartoon maw that only shows while the fish chomps.
  const mouth = B.MeshBuilder.CreateSphere(
    "maw",
    { segments: 6, diameter: 1 },
    scene,
  );
  mouth.parent = swell;
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
  // A little gold crown marks the round's current leader - to everybody else.
  // Alone in the tank it would have crowned you for leading yourself.
  let crown = null;
  if (marked) {
    const gold = shared(crowns, scene, () =>
      material(scene, "crown", "#f2c14e", 0.6),
    );
    crown = B.MeshBuilder.CreateCylinder(
      "crown",
      { height: 0.2, diameterTop: 0.5, diameterBottom: 0.4, tessellation: 8 },
      scene,
    );
    crown.position.set(0, 1.58 + lift, 0.05);
    crown.parent = swell;
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
  // Everyone in the tank wears what their gopher wears.
  if (wearing) dress(scene, swell, species, wearing);
  const { swim } = body;
  swim.start(true, 1);
  if (swim.isStarted)
    swim.goToFrame(swim.from + Math.random() * (swim.to - swim.from));
  let bite = -1,
    grew = -1,
    grewBy = 1,
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
    // A meal's worth of growth, made visible. The actual increment is far too
    // small to see - one small fish is about 7% of your radius, and the follow
    // camera eats a third of even that - so the growth a player feels has to
    // be an event rather than a size. `gain` is the mass added, which sets how
    // hard it pops: a snack is a nudge, a whole player is a lurch.
    grow(gain = 1) {
      if (death >= 0) return;
      grew = 0;
      grewBy = Math.min(1, 0.3 + gain / 10);
    },
    // seconds stretches the swallow, used for the player's own death cam.
    die(predator = null, seconds = DEATH_TIME) {
      fish.eatenBy = predator;
      death = 0;
      deathLength = seconds;
      bite = -1;
    },
    reset() {
      bite = death = grew = -1;
      fish.eatenBy = null;
      mouth.setEnabled(false);
      pose.position.setAll(0);
      pose.rotation.setAll(0);
      pose.scaling.setAll(1);
      swell.scaling.setAll(1);
    },
    // Stunned by the zapper: twitch until it wears off.
    jolt(on) {
      if (jolting && !on) {
        pose.rotation.z = 0;
        pose.position.x = 0;
      }
      jolting = on;
    },
    // Advances bite, growth and death animations; true while a death is still
    // playing.
    update(dt) {
      // The pop, on its own node, so it neither reads nor writes anything the
      // bite and death animations below touch. It overshoots and settles
      // rather than easing in: a fish that swells past its size and comes back
      // reads as "that just grew", where a fish that eases up 7% reads as
      // nothing at all.
      if (grew >= 0) {
        grew += dt;
        const t = grew / GROW_TIME;
        if (t >= 1) {
          grew = -1;
          swell.scaling.setAll(1);
        } else {
          const pop = 1 + Math.sin(Math.PI * t) * 0.22 * grewBy;
          swell.scaling.set(pop, pop, 1 + (pop - 1) * 0.5);
        }
      }
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
