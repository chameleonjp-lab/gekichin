import { Vector3 } from 'three';
import type { AircraftToken, EnemyFireRequest, EnemyWeaponKind, Projectile } from './combat-types';
import type { CollisionWorld } from './collision-world';
import type { TurretState } from './mothership';
import { turretDirection, turretMuzzle } from './mothership-layout';
import { forwardOf } from './flight';

const DEG = Math.PI / 180;
const ALIGNMENT = DEG;
const TRACKING_TICKS = 120;
const EPSILON = 1e-8;

/** R40–R44: these limits are independent of visibility and rendering detail. */
export const ENEMY_PERFORMANCE = Object.freeze({
  main: Object.freeze({ range: 1200, turnRate: 30 * DEG, warningTicks: 60, reloadTicks: 300,
    cancellationTicks: 60, speed: 400, lifeTicks: 240, damageMilli: 24000, activeCap: 4,
    targetCap: 1, poolCap: 16, shots: 1, intervalTicks: 0 }),
  mg: Object.freeze({ range: 700, turnRate: 90 * DEG, warningTicks: 18, reloadTicks: 120,
    cancellationTicks: 18, speed: 650, lifeTicks: 90, damageMilli: 1200, activeCap: 12,
    targetCap: 3, poolCap: 256, shots: 10, intervalTicks: 6 }),
});

export interface Intercept {
  flightTime: number;
  point: Vector3;
  direction: Vector3;
}

/** Solve |P + v(w + tau) - S| = c tau once, with the warning delay included. */
export function solveIntercept(
  origin: Vector3, position: Vector3, velocity: Vector3,
  warningSeconds: number, speed: number, lifetimeSeconds: number,
): Intercept | null {
  const offset = position.clone().addScaledVector(velocity, warningSeconds).sub(origin);
  const a = velocity.lengthSq() - speed * speed;
  const b = 2 * offset.dot(velocity);
  const c = offset.lengthSq();
  if (!Number.isFinite(a + b + c) || speed <= 0 || lifetimeSeconds <= 0) return null;
  const roots: number[] = [];
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const squareRoot = Math.sqrt(discriminant);
    // This form also retains the small root when b and sqrt(D) almost cancel.
    const q = -0.5 * (b + (b >= 0 ? squareRoot : -squareRoot));
    if (Math.abs(q) > EPSILON) roots.push(q / a, c / q);
    else roots.push(-b / (2 * a));
  }
  const flightTime = roots.filter(time => Number.isFinite(time) && time > EPSILON
    && time <= lifetimeSeconds + EPSILON).sort((left, right) => left - right)[0];
  if (flightTime === undefined) return null;
  const point = position.clone().addScaledVector(velocity, warningSeconds + flightTime);
  return { flightTime, point, direction: point.clone().sub(origin).normalize() };
}

export type TurretPhase = 'idle' | 'tracking' | 'warning' | 'burst' | 'reload' | 'cancelled' | 'destroyed';
export interface TurretCombatState {
  turretId: number;
  kind: EnemyWeaponKind;
  phase: TurretPhase;
  waitingSinceTick: number;
  readyTick: number;
  trackingStartedTick: number;
  warningStartedTick: number;
  warningEndsTick: number;
  targetTokenId: number | null;
  targetGeneration: number | null;
  fixedPoint: Vector3 | null;
  fixedDirection: Vector3 | null;
  nextFireTick: number;
  lastFireTick: number | null;
  shotCount: number;
  poolFailureTicks: number;
}

export interface TurretWarning {
  turretId: number;
  kind: EnemyWeaponKind;
  origin: Vector3;
  direction: Vector3;
  startTick: number;
  fireTick: number;
  targetTokenId: number;
}

function active(state: TurretCombatState): boolean {
  return state.phase === 'tracking' || state.phase === 'warning' || state.phase === 'burst';
}

function angles(turret: TurretState, direction: Vector3): { yaw: number; pitch: number } {
  const { tangent, right, normal } = turret.layout;
  return { yaw: Math.atan2(direction.dot(right), direction.dot(tangent)),
    pitch: Math.asin(Math.max(-1, Math.min(1, direction.dot(normal)))) };
}

