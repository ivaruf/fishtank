import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "../server.js";
import { SPECIES, PROTOCOL } from "../shared/config.js";
function message(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", handler);
      reject(new Error(`Timeout: ${type}`));
    }, 3000);
    function handler(raw) {
      const m = JSON.parse(raw);
      if (m.type === type) {
        clearTimeout(timeout);
        socket.off("message", handler);
        resolve(m);
      }
    }
    socket.on("message", handler);
  });
}
test("HTTP, two clients, input authority, solo isolation and reconnect", async () => {
  const { server, wss } = createGameServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`,
    clients = [];
  try {
    const index = await fetch(base);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.equal((await fetch(`${base}/vendor/babylon.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/loaders.js`)).status, 200);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    const model = await fetch(`${base}/assets/models/clownfish.glb`);
    assert.equal(model.status, 200);
    assert.equal(
      (await fetch(`${base}/assets/models/clownfish-hd.glb`)).status,
      200,
    );
    assert.equal(model.headers.get("content-type"), "model/gltf-binary");
    async function join(mode = "multiplayer", species) {
      const s = new WebSocket(base.replace("http", "ws") + "/ws");
      clients.push(s);
      await once(s, "open");
      const welcome = message(s, "WELCOME");
      s.send(
        JSON.stringify({ type: "JOIN", name: "Test fish", mode, species }),
      );
      const greeting = await welcome;
      assert.equal(greeting.protocol, PROTOCOL);
      s.playerId = greeting.id;
      return s;
    }
    const a = await join("multiplayer", "shark"),
      b = await join("multiplayer", "not-a-fish");
    let state = await message(a, "WORLD_STATE");
    assert.equal(state.players.length, 2);
    // Chosen species is honored; unknown ones fall back to a real model.
    assert.equal(
      state.players.find((p) => p.id === a.playerId).species,
      "shark",
    );
    assert.ok(
      SPECIES.includes(state.players.find((p) => p.id === b.playerId).species),
    );
    assert.ok(state.npcs.every((n) => SPECIES.includes(n.species)));
    const sound = await fetch(`${base}/assets/audio/click.m4a`);
    assert.equal(sound.status, 200);
    assert.equal(sound.headers.get("content-type"), "audio/mp4");
    const thumb = await fetch(`${base}/assets/thumbs/clownfish.png`);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get("content-type"), "image/png");
    a.send("bad json");
    a.send("null");
    a.send(
      JSON.stringify({
        type: "INPUT",
        forward: 0,
        strafe: 0,
        yaw: 0,
        pitch: 0,
        mass: 9999,
      }),
    );
    state = await message(a, "WORLD_STATE");
    assert.equal(state.players[0].mass, 8);
    // Real sockets exercise the input protocol, rather than only simulation helpers.
    const alone = await join("single");
    let soloState = await message(alone, "WORLD_STATE");
    const start = soloState.players[0];
    soloState = await message(alone, "WORLD_STATE");
    assert.deepEqual(
      [soloState.players[0].x, soloState.players[0].y, soloState.players[0].z],
      [start.x, start.y, start.z],
    );
    alone.send(
      JSON.stringify({
        type: "INPUT",
        forward: 1,
        strafe: 0,
        yaw: 0,
        pitch: 0,
      }),
    );
    soloState = await message(alone, "WORLD_STATE");
    assert.ok(soloState.players[0].z > start.z);
    alone.send(
      JSON.stringify({
        type: "INPUT",
        forward: 0,
        strafe: 0,
        yaw: 0,
        pitch: 0,
      }),
    );
    const stopped = (await message(alone, "WORLD_STATE")).players[0];
    const still = (await message(alone, "WORLD_STATE")).players[0];
    assert.deepEqual(
      [still.x, still.y, still.z],
      [stopped.x, stopped.y, stopped.z],
    );
    const solo = await join("single");
    assert.equal((await message(solo, "WORLD_STATE")).players.length, 1);
    // The shared room is a lobby: the first player hosts, everyone readies up.
    assert.equal(state.phase, "lobby");
    assert.equal(state.lobby.host, a.playerId);
    b.close();
    await once(b, "close");
    assert.equal((await message(a, "WORLD_STATE")).players.length, 1);
    const c = await join();
    assert.equal((await message(a, "WORLD_STATE")).players.length, 2);
    c.send(JSON.stringify({ type: "SETTINGS", duration: 60 }));
    c.send(JSON.stringify({ type: "START" }));
    a.send(JSON.stringify({ type: "READY", ready: true }));
    c.send(JSON.stringify({ type: "READY", ready: true }));
    a.send(JSON.stringify({ type: "SETTINGS", duration: 180 }));
    await message(a, "WORLD_STATE");
    const lobby = await message(a, "WORLD_STATE");
    assert.equal(lobby.phase, "lobby", "a guest cannot start the match");
    assert.equal(lobby.lobby.duration, 180, "only the host's length counts");
    assert.deepEqual(
      [...lobby.lobby.ready].sort(),
      [a.playerId, c.playerId].sort(),
    );
    a.send(JSON.stringify({ type: "START" }));
    await message(a, "WORLD_STATE");
    const playing = await message(a, "WORLD_STATE");
    assert.equal(playing.phase, "playing");
    assert.ok(playing.remaining > 175 && playing.remaining <= 180);
    assert.ok(playing.players.every((p) => p.alive));
  } finally {
    for (const s of clients) s.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
