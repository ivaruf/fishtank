import test from "node:test";
import assert from "node:assert/strict";
import { hostGame, joinGame } from "../client/js/peer.js";
import { CONFIG as C, PROTOCOL } from "../shared/config.js";

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
// A connected pair of channels, delivered asynchronously like a real one.
function pair() {
  const a = { sent: [] },
    b = { sent: [] };
  const link = (from, to) => {
    from.send = (value) => {
      if (from.dead) throw new Error("channel closed");
      from.sent.push(value);
      queueMicrotask(() => to.onMessage?.(structuredClone(value)));
    };
    from.close = () => {
      if (from.dead) return;
      from.dead = to.dead = true;
      queueMicrotask(() => {
        from.onClose?.();
        to.onClose?.();
      });
    };
  };
  link(a, b);
  link(b, a);
  return [a, b];
}

// The host runs the same World the server runs, so the rules cannot diverge;
// guests only send input and receive snapshots.
test("a host seats guests, simulates for everyone, and is authoritative", async () => {
  const hostStates = [],
    guestStates = [];
  let hostWelcome = null,
    guestWelcome = null,
    peerCount = 0;
  const host = hostGame({
    join: { name: "  Ivar  ", species: "shark" },
    onWelcome: (id, protocol, label) => (hostWelcome = { id, protocol, label }),
    onState: (s) => hostStates.push(s),
    onError: () => assert.fail("host should not error"),
    onClose: () => {},
    onPeers: (n) => (peerCount = n),
  });
  await settle(200);
  assert.equal(hostWelcome.protocol, PROTOCOL);
  assert.equal(peerCount, 1, "the host counts as a player");
  assert.equal(hostStates[0].players[0].name, "Ivar");
  assert.equal(hostStates[0].players[0].species, "shark");

  // A guest arrives over its own channel.
  const [hostSide, guestSide] = pair();
  host.accept("kid", hostSide);
  const guest = joinGame({
    join: { name: "Kid", species: "not-a-fish" },
    channel: guestSide,
    onWelcome: (id, protocol, label) =>
      (guestWelcome = { id, protocol, label }),
    onState: (s) => guestStates.push(s),
    onError: () => {},
    onClose: () => {},
  });
  await settle(250);
  assert.equal(guestWelcome.id, "kid");
  assert.equal(guestWelcome.protocol, PROTOCOL);
  assert.equal(peerCount, 2);
  assert.ok(guestStates.length > 0, "the guest receives snapshots");
  const seen = guestStates.at(-1);
  assert.equal(seen.players.length, 2, "both fish are in the world");
  // An unknown species falls back rather than becoming a missing model.
  assert.ok(seen.players.every((p) => p.species && p.species !== "not-a-fish"));

  // The guest's input is applied by the host, not by the guest.
  const mine = () => guestStates.at(-1).players.find((p) => p.id === "kid");
  const before = { ...mine() };
  guest.send({ forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  await settle(400);
  assert.ok(
    Math.hypot(mine().x - before.x, mine().y - before.y, mine().z - before.z) >
      0.3,
    "the host moved the guest's fish",
  );
  // A guest cannot invent its own mass: the host owns the state.
  guest.send({ forward: 0, strafe: 0, yaw: 0, pitch: 0, mass: 9999 });
  await settle(200);
  assert.equal(mine().mass, C.startMass, "the host ignores claimed mass");

  // Host and guest see the same world, because there is only one.
  assert.equal(
    hostStates.at(-1).players.length,
    guestStates.at(-1).players.length,
  );
  host.close();
  await settle(120);
});

test("losing a guest frees its seat, and losing the host ends the game", async () => {
  let peerCount = 0,
    guestClosed = null;
  const host = hostGame({
    join: { name: "Host" },
    onWelcome: () => {},
    onState: () => {},
    onError: () => {},
    onClose: () => {},
    onPeers: (n) => (peerCount = n),
  });
  await settle(150);
  const [hostSide, guestSide] = pair();
  host.accept("kid", hostSide);
  const guest = joinGame({
    join: { name: "Kid" },
    channel: guestSide,
    onWelcome: () => {},
    onState: () => {},
    onError: () => {},
    onClose: (e) => (guestClosed = e),
  });
  await settle(200);
  assert.equal(peerCount, 2);
  assert.equal(host.world.players.size, 2);

  // A guest leaving must free the seat, or a tank fills up with ghosts.
  guest.close();
  await settle(200);
  assert.equal(peerCount, 1, "the seat is freed");
  assert.equal(host.world.players.size, 1);

  // A second guest, then the host leaves: the guest must be told why.
  const [h2, g2] = pair();
  host.accept("other", h2);
  let told = null;
  joinGame({
    join: { name: "Other" },
    channel: g2,
    onWelcome: () => {},
    onState: () => {},
    onError: () => {},
    onClose: (e) => (told = e),
  });
  await settle(200);
  host.close();
  await settle(200);
  assert.equal(told?.reason, "Host left", "guests learn the host went away");
});

// A hosted tank exists to be joined, so it has to wait somewhere while the
// code is carried to another device. Without this it went straight into a
// round, and a host who backed out of that round to look for a lobby took the
// tank with them: the friend's code then found nothing.
test("a hosted tank waits in a lobby and starts on the host's word", async () => {
  const hostStates = [],
    guestStates = [];
  const host = hostGame({
    lobby: true,
    join: { name: "Ivar" },
    onWelcome: () => {},
    onState: (s) => hostStates.push(s),
    onError: () => assert.fail("host should not error"),
    onClose: () => {},
  });
  try {
    await settle(200);
    assert.equal(hostStates.at(-1).phase, "lobby", "hosting does not deal in");
    assert.equal(
      hostStates.at(-1).lobby.host,
      "host",
      "the one who hosts runs the lobby",
    );

    const [hostSide, guestSide] = pair();
    host.accept("kid", hostSide);
    const guest = joinGame({
      join: { name: "Kid" },
      channel: guestSide,
      onWelcome: () => {},
      onState: (s) => guestStates.push(s),
      onError: () => {},
      onClose: () => {},
    });
    await settle(250);
    assert.equal(
      guestStates.at(-1).phase,
      "lobby",
      "the guest lands in it too",
    );
    assert.equal(guestStates.at(-1).players.length, 2);

    // A guest cannot start the game, however it asks.
    guest.request("START");
    await settle(200);
    assert.equal(hostStates.at(-1).phase, "lobby", "only the host starts it");

    // Nor can the host, until everyone has readied up.
    host.request("START");
    await settle(200);
    assert.equal(hostStates.at(-1).phase, "lobby", "not before everyone is in");

    guest.request("READY", { ready: true });
    host.request("READY", { ready: true });
    await settle(200);
    assert.deepEqual(
      [...hostStates.at(-1).lobby.ready].sort(),
      ["host", "kid"],
      "both are ready",
    );
    host.request("START");
    await settle(250);
    assert.equal(hostStates.at(-1).phase, "playing");
    assert.equal(guestStates.at(-1).phase, "playing", "and for the guest");
  } finally {
    host.close();
    await settle(120);
  }
});

test("a full tank turns a peer away instead of seating it", async () => {
  const host = hostGame({
    join: { name: "Host" },
    onWelcome: () => {},
    onState: () => {},
    onError: () => {},
    onClose: () => {},
  });
  try {
    await settle(150);
    const seated = [];
    for (let i = 0; i < C.maxPlayers - 1; i++) {
      const [h, g] = pair();
      host.accept(`kid${i}`, h);
      joinGame({
        join: { name: `Kid ${i}` },
        channel: g,
        onWelcome: () => {},
        onState: () => {},
        onError: () => {},
        onClose: () => {},
      });
      seated.push(g);
    }
    await settle(300);
    assert.equal(host.world.players.size, C.maxPlayers);
    // One too many.
    const [h, g] = pair();
    let refused = null;
    host.accept("extra", h);
    joinGame({
      join: { name: "Extra" },
      channel: g,
      onWelcome: () => assert.fail("should not be seated"),
      onState: () => {},
      onError: (m) => (refused = m),
      onClose: () => {},
    });
    await settle(250);
    assert.match(refused ?? "", /full/i);
    assert.equal(host.world.players.size, C.maxPlayers, "no extra fish");
  } finally {
    host.close();
    await settle(120);
  }
});
