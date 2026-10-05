import type { Quaternion, Vector3 } from 'three';

export type GameMode = 'normal' | 'easy';
export type GamePhase = 'home' | 'preparing' | 'playing' | 'paused' | 'result';

/** Only flight state is implemented in P1. Combat owns separate later modules. */
export interface Aircraft {
  position: Vector3;
  previous: Vector3;
  quaternion: Quaternion;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
  loopProgress: number;
  loopCooldown: number;
}

export interface FlightInput {
  turn: number;
  climb: number;
  fire: boolean;
  loop: boolean;
  throttle?: number; accelerate?: boolean;
  brake?: boolean;
  viewAspect?: number;
  steeringRevision?: number;
}

export type PauseReason = 'manual' | 'settings' | 'guide' | 'hidden' | 'focus' | 'gap' | 'webgl';

/** A P1 flight report is never a combat result or a best record. */
export interface FlightReport {
  kind: 'flight-prototype';
  operationId: number;
  rulesVersion: string;
  mode: GameMode;
  seed: number;
  endTick: number;
  reason: 'completed' | 'aborted';
}
