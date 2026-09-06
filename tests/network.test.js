import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createGameServer } from "../server.js";
import { SPECIES, PROTOCOL, CONFIG as C, TANKS } from "../shared/config.js";
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

test("several games run at once, each chosen by name and capped at maxPlayers", async () => {
  const { server, wss } = createGameServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `ws://127.0.0.1:${server.address().port}/ws`,
    clients = [];
  // Opens a socket and returns it once the server has offered the game list.
  async function browse() {
    const s = new WebSocket(base);
    clients.push(s);
    await once(s, "open");
    const games = message(s, "GAMES");
    return { socket: s, games: (await games).games };
  }
  async function join(socket, room, name = "Test fish") {
    const welcome = message(socket, "WELCOME");
    socket.send(
      JSON.stringify({ type: "JOIN", name, mode: "multiplayer", room }),
    );
    const greeting = await welcome;
    socket.playerId = greeting.id;
    return greeting;
  }
  try {
    // Every tank is advertised before joining, so a player can choose.
    const first = await browse();
    assert.deepEqual(
      first.games.map((g) => g.id),
      TANKS.map((t) => t.id),
    );
    assert.ok(first.games.every((g) => g.capacity === C.maxPlayers));
    assert.ok(first.games.every((g) => g.players === 0));
    assert.ok(first.games.every((g) => g.phase === "lobby"));

    // Two players who pick different tanks play separate games.
    const one = await browse();
    const greeting = await join(one.socket, TANKS[0].id);
    assert.equal(greeting.roomName, TANKS[0].name);
    assert.equal(greeting.protocol, PROTOCOL);
    const two = await browse();
    await join(two.socket, TANKS[1].id);
    assert.equal((await message(one.socket, "WORLD_STATE")).players.length, 1);
    assert.equal((await message(two.socket, "WORLD_STATE")).players.length, 1);

    // A browsing socket sees the occupancy change without rejoining.
    const watcher = await browse();
    const live = await message(watcher.socket, "GAMES");
    assert.equal(live.games.find((g) => g.id === TANKS[0].id).players, 1);
    assert.equal(live.games.find((g) => g.id === TANKS[2].id).players, 0);

    // Omitting the room quick-joins the first tank with space.
    const quick = await browse();
    assert.equal((await join(quick.socket, undefined)).room, TANKS[0].id);

    // A tank refuses a ninth fish and says so instead of silently seating it.
    const full = TANKS[2].id;
    for (let i = 0; i < C.maxPlayers; i++) {
      const s = await browse();
      await join(s.socket, full, `Fish ${i}`);
    }
    const rejected = await browse();
    const error = message(rejected.socket, "ERROR");
    rejected.socket.send(
      JSON.stringify({
        type: "JOIN",
        name: "Ninth",
        mode: "multiplayer",
        room: full,
      }),
    );
    assert.match((await error).message, /full/i);

    // Unknown rooms are refused, so a solo room can never be joined by id.
    const soloSocket = await browse();
    const soloWelcome = message(soloSocket.socket, "WELCOME");
    soloSocket.socket.send(JSON.stringify({ type: "JOIN", mode: "single" }));
    const soloId = (await soloWelcome).id;
    const intruder = await browse();
    const denied = message(intruder.socket, "ERROR");
    intruder.socket.send(
      JSON.stringify({
        type: "JOIN",
        name: "Sneak",
        mode: "multiplayer",
        room: soloId,
      }),
    );
    assert.match((await denied).message, /no longer available/i);
    assert.equal(
      (await message(soloSocket.socket, "WORLD_STATE")).players.length,
      1,
    );
  } finally {
    for (const s of clients) s.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});

test("snapshots are compressed on the wire", async () => {
  const { server, wss } = createGameServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  try {
    const s = new WebSocket(url);
    await once(s, "open");
    // The server must offer permessage-deflate and keep the compression
    // context between messages: resetting it per message measured 3.1 KB a
    // snapshot against 1.8 KB with it kept.
    assert.match(
      s.extensions,
      /permessage-deflate/,
      "permessage-deflate was not negotiated",
    );
    assert.doesNotMatch(
      s.extensions,
      /server_no_context_takeover/,
      "server should keep its deflate context between snapshots",
    );
    s.send(JSON.stringify({ type: "JOIN", name: "Fish", mode: "single" }));
    await message(s, "WELCOME");
    // Compression must be transparent: the decoded snapshot still parses.
    const state = await message(s, "WORLD_STATE");
    assert.equal(state.type, "WORLD_STATE");
    assert.ok(state.npcs.length > 0);
    s.terminate();
  } finally {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});

test("assets are compressed, revalidated by content hash, and Babylon has a working fallback", async () => {
  const { server, wss } = createGameServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Brotli and gzip are both offered, and Vary keeps proxies from mixing
    // encodings up. PNGs are already compressed, so they are served as-is.
    const raw = await fetch(`${base}/css/style.css`, {
      headers: { "Accept-Encoding": "identity" },
    });
    const br = await fetch(`${base}/css/style.css`, {
      headers: { "Accept-Encoding": "br" },
    });
    assert.equal(br.headers.get("content-encoding"), "br");
    assert.equal(br.headers.get("vary"), "Accept-Encoding");
    assert.ok(
      Number(br.headers.get("content-length")) <
        Number(raw.headers.get("content-length")) / 2,
      "brotli should at least halve the stylesheet",
    );
    const gz = await fetch(`${base}/js/main.js`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(gz.headers.get("content-encoding"), "gzip");
    const png = await fetch(`${base}/assets/thumbs/clownfish.png`, {
      headers: { "Accept-Encoding": "br" },
    });
    assert.equal(png.headers.get("content-encoding"), null);

    // The client always revalidates, and unchanged bytes cost no body.
    const first = await fetch(base);
    assert.equal(first.headers.get("cache-control"), "no-cache");
    const etag = first.headers.get("etag");
    assert.ok(etag, "index.html should carry an ETag");
    const again = await fetch(base, { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
    assert.equal((await again.arrayBuffer()).byteLength, 0);

    // Babylon loads from a pinned CDN, but the local copy must stay wired up
    // as a fallback for LAN play, an outage, or a blocked request.
    const html = await first.text();
    const version = createRequire(import.meta.url)(
      "babylonjs/package.json",
    ).version;
    assert.match(
      html,
      new RegExp(`babylonjs@${version.replace(/\./g, "\\.")}/`),
    );
    assert.match(html, /\/vendor\/babylon\.js/);
    assert.match(html, /\/vendor\/loaders\.js/);
    assert.equal((await fetch(`${base}/vendor/babylon.js`)).status, 200);
    assert.equal((await fetch(`${base}/vendor/loaders.js`)).status, 200);

    // The integrity hash must match the bytes we would fall back to, or a
    // Babylon upgrade could leave the CDN and the local copy out of step.
    for (const [file, url] of [
      ["babylonjs/babylon.js", "/vendor/babylon.js"],
      ["babylonjs-loaders/babylonjs.loaders.min.js", "/vendor/loaders.js"],
    ]) {
      const bytes = new Uint8Array(
        await (await fetch(`${base}${url}`)).arrayBuffer(),
      );
      const digest = createHash("sha384").update(bytes).digest("base64");
      assert.ok(
        html.includes(`sha384-${digest}`),
        `${file} integrity hash in index.html does not match the served bytes`,
      );
    }
  } finally {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});
