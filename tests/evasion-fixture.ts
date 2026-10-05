import { Vector3 } from 'three';
import { forwardOf, updateQuaternion } from '../src/flight';
import { FlightSession } from '../src/game-state';
import { AIRCRAFT_RADIUS, BOUNDARY_HIGH, BOUNDARY_LOW, BOUNDARY_RADIUS, INITIAL_SEED } from '../src/rules';
import { turretDirection } from '../src/mothership-layout';
import type { EnemyWeaponKind } from '../src/combat-types';
import type { FlightInput } from '../src/types';

const NEUTRAL: FlightInput = { turn: 0, climb: 0, fire: false, loop: false };

export interface EvasionScenario {
  face: 'top' | 'bottom' | 'left';
  kind: EnemyWeaponKind;
  input: FlightInput;
  action: 'turn' | 'climb' | 'loop';
/** Small side-face offsets retain finite tracking while keeping the paired main-gun baseline inside the hit radius. */
  yawOffsetDegrees: number;
}

export const EVASION_SCENARIOS: readonly EvasionScenario[] = [
  { face: 'top', kind: 'main', input: { ...NEUTRAL, loop: true }, action: 'loop', yawOffsetDegrees: 0 },
  { face: 'top', kind: 'mg', input: { ...NEUTRAL, climb: 1 }, action: 'climb', yawOffsetDegrees: 0 },
  { face: 'bottom', kind: 'main', input: { ...NEUTRAL, turn: 1 }, action: 'turn', yawOffsetDegrees: 0 },
  { face: 'bottom', kind: 'mg', input: { ...NEUTRAL, turn: -1 }, action: 'turn', yawOffsetDegrees: 0 },
  { face: 'left', kind: 'main', input: { ...NEUTRAL, climb: 1 }, action: 'climb', yawOffsetDegrees: 5.5 },
  { face: 'left', kind: 'mg', input: { ...NEUTRAL, loop: true }, action: 'loop', yawOffsetDegrees: 5 },
];

function requireFixture(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid evasion test fixture: ${message}`);
}

export interface EvasionFixtureStart {
  seed: number;
  face: EvasionScenario['face'];
  kind: EnemyWeaponKind;
  tick: 0;
  aliveTurretIds: number[];
  playerPosition: number[];
  playerYaw: number;
  playerPitch: number;
  playerSpeed: number;
  turretYaw: number;
  turretPitch: number;
  turretHpMilli: number;
  yawOffsetDegrees: number;
}

export interface EvasionFixture {
  session: FlightSession;
  turretId: number;
  tokenId: number;
  start: EvasionFixtureStart;
}

/**
 * Inspection-only initial state. Start and validate the seeded 100-mount
 * normal operation; before its first tick, damage-resolve the other 99 mounts
 * as fixture setup and place the player 90m down the selected barrel ray plus
 * 500m along its horizontal outward direction. Aim the normal flight camera
 * back toward the emitter so the production warning and tracers can be seen.
 * The caller must only advance this session with ordinary FlightInput after
 * tick zero. This fixture is excluded from normal 100-mount clear evidence.
 */
export function createEvasionInitialFixture(scenario: EvasionScenario, session = new FlightSession()): EvasionFixture {
  requireFixture(session.phase === 'home' || session.phase === 'result', 'fixture starts from a normal operation boundary');
  const operationId = session.prepare('normal', INITIAL_SEED);
  requireFixture(operationId !== null, 'standard normal operation preparation succeeded');
  requireFixture(session.begin(operationId), 'the unchanged production geometry validates');

  const turret = session.mothership.turrets.find(candidate => candidate.layout.face === scenario.face && candidate.layout.kind === scenario.kind);
  requireFixture(turret, `fixture mount exists: ${scenario.face}/${scenario.kind}`);
  const player = session.fleet.player;
  requireFixture(player, 'normal operation has a player aircraft');

  const defaultAim = turretDirection(turret.layout, turret.yaw, turret.pitch);
  const fixturePosition = turret.muzzle.clone().addScaledVector(defaultAim, 90);
  const horizontalDirection = new Vector3(defaultAim.x, 0, defaultAim.z).normalize();
  fixturePosition.addScaledVector(horizontalDirection, 500);
  const towardEmitter = turret.muzzle.clone().sub(fixturePosition);
  const fixtureYaw = Math.atan2(-towardEmitter.x, -towardEmitter.z)
    + scenario.yawOffsetDegrees * Math.PI / 180;

  // These are the only fixture state writes: they all occur at logical tick 0.
  player.position.copy(fixturePosition);
  player.previous.copy(fixturePosition);
  player.yaw = fixtureYaw;
  player.pitch = 0;
  updateQuaternion(player);
  let fixtureAttack = 0;
  for (const other of session.mothership.turrets) {
    if (other === turret) continue;
    const result = session.mothership.applyDamage(other.id, other.hpMilli, {
      attackId: `evasion-initial-fixture-${scenario.face}-${scenario.kind}-${fixtureAttack++}`,
      tick: 0,
    });
    requireFixture(result.actual === other.maxHpMilli && result.killed, 'fixture damage resolves through the standard mount damage path');
  }

  requireFixture(session.tick === 0, 'fixture has not advanced the logical clock');
  requireFixture(session.mothership.turrets.filter(candidate => candidate.hpMilli > 0).length === 1
    && session.mothership.turrets.find(candidate => candidate.hpMilli > 0)?.id === turret.id, 'only the named mount remains active');
  requireFixture(fixturePosition.y > Math.max(BOUNDARY_LOW, AIRCRAFT_RADIUS) && fixturePosition.y < BOUNDARY_HIGH, 'fixture is inside the altitude boundary');
  requireFixture(Math.hypot(fixturePosition.x, fixturePosition.z) < BOUNDARY_RADIUS, 'fixture is inside the horizontal boundary');
  requireFixture(session.world.sweep(fixturePosition, fixturePosition, { radius: AIRCRAFT_RADIUS, aircraft: false, sea: true }) === null,
    'the aircraft starts outside hull, wreck and sea colliders');
  requireFixture(session.world.lineOfSight(turret.muzzle, fixturePosition), 'the selected mount has an unobstructed first warning path');
  for (const other of session.fleet.active) {
    if (other.tokenId !== player.tokenId) requireFixture(other.position.distanceTo(fixturePosition) >= 30, 'the fixture does not overlap a wingman');
  }

  const start: EvasionFixtureStart = {
    seed: INITIAL_SEED, face: scenario.face, kind: scenario.kind, tick: 0,
    aliveTurretIds: [turret.id], playerPosition: fixturePosition.toArray(), playerYaw: player.yaw,
    playerPitch: player.pitch, playerSpeed: player.speed, turretYaw: turret.yaw,
    turretPitch: turret.pitch, turretHpMilli: turret.hpMilli, yawOffsetDegrees: scenario.yawOffsetDegrees,
  };
  requireFixture(forwardOf(player).lengthSq() > .99, 'the player quaternion is a valid unit heading');
  return { session, turretId: turret.id, tokenId: player.tokenId, start };
}
