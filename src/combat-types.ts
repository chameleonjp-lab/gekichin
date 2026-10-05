import type { Vector3 } from 'three';
import type { Aircraft, GameMode } from './types';

export type AircraftOwner = 'player' | 'wingman';
export type FriendlyWeaponKind = 'mg' | 'cannon';
export type EnemyWeaponKind = 'main' | 'mg';
export type MissionOutcome = 'victory' | 'defeat' | 'mutual' | 'aborted';

export interface Ammunition {
  mg: number;
  cannon: number;
  mgReadyTick: number;
  cannonReadyTick: number;
  reloadUntilTick: number | null;
}

/** A token is never recycled. The visual slot may acquire a later generation. */
export interface AircraftToken extends Aircraft {
  operationId: number;
  tokenId: number;
  slotId: number;
  generation: number;
  owner: AircraftOwner;
  hpMilli: number;
  maxHpMilli: number;
  ammunition: Ammunition;
  outsideTicks: number;
  bornTick: number;
}

/** Identity and affiliation belong to the shot, not the current pilot. */
export interface Projectile {
  id: number;
  operationId: number;
  faction: 'friendly' | 'enemy';
  kind: FriendlyWeaponKind | EnemyWeaponKind;
  shooterId: number;
  shooterGeneration: number;
  owner: AircraftOwner | 'enemy';
  position: Vector3;
  previous: Vector3;
  velocity: Vector3;
  bornTick: number;
  expiresTick: number;
  distance: number;
  baseDamageMilli: number;
}

export interface FleetCounts {
  active: number;
  reserved: number;
  reserve: number;
  lost: number;
  remaining: number;
  playerLosses: number;
  wingmanLosses: number;
}

export interface ScoreTotals {
  K: number;
  damageMilli: number;
  P: number;
  W: number;
  N: number;
  Hmain: number;
  Hmg: number;
  playerKills: number;
  wingmanKills: number;
  playerDamageMilli: number;
  wingmanDamageMilli: number;
  mainKills: number;
  mgKills: number;
}

export interface ScoreComponents {
  destruction: number;
  damage: number;
  time: number;
  playerLoss: number;
  wingmanLoss: number;
  accuracyLoss: number;
  total: number;
  accuracy: number | null;
}

export interface CombatReport extends Readonly<ScoreTotals> {
  kind: 'mission-result';
  operationId: number;
  rulesVersion: string;
  mode: GameMode;
  seed: number;
  endTick: number;
  reason: 'completed' | 'aborted';
  outcome: MissionOutcome;
  components: Readonly<ScoreComponents>;
}

export type CombatEventKind = 'shot' | 'hit' | 'turret-destroyed' | 'aircraft-lost' | 'respawn' | 'handoff' | 'warning' | 'victory' | 'defeat' | 'abnormal';

/** Consumers follow sequence. The bounded history is presentation-only. */
export interface CombatEvent {
  sequence: number;
  operationId: number;
  tick: number;
  kind: CombatEventKind;
  point?: Vector3;
  weapon?: FriendlyWeaponKind | EnemyWeaponKind;
  owner?: AircraftOwner | 'enemy';
  attackId?: number;
  time?: number;
  shooterId?: number;
  shooterGeneration?: number;
  targetId?: number;
  targetGeneration?: number;
  tokenId?: number;
  generation?: number;
  damageMilli?: number;
  calculatedDamageMilli?: number;
  message?: string;
}

export interface WingmanIntent { turn: number; climb: number; fire: boolean; preferredSpeed?: number }

export interface EnemyFireRequest {
  requestId: number;
  turretId: number;
  kind: EnemyWeaponKind;
  origin: Vector3;
  direction: Vector3;
  targetTokenId: number;
  targetGeneration: number;
  time: number;
}
