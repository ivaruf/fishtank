const B = window.BABYLON;
function softDot(scene, name) {
  const texture = new B.DynamicTexture(name, 32, scene, false);
  const ctx = texture.getContext(),
    glow = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  glow.addColorStop(0, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.55, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 32, 32);
  texture.update();
  texture.hasAlpha = true;
  return texture;
}
// One shared particle system; every bite emits a short burst of rising bubbles.
export function createPuffs(scene) {
  const puffs = new B.ParticleSystem("puffs", 600, scene);
  puffs.particleTexture = softDot(scene, "puff");
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
// A steady trickle of bubbles from the filter outlet.
export function createStream(scene, position) {
  const stream = new B.ParticleSystem("stream", 120, scene);
  stream.particleTexture = softDot(scene, "stream bubble");
  stream.emitter = position.clone();
  stream.minEmitBox = new B.Vector3(-0.3, 0, -0.3);
  stream.maxEmitBox = new B.Vector3(0.3, 0, 0.3);
  stream.direction1 = new B.Vector3(-0.3, 1, -0.3);
  stream.direction2 = new B.Vector3(0.3, 1.6, 0.3);
  stream.minEmitPower = 0.6;
  stream.maxEmitPower = 1.2;
  stream.gravity = new B.Vector3(0, 1, 0);
  stream.minLifeTime = 1.2;
  stream.maxLifeTime = 2.4;
  stream.minSize = 0.12;
  stream.maxSize = 0.3;
  stream.color1 = new B.Color4(0.8, 0.97, 0.92, 0.55);
  stream.color2 = new B.Color4(0.9, 1, 0.97, 0.4);
  stream.colorDead = new B.Color4(0.7, 0.9, 0.9, 0);
  stream.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  stream.applyFog = true;
  stream.emitRate = 7;
  stream.start();
  return stream;
}
// Electric sparks that crackle off a stunned fish.
export function createSparks(scene) {
  const sparks = new B.ParticleSystem("sparks", 400, scene);
  sparks.particleTexture = softDot(scene, "spark");
  sparks.emitter = B.Vector3.Zero();
  sparks.minEmitBox = new B.Vector3(-0.4, -0.3, -0.4);
  sparks.maxEmitBox = new B.Vector3(0.4, 0.3, 0.4);
  sparks.direction1 = new B.Vector3(-1, -1, -1);
  sparks.direction2 = new B.Vector3(1, 1, 1);
  sparks.minEmitPower = 2;
  sparks.maxEmitPower = 5;
  sparks.minLifeTime = 0.08;
  sparks.maxLifeTime = 0.25;
  sparks.minSize = 0.08;
  sparks.maxSize = 0.2;
  sparks.color1 = new B.Color4(0.8, 0.98, 1, 1);
  sparks.color2 = new B.Color4(1, 0.95, 0.6, 1);
  sparks.colorDead = new B.Color4(0.6, 0.9, 1, 0);
  sparks.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  sparks.emitRate = 0;
  sparks.manualEmitCount = 0;
  sparks.start();
  return {
    burst(position, count = 3, size = 1) {
      sparks.emitter.copyFrom(position);
      sparks.minSize = 0.08 * size;
      sparks.maxSize = 0.2 * size;
      sparks.manualEmitCount = Math.max(0, sparks.manualEmitCount) + count;
    },
  };
}
