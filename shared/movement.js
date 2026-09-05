import { clamp, direction } from "./config.js";

// Inputs express intent; only the server applies speed and changes position.
export function parseInput(message) {
  const { forward, strafe, yaw, pitch } = message;
  if (![forward, strafe, yaw, pitch].every(Number.isFinite)) return null;
  return {
    forward: clamp(forward, -1, 1),
    strafe: clamp(strafe, -1, 1),
    yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
    pitch: clamp(pitch, -1.35, 1.35),
  };
}

export function movementVector(input) {
  const aim = direction(input);
  const length = Math.max(1, Math.hypot(input.forward, input.strafe));
  const forward = input.forward / length,
    strafe = input.strafe / length;
  return {
    x: aim.x * forward + Math.cos(input.yaw) * strafe,
    y: aim.y * forward,
    z: aim.z * forward - Math.sin(input.yaw) * strafe,
  };
}
