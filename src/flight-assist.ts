// Flight assistance adapted from kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5. See docs/P0_BASELINE.md.
import { Vector3 } from 'three';
import type { Aircraft, FlightInput, GameMode } from './types';
import { projectFlightTarget } from './flight-view';
import { flightTargetKey, selectProjectedTarget, type FlightTargetLock } from './flight-target';
import type { FlightCameraCollision } from './flight-view';

/** P2/P4 must supply an actual turret aim point and shared occlusion result. */
export interface FlightAssistTarget {
  id?: string | number;
  aimPoint: Vector3;
  alive: boolean;
  exposed: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function selectFlightAssistTarget<T extends FlightAssistTarget>(player: Aircraft, targets: readonly T[], aspect: number,
  mode: GameMode, lock?: FlightTargetLock, manual = lock?.manual ?? false, world?: FlightCameraCollision,
  unobstructed?: (target: T) => boolean) {
  return selectProjectedTarget(targets.filter(t => t.alive && t.exposed).map(enemy => ({ enemy,
    key: flightTargetKey({ ...enemy, position: enemy.aimPoint }), projection: projectFlightTarget(player, enemy.aimPoint, aspect, mode, world),
  })).filter(candidate => candidate.projection.visible && (!unobstructed || unobstructed(candidate.enemy))), aspect, 1500, mode === 'easy' ? lock : undefined, manual);
}

/** Targets never alter player steering. Visibility is inspected only for display and firing. */
export function getFlightAssist(_player: Aircraft, _targets: readonly FlightAssistTarget[], input: FlightInput, _mode: GameMode,
  _lock?: FlightTargetLock, _world?: FlightCameraCollision) {
  return { turn: clamp(input.turn, -1, 1), climb: clamp(input.climb, -1, 1), responseMultiplier: 1, hasVisibleTarget: false };
}
