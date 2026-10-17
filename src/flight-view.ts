// Camera equations from kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5. See docs/P0_BASELINE.md.
import { Euler, Quaternion, Vector3 } from 'three';
import type { Aircraft, GameMode } from './types';

export const FLIGHT_FOV = 64;
export const FLIGHT_FAR = 6500;
/** Enemy visibility, fog and the radar share the same world-distance limit. */
export const FLIGHT_VISIBILITY_RANGE = 1500;
export const FLIGHT_CAMERA_BANK_FACTOR = 0.45;
/** Radius as a fraction of the shorter CSS viewport edge. */
export const EASY_AIM_RADIUS = 0.135;
const CAMERA_OFFSET = new Vector3(0, 11, 29);
const BANK_AXIS = new Vector3(0, 0, 1);
export const NORMAL_CAMERA_LOOK_ANGLE = -0.19;
export const EASY_CAMERA_LOOK_ANGLE = -Math.atan2(11, 479);
const NORMAL_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), NORMAL_CAMERA_LOOK_ANGLE);
const EASY_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), EASY_CAMERA_LOOK_ANGLE);
const TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);

export interface FlightCameraCollision { cameraCast(from: Vector3, to: Vector3, radius: number): { point: Vector3; normal: Vector3 } | null }
export interface ShipCameraTransform { position: Vector3; rotation: Quaternion; center: Vector3 }
export function sinkingShipPose(center: Vector3, elapsedSeconds: number, reducedMotion: boolean): ShipCameraTransform {
  const seconds = Math.max(0, Math.min(5, elapsedSeconds)), progress = seconds / 5;
  const eased = progress * progress * (3 - 2 * progress);
  const roll = reducedMotion ? 0 : Math.sin(seconds * .72) * .055 * progress;
  return { center, position: new Vector3(center.x, center.y - 126 * eased, center.z),
    rotation: new Quaternion().setFromEuler(new Euler(.035 * progress + roll * .35, 0, .105 * progress + roll, 'XYZ')) };
}

/** Collision is derived from the logical world, including the ship's presentation transform. */
export function getEffectiveFlightCameraPose(player: Aircraft, mode: GameMode, position: Vector3, rotation: Quaternion,
  world?: FlightCameraCollision, ship?: ShipCameraTransform): void {
  getFlightCameraPose(player, mode, position, rotation);
  if (!world) return;
  let from = player.position, to = position;
  if (ship) {
    const inverse = ship.rotation.clone().invert();
    from = player.position.clone().sub(ship.position).applyQuaternion(inverse).add(ship.center);
    to = position.clone().sub(ship.position).applyQuaternion(inverse).add(ship.center);
  }
  const hit = world.cameraCast(from, to, 1.5);
  if (!hit) return;
  const normal = hit.normal.clone(); position.copy(hit.point);
  if (ship) { position.sub(ship.center).applyQuaternion(ship.rotation).add(ship.position); normal.applyQuaternion(ship.rotation); }
  position.addScaledVector(normal, 2.05);
}

/** Shared by rendering and targeting so the displayed circle is the actual firing gate. */
export function getFlightCameraPose(player: Aircraft, mode: GameMode, position: Vector3, rotation: Quaternion): void {
  // Keep the old 45%-bank position offset, but build optical direction from
  // the aircraft quaternion with bank removed. Apply bank only as image roll.
  const bankRotation = new Quaternion();
  rotation.copy(player.quaternion).multiply(bankRotation.setFromAxisAngle(BANK_AXIS,
    player.bank * (1 - FLIGHT_CAMERA_BANK_FACTOR)));
  position.copy(CAMERA_OFFSET).applyQuaternion(rotation).add(player.position);
  rotation.copy(player.quaternion)
    .multiply(bankRotation.setFromAxisAngle(BANK_AXIS, player.bank))
    .multiply(mode === 'easy' ? EASY_LOOK : NORMAL_LOOK)
    .multiply(bankRotation.setFromAxisAngle(BANK_AXIS, -player.bank * FLIGHT_CAMERA_BANK_FACTOR));
}

export function projectFlightTarget(player: Aircraft, target: Vector3, aspect: number, mode: GameMode,
  world?: FlightCameraCollision, ship?: ShipCameraTransform) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 393 / 852;
  const position = new Vector3(), rotation = new Quaternion();
  getEffectiveFlightCameraPose(player, mode, position, rotation, world, ship);
  const local = target.clone().sub(position).applyQuaternion(rotation.invert());
  const depth = -local.z, divisor = Math.max(0.0001, Math.abs(depth));
  const x = local.x / (divisor * TAN_HALF_FOV * safeAspect);
  const y = local.y / (divisor * TAN_HALF_FOV);
  const distance = player.position.distanceTo(target);
  const visible = distance <= FLIGHT_VISIBILITY_RANGE && depth > 0.1 && depth < FLIGHT_FAR && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const radial = Math.hypot(x * Math.max(1, safeAspect), y * Math.max(1, 1 / safeAspect)) / 2;
  return { x, y, depth, distance, visible, inCircle: visible && radial <= EASY_AIM_RADIUS };
}
