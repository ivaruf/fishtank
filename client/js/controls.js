import { clamp, wrap } from "../../shared/config.js";

// Desktop: WASD plus mouse aim, and the fish swims where you look. Touch: one
// thumb steers with a floating stick relative to the camera, the other drags up
// or down for depth (and the fish levels out when released), and main.js keeps
// the camera behind the fish. Both produce the same {forward, strafe, yaw,
// pitch} for the server.
//
// Two touch styles. "stick" is the default and mirrors the keyboard exactly:
// the left stick is WASD (it moves you, and releasing it stops you) while
// dragging anywhere on the right is the mouse (it aims the camera). Movement
// and aim are independent, so you can swim one way and look another.
// "always" is the older, simpler scheme: the fish never stops, one thumb
// steers its heading, the other drags for depth, and the camera trails behind.
const TURN = 2.4, // rad/s the touch heading may change in "always"
  ASSIST = 0.9, // rad/s the bite assist may nudge when the thumb is idle
  LEVEL = 1.2, // 1/s pitch decay back to level in "always"
  STICK = 48, // px of thumb travel for full deflection
  DEPTH = 150, // px of drag for a full dive or climb in "always"
  LOOK = 0.005, // rad per px of look drag in "stick"
  DEAD = 0.2, // stick deflection below this is treated as centred
  FULL = 0.8; // deflection at which the fish is at full speed
