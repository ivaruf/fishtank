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
  m.diffuseColor = B.Color3.FromHexString(color);
  m.specularColor = new B.Color3(0.15, 0.2, 0.17);
  m.emissiveColor = m.diffuseColor.scale(emissive);
  return m;
}
export function createFish(scene, color, npc = false) {
  const root = new B.TransformNode("fish", scene),
    skin = material(scene, "skin", palette[color % palette.length], 0.12);
  function sphere(name, scale, pos, mat) {
    const mesh = B.MeshBuilder.CreateSphere(
      name,
      { segments: 8, diameter: 2 },
      scene,
    );
    mesh.scaling.set(...scale);
    mesh.position.set(...pos);
    mesh.parent = root;
    mesh.material = mat;
    return mesh;
  }
  sphere("body", [0.58, 0.75, 1.25], [0, 0, 0], skin);
  const tail = sphere("tail", [0.12, 0.65, 0.5], [0, 0, -1.35], skin);
  tail.rotation.x = 0.25;
  sphere("dorsal", [0.07, 0.5, 0.55], [0, 0.55, -0.15], skin);
  for (const side of [-1, 1]) {
    const fin = sphere(
      "fin",
      [0.5, 0.07, 0.32],
      [side * 0.52, -0.2, -0.15],
      skin,
    );
    fin.rotation.z = side * 0.3;
  }
  const white = material(scene, "eyes", "#fff5d9", 0.25),
    black = material(scene, "pupils", "#102b30");
  for (const side of [-1, 1]) {
    sphere("eye", [0.2, 0.23, 0.23], [side * 0.45, 0.22, 0.72], white);
    sphere("pupil", [0.11, 0.14, 0.13], [side * 0.57, 0.23, 0.84], black);
  }
  if (!npc) {
    const fin = sphere(
      "player crest",
      [0.09, 0.24, 0.23],
      [0, 0.9, 0.15],
      material(scene, "crest", "#e4ffc3", 0.7),
    );
    fin.rotation.x = 0.3;
  }
  return {
    root,
    tail,
    dispose() {
      const meshes = root.getChildMeshes();
      const materials = new Set(meshes.map((m) => m.material));
      meshes.forEach((m) => m.dispose());
      root.dispose();
      materials.forEach((m) => m?.dispose());
    },
  };
}