function legalAngles(turret: TurretState, direction: Vector3): boolean {
  const { yaw, pitch } = angles(turret, direction);
  const layout = turret.layout;
  return yaw >= layout.yawMin - EPSILON && yaw <= layout.yawMax + EPSILON
    && pitch >= layout.pitchMin - EPSILON && pitch <= layout.pitchMax + EPSILON;
}

/** The core resolves these projectiles together with friendly shots in contact-time order. */
export class EnemyTurretCombat {
  readonly states = new Map<number, TurretCombatState>();
  readonly bullets: Projectile[] = [];
  anomaly: string | null = null;
  poolFailures = 0;
  private requestSequence = 0;
  private pending = new Map<number, EnemyFireRequest>();
  private turrets: readonly TurretState[] = [];
  private aircraft: readonly AircraftToken[] = [];
  private world: CollisionWorld | null = null;
  private currentTick = -1;
  private startPositions = new Map<number, Vector3>();

  constructor(readonly operationId: number) {}

  get warnings(): readonly TurretWarning[] {
    const result: TurretWarning[] = [];
    for (const turret of this.turrets) {
      const state = this.states.get(turret.layout.id);
      if (turret.hpMilli <= 0 || !state || (state.phase !== 'warning' && state.phase !== 'burst')
        || !state.fixedDirection || state.targetTokenId === null) continue;
      result.push({ turretId: state.turretId, kind: state.kind, origin: turret.muzzle.clone(),
        direction: state.fixedDirection.clone(), startTick: state.warningStartedTick,
        fireTick: state.nextFireTick, targetTokenId: state.targetTokenId });
    }
    return result;
  }

  remove(id: number): void {
    const index = this.bullets.findIndex(bullet => bullet.id === id);
    if (index >= 0) this.bullets.splice(index, 1);
  }

  /** Called at the actual contact time; already-fired projectiles stay valid. */
  destroyTurret(turretId: number, tick: number): void {
    const state = this.states.get(turretId);
    if (state) { this.release(state, tick); state.phase = 'destroyed'; }
    for (const [requestId, request] of this.pending) if (request.turretId === turretId) this.pending.delete(requestId);
  }

  clearAnomaly(): void {
    this.anomaly = null;
    for (const state of this.states.values()) state.poolFailureTicks = 0;
    this.pending.clear();
  }

  /** This step never advances bullets or commits a shot before earlier contacts. */
  step(tick: number, turrets: readonly TurretState[], aircraft: readonly AircraftToken[], world: CollisionWorld): EnemyFireRequest[] {
    this.currentTick = tick;
    this.turrets = turrets;
    this.aircraft = aircraft;
    this.world = world;
    this.pending.clear();
    this.startPositions = new Map(aircraft.map(plane => [plane.tokenId, plane.position.clone()]));
    const ordered = [...turrets].sort((a, b) => a.layout.id - b.layout.id);
    for (const turret of ordered) {
      const state = this.stateFor(turret);
      if (turret.hpMilli <= 0) { this.release(state, tick); state.phase = 'destroyed'; continue; }
      if ((state.phase === 'reload' || state.phase === 'cancelled') && tick >= state.readyTick) state.phase = 'idle';
      if (!active(state)) continue;
      const target = this.targetFor(state);
      if (!target) { this.cancel(state, tick); continue; }
      if (state.phase === 'tracking') this.track(turret, state, target, tick);
      else if (!this.fixedShotLegal(turret, state, target)) this.cancel(state, tick);
    }

    const waiting = ordered.filter(turret => turret.hpMilli > 0 && this.stateFor(turret).phase === 'idle')
      .sort((a, b) => this.stateFor(a).waitingSinceTick - this.stateFor(b).waitingSinceTick || a.layout.id - b.layout.id);
    for (const turret of waiting) {
      const state = this.stateFor(turret), performance = ENEMY_PERFORMANCE[state.kind];
      const activity = [...this.states.values()].filter(other => active(other) && other.kind === state.kind);
      if (activity.length >= performance.activeCap) continue;
      const targets = aircraft.filter(plane => this.alive(plane)
        && activity.filter(other => other.targetTokenId === plane.tokenId && other.targetGeneration === plane.generation).length < performance.targetCap)
        .sort((a, b) => a.position.distanceToSquared(turret.muzzle) - b.position.distanceToSquared(turret.muzzle) || a.tokenId - b.tokenId);
      const target = targets.find(plane => this.predict(turret, plane) !== null);
      if (!target) continue;
      state.phase = 'tracking';
      state.trackingStartedTick = tick;
      state.targetTokenId = target.tokenId;
      state.targetGeneration = target.generation;
      state.shotCount = 0;
      state.lastFireTick = null;
      state.poolFailureTicks = 0;
      state.fixedPoint = null;
      state.fixedDirection = null;
      this.track(turret, state, target, tick);
    }

    if (this.anomaly) return [];
    const requests: EnemyFireRequest[] = [];
    for (const turret of ordered) {
      const state = this.stateFor(turret);
      if ((state.phase !== 'warning' && state.phase !== 'burst') || tick < state.nextFireTick || !state.fixedDirection) continue;
      const request: EnemyFireRequest = { requestId: ++this.requestSequence, turretId: state.turretId,
        kind: state.kind, origin: turret.muzzle.clone(), direction: state.fixedDirection.clone(),
        targetTokenId: state.targetTokenId!, targetGeneration: state.targetGeneration!, time: 0 };
      this.pending.set(request.requestId, request);
      requests.push(request);
    }
    return requests;
  }

