import test from "node:test";
import assert from "node:assert/strict";
import { playLocally } from "../client/js/local.js";
import { CONFIG as C, PROTOCOL } from "../shared/config.js";

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// Solo runs the same World the server runs, in the tab, so it costs no
// bandwidth and works with the network gone. It has to behave like the socket
// transport, because main.js cannot tell the two apart.
test("solo plays entirely locally and matches the socket transport", async () => {
  const states = [];
  let welcome = null,
    closed = null;
  const game = playLocally({
    join: { name: "  Ivar  ", mode: "single", species: "shark" },
    onWelcome: (id, protocol, roomName) =>
      (welcome = { id, protocol, roomName }),
    onState: (s) => states.push(s),
    onError: () => assert.fail("a local game has nothing to fail at"),
    onClose: (e) => (closed = e),
  });
  try {
    // Welcome arrives on a later turn, as a socket's would.
    assert.equal(welcome, null, "not before the caller has finished wiring up");
    await settle(300);
    assert.equal(welcome.protocol, PROTOCOL);
    assert.equal(welcome.roomName, null, "solo is not a named tank");

    const first = states[0];
    assert.equal(first.type, "WORLD_STATE");
    assert.equal(first.phase, "playing", "solo skips the lobby");
    assert.equal(first.npcs.length, C.npcCount);
    assert.equal(first.players.length, 1);
    assert.equal(
      first.players[0].name,
      "Ivar",
      "name is trimmed as on the server",
    );
    assert.equal(first.players[0].species, "shark");
    assert.equal(first.lobby, undefined);

    // Snapshots keep coming at roughly the published rate.
    const before = states.length;
    await settle(700);
    const rate = (states.length - before) / 0.7;
    assert.ok(
      rate > 5 && rate < C.broadcastRate * 1.6,
      `~${rate.toFixed(0)} snapshots/s`,
    );

    // Input steers the same simulation: the fish must actually move.
    const me = () => states.at(-1).players[0];
    const start = { ...me() };
    game.send({ forward: 1, strafe: 0, yaw: 0, pitch: 0 });
    await settle(500);
    assert.ok(
      Math.hypot(me().x - start.x, me().y - start.y, me().z - start.z) > 0.5,
      "forward input moves the fish",
    );
    // And releasing stops it, the same contract the server honours.
    game.send({ forward: 0, strafe: 0, yaw: 0, pitch: 0 });
    await settle(C.inputTimeout * 1000 + 300);
    const parked = { ...me() };
    await settle(300);
    assert.ok(
      Math.hypot(me().x - parked.x, me().y - parked.y, me().z - parked.z) <
        1e-6,
      "released input parks the fish",
    );

    // Lobby-only requests are ignored rather than throwing.
    for (const type of ["READY", "SETTINGS", "START"]) game.request(type);
  } finally {
    game.close();
  }
  // Closing stops the world and reports it, but never synchronously: the
  // caller clears its reference in between, and a sync call would re-enter it.
  assert.equal(
    closed,
    null,
    "close is reported on a later turn, like a socket",
  );
  const after = states.length;
  await settle(300);
  assert.equal(closed.code, 1000);
  assert.equal(states.length, after, "no snapshots once closed");
});
