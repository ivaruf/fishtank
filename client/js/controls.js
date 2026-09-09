import { clamp, wrap } from "../../shared/config.js";

// Desktop: WASD plus mouse aim, and the fish swims where you look. Touch: a
// floating stick under the left thumb moves you while you push it, and a drag
// anywhere on the right half turns the camera - so the fish swims where you
// look there too. Both produce the same {forward, strafe, yaw, pitch} for the
// server. Keep this in step with the zone hints in index.html, which are the
// same thing said to the player: both described depth dragging and a fish that
// levelled out on release long after neither was true.
//
// Touch mirrors the keyboard exactly: the left stick is WASD (it moves you, and
// releasing it stops you) while dragging anywhere on the right is the mouse (it
// aims the camera). Movement and aim are independent, so you can swim one way
// and look another.
//
// There was a second scheme once - "always swimming", where the fish never
// stopped, one thumb steered its heading, the other dragged for depth and the
// camera trailed behind. It is gone, and with it a bite assist that nudged the
// heading toward nearby prey, a pitch that decayed back to level on its own,
// and a camera that had to follow the fish rather than the player's aim. Two
// input schemes is two of everything downstream of input.
const STICK = 48, // px of thumb travel for full deflection
  LOOK = 0.005, // rad per px of look drag
  DEAD = 0.2, // stick deflection below this is treated as centred
  FULL = 0.8, // deflection at which the fish is at full speed
  // The band along each screen edge in which an unlocked cursor keeps turning,
  // and how fast it turns at the very edge. See edgeLook.
  EDGE = 80,
  EDGE_YAW = 1.9, // rad/s
  EDGE_PITCH = 1; // rad/s, and pitch only has ±1.35 to cover
// How hard the cursor is pushing against an edge on one axis: 0 anywhere in
// the middle, ramping to -1 at the low edge and +1 at the high one. Pure, and
// exported, because it is the whole geometry of edgeLook and the only part of
// this file a test can reach without a browser. Positions outside the window
// clamp to full rather than running past it.
// The `+ 0` normalises -0, which the low edge's own boundary produces and
// which strict equality treats as a different value - the same reason read()
// below adds it to a stick pushed exactly sideways.
export const edgePush = (at, size, edge = EDGE) =>
  (at <= edge
    ? -(1 - Math.max(0, at) / edge)
    : at >= size - edge
      ? 1 - Math.max(0, size - at) / edge
      : 0) + 0;
export function createControls(canvas, onStop = () => {}) {
  const keys = new Set();
  const aim = { yaw: 0, pitch: 0 };
  let active = false,
    touchMode = false;
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
    // The look zone keeps no value of its own: a drag turns the camera and
    // that is the whole state. lx/ly are just the last point, for the delta.
    // The name, and the `depth-zone` id it is wired to, are what this was when
    // a drag here changed depth and nothing else. Left alone because renaming
    // an element id to fix a word is how you break the thing it names; what
    // the player reads says LOOK.
    depth = { pointer: null };
  function release(zone) {
    if (zone.pointer !== null && zone.element.hasPointerCapture(zone.pointer))
      zone.element.releasePointerCapture(zone.pointer);
    zone.pointer = null;
    zone.x = zone.y = 0;
    if (zone.visual) zone.visual.hidden = true;
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
  // Where the cursor is, for edgeLook below. Tracked from every move rather
  // than only the ones over the canvas, because a cursor resting on a HUD
  // panel in the corner of the screen is one of the cases it exists for.
  const cursor = { x: null, y: null };
  // Hover aiming works without pointer lock; clicking removes screen-edge limits.
  document.addEventListener("mousemove", (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (
      !active ||
      (document.pointerLockElement !== canvas && e.target !== canvas)
    )
      return;
    look(e.movementX * 0.0025, -e.movementY * 0.0025);
  });
  // Off the window entirely - another monitor, another app - is not aiming.
  document.addEventListener("mouseleave", () => {
    cursor.x = cursor.y = null;
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
  // visualId may be null: the look zone has nothing to draw, because the
  // camera turning is the feedback.
  function track(zone, id, visualId, onDown, onMove) {
    zone.element = document.getElementById(id);
    zone.visual = visualId ? document.getElementById(visualId) : null;
    zone.knob = zone.visual?.querySelector(".knob") ?? null;
    zone.element.addEventListener("pointerdown", (e) => {
      if (!active || !touchMode || zone.pointer !== null) return;
      e.preventDefault();
      zone.pointer = e.pointerId;
      zone.element.setPointerCapture(e.pointerId);
      if (zone.visual) {
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
    null,
    (e) => {
      depth.lx = e.clientX;
      depth.ly = e.clientY;
    },
    (e) => {
      // Free look: drag anywhere on this side and the camera turns, exactly as
      // the mouse does on desktop. Relative, so it never snaps.
      look((e.clientX - depth.lx) * LOOK, -(e.clientY - depth.ly) * LOOK);
      depth.lx = e.clientX;
      depth.ly = e.clientY;
    },
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
    orient(yaw, pitch) {
      aim.yaw = yaw;
      aim.pitch = pitch;
    },
    // Keeps turning while an unlocked cursor is held against a screen edge.
    //
    // Mouse aim is relative - it reads movementX - and at the edge of the
    // screen the pointer stops, so the deltas stop with it and the fish simply
    // cannot be turned any further that way. Pointer lock is the real answer
    // and a click still takes it, but a player who has not clicked yet should
    // not be stuck facing a wall, and finding that out while something eats
    // you is no way to learn it.
    //
    // So the last 80 px of each edge becomes a turn rate instead: nothing at
    // the inner boundary, full at the very edge, which makes it a place you
    // push into rather than a cliff you fall off. Nothing happens until the
    // cursor is right at the edge, where the alternative is nothing happening
    // at all.
    //
    // Silent when locked. There are no edges then, and a cursor left parked at
    // x=0 from before the lock would otherwise spin the fish for ever.
    edgeLook(dt) {
      if (!active || touchMode || cursor.x === null) return;
      if (document.pointerLockElement === canvas) return;
      const x = edgePush(cursor.x, innerWidth),
        y = edgePush(cursor.y, innerHeight);
      if (x || y) look(x * EDGE_YAW * dt, -y * EDGE_PITCH * dt);
    },
    // The stick is already screen-relative: its deflection becomes
    // forward/strafe, and the server resolves those against the aim being sent
    // alongside them. Nothing here needs the clock or the camera any more.
    read() {
      const push = Math.hypot(steer.x, steer.y);
      const held = steer.pointer !== null && push > DEAD;
      // The thumb's direction becomes forward/strafe against the way you are
      // looking, ramping from a standstill at the deadzone to full at FULL, so
      // letting go stops the fish outright. Nothing steers but the thumb.
      const ramp = held ? Math.min(1, (push - DEAD) / (FULL - DEAD)) / push : 0;
      const forward = !touchMode
        ? Number(keys.has("w") || keys.has("arrowup")) -
          Number(keys.has("s") || keys.has("arrowdown"))
        : -steer.y * ramp;
      const strafe = !touchMode
        ? Number(keys.has("d") || keys.has("arrowright")) -
          Number(keys.has("a") || keys.has("arrowleft"))
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
