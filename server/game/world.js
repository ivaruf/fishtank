import {
  CONFIG as C,
  radius,
  direction,
  clamp,
  wrap,
  SPECIES,
  speciesLabel,
  inCover,
  outweighs,
  FILTER,
  onButton,
} from "../../shared/config.js";
import { movementVector, parseInput } from "../../shared/movement.js";
// Wire precision, applied only when encoding a snapshot. The simulation itself
// keeps full doubles, so this can never feed back into movement or into who
// outweighs whom. Positions land on 1 cm and angles on ~0.06 degrees, both
// finer than the client draws, and short decimals compress far better than a
// 17-digit float: together with permessage-deflate this is ~90% off the wire.
// Mass stays at 2dp so the client's food-or-danger tint still matches the
// server's own comparison for fish of nearly equal size.
const wire = (n, places) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
};
export function canEat(a, b) {
  if (
    !a.alive ||
    !b.alive ||
    !outweighs(a, b) ||
    a.protection > 0 ||
    b.protection > 0
  )
    return false;
  const d = direction(a),
    r = radius(a.mass);
  return (
    Math.hypot(
      a.x + d.x * r * 0.8 - b.x,
      a.y + d.y * r * 0.8 - b.y,
      a.z + d.z * r * 0.8 - b.z,
    ) <
    r * 0.75 + radius(b.mass) * 0.65
  );
}
export class World {
  // A lobby room waits in phase "lobby" until everyone is ready and the host
  // (the first player in) presses start; solo rooms play straight away.
  constructor(random = Math.random, { lobby = false } = {}) {
    this.random = random;
    this.players = new Map();
    this.npcs = [];
    this.events = [];
    this.roundLength = C.roundLength;
    this.lobby = lobby ? { duration: C.roundLength, ready: new Set() } : null;
    this.phase = lobby ? "lobby" : "playing";
    this.remaining = C.roundLength;
    this.round = 1;
    this.filter = { armed: false, cooldown: 0, on: [] };
    this.seedNPCs();
  }
  get host() {
    return this.players.keys().next().value ?? null;
  }
  removePlayer(id) {
    this.players.delete(id);
    this.lobby?.ready.delete(id);
  }
  setReady(id, ready) {
    if (!this.lobby || this.phase !== "lobby" || !this.players.has(id))
      return false;
    if (ready) this.lobby.ready.add(id);
    else this.lobby.ready.delete(id);
    return true;
  }
  // Host only: match length between one and five minutes.
  setDuration(id, seconds) {
    if (!this.lobby || this.phase !== "lobby" || id !== this.host) return false;
    if (!Number.isFinite(seconds)) return false;
    this.lobby.duration = clamp(Math.round(seconds), 60, 300);
    return true;
  }
  // Host only, and only once every player in the lobby is ready.
  start(id) {
    if (!this.lobby || this.phase !== "lobby" || id !== this.host) return false;
    if ([...this.players.keys()].some((k) => !this.lobby.ready.has(k)))
      return false;
    this.roundLength = this.lobby.duration;
    this.lobby.ready.clear();
    this.beginRound();
    return true;
  }
  beginRound() {
    this.phase = "playing";
    this.remaining = this.roundLength;
    this.filter = { armed: false, cooldown: 0, on: [] };
    this.seedNPCs();
    for (const p of this.players.values()) {
      p.mass = C.startMass;
      p.score = 0;
      this.spawn(p);
    }
  }
  spawn(fish) {
    Object.assign(fish, {
      x: (this.random() - 0.5) * 55,
      y: 4 + this.random() * 20,
      z: (this.random() - 0.5) * 55,
      yaw: this.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      protection: fish.npc ? 0 : C.spawnProtection,
      respawn: 0,
    });
    if (!fish.npc) {
      fish.yaw = Math.atan2(-fish.x, -fish.z);
      fish.input = { forward: 0, strafe: 0, yaw: fish.yaw, pitch: 0 };
      fish.inputAge = 0;
    }
  }
  seedNPCs() {
    this.npcs = Array.from({ length: C.npcCount }, (_, i) => {
      const f = {
        id: `npc-${i}`,
        npc: true,
        mass: i < 75 ? 1 + this.random() * 3 : 5 + this.random() * 22,
        color: i % 5,
        species: SPECIES[i % SPECIES.length],
        decision: 0,
      };
      this.spawn(f);
      return f;
    });
  }
  addPlayer(id, name, species = SPECIES[this.players.size % SPECIES.length]) {
    const p = {
      id,
      name,
      species,
      mass: C.startMass,
      score: 0,
      color: this.players.size % 8,
    };
    this.spawn(p);
    if (this.phase === "lobby") p.alive = false;
    this.players.set(id, p);
    return p;
  }
  setInput(id, message) {
    const player = this.players.get(id),
      input = parseInput(message);
    if (!player || !input || !player.alive || this.phase !== "playing") return;
    player.input = input;
    player.inputAge = 0;
  }
  move(f, dt, speed, d = direction(f)) {
    const r = radius(f.mass);
    f.x = clamp(f.x + d.x * speed * dt, -C.width / 2 + r, C.width / 2 - r);
    f.y = clamp(f.y + d.y * speed * dt, r + 0.5, C.height - r);
    f.z = clamp(f.z + d.z * speed * dt, -C.depth / 2 + r, C.depth / 2 - r);
  }
  // Nearest player this wild fish could eat and is close enough to bother
  // with. Players tucked into the kelp are not hunted, though a fish that
  // blunders into them still eats them.
  huntTarget(npc) {
    let best = null,
      reach = C.npcHuntRange + radius(npc.mass);
    for (const p of this.players.values()) {
      if (!p.alive || p.protection > 0 || !outweighs(npc, p) || inCover(p))
        continue;
      const distance = Math.hypot(p.x - npc.x, p.y - npc.y, p.z - npc.z);
      if (distance < reach) {
        best = p;
        reach = distance;
      }
    }
    return best;
  }
  eat(predator, prey) {
    const before = predator.mass;
    predator.mass = Math.min(1800, predator.mass + prey.mass * C.growth);
    if (!predator.npc) predator.score += Math.round(prey.mass * 10);
    prey.alive = false;
    if (prey.chunk) prey.gone = true;
    prey.respawn = prey.npc ? 2 + this.random() * 3 : C.respawnDelay;
    prey.killedBy = predator.npc
      ? `a wild ${speciesLabel(predator.species)}`
      : predator.name;
    this.events.push({
      type: prey.npc ? "NPC_EATEN" : "PLAYER_EATEN",
      predator: predator.id,
      prey: prey.id,
      // What was eaten and how much the eater grew, for the eater's toast.
      label: prey.npc ? speciesLabel(prey.species) : prey.name,
      grew: +(predator.mass - before).toFixed(1),
    });
  }
  // The filter arms a minute into the round. A press is a fish arriving on
  // its button; when live it zaps, otherwise it just buzzes.
  pressFilter(dt) {
    const f = this.filter;
    f.cooldown = Math.max(0, f.cooldown - dt);
    if (!f.armed && C.roundLength - this.remaining >= FILTER.armAfter) {
      f.armed = true;
      this.events.push({ type: "FILTER_ARMED" });
    }
    const players = [...this.players.values()].filter((p) => p.alive);
    const now = players.filter((p) => onButton(p)).map((p) => p.id);
    const arrivals = now.filter((id) => !f.on.includes(id));
    f.on = now;
    for (const id of arrivals) {
      if (f.armed && f.cooldown <= 0) this.zap(id);
      else this.events.push({ type: "BUZZ", by: id });
    }
  }
  // The heaviest player takes the hit, or the heaviest wild fish when alone.
  zap(by) {
    this.filter.cooldown = FILTER.cooldown;
    const players = [...this.players.values()].filter((p) => p.alive);
    const pool =
      players.length > 1
        ? players
        : this.npcs.filter((n) => n.alive && !n.chunk);
    const target = pool.reduce((a, b) => (b.mass > a.mass ? b : a), pool[0]);
    if (!target) return;
    const lost =
      target.mass - Math.max(C.startMass, target.mass * FILTER.shrink);
    target.mass -= lost;
    target.stunned = FILTER.stun;
    if (!target.npc) {
      target.input.forward = 0;
      target.input.strafe = 0;
    }
    // The lost mass scatters as minnows of the same species that anyone can
    // eat (capped small enough for a fresh spawn); they never respawn.
    const count = Math.min(
      12,
      Math.max(2, Math.round(lost / FILTER.chunkMass)),
    );
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.random(),
        r = radius(target.mass) + 2 + this.random() * 2;
      const f = {
        id: `chunk-${this.round}-${this.remaining.toFixed(2)}-${i}`,
        npc: true,
        chunk: true,
        mass: Math.min(FILTER.chunkMass, Math.max(0.6, lost / count)),
        color: i % 5,
        species: target.species,
        decision: 0,
      };
      this.spawn(f);
      Object.assign(f, {
        x: clamp(target.x + Math.cos(a) * r, -34, 34),
        y: clamp(target.y + (this.random() - 0.5) * 3, 1.5, 28),
        z: clamp(target.z + Math.sin(a) * r, -34, 34),
      });
      this.npcs.push(f);
    }
    this.events.push({
      type: "ZAP",
      target: target.id,
      by,
      lost: +lost.toFixed(1),
    });
  }
  // Results stay up until a player asks for the next round.
  // Results stay up until someone asks for the next round. Lobby rooms go back
  // to the lobby to ready up again; solo rooms start straight away.
  nextRound() {
    if (this.phase !== "results") return false;
    this.round++;
    if (this.lobby) {
      this.phase = "lobby";
      this.lobby.ready.clear();
      for (const p of this.players.values()) p.alive = false;
      return true;
    }
    this.beginRound();
    return true;
  }
  // Wild fish wander, and the big ones drift toward a lighter player nearby.
  steerNPC(f, dt) {
    f.decision -= dt;
    if (f.decision <= 0) {
      f.turn = (this.random() - 0.5) * 1.5;
      f.vertical = (this.random() - 0.5) * 0.4;
      f.decision = 1 + this.random() * 3;
    }
    const prey = this.phase === "playing" ? this.huntTarget(f) : null;
    f.hunting = !!prey;
    if (prey) {
      const dx = prey.x - f.x,
        dy = prey.y - f.y,
        dz = prey.z - f.z;
      f.turn = clamp(wrap(Math.atan2(dx, dz) - f.yaw) * 3, -1.5, 1.5);
      f.vertical = clamp(
        (Math.atan2(dy, Math.hypot(dx, dz)) - f.pitch) * 2,
        -0.6,
        0.6,
      );
    }
    if (Math.abs(f.x) > 29 || Math.abs(f.z) > 29) {
      const target = Math.atan2(-f.x, -f.z);
      f.turn = clamp(wrap(target - f.yaw), -1.5, 1.5);
    }
    f.yaw += f.turn * dt;
    f.pitch = clamp(f.pitch + f.vertical * dt, -0.45, 0.45);
    if (f.y < 3) f.pitch = 0.35;
    if (f.y > 26) f.pitch = -0.35;
  }
  tick(dt) {
    if (!this.players.size) return;
    if (this.phase === "lobby") {
      // The tank keeps living behind the lobby: wild fish swim, nothing eats.
      this.remaining = this.lobby.duration;
      for (const f of this.npcs)
        if (f.alive) {
          this.steerNPC(f, dt);
          this.move(f, dt, 2.4 + 1 / radius(f.mass));
        }
      return;
    }
    if (this.phase !== "playing") return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.phase = "results";
      this.remaining = 0;
      this.events.push({ type: "ROUND_END" });
      return;
    }
    for (const f of [...this.players.values(), ...this.npcs]) {
      if (!f.alive) {
        f.respawn -= dt;
        if (f.respawn <= 0) {
          if (!f.npc) f.mass = C.startMass;
          this.spawn(f);
        }
        continue;
      }
      f.protection = Math.max(0, f.protection - dt);
      if (f.stunned > 0) {
        f.stunned = Math.max(0, f.stunned - dt);
        continue;
      }
      if (f.npc) this.steerNPC(f, dt);
      else {
        f.inputAge += dt;
        if (f.inputAge > C.inputTimeout) {
          f.input.forward = 0;
          f.input.strafe = 0;
        }
        // Aiming is immediate for movement/camera; the visible fish turns gradually.
        const angle = wrap(f.input.yaw - f.yaw);
        f.yaw += clamp(angle, -C.turnSpeed * dt, C.turnSpeed * dt);
        f.pitch += clamp(
          f.input.pitch - f.pitch,
          -C.turnSpeed * dt,
          C.turnSpeed * dt,
        );
      }
      const speed = f.npc
        ? (2.4 + 1 / radius(f.mass)) * (f.hunting ? C.npcHuntSpeed : 1)
        : C.speed / (1 + Math.max(0, radius(f.mass) - 1) * 0.08);
      this.move(f, dt, speed, f.npc ? direction(f) : movementVector(f.input));
    }
    this.pressFilter(dt);
    const players = [...this.players.values()];
    for (const p of players)
      for (const f of [...this.npcs, ...players])
        if (p.id !== f.id && canEat(p, f)) this.eat(p, f);
    // Wild fish only ever eat players, so the food supply stays steady.
    for (const n of this.npcs)
      for (const p of players) if (canEat(n, p)) this.eat(n, p);
    if (this.npcs.some((n) => n.gone))
      this.npcs = this.npcs.filter((n) => !n.gone);
  }
  snapshot() {
    const encode = (f) => ({
      id: f.id,
      npc: !!f.npc,
      name: f.name,
      species: f.species,
      x: wire(f.x, 2),
      y: wire(f.y, 2),
      z: wire(f.z, 2),
      yaw: wire(f.yaw, 3),
      pitch: wire(f.pitch, 3),
      mass: wire(f.mass, 2),
      score: f.score,
      color: f.color,
      alive: f.alive,
      protection: wire(f.protection, 2),
      respawn: wire(f.respawn, 2),
      killedBy: f.killedBy,
      hidden: f.npc ? undefined : inCover(f),
      stunned: f.stunned > 0 ? wire(f.stunned, 2) : undefined,
    });
    return {
      type: "WORLD_STATE",
      round: this.round,
      phase: this.phase,
      remaining: this.remaining,
      players: [...this.players.values()].map(encode),
      npcs: this.npcs.map(encode),
      filter: {
        armed: this.filter.armed,
        cooldown: Math.ceil(this.filter.cooldown),
      },
      lobby: this.lobby
        ? {
            host: this.host,
            duration: this.lobby.duration,
            ready: [...this.lobby.ready],
          }
        : undefined,
    };
  }
}
