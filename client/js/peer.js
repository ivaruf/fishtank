import { World } from "../../shared/world.js";
import { CONFIG as C, PROTOCOL, SPECIES } from "../../shared/config.js";
// Host-authoritative peer-to-peer, with no server in the game loop at all.
//
// One player runs the simulation - the same shared/world.js the Node server
// runs, and the same one solo already runs - and every other player sends
// input and receives snapshots over a data channel. The host is authoritative
// exactly as the server was, so nothing about the rules changes.
//
// This file knows nothing about WebRTC. It talks to "channels": anything with
// send(value) and onMessage/onClose callbacks. That keeps the protocol
// testable without a browser, and lets the same logic run over a real
// RTCDataChannel, over BroadcastChannel between two tabs, or over a fake pair
// in a unit test.
//
// Deliberately the same shape as connect() and playLocally(), so main.js
// treats all three transports identically.

// Guests address the host as this; the host's own player id is its peer id.
const HOST = "host";

// The host's simulation, behind a surface small enough that it can run either
// in the page or in a worker without the protocol above knowing which. There
// is one protocol implementation, and the two engines cannot drift.
function localEngine({ lobby, onState }) {
  const world = new World(Math.random, { lobby });
  const per = Math.max(1, Math.round(C.tickRate / C.broadcastRate));
  let ticker = null,
    tick = 0;
  const step = () => {
    world.tick(1 / C.tickRate);
    if (++tick % per) return;
    onState({ ...world.snapshot(), events: world.events.splice(0) });
  };
  return {
    world,
    start: () => (ticker = setInterval(step, 1000 / C.tickRate)),
    count: () => world.players.size,
    add: (id, name, species, seated) => {
      world.addPlayer(id, name, species);
      seated?.();
    },
    remove: (id) => world.removePlayer(id),
    input: (id, input) => world.setInput(id, input),
    request: (id, request, payload = {}) => {
      if (request === "NEXT_ROUND") world.nextRound();
      if (request === "READY") world.setReady(id, !!payload.ready);
      if (request === "SETTINGS") world.setDuration(id, payload.duration);
      if (request === "START") world.start(id);
    },
    stop: () => {
      if (ticker) clearInterval(ticker);
      ticker = null;
    },
  };
}

// The same simulation in a worker, so a backgrounded host keeps running.
function workerEngine({ lobby, onState, url }) {
  const worker = new Worker(url, { type: "module" });
  const seating = new Map();
  let count = 0;
  worker.onmessage = ({ data }) => {
    if (data.type === "STATE") onState(data.state);
    else if (data.type === "ADDED") {
      count = data.players;
      seating.get(data.id)?.();
      seating.delete(data.id);
    } else if (data.type === "REMOVED") count = data.players;
  };
  return {
    world: null,
    start: () => worker.postMessage({ type: "START", lobby }),
    // Counted optimistically: the worker's reply corrects it, but two joins
    // landing together must not both see a free seat.
    count: () => count,
    add: (id, name, species, seated) => {
      count++;
      seating.set(id, seated);
      worker.postMessage({ type: "ADD", id, name, species });
    },
    remove: (id) => {
      count = Math.max(0, count - 1);
      worker.postMessage({ type: "REMOVE", id });
    },
    input: (id, input) => worker.postMessage({ type: "INPUT", id, input }),
    request: (id, request, payload = {}) =>
      worker.postMessage({ type: "REQUEST", id, request, payload }),
    stop: () => {
      worker.postMessage({ type: "STOP" });
      worker.terminate();
    },
  };
}

// Prefer the worker, because a throttled host freezes the game for everyone,
// but never fail outright if it is unavailable.
export function createHostEngine(options) {
  try {
    if (typeof Worker === "function")
      return workerEngine({
        ...options,
        url: new URL("./host-worker.js", import.meta.url),
      });
  } catch {
    /* Fall through to running it in the page. */
  }
  return localEngine(options);
}

const cleanName = (name) =>
  String(name ?? "")
    .trim()
    .slice(0, 18) || "Little fish";
const cleanSpecies = (species) =>
  SPECIES.includes(species) ? species : undefined;

