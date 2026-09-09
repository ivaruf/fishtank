import test from "node:test";
import assert from "node:assert/strict";
import { createPacker, createUnpacker } from "../shared/snapshot-codec.js";
import { World } from "../shared/world.js";
import { CONFIG as C, wrap } from "../shared/config.js";

// A world with people in it, run far enough that fish have spread out, turned
// to face all directions, grown, and started eating each other.
function busyWorld(players = 4, seconds = 6) {
  const world = new World(Math.random);
  for (let i = 0; i < players; i++) world.addPlayer(`p${i}`, `Player ${i}`);
  for (const [i, p] of [...world.players.values()].entries())
    world.setInput(p.id, {
      forward: 1,
      strafe: i % 2 ? 1 : -1,
      yaw: -Math.PI + (i / players) * 2 * Math.PI,
      pitch: i % 2 ? 0.8 : -0.9,
    });
  for (let t = 0; t < seconds * C.tickRate; t++) world.tick(1 / C.tickRate);
  return world;
}

// The pair, wired up the way peer.js will: rosters travel reliably and in
// order, frames may be dropped but never reordered past a roster.
function link() {
  const packer = createPacker();
  const unpacker = createUnpacker();
  return {
    packer,
    unpacker,
    // Returns the decoded snapshot, plus the bytes so a test can weigh them.
    send(snapshot) {
      const { roster, frame } = packer.pack(snapshot);
      if (roster) unpacker.roster(structuredClone(roster));
      return { seen: unpacker.unpack(frame.slice()), frame, roster };
    },
  };
}

test("a packed snapshot survives the round trip", () => {
  const world = busyWorld();
  const sent = world.snapshot();
  const { seen } = link().send(sent);
  assert.ok(seen, "the frame decoded");

  assert.equal(seen.type, "WORLD_STATE");
  assert.equal(seen.round, sent.round);
  assert.equal(seen.phase, sent.phase);
  assert.ok(Math.abs(seen.remaining - sent.remaining) < 0.02);
  assert.equal(seen.filter.armed, sent.filter.armed);
  assert.equal(seen.filter.cooldown, sent.filter.cooldown);
  assert.equal(seen.players.length, sent.players.length);
  assert.equal(seen.npcs.length, sent.npcs.length);

  // Identity is exact: it comes from the roster, not the frame.
  for (const [kind, tolerance] of [
    ["players", { angle: 0.0002 }],
    // Wild fish trade angle precision for bytes: a byte of yaw is 1.4°.
    ["npcs", { angle: 0.013 }],
  ])
    for (const [i, before] of sent[kind].entries()) {
      const after = seen[kind][i];
      const where = `${kind}[${i}] (${before.id})`;
      assert.equal(after.id, before.id, where);
      assert.equal(after.name, before.name, where);
      assert.equal(after.species, before.species, where);
      assert.equal(after.color, before.color, where);
      assert.equal(after.npc, before.npc, where);
      assert.equal(after.alive, before.alive, where);
      for (const axis of ["x", "y", "z"])
        assert.ok(
          Math.abs(after[axis] - before[axis]) <= 0.005,
          `${where} ${axis}: ${before[axis]} -> ${after[axis]}`,
        );
      // Compared as an angle, not as a number: a heading of 3.142 comes back
      // as -3.1412, which is the same way round. The client does the same,
      // steering by wrap(target - current).
      assert.ok(
        Math.abs(wrap(after.yaw - before.yaw)) <= tolerance.angle,
        `${where} yaw: ${before.yaw} -> ${after.yaw}`,
      );
      assert.ok(
        Math.abs(after.pitch - before.pitch) <= tolerance.angle,
        `${where} pitch: ${before.pitch} -> ${after.pitch}`,
      );
      // Mass drives the radius everyone is drawn at, so it has to survive the
      // ×32 scale that squeezes a 1800 cap into two bytes.
      assert.ok(
        Math.abs(after.mass - before.mass) <= 1 / 32,
        `${where} mass: ${before.mass} -> ${after.mass}`,
      );
      if (kind === "players") {
        assert.equal(after.score, before.score, where);
        assert.equal(after.hidden, !!before.hidden, where);
      }
    }
});

test("negative headings come back negative, not the long way round", () => {
  // A byte of yaw is unsigned, so this is where a wild fish facing -3 rad used
  // to decode as +3.28: the same heading, but interpolation spins it 200° the
  // wrong way to get there.
  const world = new World(Math.random);
  world.addPlayer("p", "Player");
  const sent = world.snapshot();
  for (const [i, fish] of sent.npcs.entries())
    fish.yaw = -Math.PI + (i / sent.npcs.length) * 2 * Math.PI;
  sent.players[0].yaw = -2.5;
  const { seen } = link().send(sent);
  assert.ok(Math.abs(seen.players[0].yaw - -2.5) < 0.0002);
  for (const [i, fish] of seen.npcs.entries()) {
    assert.ok(
      Math.abs(fish.yaw - sent.npcs[i].yaw) <= 0.013,
      `npc ${i}: ${sent.npcs[i].yaw} -> ${fish.yaw}`,
    );
    assert.ok(fish.yaw >= -Math.PI - 0.02 && fish.yaw <= Math.PI + 0.02);
  }
});

