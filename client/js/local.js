import { World } from "../../shared/world.js";
import { CONFIG as C, PROTOCOL, SPECIES } from "../../shared/config.js";
// Solo needs no server. The simulation in shared/world.js has no Node
// dependencies, so the same class the server runs also runs here, driven by a
// timer instead of a socket and handed to the same callbacks. That means solo
// costs nothing to host, plays with no latency, and keeps working when the
// network does not.
//
// Deliberately the same shape as the peer connection in peer.js, so main.js treats
// a local game and a hosted one identically.
export function playLocally({ join, onWelcome, onState, onError, onClose }) {
  const world = new World(Math.random);
  const id = `solo-${Math.random().toString(36).slice(2, 10)}`;
  let ticker = null;
  let closed = false;
  const stop = () => {
    if (ticker) clearInterval(ticker);
    ticker = null;
  };
  // The server publishes every other tick; match it so the client's
  // interpolation sees the cadence it was tuned for.
  const per = Math.max(1, Math.round(C.tickRate / C.broadcastRate));
  let tick = 0;
  const step = () => {
    world.tick(1 / C.tickRate);
    if (++tick % per) return;
    // Events are drained exactly as the server drains them, so a bite or a zap
    // is delivered once and only once.
    onState({ ...world.snapshot(), events: world.events.splice(0) });
  };
  const start = ({ name, species }) => {
    world.addPlayer(
      id,
      String(name ?? "")
        .trim()
        .slice(0, 18) || "Little fish",
      // Validated exactly as the server validates it, so a stale saved
      // species falls back to a real fish instead of a missing model.
      SPECIES.includes(species) ? species : undefined,
    );
    // Announce on a later turn, so the caller has finished wiring itself up
    // before the first snapshot lands, exactly as a socket's open would.
    queueMicrotask(() => {
      if (closed) return;
      onWelcome(id, PROTOCOL, null);
      ticker = setInterval(step, 1000 / C.tickRate);
    });
  };
  if (join) start(join);
  return {
    join: start,
    send(input) {
      world.setInput(id, input);
    },
    request(type) {
      if (type === "NEXT_ROUND") world.nextRound();
      // READY, SETTINGS and START belong to shared lobbies; solo plays at once.
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      // A socket reports its close on a later turn, and the caller clears its
      // reference in between. Reporting synchronously would re-enter leave().
      queueMicrotask(() =>
        onClose?.({ code: 1000, reason: "Local game ended" }),
      );
    },
    // Present so the two transports really are interchangeable.
    onError,
  };
}
