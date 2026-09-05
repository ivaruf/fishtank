import { material } from "./fish.js";
import { hardwareScaling } from "./rendering.js";
const B = window.BABYLON;
export function createAquarium(canvas) {
  const engine = new B.Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
  });
  const resolution = document.getElementById("resolution");
  const resize = () => {
    engine.setHardwareScalingLevel(
      hardwareScaling(resolution.value, window.devicePixelRatio),
    );
    engine.resize();
  };
  resolution.addEventListener("change", resize);
  window.addEventListener("resize", resize);
  resize();
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0.025, 0.16, 0.19, 1);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.014;
  scene.fogColor = new B.Color3(0.035, 0.23, 0.25);
  const camera = new B.FreeCamera("follow", new B.Vector3(0, 15, -28), scene);
  camera.minZ = 0.15;
  camera.fov = 0.95;
  camera.setTarget(new B.Vector3(0, 12, 0));
  const light = new B.HemisphericLight(
    "waterlight",
    new B.Vector3(0, 1, 0),
    scene,
  );
  light.intensity = 1.3;
  light.groundColor = new B.Color3(0.12, 0.25, 0.25);
  const sun = new B.DirectionalLight(
    "sun",
    new B.Vector3(-0.3, -1, 0.4),
    scene,
  );
  sun.intensity = 1.5;
  const sand = material(scene, "sand", "#79978a"),
    rock = material(scene, "rock", "#466b67"),
    plant = material(scene, "kelp", "#479f81", 0.1);
  const floor = B.MeshBuilder.CreateGround(
    "sand",
    { width: 72, height: 72, subdivisions: 1 },
    scene,
  );
  floor.material = sand;
  const grid = [];
  for (let i = -36; i <= 36; i += 6) {
    grid.push([new B.Vector3(i, 0.03, -36), new B.Vector3(i, 0.03, 36)]);
    grid.push([new B.Vector3(-36, 0.03, i), new B.Vector3(36, 0.03, i)]);
  }
  const lines = B.MeshBuilder.CreateLineSystem(
    "floor grid",
    { lines: grid },
    scene,
  );
  lines.color = new B.Color3(0.37, 0.55, 0.49);
  lines.alpha = 0.28;
  const edges = [];
  for (const x of [-36, 36])
    for (const z of [-36, 36])
      edges.push([new B.Vector3(x, 0, z), new B.Vector3(x, 30, z)]);
  for (const y of [0, 30])
    edges.push([
      new B.Vector3(-36, y, -36),
      new B.Vector3(36, y, -36),
      new B.Vector3(36, y, 36),
      new B.Vector3(-36, y, 36),
      new B.Vector3(-36, y, -36),
    ]);
  const frame = B.MeshBuilder.CreateLineSystem(
    "tank frame",
    { lines: edges },
    scene,
  );
  frame.color = new B.Color3(0.43, 0.76, 0.7);
  frame.alpha = 0.5;
  for (let i = 0; i < 36; i++) {
    const x = Math.sin(i * 2.39996) * 32,
      z = Math.cos(i * 1.618) * 32;
    const mesh = B.MeshBuilder.CreateSphere(
      "stone",
      { segments: 7, diameter: 2 },
      scene,
    );
    mesh.position.set(x, 0.45, z);
    mesh.scaling.set(1 + (i % 3), 0.7 + (i % 2), 1.3);
    mesh.material = rock;
    for (let j = 0; j < 3; j++) {
      const h = 2 + ((i + j) % 6);
      const stem = B.MeshBuilder.CreateCylinder(
        "plant",
        { height: h, diameterTop: 0.07, diameterBottom: 0.28, tessellation: 5 },
        scene,
      );
      stem.position.set(x + j * 0.6, h / 2, z + 1);
      stem.rotation.z = Math.sin(i + j) * 0.2;
      stem.material = plant;
    }
  }
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
  return {
    engine,
    scene,
    camera,
    animate(dt) {
      for (const b of bubbles) {
        b.position.y += dt * 0.8;
        if (b.position.y > 30) b.position.y = 0;
      }
    },
  };
}
