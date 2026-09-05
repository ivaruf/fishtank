import { material } from "./fish.js";
import { FILTER } from "../../shared/config.js";
const B = window.BABYLON;
// The faulty filter in the back-left corner: a tall plastic canister with an
// intake tube, an outlet that burbles, a status lamp and one big red button.
// Dark for the first minute, then it hums, sparks and can be pressed.
export function createFilter(scene, glow, sparks) {
  const plastic = material(scene, "filter plastic", "#2c3236"),
    darker = material(scene, "filter trim", "#191d20"),
    red = material(scene, "filter button", "#c8322e", 0.25);
  plastic.specularColor = new B.Color3(0.35, 0.35, 0.35);
  red.specularColor = new B.Color3(0.6, 0.4, 0.4);
  const x = FILTER.x,
    z = FILTER.z;
  const place = (mesh, px, py, pz, mat) => {
    mesh.position.set(px, py, pz);
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  };
  place(
    B.MeshBuilder.CreateBox(
      "filter body",
      { width: 5, height: 24, depth: 4 },
      scene,
    ),
    x,
    12,
    z,
    plastic,
  );
  place(
    B.MeshBuilder.CreateBox(
      "filter lid",
      { width: 5.6, height: 1.2, depth: 4.6 },
      scene,
    ),
    x,
    24.6,
    z,
    darker,
  );
  place(
    B.MeshBuilder.CreateBox(
      "filter foot",
      { width: 5.6, height: 0.8, depth: 4.6 },
      scene,
    ),
    x,
    0.4,
    z,
    darker,
  );
  for (let i = 0; i < 7; i++)
    place(
      B.MeshBuilder.CreateBox(
        "filter vent",
        { width: 3.6, height: 0.35, depth: 0.3 },
        scene,
      ),
      x,
      9 + i * 1.6,
      z - 2.1,
      darker,
    );
  place(
    B.MeshBuilder.CreateCylinder(
      "filter intake",
      { diameter: 1.3, height: 20, tessellation: 12 },
      scene,
    ),
    x + 3.4,
    10,
    z - 0.6,
    plastic,
  );
  for (let i = 0; i < 5; i++)
    place(
      B.MeshBuilder.CreateTorus(
        "filter slot",
        { diameter: 1.4, thickness: 0.12, tessellation: 12 },
        scene,
      ),
      x + 3.4,
      2 + i * 1.2,
      z - 0.6,
      darker,
    );
  const outlet = B.MeshBuilder.CreateTube(
    "filter outlet",
    {
      path: [
        new B.Vector3(x, 23.5, z - 2),
        new B.Vector3(x, 26, z - 3.5),
        new B.Vector3(x + 1.5, 26.5, z - 5),
      ],
      radius: 0.55,
      tessellation: 10,
    },
    scene,
  );
  outlet.material = plastic;
  outlet.freezeWorldMatrix();
  const lampMat = material(scene, "filter lamp", "#233", 0);
  const lamp = place(
    B.MeshBuilder.CreateSphere(
      "filter lamp",
      { diameter: 1, segments: 10 },
      scene,
    ),
    x - 1.4,
    21,
    z - 2.3,
    lampMat,
  );
  glow?.addIncludedOnlyMesh(lamp);
  const button = B.MeshBuilder.CreateSphere(
    "filter button",
    { diameter: FILTER.buttonRadius * 1.3, segments: 12 },
    scene,
  );
  button.scaling.z = 0.55;
  place(button, FILTER.button.x, FILTER.button.y, FILTER.button.z, red);
  place(
    B.MeshBuilder.CreateCylinder(
      "filter button rim",
      { diameter: FILTER.buttonRadius * 1.6, height: 0.5, tessellation: 20 },
      scene,
    ),
    FILTER.button.x,
    FILTER.button.y,
    z - 1.9,
    darker,
  ).rotation.x = Math.PI / 2;
  const spout = new B.Vector3(x + 1.5, 26.5, z - 5),
    top = new B.Vector3(x, 25, z - 2);
  let bolt = null,
    boltLife = 0,
    boltTarget = null,
    flash = 0,
    time = 0,
    crackle = 0;
  function jag() {
    const points = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14,
        p = B.Vector3.Lerp(top, boltTarget, t),
        wobble = Math.sin(t * Math.PI) * 1.6;
      points.push(
        p.add(
          new B.Vector3(
            (Math.random() - 0.5) * wobble,
            (Math.random() - 0.5) * wobble,
            (Math.random() - 0.5) * wobble,
          ),
        ),
      );
    }
    return points;
  }
  return {
    // Where the burbles come from, for the bubble stream.
    spout,
    zap(target) {
      boltTarget = target.clone();
      boltLife = 0.55;
      flash = 1;
      bolt?.dispose();
      bolt = B.MeshBuilder.CreateLines(
        "bolt",
        { points: jag(), updatable: true },
        scene,
      );
      bolt.color = new B.Color3(0.75, 0.95, 1);
      bolt.isPickable = false;
      sparks?.burst(top, 40, 1.6);
    },
    update(state, dt) {
      time += dt;
      const armed = !!state?.armed,
        cooling = (state?.cooldown ?? 0) > 0,
        pulse = 0.5 + 0.5 * Math.sin(time * 5);
      // Lamp: off before arming, red while recharging, green when live.
      if (!armed) lampMat.emissiveColor.set(0.05, 0.08, 0.08);
      else if (cooling)
        lampMat.emissiveColor
          .set(0.9, 0.15, 0.1)
          .scaleInPlace(0.5 + 0.5 * pulse);
      else
        lampMat.emissiveColor
          .set(0.35, 1, 0.5)
          .scaleInPlace(0.8 + 0.2 * pulse + flash);
      red.emissiveColor
        .set(0.5, 0.08, 0.06)
        .scaleInPlace(armed && !cooling ? 0.5 + 0.5 * pulse : 0.25);
      // A live filter crackles now and then; a fresh zap flashes hard.
      flash = Math.max(0, flash - dt * 2.5);
      if (armed && !cooling) {
        crackle -= dt;
        if (crackle <= 0) {
          crackle = 0.6 + Math.random() * 1.2;
          sparks?.burst(
            top.add(
              new B.Vector3(
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 6,
                0,
              ),
            ),
            6,
            0.9,
          );
        }
      }
      if (bolt) {
        boltLife -= dt;
        if (boltLife <= 0) {
          bolt.dispose();
          bolt = null;
        } else
          bolt = B.MeshBuilder.CreateLines("bolt", {
            points: jag(),
            instance: bolt,
          });
      }
    },
  };
}
