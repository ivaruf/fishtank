import test from "node:test";
import assert from "node:assert/strict";
// A tiny AudioContext stand-in: enough to see what the module schedules.
class Param {
  constructor(value) {
    this.value = value;
    this.ramps = [];
  }
  setValueAtTime(v) {
    this.value = v;
  }
  linearRampToValueAtTime(v, t) {
    this.ramps.push([v, t]);
    this.value = v;
  }
  setTargetAtTime(v) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class Node {
  constructor() {
    this.gain = new Param(1);
    this.connections = [];
  }
  connect(target) {
    this.connections.push(target);
  }
}
class Source extends Node {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.loop = false;
  }
  start(when = 0, offset = 0) {
    this.ctx.started.push({ source: this, when, offset });
  }
  stop(when) {
    this.stopAt = when;
  }
}
class FakeContext {
  constructor() {
    this.currentTime = 10;
    this.state = "running";
    this.destination = new Node();
    this.started = [];
  }
  createGain() {
    return new Node();
  }
  createBufferSource() {
    return new Source(this);
  }
  async decodeAudioData(bytes) {
    // The "file" is a JSON description of a buffer: length, rate, priming.
    const spec = JSON.parse(Buffer.from(bytes).toString());
    const data = new Float32Array(spec.length);
    for (let i = spec.priming ?? 0; i < spec.length; i++) data[i] = 0.5;
    return {
      length: spec.length,
      sampleRate: spec.rate,
      duration: spec.length / spec.rate,
      getChannelData: () => data,
    };
  }
}
const files = {
  "music-menu": { length: 48000 * 32 + 1024, rate: 48000, priming: 1024 },
  "music-game": { length: 48000 * 38.4, rate: 48000 },
  chomp: { length: 4800, rate: 48000 },
  nearby: { length: 2400, rate: 48000 },
};
let contexts = [];
const storage = new Map();
globalThis.window = {
  AudioContext: class extends FakeContext {
    constructor() {
      super();
      contexts.push(this);
    }
  },
};
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
};
globalThis.fetch = async (url) => {
  const name = url.match(/\/([\w-]+)\.m4a$/)[1];
  if (!files[name]) return { ok: false, status: 404 };
  return {
    ok: true,
    arrayBuffer: async () => Buffer.from(JSON.stringify(files[name])),
  };
};
const { createAudio } = await import("../client/js/audio.js");
const settle = () => new Promise((r) => setTimeout(r, 5));

test("music waits for a gesture, loops around decoder priming, and crossfades", async () => {
  const audio = createAudio();
  audio.music("menu");
  assert.equal(contexts.length, 0, "no context before a gesture");
  audio.unlock();
  assert.equal(contexts.length, 1);
  await settle();
  const ctx = contexts[0];
  assert.equal(ctx.started.length, 1);
  const { source, offset } = ctx.started[0];
  assert.equal(source.loop, true);
  // 1024 leading zero samples are skipped so the loop stays seamless.
  assert.ok(Math.abs(offset - 1024 / 48000) < 1e-9);
  assert.ok(Math.abs(source.loopEnd - source.loopStart - 32) < 1e-9);
  audio.music("game");
  await settle();
  assert.equal(ctx.started.length, 2);
  assert.equal(source.stopAt, ctx.currentTime + 1.25, "old track fades out");
  assert.equal(ctx.started[1].source.loopEnd, 38.4);
  audio.music("game");
  await settle();
  assert.equal(ctx.started.length, 2, "same track is not restarted");
  audio.unlock();
  assert.equal(contexts.length, 1, "unlock is idempotent");
});
test("effects fall off with distance, honour mute, and mute is remembered", async () => {
  contexts = [];
  const audio = createAudio();
  audio.unlock();
  const ctx = contexts[0];
  await audio.play("chomp");
  await audio.play("nearby", { distance: 20, range: 40 });
  await audio.play("nearby", { distance: 45, range: 40 });
  await audio.play("missing");
  const gains = ctx.started
    .filter((s) => s.source.buffer.length < 48000)
    .map((s) => s.source.connections[0].gain.value);
  assert.deepEqual(gains, [1, 0.25]);
  audio.setMuted(true);
  await audio.play("chomp");
  assert.equal(gains.length, 2, "muted effects are skipped");
  assert.equal(storage.get("fishtank.muted"), "1");
  assert.equal(createAudio().muted, true, "mute survives a reload");
});