// A host: runs the world, seats arriving peers, and broadcasts snapshots.
export function hostGame({
  join,
  onWelcome,
  onState,
  onError,
  onClose,
  onPeers,
  lobby = false,
  // A factory rather than an instance, because the engine needs the publish
  // function that is defined just below it.
  engine = localEngine,
}) {
  const peers = new Map(); // peer id -> channel
  const seated = new Set(); // peers the simulation has actually admitted
  let closed = false;
  const announce = () => onPeers?.(peers.size + 1);

  // One snapshot, drained once, delivered to everyone including the host.
  const publish = (state) => {
    for (const [id, channel] of peers) {
      try {
        channel.send({ type: "WORLD_STATE", ...state });
      } catch {
        // A channel that cannot take a frame is treated as gone; the close
        // handler will tidy up the player.
        drop(id);
      }
    }
    onState(state);
  };
  const sim = engine({ lobby, onState: publish });

  function drop(id) {
    const channel = peers.get(id);
    peers.delete(id);
    sim.remove(id);
    try {
      channel?.close();
    } catch {
      /* Already gone. */
    }
    announce();
  }

  // Called by the signalling layer for every peer that finishes connecting.
  function accept(id, channel) {
    if (closed) {
      channel.close();
      return;
    }
    peers.set(id, channel);
    channel.onMessage = (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "JOIN") {
        // Capacity is decided here rather than on connect, as the server does
        // it: a peer that has connected but not asked for a seat holds none,
        // and refusing before its JOIN arrives would race its own message.
        if (sim.count() >= C.maxPlayers) {
          channel.send({ type: "ERROR", message: "This tank is full." });
          return;
        }
        // Welcome only once the simulation confirms the seat, since a worker
        // seats players a message later than the page asks.
        sim.add(
          id,
          cleanName(message.name),
          cleanSpecies(message.species),
          () => {
            if (closed || !peers.has(id)) return;
            seated.add(id);
            channel.send({ type: "WELCOME", id, protocol: PROTOCOL });
            announce();
          },
        );
        return;
      }
      // Everything else is only meaningful once seated.
      if (!seated.has(id)) return;
      if (message.type === "INPUT") sim.input(id, message);
      else sim.request(id, message.type, message);
    };
    channel.onClose = () => drop(id);
  }

  const start = ({ name, species } = {}) => {
    sim.start();
    sim.add(HOST, cleanName(name), cleanSpecies(species), () => {
      if (closed) return;
      seated.add(HOST);
      onWelcome(HOST, PROTOCOL, "Your tank");
      announce();
    });
  };
  if (join) start(join);

  return {
    accept,
    // Present only for the in-page engine, which the protocol tests use.
    get world() {
      return sim.world;
    },
    players: () => sim.count(),
    join: start,
    send(input) {
      sim.input(HOST, input);
    },
    request(type, payload = {}) {
      sim.request(HOST, type, payload);
    },
    close() {
      if (closed) return;
      closed = true;
      sim.stop();
      // Tell everyone before going, so guests can say why rather than just
      // freezing: losing the host ends the game for all of them.
      for (const [id, channel] of peers) {
        try {
          channel.send({ type: "HOST_LEFT" });
          channel.close();
        } catch {
          /* Already gone. */
        }
        sim.remove(id);
      }
      peers.clear();
      seated.clear();
      queueMicrotask(() => onClose?.({ code: 1000, reason: "Host closed" }));
    },
    onError,
  };
}

// A guest: sends input to the host and renders whatever the host says.
export function joinGame({
  join,
  channel,
  onWelcome,
  onState,
  onError,
  onClose,
}) {
  let closed = false,
    seated = false;
  channel.onMessage = (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "WELCOME") {
      seated = true;
      onWelcome(message.id, message.protocol, "Their tank");
    } else if (message.type === "WORLD_STATE") onState(message);
    else if (message.type === "ERROR") onError?.(message.message);
    else if (message.type === "HOST_LEFT") {
      // Not a network fault: the person running the game left.
      closed = true;
      onClose?.({ code: 4001, reason: "Host left" });
      try {
        channel.close();
      } catch {
        /* Already gone. */
      }
    }
  };
  channel.onClose = () => {
    if (closed) return;
    closed = true;
    onClose?.({
      code: seated ? 1006 : 4002,
      reason: seated ? "Lost the host" : "Could not reach the host",
    });
  };
  // A data channel throws if it is closing, and a guest cannot know that
  // before the host's close reaches it. Losing a message is fine; throwing
  // out of the render loop is not.
  const post = (message) => {
    if (closed) return;
    try {
      channel.send(message);
    } catch {
      /* The close handler will report it. */
    }
  };
  const start = (payload = {}) =>
    post({
      type: "JOIN",
      name: cleanName(payload.name),
      species: cleanSpecies(payload.species),
    });
  if (join) start(join);
  return {
    join: start,
    send(input) {
      post({ type: "INPUT", ...input });
    },
    request(type, payload = {}) {
      post({ type, ...payload });
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        channel.close();
      } catch {
        /* Already gone. */
      }
      queueMicrotask(() => onClose?.({ code: 1000, reason: "Left" }));
    },
    onError,
  };
}
