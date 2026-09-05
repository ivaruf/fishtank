import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "../server.js";
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
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/vendor/babylon.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/loaders.js`)).status, 200);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    const model = await fetch(`${base}/assets/models/clownfish.glb`);
    assert.equal(model.status, 200);
    assert.equal(model.headers.get("content-type"), "model/gltf-binary");
    async function join(mode = "multiplayer") {
      const s = new WebSocket(base.replace("http", "ws") + "/ws");
      clients.push(s);
      await once(s, "open");
      const welcome = message(s, "WELCOME");
      s.send(JSON.stringify({ type: "JOIN", name: "Test fish", mode }));
      await welcome;
      return s;
    }
    const a = await join(),
      b = await join();
    let state = await message(a, "WORLD_STATE");
    assert.equal(state.players.length, 2);
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
    b.close();
    await once(b, "close");
    assert.equal((await message(a, "WORLD_STATE")).players.length, 1);
    await join();
    assert.equal((await message(a, "WORLD_STATE")).players.length, 2);
  } finally {
    for (const s of clients) s.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
