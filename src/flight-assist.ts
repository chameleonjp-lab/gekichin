// Flight assistance adapted from kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5. See docs/P0_BASELINE.md.
import { Vector3 } from 'three';
import type { Aircraft, FlightInput, GameMode } from './types';
import { EASY_AIM_RADIUS, FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, projectFlightTarget } from './flight-view';
import { PLAYER_MAX_PITCH } from './rules';
import { flightTargetKey, selectProjectedTarget, type FlightTargetLock } from './flight-target';
import type { FlightCameraCollision } from './flight-view';

export const OFFSCREEN_RESPONSE_MULTIPLIER = 1.65;
export const EASY_TARGET_TRACKING_STRENGTH = 0.25;
export const EASY_SHOT_CORRECTION_STRENGTH = 0.35;
export const EASY_SHOT_MAX_ANGLE = 0.028;
export const EASY_SHOT_PREDICTION_GATE = 0.16;

/** P2/P4 must supply an actual turret aim point and shared occlusion result. */
export interface FlightAssistTarget {
  id?: string | number;
  aimPoint: Vector3;
  alive: boolean;
  exposed: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function applyEasyShotCorrection(forward: Vector3, predicted: Vector3): Vector3 {
  const angle = forward.angleTo(predicted);
  if (angle > EASY_SHOT_PREDICTION_GATE || angle < 1e-8) return forward.clone();
  const correction = Math.min(angle * EASY_SHOT_CORRECTION_STRENGTH, EASY_SHOT_MAX_ANGLE);
  return forward.clone().multiplyScalar(Math.sin(angle - correction) / Math.sin(angle))
    .addScaledVector(predicted, Math.sin(correction) / Math.sin(angle)).normalize();
}

export function selectFlightAssistTarget<T extends FlightAssistTarget>(player: Aircraft, targets: readonly T[], aspect: number,
  mode: GameMode, lock?: FlightTargetLock, manual = lock?.manual ?? false, world?: FlightCameraCollision) {
  return selectProjectedTarget(targets.filter(t => t.alive && t.exposed).map(enemy => ({ enemy,
    key: flightTargetKey({ ...enemy, position: enemy.aimPoint }), projection: projectFlightTarget(player, enemy.aimPoint, aspect, mode, world),
  })), aspect, 1500, mode === 'easy' ? lock : undefined, manual);
}

export function getFlightAssist(player: Aircraft, targets: readonly FlightAssistTarget[], input: FlightInput, mode: GameMode,
  lock?: FlightTargetLock, world?: FlightCameraCollision) {
  const manualTurn = clamp(input.turn, -1, 1), manualClimb = clamp(input.climb, -1, 1);
  const aspect = Number.isFinite(input.viewAspect) && (input.viewAspect ?? 0) > 0 ? input.viewAspect! : 393 / 852;
  const target = selectFlightAssistTarget(player, targets, aspect, mode, lock,
    !!input.steeringActive || Math.max(Math.abs(manualTurn), Math.abs(manualClimb)) > 1e-4, world)?.projection ?? null;
  const hasVisibleTarget = target !== null;
  const responseMultiplier = targets.some(candidate => candidate.alive) && !hasVisibleTarget
    ? OFFSCREEN_RESPONSE_MULTIPLIER : 1;
  if (mode !== 'easy' || !target || input.steeringActive) return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget };
  const screenRadius = Math.hypot(target.x * Math.max(1, aspect), target.y * Math.max(1, 1 / aspect)) / 2;
  const manualWeight = clamp(Math.max(Math.abs(manualTurn), Math.abs(manualClimb)) / 0.35, 0, 1);
  const assistFade = clamp((screenRadius - EASY_AIM_RADIUS) / (EASY_AIM_RADIUS * 2), 0, 1)
    * (1 - manualWeight) * EASY_TARGET_TRACKING_STRENGTH;
  if (assistFade <= 0) return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget: true };
  const tanVerticalHalf = Math.tan(FLIGHT_FOV * Math.PI / 360);
  const screenHorizontal = target.x * Math.tan(Math.atan(aspect * tanVerticalHalf));
  const screenVertical = target.y * tanVerticalHalf;
  const bankCos = Math.cos(player.bank * FLIGHT_CAMERA_BANK_FACTOR), bankSin = Math.sin(player.bank * FLIGHT_CAMERA_BANK_FACTOR);
  const viewYaw = Math.atan(screenHorizontal * bankCos + screenVertical * bankSin);
  const viewPitch = Math.atan(-screenHorizontal * bankSin + screenVertical * bankCos);
  const requestedTurn = clamp(viewYaw / 0.18, -1, 1) * assistFade;
  const turn = manualTurn * requestedTurn < 0 ? manualTurn : clamp(manualTurn + requestedTurn, -1, 1);
  const manualPitch = manualClimb * PLAYER_MAX_PITCH;
  const absolutePitch = Math.abs(manualClimb) > 0.05 && manualClimb * viewPitch < 0
    ? manualPitch : manualPitch + (player.pitch + viewPitch - manualPitch) * assistFade;
  return { turn, climb: clamp(absolutePitch / PLAYER_MAX_PITCH, -1, 1), responseMultiplier, hasVisibleTarget: true };
}
