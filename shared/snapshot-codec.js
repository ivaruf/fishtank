// Snapshots, packed.
//
// A WebSocket could lean on permessage-deflate and send 1.8 KB a frame.
// Data channels do not compress, so peer to peer was sending the raw 17.2 KB —
// 6.3 Mbit/s of host upload at three peers, measured 4.2 Mbit/s from a phone on
// 5G with two iPads connected, which is roughly 1.9 GB an hour off somebody's
// mobile allowance. It also sat above 16 KB, which is the *interoperable*
// data-channel message limit; Chrome to Chrome and Safari to Safari have both
// carried it here, but that is luck we do not need to keep spending.
//
// The split is between what changes every frame and what does not:
//
//   roster   id, name, species and colour. Sent on the reliable lane, only
//            when the cast changes, as a delta. A fish is a slot number from
//            then on.
//   frame    numbers only, quantised, on the lossy lane. No strings at all.
//
// Every frame carries the roster version it was packed against, and a guest
// drops any frame it cannot interpret yet — one frame at 15 Hz, invisible —
// rather than guessing. The two lanes have no ordering guarantee between them,
// so this is the only safe way round.
//
// Quantisation is deliberate and one-way: the host's own world keeps full
// precision, and this is what everyone else sees. It is the same trade
// shared/world.js already makes with wire(), just further.
import { wrap } from "./config.js";

const MAGIC = 0xf1;
const CODEC = 1;
// Order is the wire format; appending is safe, reordering is not.
const PHASES = ["lobby", "playing", "results"];
const NONE = 0xffff;

// Scales. The tank spans ±34 and mass caps at CONFIG.massCap, now 900, which
// is what decides each width below. The cap was 1800 when these were chosen,
// so MASS has room to spare rather than being tight: raising it would buy
// precision nobody can see, and would change the wire format to do it.
const POS = 100; // 0.01 of a unit, inside an i16's ±327
const ANGLE = 10000; // radians: yaw wraps to ±π, so ±31416 fits an i16
const MASS = 32; // 900 × 32 leaves half a u16 spare; 0.03 of a unit, invisible
const TIME = 100; // the short countdowns, in centiseconds
// Nobody aims a wild fish, so they get coarser angles: a byte of yaw is 1.4°.
const NPC_YAW = 256 / (2 * Math.PI);
const NPC_PITCH = 80; // pitch clamps to ±1.35, so ±108 fits an i8

const FLAG = {
  alive: 1 << 0,
  hidden: 1 << 1,
  protection: 1 << 2,
  respawn: 1 << 3,
  stunned: 1 << 4,
  killedBy: 1 << 5,
};

const clampTo = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const q = (value, scale, lo, hi) =>
  clampTo(Math.round((Number.isFinite(value) ? value : 0) * scale), lo, hi);
const i16 = (value, scale) => q(value, scale, -32768, 32767);
const u16 = (value, scale) => q(value, scale, 0, 65535);

// What the roster carries about a fish: everything that will not change for as
// long as it is in the tank.
const still = (f) => ({
  id: f.id,
  npc: !!f.npc,
  name: f.name,
  species: f.species,
  color: f.color,
});
const same = (a, b) =>
  a.id === b.id &&
  a.npc === b.npc &&
  a.name === b.name &&
  a.species === b.species &&
  a.color === b.color;