  /** Called by the chronological core after all contacts at time zero have resolved. */
  fire(request: EnemyFireRequest, tick: number, allocateAttackId: () => number): Projectile | null {
    if (tick !== this.currentTick || this.pending.get(request.requestId) !== request || this.anomaly) return null;
    this.pending.delete(request.requestId);
    const turret = this.turrets.find(candidate => candidate.layout.id === request.turretId);
    const state = this.states.get(request.turretId);
    if (!turret || !state || turret.hpMilli <= 0) {
      if (state) { this.release(state, tick); state.phase = 'destroyed'; }
      return null;
    }
    const target = this.targetFor(state);
    if (!target || (state.phase !== 'warning' && state.phase !== 'burst') || !this.fixedShotLegal(turret, state, target)) {
      this.cancel(state, tick); return null;
    }
    const performance = ENEMY_PERFORMANCE[state.kind];
    if (this.bullets.filter(bullet => bullet.kind === state.kind).length >= performance.poolCap) {
      this.poolFailures += 1;
      state.poolFailureTicks += 1;
      state.nextFireTick = tick + 1;
      if (state.shotCount === 0) state.warningEndsTick = state.nextFireTick;
      if (state.poolFailureTicks >= 60) this.anomaly = `敵${state.kind === 'main' ? '主砲' : '機銃'}の弾生成が60tick連続で不成立（砲台${state.turretId}）`;
      return null;
    }
    const origin = turret.muzzle.clone();
    const bullet: Projectile = { id: allocateAttackId(), operationId: this.operationId, faction: 'enemy',
      kind: state.kind, shooterId: state.turretId, shooterGeneration: 0, owner: 'enemy',
      position: origin, previous: origin.clone(), velocity: state.fixedDirection!.clone().multiplyScalar(performance.speed),
      bornTick: tick, expiresTick: tick + performance.lifeTicks, distance: 0, baseDamageMilli: performance.damageMilli };
    this.bullets.push(bullet);
    state.poolFailureTicks = 0;
    state.shotCount += 1;
    state.lastFireTick = tick;
    if (state.shotCount >= performance.shots) {
      state.phase = 'reload';
      state.readyTick = tick + performance.reloadTicks;
      this.release(state, tick);
    } else {
      state.phase = 'burst';
      state.nextFireTick = tick + performance.intervalTicks;
    }
    return bullet;
  }

  private stateFor(turret: TurretState): TurretCombatState {
    let state = this.states.get(turret.layout.id);
    if (!state) {
      state = { turretId: turret.layout.id, kind: turret.layout.kind, phase: 'idle', waitingSinceTick: 0,
        readyTick: 0, trackingStartedTick: 0, warningStartedTick: 0, warningEndsTick: 0,
        targetTokenId: null, targetGeneration: null, fixedPoint: null, fixedDirection: null,
        nextFireTick: 0, lastFireTick: null, shotCount: 0, poolFailureTicks: 0 };
      this.states.set(state.turretId, state);
    }
    return state;
  }

  private alive(aircraft: AircraftToken): boolean {
    return aircraft.hpMilli > 0 && aircraft.operationId === this.operationId;
  }

