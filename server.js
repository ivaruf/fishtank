import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { World } from "./server/game/world.js";
import {
  CONFIG as C,
  SPECIES,
  PROTOCOL,
  TANKS,
  isTank,
} from "./shared/config.js";
const root = path.dirname(fileURLToPath(import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".m4a": "audio/mp4",
};
const vendors = {
  "/vendor/babylon.js": "node_modules/babylonjs/babylon.js",
  "/vendor/loaders.js":
    "node_modules/babylonjs-loaders/babylonjs.loaders.min.js",
};
export function createGameServer() {
  const shared = () => new World(Math.random, { lobby: true });
  // The shared games are persistent, so the picker always has something to
  // show; solo rooms are keyed by socket id and created on demand.
  const rooms = new Map(TANKS.map((t) => [t.id, shared()]));
  const gameList = () =>
    TANKS.map((t) => {
      const room = rooms.get(t.id);
      return {
        id: t.id,
        name: t.name,
        players: room.players.size,
        capacity: C.maxPlayers,
        phase: room.phase,
        round: room.round,
        remaining: room.phase === "playing" ? Math.ceil(room.remaining) : 0,
      };
    });
  const openTank = () =>
    TANKS.find((t) => rooms.get(t.id).players.size < C.maxPlayers)?.id;
  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const rel =
        vendors[url] ||
        (url.startsWith("/shared/")
          ? url.slice(1)
          : `client${url === "/" ? "/index.html" : url}`);
      const file = path.resolve(root, rel);
      if (
        !file.startsWith(root + path.sep) ||
        (!vendors[url] &&
          !file.startsWith(
            path.join(root, url.startsWith("/shared/") ? "shared" : "client") +
              path.sep,
          ))
      ) {
        res.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
  wss.on("connection", (socket) => {
    socket.id = randomUUID();
    socket.isAlive = true;
    socket.on("pong", () => (socket.isAlive = true));
    socket.on("error", () => {});
    // Long enough to browse the game list and pick one; still reaps sockets
    // that connect and never join.
    const joinTimeout = setTimeout(() => {
      if (!socket.room) socket.close(1008, "Join required");
    }, 120000);
    socket.send(JSON.stringify({ type: "GAMES", games: gameList() }));
    socket.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      if (m.type === "JOIN" && !socket.room) {
        const solo = m.mode === "single";
        // Only the listed tanks are joinable by name, so a client can never
        // address someone else's solo room by guessing its socket id.
        const key = solo
          ? socket.id
          : typeof m.room === "string" && m.room
            ? m.room
            : openTank();
        if (!solo && !isTank(key)) {
          socket.send(
            JSON.stringify({
              type: "ERROR",
              message: "That game is no longer available. Pick another tank.",
            }),
          );
          return;
        }
        if (solo && !rooms.has(key)) rooms.set(key, new World());
        // (Solo rooms are keyed by socket id and play immediately.)
        const room = rooms.get(key);
        if (room.players.size >= C.maxPlayers) {
          socket.send(
            JSON.stringify({
              type: "ERROR",
              message: "That tank is full. Pick another game.",
            }),
          );
          return;
        }
        const name =
          typeof m.name === "string" ? m.name.trim().slice(0, 18) : "";
        room.addPlayer(
          socket.id,
          name || "Little fish",
          SPECIES.includes(m.species) ? m.species : undefined,
        );
        socket.room = key;
        clearTimeout(joinTimeout);
        socket.send(
          JSON.stringify({
            type: "WELCOME",
            id: socket.id,
            protocol: PROTOCOL,
            room: solo ? null : key,
            roomName: solo
              ? null
              : (TANKS.find((t) => t.id === key)?.name ?? key),
          }),
        );
      }
      if (m.type === "INPUT" && socket.room) {
        rooms.get(socket.room)?.setInput(socket.id, m);
      }
      if (m.type === "NEXT_ROUND" && socket.room) {
        rooms.get(socket.room)?.nextRound();
      }
      if (m.type === "READY" && socket.room)
        rooms.get(socket.room)?.setReady(socket.id, !!m.ready);
      if (m.type === "SETTINGS" && socket.room)
        rooms.get(socket.room)?.setDuration(socket.id, Number(m.duration));
      if (m.type === "START" && socket.room)
        rooms.get(socket.room)?.start(socket.id);
    });
    socket.on("close", () => {
      clearTimeout(joinTimeout);
      const room = rooms.get(socket.room);
      room?.removePlayer(socket.id);
      if (!socket.room) return;
      // Solo rooms go away with their player; a shared tank that empties out
      // resets to a fresh lobby so the next group starts clean.
      if (!isTank(socket.room)) rooms.delete(socket.room);
      else if (room && !room.players.size) rooms.set(socket.room, shared());
    });
  });
  let tick = 0;
  const timer = setInterval(() => {
    for (const room of rooms.values()) room.tick(1 / C.tickRate);
    // Twice a second, refresh anyone still choosing a game. The list is a few
    // hundred bytes, so this costs far less than a single world snapshot.
    if (tick % (C.tickRate / 2) === 0) {
      const games = JSON.stringify({ type: "GAMES", games: gameList() });
      for (const s of wss.clients)
        if (!s.room && s.readyState === WebSocket.OPEN) s.send(games);
    }
    if (++tick % (C.tickRate / C.broadcastRate)) return;
    for (const [key, room] of rooms) {
      const state = JSON.stringify({
        ...room.snapshot(),
        events: room.events.splice(0),
      });
      for (const s of wss.clients)
        if (
          s.room === key &&
          s.readyState === WebSocket.OPEN &&
          s.bufferedAmount < 256000
        )
          s.send(state);
    }
  }, 1000 / C.tickRate);
  const heartbeat = setInterval(() => {
    for (const s of wss.clients) {
      if (!s.isAlive) {
        s.terminate();
        continue;
      }
      s.isAlive = false;
      s.ping();
    }
  }, 15000);
  server.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
  return { server, wss, rooms };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () =>
    console.log(
      `Fishtank swimming at http://localhost:${port} — LAN: http://<your-local-ip>:${port}`,
    ),
  );
}
