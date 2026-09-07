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
}) {
  const world = new World(Math.random, { lobby });
  const peers = new Map(); // peer id -> channel
  let ticker = null,
    closed = false,
    tick = 0;
  const per = Math.max(1, Math.round(C.tickRate / C.broadcastRate));
  const announce = () => onPeers?.(peers.size + 1);

  const step = () => {
    world.tick(1 / C.tickRate);
    if (++tick % per) return;
    // One snapshot, drained once, delivered to everyone including the host.
    const state = { ...world.snapshot(), events: world.events.splice(0) };
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

  function drop(id) {
    const channel = peers.get(id);
    peers.delete(id);
    world.removePlayer(id);
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
        if (world.players.size >= C.maxPlayers) {
          channel.send({ type: "ERROR", message: "This tank is full." });
          return;
        }
        world.addPlayer(
          id,
          cleanName(message.name),
          cleanSpecies(message.species),
        );
        channel.send({ type: "WELCOME", id, protocol: PROTOCOL });
        announce();
        return;
      }
      // Everything else is only meaningful once seated.
      if (!world.players.has(id)) return;
      if (message.type === "INPUT") world.setInput(id, message);
      if (message.type === "NEXT_ROUND") world.nextRound();
      if (message.type === "READY") world.setReady(id, !!message.ready);
      if (message.type === "SETTINGS") world.setDuration(id, message.duration);
      if (message.type === "START") world.start(id);
    };
    channel.onClose = () => drop(id);
  }

  const start = ({ name, species } = {}) => {
    world.addPlayer(HOST, cleanName(name), cleanSpecies(species));
    queueMicrotask(() => {
      if (closed) return;
      onWelcome(HOST, PROTOCOL, "Your tank");
      announce();
      ticker = setInterval(step, 1000 / C.tickRate);
    });
  };
  if (join) start(join);

  return {
    accept,
    world,
    join: start,
    send(input) {
      world.setInput(HOST, input);
    },
    request(type, payload = {}) {
      if (type === "NEXT_ROUND") world.nextRound();
      if (type === "READY") world.setReady(HOST, !!payload.ready);
      if (type === "SETTINGS") world.setDuration(HOST, payload.duration);
      if (type === "START") world.start(HOST);
    },
    close() {
      if (closed) return;
      closed = true;
      if (ticker) clearInterval(ticker);
      ticker = null;
      // Tell everyone before going, so guests can say why rather than just
      // freezing: losing the host ends the game for all of them.
      for (const [id, channel] of peers) {
        try {
          channel.send({ type: "HOST_LEFT" });
          channel.close();
        } catch {
          /* Already gone. */
        }
        world.removePlayer(id);
      }
      peers.clear();
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