  private targetFor(state: TurretCombatState): AircraftToken | undefined {
    return this.aircraft.find(plane => this.alive(plane) && plane.tokenId === state.targetTokenId
      && plane.generation === state.targetGeneration);
  }

  private predict(turret: TurretState, target: AircraftToken): Intercept | null {
    const performance = ENEMY_PERFORMANCE[turret.layout.kind];
    const origin = turret.muzzle;
    if (origin.distanceToSquared(target.position) > performance.range ** 2 || !this.world) return null;
    const currentDirection = target.position.clone().sub(origin).normalize();
    if (!legalAngles(turret, currentDirection) || !this.world.lineOfSight(origin, target.position)) return null;
    // The core has already copied previous=position for the new tick. Reading
    // that difference here would silently make every moving target stationary.
    const velocity = forwardOf(target).multiplyScalar(target.speed);
    const prediction = solveIntercept(origin, target.position, velocity, performance.warningTicks / 60,
      performance.speed, performance.lifeTicks / 60);
    if (!prediction || origin.distanceToSquared(prediction.point) > performance.range ** 2
      || !legalAngles(turret, prediction.direction) || !this.world.lineOfSight(origin, prediction.point)) return null;
    return prediction;
  }

  private track(turret: TurretState, state: TurretCombatState, target: AircraftToken, tick: number): void {
    if (tick - state.trackingStartedTick >= TRACKING_TICKS) { this.cancel(state, tick); return; }
    const prediction = this.predict(turret, target);
    if (!prediction) { this.cancel(state, tick); return; }
    const desired = angles(turret, prediction.direction);
    const deltaYaw = desired.yaw - turret.yaw, deltaPitch = desired.pitch - turret.pitch;
    const angularDistance = Math.hypot(deltaYaw, deltaPitch);
    const allowance = ENEMY_PERFORMANCE[state.kind].turnRate / 60;
    const scale = angularDistance > allowance ? allowance / angularDistance : 1;
    turret.yaw += deltaYaw * scale;
    turret.pitch += deltaPitch * scale;
    // Rotating the barrel also moves the real muzzle; solve again from that origin.
    const alignedPrediction = this.predict(turret, target);
    if (!alignedPrediction) { this.cancel(state, tick); return; }
    const direction = turretDirection(turret.layout, turret.yaw, turret.pitch);
    if (direction.angleTo(alignedPrediction.direction) <= ALIGNMENT + EPSILON) {
      state.phase = 'warning';
      state.warningStartedTick = tick;
      state.warningEndsTick = tick + ENEMY_PERFORMANCE[state.kind].warningTicks;
      state.nextFireTick = state.warningEndsTick;
      state.fixedPoint = alignedPrediction.point.clone();
      state.fixedDirection = direction.clone();
    }
  }

  private fixedShotLegal(turret: TurretState, state: TurretCombatState, target: AircraftToken): boolean {
    if (!state.fixedPoint || !state.fixedDirection || !this.world) return false;
    const origin = turretMuzzle(turret.layout, turret.yaw, turret.pitch);
    const performance = ENEMY_PERFORMANCE[state.kind];
    const position = this.startPositions.get(target.tokenId) ?? target.position;
    if (origin.distanceToSquared(position) > performance.range ** 2
      || origin.distanceToSquared(state.fixedPoint) > performance.range ** 2) return false;
    if (!legalAngles(turret, position.clone().sub(origin).normalize())
      || !legalAngles(turret, state.fixedDirection)) return false;
    const axis = turretDirection(turret.layout, turret.yaw, turret.pitch);
    return axis.angleTo(state.fixedPoint.clone().sub(origin).normalize()) <= ALIGNMENT + EPSILON
      && axis.angleTo(state.fixedDirection) <= EPSILON
      && this.world.lineOfSight(origin, position)
      && this.world.lineOfSight(origin, state.fixedPoint);
  }

  private release(state: TurretCombatState, tick: number): void {
    state.targetTokenId = null;
    state.targetGeneration = null;
    state.waitingSinceTick = tick;
  }

  private cancel(state: TurretCombatState, tick: number): void {
    const performance = ENEMY_PERFORMANCE[state.kind];
    state.phase = 'cancelled';
    state.readyTick = state.kind === 'mg' && state.lastFireTick !== null
      ? state.lastFireTick + performance.reloadTicks : tick + performance.cancellationTicks;
    this.release(state, tick);
  }
}
