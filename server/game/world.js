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
  constructor(random = Math.random) {
    this.random = random;
    this.players = new Map();
    this.npcs = [];
    this.events = [];
    this.phase = "playing";
    this.remaining = C.roundLength;
    this.round = 1;
    this.filter = { armed: false, cooldown: 0, on: [] };
    this.seedNPCs();
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
  nextRound() {
    if (this.phase !== "results") return false;
    this.phase = "playing";
    this.remaining = C.roundLength;
    this.round++;
    this.filter = { armed: false, cooldown: 0, on: [] };
    this.seedNPCs();
    for (const p of this.players.values()) {
      p.mass = C.startMass;
      p.score = 0;
      this.spawn(p);
    }
    return true;
  }
  tick(dt) {
    if (!this.players.size || this.phase !== "playing") return;
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
      if (f.npc) {
        f.decision -= dt;
        if (f.decision <= 0) {
          f.turn = (this.random() - 0.5) * 1.5;
          f.vertical = (this.random() - 0.5) * 0.4;
          f.decision = 1 + this.random() * 3;
        }
        const prey = this.huntTarget(f);
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
      } else {
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
      x: f.x,
      y: f.y,
      z: f.z,
      yaw: f.yaw,
      pitch: f.pitch,
      mass: f.mass,
      score: f.score,
      color: f.color,
      alive: f.alive,
      protection: f.protection,
      respawn: f.respawn,
      killedBy: f.killedBy,
      hidden: f.npc ? undefined : inCover(f),
      stunned: f.stunned > 0 ? f.stunned : undefined,
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
    };
  }
}