// The host's side: hands out slots, notices when the cast changes, and packs.
export function createPacker() {
  let slots = new Map(); // id -> slot
  let known = new Map(); // slot -> still()
  let free = []; // slots to reuse, so the numbers stay small and u16-sized
  let version = 0;

  // Diff this snapshot's cast against the last one. Returns a roster message,
  // or null when nothing changed — which is the common case.
  function reslot(fish) {
    const add = [];
    const seen = new Set();
    for (const f of fish) {
      seen.add(f.id);
      const slot = slots.get(f.id);
      const now = still(f);
      const before = slot === undefined ? undefined : known.get(slot);
      if (before && same(before, now)) continue;
      // A fish whose static data changed (a player picking a new species
      // between rounds) is re-announced in place rather than reslotted.
      const at = slot ?? free.pop() ?? slots.size + free.length;
      slots.set(f.id, at);
      known.set(at, now);
      add.push([at, now.id, now.npc ? 1 : 0, now.name, now.species, now.color]);
    }
    const drop = [];
    for (const [id, slot] of slots)
      if (!seen.has(id)) {
        drop.push(slot);
        slots.delete(id);
        known.delete(slot);
        free.push(slot);
      }
    if (!add.length && !drop.length) return null;
    return { type: "ROSTER", v: ++version, add, drop };
  }

  return {
    get version() {
      return version;
    },
    // The whole cast, for someone who has just arrived. The deltas above only
    // describe changes since the last frame, so a peer seated mid-game would
    // otherwise never hear about the host or any of the hundred wild fish —
    // it would decode a tank containing only whoever joined after it did.
    full() {
      return {
        type: "ROSTER",
        v: version,
        reset: 1,
        add: [...known].map(([slot, f]) => [
          slot,
          f.id,
          f.npc ? 1 : 0,
          f.name,
          f.species,
          f.color,
        ]),
        drop: [],
      };
    },
    // Returns { roster, frame }: roster is null unless the cast changed, and
    // must be sent on the reliable lane before the frame goes out.
    pack(snapshot) {
      const players = snapshot.players ?? [];
      const npcs = snapshot.npcs ?? [];
      const roster = reslot([...players, ...npcs]);
      const slot = (id) => slots.get(id) ?? NONE;

      const ready = snapshot.lobby?.ready ?? [];
      // Worst case per fish, sliced to the true length at the end.
      const bytes = new Uint8Array(
        32 + ready.length * 2 + players.length * 33 + npcs.length * 25,
      );
      const view = new DataView(bytes.buffer);
      let at = 0;
      const u8 = (v) => view.setUint8(at++, v);
      const i8 = (v) => view.setInt8(at++, v);
      const w16 = (v) => {
        view.setInt16(at, v);
        at += 2;
      };
      const w16u = (v) => {
        view.setUint16(at, v);
        at += 2;
      };
      const w32 = (v) => {
        view.setUint32(at, v);
        at += 4;
      };

      u8(MAGIC);
      u8(CODEC);
      w16u(version);
      w16u(clampTo(snapshot.round ?? 1, 0, 65535));
      u8(Math.max(0, PHASES.indexOf(snapshot.phase)));
      w16u(u16(snapshot.remaining ?? 0, TIME));
      u8(snapshot.filter?.armed ? 1 : 0);
      w16u(clampTo(Math.ceil(snapshot.filter?.cooldown ?? 0), 0, 65535));
      if (snapshot.lobby) {
        u8(1);
        w16u(slot(snapshot.lobby.host));
        w16u(clampTo(Math.round(snapshot.lobby.duration ?? 0), 0, 65535));
        w16u(ready.length);
        for (const id of ready) w16u(slot(id));
      } else u8(0);

      w16u(players.length);
      for (const f of players) {
        w16u(slot(f.id));
        w16(i16(f.x, POS));
        w16(i16(f.y, POS));
        w16(i16(f.z, POS));
        // The simulation does not keep headings inside ±π — a fish turning
        // steadily was measured at -4.712 — so wrap before quantising or the
        // i16 clamps it to a heading the fish is not facing. Safe to do: the
        // client steers by wrap(target - current), so only the heading counts.
        w16(i16(wrap(f.yaw ?? 0), ANGLE));
        w16(i16(f.pitch, ANGLE));
        w16u(u16(f.mass, MASS));
        w32(clampTo(Math.round(f.score ?? 0), 0, 4294967295));
        const flags =
          (f.alive ? FLAG.alive : 0) |
          (f.hidden ? FLAG.hidden : 0) |
          (f.protection > 0 ? FLAG.protection : 0) |
          (f.respawn > 0 ? FLAG.respawn : 0) |
          (f.stunned > 0 ? FLAG.stunned : 0) |
          (f.killedBy != null ? FLAG.killedBy : 0);
        u8(flags);
        if (flags & FLAG.protection) w16u(u16(f.protection, TIME));
        if (flags & FLAG.respawn) w16u(u16(f.respawn, TIME));
        if (flags & FLAG.stunned) w16u(u16(f.stunned, TIME));
        if (flags & FLAG.killedBy) w16u(slot(f.killedBy));
      }

      w16u(npcs.length);
      for (const f of npcs) {
        w16u(slot(f.id));
        w16(i16(f.x, POS));
        w16(i16(f.y, POS));
        w16(i16(f.z, POS));
        // A whole turn in one byte, wrapped for the same reason as above.
        u8(Math.round(wrap(f.yaw ?? 0) * NPC_YAW) & 255);
        i8(q(f.pitch, NPC_PITCH, -128, 127));
        w16u(u16(f.mass, MASS));
        const flags =
          (f.alive ? FLAG.alive : 0) | (f.stunned > 0 ? FLAG.stunned : 0);
        u8(flags);
        if (flags & FLAG.stunned) w16u(u16(f.stunned, TIME));
      }
      return { roster, frame: bytes.subarray(0, at) };
    },
  };
}

