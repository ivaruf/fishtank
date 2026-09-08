import { material } from "./fish.js";
import { createEnvironmentDetails } from "./environment.js";
import { loadScenery } from "./scenery.js";
import { createSandFloor } from "./sand.js";
import { hardwareScaling } from "./rendering.js";
import { PLANTS, FILTER } from "../../shared/config.js";
const B = window.BABYLON;
// The tank is 72 x 30 x 72 units with the sand at y = 0. It stands on a cabinet
// in an evening office roughly 300 x 150 x 400 units; the camera never leaves
// the water, so the room is only ever seen through glass.
const TANK = { x: 36, y: 30, z: 36 },
  ROOM = { x: 150, z: 200, floor: -40, ceiling: 110 };
// Deterministic noise so the room and rocks look the same on every machine.
function noise(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
export function createAquarium(canvas) {
  const engine = new B.Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
  });
  const resolution = document.getElementById("resolution");
  // Multiplied into the chosen tier's scaling by the adaptive loop in main.js.
  let relief = 1;
  const resize = () => {
    engine.setHardwareScalingLevel(
      hardwareScaling(resolution.value, window.devicePixelRatio) * relief,
    );
    engine.resize();
  };
  resolution.addEventListener("change", resize);
  window.addEventListener("resize", resize);
  resize();
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0.015, 0.09, 0.11, 1);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.011;
  scene.fogColor = new B.Color3(0.02, 0.11, 0.13);
  const camera = new B.FreeCamera("follow", new B.Vector3(0, 15, -28), scene);
  camera.minZ = 0.15;
  camera.maxZ = 1200;
  camera.fov = 0.95;
  camera.setTarget(new B.Vector3(0, 12, 0));
  // Lighting: the tank's own light bar does most of the work, a desk lamp and
  // a floor lamp warm the room, and a faint blue ambient fills the rest.
  const ambient = new B.HemisphericLight(
    "ambient",
    new B.Vector3(0, 1, 0),
    scene,
  );
  ambient.intensity = 0.4;
  ambient.diffuse = new B.Color3(0.7, 0.82, 0.9);
  ambient.groundColor = new B.Color3(0.06, 0.09, 0.1);
  ambient.specular = new B.Color3(0.1, 0.1, 0.1);
  const hoodLight = new B.SpotLight(
    "hood light",
    new B.Vector3(0, TANK.y + 6, 0),
    new B.Vector3(0, -1, 0),
    1.9,
    1.5,
    scene,
  );
  hoodLight.intensity = 2.3;
  hoodLight.diffuse = new B.Color3(0.85, 0.95, 1);
  hoodLight.specular = new B.Color3(0.5, 0.6, 0.7);
  const deskLamp = new B.PointLight(
    "desk lamp",
    new B.Vector3(ROOM.x - 36, 30, 22),
    scene,
  );
  deskLamp.intensity = 1.1;
  deskLamp.range = 180;
  deskLamp.diffuse = new B.Color3(1, 0.78, 0.5);
  deskLamp.specular = new B.Color3(0.4, 0.3, 0.2);
  const floorLamp = new B.PointLight(
    "floor lamp",
    new B.Vector3(-118, 66, 150),
    scene,
  );
  floorLamp.intensity = 0.9;
  floorLamp.range = 260;
  floorLamp.diffuse = new B.Color3(1, 0.82, 0.6);
  floorLamp.specular = new B.Color3(0.3, 0.25, 0.2);
  // Only the lamps glow; fish carry emissive colour too and must not bloom.
  const glow = new B.GlowLayer("glow", scene, { blurKernelSize: 48 });
  glow.intensity = 0.55;
  const tank = buildTank(scene, glow);
  buildRoom(scene, glow);
  createEnvironmentDetails(scene, resolution);
  createSandFloor(scene, resolution, tank.floor);
  const bubbleMat = material(scene, "bubble", "#a6e6d6", 0.3);
  bubbleMat.alpha = 0.22;
  const bubbles = [];
  for (let i = 0; i < 45; i++) {
    const b = B.MeshBuilder.CreateSphere(
      "bubble",
      { diameter: 0.12 + (i % 4) * 0.07, segments: 6 },
      scene,
    );
    b.position.set(Math.sin(i * 17) * 33, i % 30, Math.cos(i * 11) * 33);
    b.material = bubbleMat;
    bubbles.push(b);
  }
  let time = 0;
  return {
    engine,
    scene,
    camera,
    glow,
    // Adaptive resolution relief, 1 being the chosen tier's own resolution.
    // Returns whether it actually changed, so the caller can log a real step.
    // Must live here, beside `relief` and `resize`: it was briefly attached to
    // the kelp builder's object instead, which has its own animate() and so
    // looked plausible, and nothing noticed until a device slow enough to call
    // it turned up.
    setRelief(value) {
      if (value === relief) return false;
      relief = value;
      resize();
      return true;
    },
    animate(dt) {
      time += dt;
      for (const b of bubbles) {
        b.position.y += dt * 0.8;
        if (b.position.y > TANK.y) b.position.y = 0;
      }
      tank.animate(time);
    },
  };
}
// Sand, lumpy rocks, swaying kelp, a black frame with a light bar, glass panes
// and the water surface.
function buildTank(scene, glow) {
  const rnd = noise(29);
  const sandMat = material(scene, "sand", "#9a8c66");
  sandMat.diffuseTexture = speckles(scene, "sand grain", "#9a8c66", [
    "#877852",
    "#ad9f79",
    "#6f6248",
  ]);
  sandMat.diffuseTexture.uScale = sandMat.diffuseTexture.vScale = 6;
  sandMat.specularColor = new B.Color3(0.05, 0.05, 0.04);
  const floor = B.MeshBuilder.CreateGround(
    "sand",
    { width: TANK.x * 2, height: TANK.z * 2, subdivisions: 1 },
    scene,
  );
  floor.material = sandMat;
  floor.freezeWorldMatrix();
  // Rocks: spheres pushed in and out by layered sines, then squashed.
  const stone = speckles(scene, "stone grain", "#8a8f88", [
    "#5e645f",
    "#a5a9a1",
    "#4b4f4a",
    "#767b74",
  ]);
  const rockMats = ["#7c8280", "#8a7a68", "#6f7f6d"].map((tint, i) => {
    const m = material(scene, `rock ${i}`, tint);
    m.diffuseTexture = stone;
    m.diffuseTexture.uScale = m.diffuseTexture.vScale = 2;
    m.specularColor = new B.Color3(0.08, 0.08, 0.08);
    return m;
  });
  const rockSpots = [];
  for (let i = 0; i < 22; i++) {
    const a = i * 2.39996 + 0.7;
    rockSpots.push([
      Math.sin(a) * (30 + rnd() * 3),
      Math.cos(a) * (30 + rnd() * 3),
    ]);
  }
  for (let i = 0; i < 9; i++)
    rockSpots.push([(rnd() - 0.5) * 50, (rnd() - 0.5) * 50]);
  // Keep the filter's corner clear of rubble.
  const clear = ([x, z]) => Math.hypot(x - FILTER.x, z - FILTER.z) > 8;
  rockSpots.filter(clear).forEach(([x, z], i) => {
    const rock = B.MeshBuilder.CreateSphere(
      "rock",
      { segments: 12, diameter: 2, updatable: true },
      scene,
    );
    const positions = rock.getVerticesData(B.VertexBuffer.PositionKind),
      normals = new Float32Array(positions.length),
      seed = rnd() * 20;
    for (let v = 0; v < positions.length; v += 3) {
      const px = positions[v],
        py = positions[v + 1],
        pz = positions[v + 2];
      const bump =
        1 +
        0.16 * Math.sin(3.1 * px + seed) +
        0.13 * Math.sin(2.6 * py + seed * 1.7 + px) +
        0.11 * Math.sin(3.6 * pz + seed * 0.6 + py);
      positions[v] = px * bump;
      positions[v + 1] = py * bump;
      positions[v + 2] = pz * bump;
    }
    B.VertexData.ComputeNormals(positions, rock.getIndices(), normals);
    rock.updateVerticesData(B.VertexBuffer.PositionKind, positions);
    rock.updateVerticesData(B.VertexBuffer.NormalKind, normals);
    const size = 0.9 + rnd() * 1.6;
    rock.scaling.set(
      size * (1 + rnd() * 0.8),
      size * (0.55 + rnd() * 0.45),
      size * (0.8 + rnd() * 0.6),
    );
    rock.position.set(x, rock.scaling.y * 0.55, z);
    rock.rotation.y = rnd() * Math.PI;
    rock.material = rockMats[i % rockMats.length];
    rock.refreshBoundingInfo();
    rock.freezeWorldMatrix();
  });
  const kelp = buildKelp(scene, rnd);
  // The Blender scenery pack settles onto the sand a moment later. Nothing
  // waits for it: the tank is finished without it, so a slow or failed load
  // costs the dressing and never the game.
  loadScenery(scene).catch((error) =>
    console.warn("Scenery could not be placed; the tank does without", error),
  );
  // Frame: four posts and two rims of slim black bars, plus the light bar.
  const frameMat = material(scene, "tank frame", "#14191b");
  frameMat.specularColor = new B.Color3(0.3, 0.3, 0.3);
  const bar = (name, size, pos, mat = frameMat) => {
    const mesh = B.MeshBuilder.CreateBox(
      name,
      { width: size[0], height: size[1], depth: size[2] },
      scene,
    );
    mesh.position.set(...pos);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  };
  const t = 1.4;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      bar("post", [t, TANK.y + t, t], [sx * TANK.x, TANK.y / 2, sz * TANK.z]);
  for (const y of [0, TANK.y])
    for (const s of [-1, 1]) {
      bar("rim", [TANK.x * 2 + t, t, t], [0, y, s * TANK.z]);
      bar("rim", [t, t, TANK.z * 2 + t], [s * TANK.x, y, 0]);
    }
  bar("light bar", [TANK.x * 2 + t, 2.2, 9], [0, TANK.y + 3.5, 0]);
  const strip = bar(
    "light strip",
    [TANK.x * 2 - 4, 0.3, 5],
    [0, TANK.y + 2.3, 0],
    material(scene, "light strip", "#eaf6ff", 1),
  );
  glow.addIncludedOnlyMesh(strip);
  // Glass: faintly tinted, mostly specular, seen from both sides.
  const glass = material(scene, "glass", "#8fc9d8", 0.05);
  glass.alpha = 0.22;
  glass.specularColor = new B.Color3(0.9, 0.95, 1);
  glass.specularPower = 96;
  glass.backFaceCulling = false;
  for (const [x, z, yaw] of [
    [0, TANK.z, 0],
    [0, -TANK.z, Math.PI],
    [TANK.x, 0, Math.PI / 2],
    [-TANK.x, 0, -Math.PI / 2],
  ]) {
    const pane = B.MeshBuilder.CreatePlane(
      "glass",
      { width: TANK.x * 2, height: TANK.y },
      scene,
    );
    pane.position.set(x, TANK.y / 2, z);
    pane.rotation.y = yaw;
    pane.material = glass;
    pane.freezeWorldMatrix();
  }
  // Water surface: a translucent sheet that ripples slowly, seen from below.
  const surfaceMat = material(scene, "water surface", "#a9dfe8", 0.25);
  surfaceMat.alpha = 0.3;
  surfaceMat.specularColor = new B.Color3(1, 1, 1);
  surfaceMat.specularPower = 48;
  surfaceMat.backFaceCulling = false;
  const surface = B.MeshBuilder.CreateGround(
    "water surface",
    {
      width: TANK.x * 2,
      height: TANK.z * 2,
      subdivisions: 24,
      updatable: true,
    },
    scene,
  );
  surface.position.y = TANK.y;
  surface.material = surfaceMat;
  const positions = surface.getVerticesData(B.VertexBuffer.PositionKind),
    indices = surface.getIndices(),
    normals = new Float32Array(positions.length);
  return {
    // Handed out so sand.js can hide it: the authored tiles stand in the same
    // place and would fight this plane for every pixel.
    floor,
    animate(time) {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i],
          z = positions[i + 2];
        positions[i + 1] =
          Math.sin(x * 0.18 + time * 0.9) * 0.18 +
          Math.sin(z * 0.23 - time * 0.7) * 0.14 +
          Math.sin((x + z) * 0.11 + time * 0.5) * 0.1;
      }
      surface.updateVerticesData(B.VertexBuffer.PositionKind, positions);
      B.VertexData.ComputeNormals(positions, indices, normals);
      surface.updateVerticesData(B.VertexBuffer.NormalKind, normals);
      kelp.animate(time);
    },
  };
}
// Kelp forests grow where shared/config.js says cover is, so hiding looks like
// hiding. Every stem and blade is merged into two meshes (two shades of green)
// whose vertices sway each frame; a fish inside is well screened.
function buildKelp(scene, rnd) {
  const shades = [
    material(scene, "kelp", "#2f7a58", 0.12),
    material(scene, "kelp light", "#5f9d4a", 0.1),
  ];
  for (const m of shades) {
    m.backFaceCulling = false;
    m.specularColor = new B.Color3(0.1, 0.15, 0.1);
  }
  const parts = [[], []],
    meta = [[], []];
  const add = (mesh, shade, height, phase, amp) => {
    const count = mesh.getTotalVertices();
    parts[shade].push(mesh);
    for (let v = 0; v < count; v++) meta[shade].push(height, phase, amp);
  };
  PLANTS.forEach((cluster, c) => {
    const stems = 8 + (c % 4) * 2;
    for (let s = 0; s < stems; s++) {
      const angle = rnd() * Math.PI * 2,
        reach = Math.sqrt(rnd()) * cluster.radius * 0.85,
        x = cluster.x + Math.cos(angle) * reach,
        z = cluster.z + Math.sin(angle) * reach,
        height = cluster.height * (0.6 + rnd() * 0.45),
        shade = (c + s) % 2,
        phase = rnd() * Math.PI * 2;
      const stem = B.MeshBuilder.CreateCylinder(
        "kelp stem",
        {
          height,
          diameterTop: 0.08,
          diameterBottom: 0.36 + rnd() * 0.2,
          tessellation: 6,
          subdivisions: 7,
          cap: B.Mesh.NO_CAP,
        },
        scene,
      );
      stem.position.set(x, height / 2, z);
      add(stem, shade, height, phase, 0.8 + rnd() * 0.6);
      if (rnd() < 0.7) {
        const bladeHeight = height * (0.55 + rnd() * 0.3);
        const blade = B.MeshBuilder.CreateGround(
          "kelp blade",
          {
            width: 0.9 + rnd() * 0.7,
            height: bladeHeight,
            subdivisionsX: 1,
            subdivisionsY: 6,
          },
          scene,
        );
        blade.rotation.set(-Math.PI / 2, rnd() * Math.PI, 0);
        blade.position.set(
          x + (rnd() - 0.5) * 0.4,
          bladeHeight / 2,
          z + (rnd() - 0.5) * 0.4,
        );
        add(blade, shade, bladeHeight, phase + 0.8, 1 + rnd() * 0.8);
      }
    }
  });
  const forests = parts.map((list, i) => {
    const merged = B.Mesh.MergeMeshes(list, true, true);
    merged.name = `kelp forest ${i}`;
    merged.material = shades[i];
    const rest = merged.getVerticesData(B.VertexBuffer.PositionKind);
    merged.setVerticesData(B.VertexBuffer.PositionKind, rest.slice(), true);
    merged.alwaysSelectAsActiveMesh = true;
    return {
      merged,
      rest,
      live: rest.slice(),
      meta: Float32Array.from(meta[i]),
    };
  });
  return {
    animate(time) {
      for (const { merged, rest, live, meta } of forests) {
        for (let v = 0, m = 0; v < rest.length; v += 3, m += 3) {
          const height = meta[m],
            phase = meta[m + 1],
            amp = meta[m + 2],
            t = Math.min(1, Math.max(0, rest[v + 1] / height)),
            w = t * t * amp;
          live[v] = rest[v] + Math.sin(time * 0.9 + phase + t * 2.2) * w;
          live[v + 2] =
            rest[v + 2] +
            Math.cos(time * 0.7 + phase * 1.3 + t * 1.7) * w * 0.7;
        }
        merged.updateVerticesData(B.VertexBuffer.PositionKind, live);
      }
    },
  };
}
// The evening office around the tank. Its materials ignore the water fog so
// the room reads as air beyond the glass; the glass itself keeps a little haze.
function buildRoom(scene, glow) {
  const solid = (name, color, emissive = 0) => {
    const m = material(scene, name, color, emissive);
    m.fogEnabled = false;
    m.specularColor = new B.Color3(0.04, 0.04, 0.04);
    return m;
  };
  const box = (name, size, pos, mat, rot) => {
    const mesh = B.MeshBuilder.CreateBox(
      name,
      { width: size[0], height: size[1], depth: size[2] },
      scene,
    );
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  };
  const cylinder = (name, diameter, height, pos, mat, top = diameter, rot) => {
    const mesh = B.MeshBuilder.CreateCylinder(
      name,
      { diameter, diameterTop: top, height, tessellation: 20 },
      scene,
    );
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  };
  const ball = (name, diameter, pos, mat) => {
    const mesh = B.MeshBuilder.CreateSphere(
      name,
      { diameter, segments: 12 },
      scene,
    );
    mesh.position.set(...pos);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  };
  const { floor, ceiling } = ROOM,
    height = ceiling - floor,
    midY = floor + height / 2,
    rnd = noise(11);
  // Shell
  const planksMat = solid("planks", "#6e5236");
  planksMat.diffuseTexture = planks(scene, "plank grain");
  planksMat.diffuseTexture.uScale = 6;
  planksMat.diffuseTexture.vScale = 8;
  planksMat.specularColor = new B.Color3(0.12, 0.1, 0.08);
  const roomFloor = B.MeshBuilder.CreateGround(
    "room floor",
    { width: ROOM.x * 2, height: ROOM.z * 2 },
    scene,
  );
  roomFloor.position.y = floor;
  roomFloor.material = planksMat;
  roomFloor.freezeWorldMatrix();
  const wall = solid("wall", "#a39d90"),
    trim = solid("trim", "#c9c4b8"),
    dark = solid("matte black", "#1b1e22"),
    walnut = solid("walnut", "#4a3526"),
    brass = solid("brass", "#c9a45c", 0.15);
  box("back wall", [ROOM.x * 2, height, 2], [0, midY, ROOM.z + 1], wall);
  box("front wall", [ROOM.x * 2, height, 2], [0, midY, -ROOM.z - 1], wall);
  box("left wall", [2, height, ROOM.z * 2], [-ROOM.x - 1, midY, 0], wall);
  box("right wall", [2, height, ROOM.z * 2], [ROOM.x + 1, midY, 0], wall);
  box(
    "ceiling",
    [ROOM.x * 2, 2, ROOM.z * 2],
    [0, ceiling + 1, 0],
    solid("ceiling", "#8c8a84"),
  );
  for (const [size, pos] of [
    [
      [ROOM.x * 2, 4, 3],
      [0, floor + 2, ROOM.z - 1.5],
    ],
    [
      [ROOM.x * 2, 4, 3],
      [0, floor + 2, -ROOM.z + 1.5],
    ],
    [
      [3, 4, ROOM.z * 2],
      [-ROOM.x + 1.5, floor + 2, 0],
    ],
    [
      [3, 4, ROOM.z * 2],
      [ROOM.x - 1.5, floor + 2, 0],
    ],
  ])
    box("skirting", size, pos, trim);
  // Dusk window with blinds on the back wall, behind the tank in the default view.
  box(
    "dusk sky",
    [120, 46, 1],
    [20, 52, ROOM.z - 1],
    solid("dusk sky", "#1c2c52", 0.6),
  );
  box(
    "dusk horizon",
    [120, 14, 1],
    [20, 22, ROOM.z - 1],
    solid("dusk horizon", "#c9743a", 0.55),
  );
  const cityLight = solid("city light", "#ffe9b0", 0.9);
  for (let i = 0; i < 14; i++)
    box(
      "city light",
      [1.6, 1.2, 0.5],
      [-34 + rnd() * 108, 26 + rnd() * 9, ROOM.z - 1.6],
      cityLight,
    );
  box("window sill", [128, 3, 6], [20, 14, ROOM.z - 3], trim);
  box("window head", [128, 3, 3], [20, 76, ROOM.z - 2], trim);
  box("window jamb", [3, 64, 3], [-42, 45, ROOM.z - 2], trim);
  box("window jamb", [3, 64, 3], [82, 45, ROOM.z - 2], trim);
  box("blind rail", [122, 2.5, 3], [20, 74, ROOM.z - 4], trim);
  const slat = solid("blind slat", "#d8d3c8");
  for (let i = 0; i < 9; i++)
    box(
      "blind slat",
      [118, 0.6, 2.6],
      [20, 71 - i * 5.8, ROOM.z - 4],
      slat,
      [0.55, 0, 0],
    );
  // Door and coat stand on the front wall
  box("door frame", [46, 88, 1], [-70, floor + 44, -ROOM.z + 0.4], trim);
  box(
    "door",
    [40, 84, 2],
    [-70, floor + 42, -ROOM.z + 1],
    solid("door", "#5a3f2c"),
  );
  box(
    "door panel",
    [30, 34, 0.6],
    [-70, floor + 60, -ROOM.z + 2.2],
    solid("door panel", "#4e3626"),
  );
  box(
    "door panel",
    [30, 30, 0.6],
    [-70, floor + 22, -ROOM.z + 2.2],
    solid("door panel", "#4e3626"),
  );
  ball("door knob", 3, [-54, floor + 42, -ROOM.z + 2.8], brass);
  cylinder("coat stand", 2.4, 96, [-30, floor + 48, -ROOM.z + 12], dark);
  cylinder("coat stand base", 22, 1.4, [-30, floor + 0.7, -ROOM.z + 12], dark);
  for (const a of [0, 1.6, 3.1, 4.7])
    box(
      "coat hook",
      [1.2, 1.2, 9],
      [-30 + Math.sin(a) * 4.5, floor + 92, -ROOM.z + 12 + Math.cos(a) * 4.5],
      dark,
      [0, a, 0],
    );
  box(
    "coat",
    [10, 40, 16],
    [-24, floor + 68, -ROOM.z + 16],
    solid("coat", "#2b3a5c"),
  );
  // Cabinet the tank stands on; its top stays just below the sand plane.
  box("cabinet", [78, -floor - 1.3, 78], [0, (floor - 1.3) / 2, 0], walnut);
  box(
    "cabinet top",
    [80, 1.2, 80],
    [0, -0.7, 0],
    solid("cabinet top", "#2f221a"),
  );
  for (const x of [-26, 0, 26])
    box("cabinet handle", [6, 1, 1.5], [x, -22, -39.5], brass);
  // Desk against the right wall: monitor, keyboard, papers, mug, pens, lamp.
  const desk = solid("desk", "#8a6a48");
  box("desk top", [50, 3, 100], [ROOM.x - 28, -4, 60], desk);
  for (const [x, z] of [
    [-22, -47],
    [-22, 47],
    [22, -47],
    [22, 47],
  ])
    box("desk leg", [3, 34, 3], [ROOM.x - 28 + x, -22, 60 + z], walnut);
  box("monitor", [2, 26, 44], [ROOM.x - 12, 14, 60], dark);
  const screen = box(
    "screen",
    [0.6, 22, 40],
    [ROOM.x - 13.4, 14, 60],
    solid("screen", "#6fa9c9", 0.6),
  );
  glow.addIncludedOnlyMesh(screen);
  box("monitor stand", [6, 8, 8], [ROOM.x - 12, -2, 60], dark);
  box("keyboard", [12, 1.2, 32], [ROOM.x - 32, -1.9, 60], dark);
  box("keys", [10, 0.5, 30], [ROOM.x - 32, -1.1, 60], solid("keys", "#3a3f45"));
  box("mouse", [5, 1.6, 3], [ROOM.x - 32, -1.7, 82], dark);
  for (let i = 0; i < 3; i++)
    box(
      "papers",
      [22, 0.3, 30],
      [ROOM.x - 30 + i * 1.5, -2.35 + i * 0.3, 18 + i * 2],
      solid("paper", "#efeadf"),
      [0, 0.1 * i - 0.1, 0],
    );
  cylinder("mug", 6, 8, [ROOM.x - 40, 1.5, 92], solid("mug", "#c8563a"));
  cylinder("pen cup", 5, 7, [ROOM.x - 16, 1, 30], solid("pen cup", "#2b6a8f"));
  for (const [dx, col] of [
    [-1, "#e0b13a"],
    [0.8, "#3b73c4"],
    [0, "#c94c4c"],
  ])
    cylinder(
      "pen",
      0.7,
      12,
      [ROOM.x - 16 + dx, 6, 30 + dx * 0.6],
      solid("pen", col),
      0.7,
      [0.15 * dx, 0, 0.12],
    );
  cylinder("lamp base", 10, 1.5, [ROOM.x - 36, -1.75, 22], dark);
  cylinder("lamp arm", 1.2, 30, [ROOM.x - 36, 13, 22], dark);
  const shade = cylinder(
    "lamp shade",
    14,
    9,
    [ROOM.x - 36, 31, 22],
    solid("lamp glow", "#ffd9a0", 0.9),
    7,
  );
  glow.addIncludedOnlyMesh(shade);
  box("chair seat", [30, 3, 30], [ROOM.x - 62, -14, 60], dark);
  box("chair back", [3, 30, 30], [ROOM.x - 76, 2, 60], dark);
  cylinder("chair post", 3, 20, [ROOM.x - 62, -26, 60], dark);
  cylinder("chair foot", 26, 1.5, [ROOM.x - 62, floor + 0.75, 60], dark);
  box(
    "rug border",
    [100, 0.5, 140],
    [ROOM.x - 60, floor + 0.25, 60],
    solid("rug border", "#4a2a2e"),
  );
  box(
    "rug",
    [92, 0.6, 132],
    [ROOM.x - 60, floor + 0.3, 60],
    solid("rug", "#7a3b3b"),
  );
  // Bookcase on the left wall
  const shelfMat = solid("shelf", "#3b2a1e"),
    spines = [
      "#b5473b",
      "#2f6f9a",
      "#e2b04a",
      "#4c8a5f",
      "#6d4c8f",
      "#d97a3a",
      "#f0e6d2",
      "#28323a",
    ].map((c) => solid("book", c));
  box("bookcase back", [2, 110, 80], [-ROOM.x + 1, 15, -60], shelfMat);
  box("bookcase side", [22, 110, 2], [-ROOM.x + 11, 15, -100], shelfMat);
  box("bookcase side", [22, 110, 2], [-ROOM.x + 11, 15, -20], shelfMat);
  box("bookcase top", [22, 2, 80], [-ROOM.x + 11, 70, -60], shelfMat);
  for (let s = 0; s < 5; s++) {
    const y = floor + 4 + s * 26;
    box("shelf", [22, 2, 80], [-ROOM.x + 11, y, -60], shelfMat);
    let z = -98;
    while (z < -24) {
      const w = 3 + rnd() * 3,
        h = 14 + rnd() * 6;
      box(
        "book",
        [16, h, w],
        [-ROOM.x + 12, y + 1 + h / 2, z + w / 2],
        spines[Math.floor(rnd() * spines.length)],
      );
      z += w + 0.4;
      if (rnd() < 0.12) z += 6;
    }
  }
  // Floor lamp and potted plant in the back-left corner
  cylinder("floor lamp pole", 2, 100, [-118, floor + 50, 150], dark);
  cylinder("floor lamp foot", 24, 1.5, [-118, floor + 0.75, 150], dark);
  const floorShade = cylinder(
    "floor lamp shade",
    26,
    18,
    [-118, 66, 150],
    solid("floor lamp glow", "#ffd9a0", 0.85),
    20,
  );
  glow.addIncludedOnlyMesh(floorShade);
  cylinder(
    "pot",
    14,
    20,
    [-125, floor + 10, 105],
    solid("terracotta", "#8f4a32"),
    18,
  );
  const leaf = solid("leaf", "#2f6b40", 0.08);
  for (const [dx, dy, dz, d] of [
    [0, 30, 0, 24],
    [8, 22, 6, 16],
    [-9, 24, -4, 18],
    [3, 38, -7, 14],
    [-4, 36, 8, 12],
  ])
    ball("foliage", d, [-125 + dx, floor + dy, 105 + dz], leaf);
  // Wall clock over the door, pictures and a poster on the right wall
  cylinder(
    "clock face",
    24,
    1.5,
    [10, 70, -ROOM.z + 1.6],
    solid("clock face", "#e9e6df", 0.1),
    24,
    [Math.PI / 2, 0, 0],
  );
  cylinder("clock rim", 26, 1.2, [10, 70, -ROOM.z + 1.2], dark, 26, [
    Math.PI / 2,
    0,
    0,
  ]);
  box("clock hand", [1, 8, 0.6], [10, 74, -ROOM.z + 2.6], dark);
  box("clock hand", [1, 10, 0.6], [14, 68, -ROOM.z + 2.6], dark, [0, 0, 1.1]);
  const unlit = solid("ceiling light off", "#55534f");
  box("light panel", [40, 1, 80], [0, ceiling - 0.5, -90], unlit);
  box("light panel", [40, 1, 80], [0, ceiling - 0.5, 90], unlit);
  box("poster frame", [1, 54, 40], [ROOM.x - 0.5, 45, -80], dark);
  box(
    "poster",
    [1, 50, 36],
    [ROOM.x - 1.2, 45, -80],
    solid("poster", "#d9b45c"),
  );
  box(
    "poster print",
    [0.4, 30, 22],
    [ROOM.x - 1.9, 47, -80],
    solid("poster print", "#2a6f97"),
  );
  for (const [z, col] of [
    [-20, "#5b7f9a"],
    [10, "#8a6b4f"],
  ]) {
    box("picture frame", [1, 26, 32], [ROOM.x - 0.5, 60, z], dark);
    box("picture", [0.6, 22, 28], [ROOM.x - 1.2, 60, z], solid("picture", col));
  }
}
// Procedural textures: tiny canvases, tiled by uScale/vScale.
function speckles(scene, name, base, tones) {
  const size = 256,
    texture = new B.DynamicTexture(name, size, scene, true),
    ctx = texture.getContext(),
    rnd = noise(3);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few larger soft blotches so surfaces read as mottled, not just grainy.
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 8 + rnd() * 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  texture.update();
  return texture;
}
function planks(scene, name) {
  const size = 512,
    texture = new B.DynamicTexture(name, size, scene, true),
    ctx = texture.getContext(),
    rnd = noise(5),
    plank = 64;
  for (let i = 0; i < size / plank; i++) {
    ctx.fillStyle = i % 2 ? "#7a5d40" : "#6e5236";
    ctx.fillRect(i * plank, 0, plank, size);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#3f2c1a";
    ctx.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const x = i * plank + 6 + g * 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 5, size / 3, x - 5, (size * 2) / 3, x, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#3f2c1a";
    ctx.fillRect(i * plank, 0, 2, size);
    ctx.fillRect(i * plank, Math.floor(rnd() * size), plank, 2);
  }
  texture.update();
  return texture;
}
