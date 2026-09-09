// The host's simulation, moved off the page.
//
// A browser throttles setInterval in a background tab, so a host that looked
// at another tab froze the game for everyone: measured 3 snapshots against 62
// over the same fifteen seconds, with the round timer stopped. Worker timers
// are not throttled the same way, and this also gets the simulation off the
// render thread, which matters because the host does strictly more work than
// any guest.
//
// shared/world.js has no DOM dependencies, which is what let it move
// client-side for solo in the first place, and lets it move again here.
import { World } from "../../shared/world.js";
import { CONFIG as C, SPECIES } from "../../shared/config.js";

let world = null,
  ticker = null,
  tick = 0;
const per = Math.max(1, Math.round(C.tickRate / C.broadcastRate));
const cleanName = (name) =>
  String(name ?? "")
    .trim()
    .slice(0, 18) || "Little fish";
const cleanSpecies = (species) =>
  SPECIES.includes(species) ? species : undefined;

const step = () => {
  world.tick(1 / C.tickRate);
  if (++tick % per) return;
  // The page forwards this to peers and renders it; the worker never touches
  // a data channel, so it stays a pure simulation.
  postMessage({
    type: "STATE",
    state: { ...world.snapshot(), events: world.events.splice(0) },
  });
};

onmessage = ({ data }) => {
  switch (data.type) {
    case "START": {
      world = new World(Math.random, { lobby: data.lobby ?? false });
      tick = 0;
      ticker = setInterval(step, 1000 / C.tickRate);
      break;
    }
    case "ADD": {
      world.addPlayer(
        data.id,
        cleanName(data.name),
        cleanSpecies(data.species),
      );
      postMessage({ type: "ADDED", id: data.id, players: world.players.size });
      break;
    }
    case "REMOVE": {
      world.removePlayer(data.id);
      postMessage({
        type: "REMOVED",
        id: data.id,
        players: world.players.size,
      });
      break;
    }
    case "INPUT":
      world.setInput(data.id, data.input);
      break;
    case "REQUEST": {
      const { id, request, payload = {} } = data;
      if (request === "NEXT_ROUND") world.nextRound();
      if (request === "READY") world.setReady(id, !!payload.ready);
      if (request === "SETTINGS") {
        if (payload.duration !== undefined)
          world.setDuration(id, payload.duration);
        if (payload.difficulty !== undefined)
          world.setDifficulty(id, payload.difficulty);
      }
      if (request === "START") world.start(id);
      break;
    }
    case "FULL":
      // The page decides who may sit down, but only the worker knows the
      // count, so it answers rather than the page guessing.
      postMessage({
        type: "FULL",
        seat: data.seat,
        full: world.players.size >= C.maxPlayers,
      });
      break;
    case "STOP":
      if (ticker) clearInterval(ticker);
      ticker = null;
      world = null;
      break;
  }
};