test("the roster is only sent when the cast changes", () => {
  const world = busyWorld(2, 2);
  const wire = link();
  const first = wire.send(world.snapshot());
  assert.ok(first.roster, "the first frame has to describe everyone");

  // Nothing joins or leaves: the fish move, and that is all the frame carries.
  world.tick(1 / C.tickRate);
  const quiet = wire.send(world.snapshot());
  assert.equal(quiet.roster, null, "no roster for a frame that only moved");
  assert.ok(quiet.seen);

  // Someone joins.
  world.addPlayer("late", "Latecomer", "shark");
  const joined = wire.send(world.snapshot());
  assert.ok(joined.roster, "a new fish needs announcing");
  assert.deepEqual(
    joined.roster.add.map((entry) => entry[1]),
    ["late"],
    "only the newcomer, not the whole tank",
  );
  assert.equal(joined.seen.players.at(-1).name, "Latecomer");
  assert.equal(joined.seen.players.at(-1).species, "shark");

  // And leaves: the slot is released and reused rather than growing forever.
  const slot = joined.roster.add[0][0];
  world.removePlayer("late");
  const left = wire.send(world.snapshot());
  assert.deepEqual(left.roster.drop, [slot]);
  world.addPlayer("newer", "Newer");
  const reused = wire.send(world.snapshot());
  assert.equal(reused.roster.add[0][0], slot, "the freed slot came back round");
  assert.equal(reused.seen.players.at(-1).name, "Newer");
});

test("a frame from a roster you have not got yet is dropped, not guessed", () => {
  const world = busyWorld(2, 2);
  const packer = createPacker();
  const unpacker = createUnpacker();
  const first = packer.pack(world.snapshot());
  unpacker.roster(first.roster);
  assert.ok(unpacker.unpack(first.frame), "in step to begin with");

  // The cast changes, and the guest misses the roster — the two lanes have no
  // ordering between them, so this is a real arrival order.
  world.addPlayer("late", "Latecomer");
  const ahead = packer.pack(world.snapshot());
  assert.ok(ahead.roster);
  assert.equal(
    unpacker.unpack(ahead.frame),
    null,
    "refuses a frame it cannot read",
  );

  // Once the roster lands, the next frame is fine.
  unpacker.roster(ahead.roster);
  world.tick(1 / C.tickRate);
  const after = packer.pack(world.snapshot());
  assert.equal(after.roster, null);
  assert.equal(unpacker.unpack(after.frame).players.length, 3);
});

test("someone seated mid-game is told the whole cast, not just the news", () => {
  // The bug this pins: rosters that ride along with frames are deltas, so a
  // peer that joins after the tank was populated decoded a world containing
  // only the fish that arrived after it did — one player in a tank of 101.
  const world = busyWorld(2, 3);
  const packer = createPacker();
  packer.pack(world.snapshot()); // the tank has been running for a while

  world.addPlayer("late", "Latecomer");
  const latecomer = createUnpacker();
  latecomer.roster(packer.full()); // what hostGame sends with the WELCOME
  const { roster, frame } = packer.pack(world.snapshot());
  if (roster) latecomer.roster(roster);

  const seen = latecomer.unpack(frame);
  assert.ok(seen, "the newcomer can read the frame");
  assert.equal(seen.players.length, 3, "everybody, not just itself");
  assert.equal(seen.npcs.length, world.npcs.length, "and all the wild fish");
  assert.ok(
    seen.players.every((p) => p.species && p.name),
    "with their names and species, which only the roster carries",
  );
});

test("the lobby survives packing, by slot rather than by id", () => {
  const world = new World(Math.random, { lobby: true });
  world.addPlayer("host", "Ivar");
  world.addPlayer("kid", "Kid");
  world.setReady("kid", true);
  world.setDuration("host", 180);
  world.setDifficulty("host", 5);
  const { seen } = link().send(world.snapshot());
  assert.equal(seen.phase, "lobby");
  assert.equal(seen.lobby.host, "host");
  assert.equal(seen.lobby.duration, 180);
  // A guest has to see what it is about to swim into, so the chosen tier rides
  // along with the duration rather than being the host's private business.
  assert.equal(seen.lobby.difficulty, 5);
  assert.deepEqual(seen.lobby.ready, ["kid"]);
});

test("a full tank packs small enough to stop being a bandwidth problem", () => {
  const world = busyWorld(C.maxPlayers, 8);
  const snapshot = world.snapshot();
  const { frame } = link().send(snapshot);
  const json = Buffer.byteLength(JSON.stringify(snapshot));
  const fish = snapshot.players.length + snapshot.npcs.length;
  const upload = (bytes, peers) =>
    ((bytes * C.broadcastRate * peers * 8) / 1e6).toFixed(1);
  console.log(
    `\n    ${fish} fish, ${snapshot.players.length} of them players` +
      `\n      JSON            ${(json / 1024).toFixed(1)} KB   ` +
      `${upload(json, 3)} Mbit/s up at 3 peers, ${upload(json, 15)} at 15` +
      `\n      packed          ${(frame.length / 1024).toFixed(1)} KB   ` +
      `${upload(frame.length, 3)} Mbit/s up at 3 peers, ` +
      `${upload(frame.length, 15)} at 15` +
      `\n      saved           ${(100 - (frame.length / json) * 100).toFixed(1)}%\n`,
  );
  assert.ok(
    frame.length < json / 8,
    `packing should be well under an eighth of the JSON: ${frame.length} vs ${json}`,
  );
  // The interoperable data-channel message limit, which the JSON exceeded.
  assert.ok(
    frame.length < 16384,
    `a frame must fit the 16 KB limit: ${frame.length}`,
  );
});
