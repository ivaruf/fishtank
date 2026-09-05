import { clamp } from "../../shared/config.js";

export function createControls(canvas, onStop = () => {}) {
  const keys = new Set();
  const aim = { yaw: 0, pitch: 0 };
  const pads = [];
  let active = false;
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
    aim.yaw = Math.atan2(Math.sin(aim.yaw + x), Math.cos(aim.yaw + x));
    aim.pitch = clamp(aim.pitch + y, -1.35, 1.35);
  };
  function reset() {
    keys.clear();
    for (const pad of pads) {
      const pointer = pad.pointer;
      pad.pointer = null;
      pad.x = pad.y = 0;
      pad.knob.style.transform = "";
      if (pointer !== null && pad.element.hasPointerCapture(pointer))
        pad.element.releasePointerCapture(pointer);
    }
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
  function stick(id) {
    const element = document.getElementById(id);
    const pad = {
      element,
      knob: element.querySelector(".stick"),
      pointer: null,
      x: 0,
      y: 0,
    };
    pads.push(pad);
    function update(e) {
      const rect = element.getBoundingClientRect(),
        travel = rect.width * 0.36;
      const x = (e.clientX - rect.left - rect.width / 2) / travel;
      const y = (e.clientY - rect.top - rect.height / 2) / travel;
      const distance = Math.hypot(x, y),
        magnitude = clamp((distance - 0.12) / 0.88, 0, 1);
      pad.x = distance ? (x / distance) * magnitude : 0;
      pad.y = distance ? (y / distance) * magnitude : 0;
      pad.knob.style.transform = `translate(${pad.x * travel}px,${pad.y * travel}px)`;
    }
    element.addEventListener("pointerdown", (e) => {
      if (!active || pad.pointer !== null) return;
      e.preventDefault();
      pad.pointer = e.pointerId;
      element.setPointerCapture(e.pointerId);
      update(e);
    });
    element.addEventListener("pointermove", (e) => {
      if (e.pointerId === pad.pointer) update(e);
    });
    function release(e) {
      if (e.pointerId !== pad.pointer) return;
      pad.pointer = null;
      pad.x = pad.y = 0;
      pad.knob.style.transform = "";
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
      onStop();
    }
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      element.addEventListener(event, release);
    return pad;
  }
  const movePad = stick("move-stick"),
    lookPad = stick("look-stick");
  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      if (!value) {
        reset();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }
    },
    orient(yaw, pitch) {
      aim.yaw = yaw;
      aim.pitch = pitch;
    },
    read(dt = 0) {
      if (active) look(lookPad.x * dt * 2.2, -lookPad.y * dt * 1.7);
      return {
        ...aim,
        forward: active
          ? movePad.pointer !== null
            ? -movePad.y
            : Number(keys.has("w") || keys.has("arrowup")) -
              Number(keys.has("s") || keys.has("arrowdown"))
          : 0,
        strafe: active
          ? movePad.pointer !== null
            ? movePad.x
            : Number(keys.has("d") || keys.has("arrowright")) -
              Number(keys.has("a") || keys.has("arrowleft"))
          : 0,
      };
    },
  };
}
