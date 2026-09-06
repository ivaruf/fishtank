import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { World } from "./shared/world.js";
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
  ".webmanifest": "application/manifest+json",
};
const vendors = {
  "/vendor/babylon.js": "node_modules/babylonjs/babylon.js",
  "/vendor/loaders.js":
    "node_modules/babylonjs-loaders/babylonjs.loaders.min.js",
};
// What build is actually running, so a deploy can be confirmed at a glance
// rather than by guessing. Render sets RENDER_GIT_COMMIT for services built
// from a repo; APP_VERSION overrides it on any other host, and locally we read
// the checked-out commit straight from .git. Resolved once at startup.
const BUILD = (() => {
  const given = process.env.APP_VERSION || process.env.RENDER_GIT_COMMIT;
  if (given) return given.trim().slice(0, 7);
  try {
    const head = readFileSync(path.join(root, ".git/HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ")
      ? readFileSync(path.join(root, ".git", head.slice(5)), "utf8")
      : head;
    return ref.trim().slice(0, 7);
  } catch {
    // Packed refs, or no .git at all: better to say so than to invent one.
    return "dev";
  }
})();
const STARTED = new Date().toISOString();
// PNG and M4A are already compressed; measured 0% gain and pure CPU cost.
const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".css",
  ".glb",
  ".json",
  ".webmanifest",
]);
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
// One entry per file per process: its content hash, and the pre-compressed
// bodies. Built on first request rather than at startup so `npm start` and the
// tests stay instant, and so the 36 MB of fish models only cost what is asked
// for. Brotli at quality 5 measured 83% off the vendor bundle and 63-76% off
// the GLBs for a fraction of the CPU of the maximum setting.
const bundle = new Map();
async function serveFile(file) {
  let entry = bundle.get(file);
  if (!entry) {
    const raw = await readFile(file);
    const extension = path.extname(file);
    const compress = COMPRESSIBLE.has(extension) && raw.length > 1024;
    entry = {
      type: mime[extension] || "application/octet-stream",
      hash: `"${createHash("sha256").update(raw).digest("base64url").slice(0, 22)}"`,
      raw,
      br: compress
        ? await brotli(raw, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
          })
        : null,
      gzip: compress ? await gzip(raw, { level: 6 }) : null,
    };
    bundle.set(file, entry);
  }
  return entry;
}
// The client always revalidates, and gets an empty 304 unless the bytes
// changed. That keeps a rebuilt fish or an edited script live immediately
// while costing a few hundred bytes instead of megabytes on a reload.
function pick(entry, accept = "") {
  if (entry.br && /\bbr\b/.test(accept)) return ["br", entry.br];
  if (entry.gzip && /\bgzip\b/.test(accept)) return ["gzip", entry.gzip];
  return [null, entry.raw];
}
// idleTimeout is injectable so the reaper can be tested in a second rather
// than in a minute and a half.
export function createGameServer({ idleTimeout = C.idleTimeout } = {}) {
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
      // A cheap liveness probe for whatever platform this runs on: it reports
      // the live room count rather than just 200, so a wedged tick loop is
      // visible. Not cached, and it never touches the disk.
      if (url === "/healthz") {
        const games = gameList();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(
          JSON.stringify({
            ok: true,
            version: BUILD,
            started: STARTED,
            protocol: PROTOCOL,
            uptime: Math.round(process.uptime()),
            players: games.reduce((n, g) => n + g.players, 0),
            games,
          }),
        );
        return;
      }
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
      const entry = await serveFile(file);
      const headers = {
        "Content-Type": entry.type,
        "X-Content-Type-Options": "nosniff",
        // Always revalidate, so a rebuilt asset is picked up at once; the
        // ETag is a content hash, so unchanged bytes cost a 304 and no body.
        "Cache-Control": "no-cache",
        ETag: entry.hash,
        // Different bytes per Accept-Encoding: proxies must not mix them up.
        Vary: "Accept-Encoding",
      };
      if (req.headers["if-none-match"] === entry.hash) {
        res.writeHead(304, headers).end();
        return;
      }
      const [encoding, body] = pick(entry, req.headers["accept-encoding"]);
      if (encoding) headers["Content-Encoding"] = encoding;
      headers["Content-Length"] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 2048,
    // Snapshots are large, repetitive JSON and barely change tick to tick, so
    // deflate earns its keep here. Keeping the compression context between
    // messages is what makes it pay: measured 26 KB -> 1.8 KB per snapshot
    // with quantised floats, against 3.1 KB if the context is reset each time.
    // Shrinking the zlib window to save memory measured *worse* than no
    // compression at all, so the window stays at its default; the cost is
    // roughly a quarter megabyte of zlib state per connection, which at 24
    // players is a few megabytes.
    perMessageDeflate: {
      // Control messages (GAMES, WELCOME, ERROR) are far too small to gain.
      threshold: 1024,
      zlibDeflateOptions: { level: 6 },
      // Bound how many messages compress at once under a burst of joins.
      concurrencyLimit: 10,
    },
  });
  wss.on("connection", (socket) => {
    socket.id = randomUUID();
    socket.isAlive = true;
    // Any inbound frame counts as "someone is there"; pongs deliberately do
    // not, since the browser answers those with the tab closed and asleep.
    socket.seen = Date.now();
    socket.on("pong", () => (socket.isAlive = true));
    socket.on("error", () => {});
    // Long enough to browse the game list and pick one; still reaps sockets
    // that connect and never join.
    const joinTimeout = setTimeout(() => {
      if (!socket.room) socket.close(1008, "Join required");
    }, 120000);
    socket.send(JSON.stringify({ type: "GAMES", games: gameList() }));
    socket.on("message", (raw) => {
      socket.seen = Date.now();
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== "object") return;
      // AWAKE carries nothing: having arrived is the whole message.
      if (m.type === "AWAKE") return;
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
    tick++;
    // Per room, because a lobby or a results screen needs far fewer updates
    // than a round in progress and used to cost exactly the same.
    for (const [key, room] of rooms) {
      const hz =
        room.phase === "playing" ? C.broadcastRate : C.idleBroadcastRate;
      if (tick % Math.max(1, Math.round(C.tickRate / hz))) continue;
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
  // Sweep often enough to catch an idle socket promptly, which at the default
  // ninety seconds is the same fifteen-second beat as before.
  const sweep = Math.min(15000, Math.max(250, (idleTimeout * 1000) / 3));
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const s of wss.clients) {
      // A tab that stopped talking is a closed laptop or a backgrounded page.
      // It still costs a full snapshot stream, so let it go and let the player
      // dive back in when they return.
      if (now - s.seen > idleTimeout * 1000) {
        s.close(1001, "Idle");
        continue;
      }
      if (!s.isAlive) {
        s.terminate();
        continue;
      }
      s.isAlive = false;
      s.ping();
    }
  }, sweep);
  server.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
  return { server, wss, rooms };
}
// Compress and hash the entry surface up front so the first visitor does not
// pay for it. Deliberately not the fish models: those are per-quality-tier and
// 36 MB in total, so they stay lazy and only the tier someone asks for is ever
// built. Called from the CLI path only, to keep createGameServer() instant for
// the tests.
export async function warmBundle() {
  const entry = [
    "client/index.html",
    "client/css/style.css",
    "shared/config.js",
    "shared/movement.js",
    ...(await readdir(path.join(root, "client/js"))).map(
      (f) => `client/js/${f}`,
    ),
  ];
  const warmed = await Promise.all(
    entry.map(async (rel) => {
      try {
        const e = await serveFile(path.resolve(root, rel));
        return (e.br ?? e.raw).length;
      } catch {
        return 0; // A file that no longer exists simply stays uncached.
      }
    }),
  );
  return {
    files: warmed.filter(Boolean).length,
    bytes: warmed.reduce((a, b) => a + b, 0),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server } = createGameServer({
    idleTimeout: Number(process.env.IDLE_TIMEOUT) || C.idleTimeout,
  });
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", async () => {
    console.log(
      `Fishtank swimming at http://localhost:${port} — LAN: http://<your-local-ip>:${port}`,
    );
    const { files, bytes } = await warmBundle();
    console.log(
      `Cached ${files} client files, ${(bytes / 1024).toFixed(0)} KB compressed. Babylon loads from jsDelivr with a /vendor/ fallback.`,
    );
  });
}
