import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { World } from "./server/game/world.js";
import { CONFIG as C, SPECIES, PROTOCOL } from "./shared/config.js";
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
  const rooms = new Map([["multiplayer", new World()]]);
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
    const joinTimeout = setTimeout(() => {
      if (!socket.room) socket.close(1008, "Join required");
    }, 10000);
    socket.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      if (m.type === "JOIN" && !socket.room) {
        const key = m.mode === "single" ? socket.id : "multiplayer";
        if (!rooms.has(key)) rooms.set(key, new World());
        const room = rooms.get(key);
        if (room.players.size >= C.maxPlayers) {
          socket.send(
            JSON.stringify({
              type: "ERROR",
              message: "This tank is full. Try again shortly.",
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
          }),
        );
      }
      if (m.type === "INPUT" && socket.room) {
        rooms.get(socket.room)?.setInput(socket.id, m);
      }
    });
    socket.on("close", () => {
      clearTimeout(joinTimeout);
      const room = rooms.get(socket.room);
      room?.players.delete(socket.id);
      if (socket.room && socket.room !== "multiplayer")
        rooms.delete(socket.room);
      if (socket.room === "multiplayer" && !room.players.size)
        rooms.set("multiplayer", new World());
    });
  });
  let tick = 0;
  const timer = setInterval(() => {
    for (const room of rooms.values()) room.tick(1 / C.tickRate);
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
