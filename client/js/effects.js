const B = window.BABYLON;
// One shared particle system; every bite emits a short burst of rising bubbles.
export function createPuffs(scene) {
  const texture = new B.DynamicTexture("puff", 32, scene, false);
  const ctx = texture.getContext(),
    glow = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  glow.addColorStop(0, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.55, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 32, 32);
  texture.update();
  texture.hasAlpha = true;
  const puffs = new B.ParticleSystem("puffs", 600, scene);
  puffs.particleTexture = texture;
  puffs.emitter = B.Vector3.Zero();
  puffs.minEmitBox = B.Vector3.Zero();
  puffs.maxEmitBox = B.Vector3.Zero();
  puffs.direction1 = new B.Vector3(-1, 0.4, -1);
  puffs.direction2 = new B.Vector3(1, 1.6, 1);
  puffs.minEmitPower = 0.5;
  puffs.maxEmitPower = 1.6;
  puffs.gravity = new B.Vector3(0, 1.4, 0);
  puffs.minLifeTime = 0.4;
  puffs.maxLifeTime = 0.9;
  puffs.color1 = new B.Color4(0.8, 0.97, 0.92, 0.75);
  puffs.color2 = new B.Color4(0.95, 1, 0.97, 0.55);
  puffs.colorDead = new B.Color4(0.7, 0.9, 0.9, 0);
  puffs.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  puffs.applyFog = true;
  puffs.emitRate = 0;
  puffs.manualEmitCount = 0;
  puffs.start();
  return {
    burst(position, size = 1) {
      // Even a minnow's bite should read from the camera's usual distance.
      const s = Math.min(3, Math.max(0.9, size));
      puffs.emitter.copyFrom(position);
      puffs.minSize = 0.12 * s;
      puffs.maxSize = 0.4 * s;
      puffs.manualEmitCount = Math.round(8 + 6 * s);
    },
  };
}