// A guest's side: keeps the roster it has been told about, and turns frames
// back into the snapshot shape the rest of the client already reads.
export function createUnpacker() {
  const known = new Map(); // slot -> still()
  let version = 0;

  return {
    get version() {
      return version;
    },
    // Apply a roster delta. Out-of-order deltas cannot happen: they travel the
    // reliable, ordered lane.
    roster(message) {
      // A full roster replaces what we think we know; a delta amends it.
      if (message.reset) known.clear();
      for (const [slot, id, npc, name, species, color] of message.add ?? [])
        known.set(slot, { id, npc: !!npc, name, species, color });
      for (const slot of message.drop ?? []) known.delete(slot);
      version = message.v;
    },
    // Returns the snapshot, or null when this frame belongs to a roster we do
    // not have yet. Dropping it is correct: the roster is on its way, and the
    // next frame is 66 ms behind this one.
    unpack(bytes) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      let at = 0;
      const u8 = () => view.getUint8(at++);
      const i8 = () => view.getInt8(at++);
      const r16 = () => {
        const v = view.getInt16(at);
        at += 2;
        return v;
      };
      const r16u = () => {
        const v = view.getUint16(at);
        at += 2;
        return v;
      };
      const r32 = () => {
        const v = view.getUint32(at);
        at += 4;
        return v;
      };

      if (u8() !== MAGIC || u8() !== CODEC) return null;
      const packedAgainst = r16u();
      if (packedAgainst !== version) return null;
      const lookup = (slot) => known.get(slot);
      const idOf = (slot) => known.get(slot)?.id;
      // Back into the ±π that wrap() produces, not the 0..2π a raw byte would
      // give: the two are the same heading, but a fish interpolated from 5.28
      // to -1.01 spins the long way round.
      const npcYaw = (byte) => (byte > 127 ? byte - 256 : byte) / NPC_YAW;

      const round = r16u();
      const phase = PHASES[u8()] ?? "playing";
      const remaining = r16u() / TIME;
      const armed = !!u8();
      const cooldown = r16u();
      let lobby;
      if (u8()) {
        const host = idOf(r16u()) ?? null;
        const duration = r16u();
        const count = r16u();
        const ready = [];
        for (let i = 0; i < count; i++) {
          const id = idOf(r16u());
          if (id !== undefined) ready.push(id);
        }
        lobby = { host, duration, ready };
      }

      const players = [];
      for (let n = r16u(); n > 0; n--) {
        const who = lookup(r16u());
        const fish = {
          x: r16() / POS,
          y: r16() / POS,
          z: r16() / POS,
          yaw: r16() / ANGLE,
          pitch: r16() / ANGLE,
          mass: r16u() / MASS,
          score: r32(),
        };
        const flags = u8();
        fish.alive = !!(flags & FLAG.alive);
        fish.hidden = !!(flags & FLAG.hidden);
        fish.protection = flags & FLAG.protection ? r16u() / TIME : 0;
        fish.respawn = flags & FLAG.respawn ? r16u() / TIME : 0;
        if (flags & FLAG.stunned) fish.stunned = r16u() / TIME;
        if (flags & FLAG.killedBy) fish.killedBy = idOf(r16u());
        // A fish whose slot we somehow do not know is skipped rather than
        // rendered nameless: it has been read off the wire, so the cursor is
        // already past it.
        if (who) players.push({ ...who, ...fish });
      }

      const npcs = [];
      for (let n = r16u(); n > 0; n--) {
        const who = lookup(r16u());
        const fish = {
          x: r16() / POS,
          y: r16() / POS,
          z: r16() / POS,
          yaw: npcYaw(u8()),
          pitch: i8() / NPC_PITCH,
          mass: r16u() / MASS,
        };
        const flags = u8();
        fish.alive = !!(flags & FLAG.alive);
        if (flags & FLAG.stunned) fish.stunned = r16u() / TIME;
        if (who) npcs.push({ ...who, ...fish });
      }

      return {
        type: "WORLD_STATE",
        round,
        phase,
        remaining,
        players,
        npcs,
        filter: { armed, cooldown },
        lobby,
      };
    },
  };
}