export function createControls(canvas, onStop = () => {}) {
  const keys = new Set();
  const aim = { yaw: 0, pitch: 0 };
  let active = false,
    touchMode = false,
    moveStyle = "stick",
    assist = null;
  const allowed = [
    "w",
    "a",
    "s",
    "d",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
  ];
  const look = (x, y) => {
    aim.yaw = wrap(aim.yaw + x);
    aim.pitch = clamp(aim.pitch + y, -1.35, 1.35);
  };
  // Touch zones: each tracks one pointer and shows a floating visual under it.
  const steer = { pointer: null, x: 0, y: 0 },
    depth = { pointer: null, value: 0, base: 0 };
  function release(zone) {
    if (zone.pointer !== null && zone.element.hasPointerCapture(zone.pointer))
      zone.element.releasePointerCapture(zone.pointer);
    zone.pointer = null;
    zone.x = zone.y = zone.value = 0;
    zone.visual.hidden = true;
  }
  function reset() {
    keys.clear();
    for (const zone of [steer, depth]) release(zone);
    onStop();
  }
  window.addEventListener("keydown", (e) => {
    if (!active || e.target.closest?.("input, select, button")) return;
    if (allowed.includes(e.key.toLowerCase())) {
      e.preventDefault();
      keys.add(e.key.toLowerCase());
    }
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
    if (active) onStop();
  });
  // Safari reports pinches as gesture events rather than as touch-action, so
  // several fingers landing at once zooms the page and leaves the game
  // misaligned. Block it while playing; the menu stays zoomable for anyone who
  // needs that.
  for (const type of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(
      type,
      (e) => {
        if (active) e.preventDefault();
      },
      { passive: false },
    );
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== canvas) reset();
  });
  // Hover aiming works without pointer lock; clicking removes screen-edge limits.
  document.addEventListener("mousemove", (e) => {
    if (
      !active ||
      (document.pointerLockElement !== canvas && e.target !== canvas)
    )
      return;
    look(e.movementX * 0.0025, -e.movementY * 0.0025);
  });
  canvas.addEventListener("click", async (e) => {
    if (!active || e.pointerType === "touch") return;
    canvas.focus();
    try {
      await canvas.requestPointerLock?.();
    } catch {
      /* Hover aiming remains available. */
    }
  });
  document.addEventListener("pointerlockerror", () => {
    /* Keep hover aiming. */
  });
  function track(zone, id, visualId, onDown, onMove, wantsVisual = () => true) {
    zone.element = document.getElementById(id);
    zone.visual = document.getElementById(visualId);
    zone.knob = zone.visual.querySelector(".knob");
    zone.element.addEventListener("pointerdown", (e) => {
      if (!active || !touchMode || zone.pointer !== null) return;
      e.preventDefault();
      zone.pointer = e.pointerId;
      zone.element.setPointerCapture(e.pointerId);
      // Free look shows nothing: the camera moving is the feedback.
      if (wantsVisual()) {
        const rect = zone.element.getBoundingClientRect();
        zone.visual.style.left = `${e.clientX - rect.left}px`;
        zone.visual.style.top = `${e.clientY - rect.top}px`;
        zone.visual.hidden = false;
        zone.knob.style.transform = "";
      }
      onDown(e);
    });
    zone.element.addEventListener("pointermove", (e) => {
      if (e.pointerId === zone.pointer) onMove(e);
    });
    const end = (e) => {
      if (e.pointerId !== zone.pointer) return;
      release(zone);
      onStop();
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      zone.element.addEventListener(type, end);
  }
  track(
    steer,
    "move-zone",
    "move-stick",
    (e) => {
      steer.ox = e.clientX;
      steer.oy = e.clientY;
    },
    (e) => {
      let dx = (e.clientX - steer.ox) / STICK,
        dy = (e.clientY - steer.oy) / STICK;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        dx /= d;
        dy /= d;
      }
      steer.x = dx;
      steer.y = dy;
      steer.knob.style.transform = `translate(${dx * STICK}px, ${dy * STICK}px)`;
    },
  );
  track(
    depth,
    "depth-zone",
    "depth-gauge",
    (e) => {
      depth.oy = e.clientY;
      depth.lx = e.clientX;
      depth.ly = e.clientY;
      depth.base = aim.pitch;
      depth.value = aim.pitch;
    },
    (e) => {
      if (moveStyle === "stick") {
        // Free look: drag anywhere on this side and the camera turns, exactly
        // as the mouse does on desktop. Relative, so it never snaps.
        look((e.clientX - depth.lx) * LOOK, -(e.clientY - depth.ly) * LOOK);
        depth.lx = e.clientX;
        depth.ly = e.clientY;
        return;
      }
      // "always": drag up to rise, down to dive, relative to the pitch you
      // started at.
      depth.value = clamp(
        depth.base - ((e.clientY - depth.oy) / DEPTH) * 1.1,
        -1.1,
        1.1,
      );
      depth.knob.style.transform = `translateY(${(-depth.value / 1.1) * 60}px)`;
    },
    () => moveStyle !== "stick",
  );
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      if (!value) {
        reset();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
    },
    setTouchMode(value) {
      touchMode = value;
      if (!value) for (const zone of [steer, depth]) release(zone);
    },
    // "stick" (left thumb moves, right thumb looks) or "always" (never stops).
    setMoveStyle(value) {
      moveStyle = value === "always" ? "always" : "stick";
      for (const zone of [steer, depth]) release(zone);
      onStop();
    },
    // main.js aims the camera itself in "always"; in "stick" the player does.
    get freeLook() {
      return moveStyle === "stick";
    },
    // A {yaw, pitch} to drift toward while the thumb is idle, or null.
    assist(target) {
      assist = target;
    },
    orient(yaw, pitch) {
      aim.yaw = yaw;
      aim.pitch = pitch;
    },
    // cameraYaw makes stick directions screen-relative on touch.
    read(dt = 0, cameraYaw = aim.yaw) {
      const push = Math.hypot(steer.x, steer.y);
      const held = steer.pointer !== null && push > DEAD;
      // A fish that is standing still must stay still: the bite assist may
      // only nudge the heading of a fish that is actually swimming, or a
      // parked fish would slowly rotate on its own. In "stick" the player
      // aims for themselves, so nothing steers but the thumb.
      const swimming = moveStyle === "always" || held;
      if (active && touchMode && moveStyle === "always") {
        if (held) {
          const wanted = cameraYaw + Math.atan2(steer.x, -steer.y);
          aim.yaw = wrap(
            aim.yaw + clamp(wrap(wanted - aim.yaw), -TURN * dt, TURN * dt),
          );
        } else if (assist && swimming) {
          aim.yaw = wrap(
            aim.yaw +
              clamp(wrap(assist.yaw - aim.yaw), -ASSIST * dt, ASSIST * dt),
          );
        }
        if (depth.pointer !== null) aim.pitch = depth.value;
        else if (assist && swimming)
          aim.pitch += clamp(
            assist.pitch - aim.pitch,
            -ASSIST * dt,
            ASSIST * dt,
          );
        else aim.pitch *= Math.exp(-dt * LEVEL);
      }
      // "always" swims at full speed regardless of the thumb. "stick" is the
      // keyboard: the thumb's direction becomes forward/strafe against the way
      // you are looking, ramping from a standstill at the deadzone to full at
      // FULL, so letting go stops the fish outright.
      const ramp = held ? Math.min(1, (push - DEAD) / (FULL - DEAD)) / push : 0;
      const forward = !touchMode
        ? Number(keys.has("w") || keys.has("arrowup")) -
          Number(keys.has("s") || keys.has("arrowdown"))
        : moveStyle === "always"
          ? 1
          : -steer.y * ramp;
      const strafe = !touchMode
        ? Number(keys.has("d") || keys.has("arrowright")) -
          Number(keys.has("a") || keys.has("arrowleft"))
        : moveStyle === "always"
          ? 0
          : steer.x * ramp;
      return {
        ...aim,
        // Adding zero normalises -0, which a stick pushed exactly sideways
        // produces and which strict equality treats as a different value.
        forward: active ? forward + 0 : 0,
        strafe: active ? strafe + 0 : 0,
      };
    },
  };
}
