import {
  CONFIG as C,
  radius,
  direction,
  clamp,
  wrap,
  speciesLabel,
} from "../../shared/config.js";
import { movementVector, parseInput } from "../../shared/movement.js";
export function canEat(a, b) {
  if (
    !a.alive ||
    !b.alive ||
    a.mass < b.mass * C.eatRatio ||
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
        decision: 0,
      };
      this.spawn(f);
      return f;
    });
  }
  addPlayer(id, name) {
    const p = {
      id,
      name,
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
  // Nearest player this wild fish could eat and is close enough to bother with.
  huntTarget(npc) {
    let best = null,
      reach = C.npcHuntRange + radius(npc.mass);
    for (const p of this.players.values()) {
      if (!p.alive || p.protection > 0 || npc.mass < p.mass * C.eatRatio)
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
    prey.respawn = prey.npc ? 2 + this.random() * 3 : C.respawnDelay;
    prey.killedBy = predator.npc
      ? `a wild ${speciesLabel(predator.color)}`
      : predator.name;
    this.events.push({
      type: prey.npc ? "NPC_EATEN" : "PLAYER_EATEN",
      predator: predator.id,
      prey: prey.id,
    });
  }
  tick(dt) {
    if (!this.players.size) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      if (this.phase === "playing") {
        this.phase = "results";
        this.remaining = C.intermission;
        this.events.push({ type: "ROUND_END" });
      } else {
        this.phase = "playing";
        this.remaining = C.roundLength;
        this.round++;
        this.seedNPCs();
        for (const p of this.players.values()) {
          p.mass = C.startMass;
          p.score = 0;
          this.spawn(p);
        }
        return;
      }
    }
    if (this.phase !== "playing") return;
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
    const players = [...this.players.values()];
    for (const p of players)
      for (const f of [...this.npcs, ...players])
        if (p.id !== f.id && canEat(p, f)) this.eat(p, f);
    // Wild fish only ever eat players, so the food supply stays steady.
    for (const n of this.npcs)
      for (const p of players) if (canEat(n, p)) this.eat(n, p);
  }
  snapshot() {
    const encode = (f) => ({
      id: f.id,
      npc: !!f.npc,
      name: f.name,
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
    });
    return {
      type: "WORLD_STATE",
      round: this.round,
      phase: this.phase,
      remaining: this.remaining,
      players: [...this.players.values()].map(encode),
      npcs: this.npcs.map(encode),
    };
  }
}
