// Aircraft barrel offsets, velocities and finite AI spread retain
// kaisen@3d751051dc6212482a129e8da596ddd349b2f9f5:src/simulation.ts.
// Finite wingman magazines and atomic reserved pools are Gekichin rules.
import { Quaternion, Vector3 } from 'three';
import { forwardOf } from './flight';
import { applyEasyShotCorrection } from './flight-assist';
import { CANNON_MAGAZINE, FRIENDLY_BULLET_CAPACITY, FRIENDLY_BULLET_LIFETIME, FRIENDLY_CANNON_SPEED, FRIENDLY_MG_SPEED,
  MG_MAGAZINE, PLAYER_BULLET_RESERVE, PLAYER_CANNON_INTERVAL, PLAYER_MG_INTERVAL, RELOAD_TICKS,
  WINGMAN_CANNON_INTERVAL, WINGMAN_MG_INTERVAL } from './rules';
import type { AircraftOwner, AircraftToken, FriendlyWeaponKind, Projectile } from './combat-types';

export interface FriendlyFireRequest {
  requestId: number;
  operationId: number;
  tokenId: number;
  generation: number;
  owner: AircraftOwner;
  kind: FriendlyWeaponKind;
  time: number;
  plane: AircraftToken;
  position: Vector3;
  quaternion: Quaternion;
  forward: Vector3;
  speed: number;
  aimPoint: Vector3 | null;
  easy: boolean;
}

export function friendlyDamageMilli(owner: AircraftOwner, kind: FriendlyWeaponKind, distance: number): number {
  const base = owner === 'player' ? (kind === 'mg' ? 4_000 : 20_000) : (kind === 'mg' ? 2_400 : 9_600);
  const band = distance < 200 ? 0 : distance < 500 ? 1 : distance < 800 ? 2 : 3;
  return Math.round(base * (kind === 'mg' ? [1, 0.75, 0.5, 0.25] : [1, 0.9, 0.8, 0.7])[band]);
}

export function advanceAmmunition(plane: AircraftToken, tick: number): void {
  const ammunition = plane.ammunition;
  if (ammunition.reloadUntilTick !== null && tick >= ammunition.reloadUntilTick) {
    ammunition.mg = MG_MAGAZINE;
    ammunition.cannon = CANNON_MAGAZINE;
    ammunition.reloadUntilTick = null;
  }
}

export class AircraftWeapons {
  private readonly projectiles: Projectile[] = [];
  private requestSequence = 0;
  allocationFailures = 0;
  maxObserved = 0;
  constructor(readonly operationId: number) {}
  get bullets(): readonly Projectile[] { return this.projectiles; }

  plan(plane: AircraftToken, tick: number, firing: boolean, easy = false, aimPoint: Vector3 | null = null): FriendlyFireRequest[] {
    if (!firing || plane.hpMilli <= 0 || plane.operationId !== this.operationId || plane.bornTick >= tick || plane.ammunition.reloadUntilTick !== null) return [];
    return (['mg', 'cannon'] as const).filter(kind => plane.ammunition[kind] >= 2 && tick >= plane.ammunition[kind === 'mg' ? 'mgReadyTick' : 'cannonReadyTick'])
      .map(kind => ({ requestId: ++this.requestSequence, operationId: this.operationId, tokenId: plane.tokenId, generation: plane.generation,
        owner: plane.owner, kind, time: 0, plane, position: plane.previous.clone(), quaternion: plane.quaternion.clone(),
        forward: forwardOf(plane), speed: plane.speed, aimPoint: aimPoint?.clone() ?? null, easy }));
  }

  /** Commit the complete two-barrel volley or leave clocks, ammunition and N alone. */
  fire(request: FriendlyFireRequest, tick: number, allocateAttackId: () => number): readonly Projectile[] {
    const plane = request.plane, ammunition = plane.ammunition, kind = request.kind;
    const ready = kind === 'mg' ? 'mgReadyTick' : 'cannonReadyTick';
    if (plane.hpMilli <= 0 || plane.operationId !== this.operationId || request.operationId !== this.operationId
      || plane.tokenId !== request.tokenId || plane.generation !== request.generation || plane.owner !== request.owner
      || ammunition.reloadUntilTick !== null || ammunition[kind] < 2 || tick < ammunition[ready]) return [];
    const wingmanCount = this.projectiles.filter(bullet => bullet.owner === 'wingman').length;
    if (this.projectiles.length + 2 > FRIENDLY_BULLET_CAPACITY
      || (request.owner === 'wingman' && wingmanCount + 2 > FRIENDLY_BULLET_CAPACITY - PLAYER_BULLET_RESERVE)) {
      this.allocationFailures += 1;
      return [];
    }
    const shots: Projectile[] = [];
    for (const side of [-1, 1]) {
      const offset = kind === 'mg' ? new Vector3(side * 0.3, 0.52, -4.25) : new Vector3(side * 2.5, 0, -2.4);
      const origin = request.position.clone().add(offset.applyQuaternion(request.quaternion));
      const forward = request.forward.clone();
      let direction = request.easy && request.aimPoint
        ? applyEasyShotCorrection(forward, request.aimPoint.clone().sub(origin).normalize()) : forward;
      if (request.owner === 'wingman') {
        direction.x += Math.sin(tick * 1.7 + plane.tokenId * 3 + side) * 0.012;
        direction.y += Math.cos(tick * 1.3 + plane.tokenId * 2 + side) * 0.012;
        direction.normalize();
      }
      const speed = request.speed + (kind === 'mg' ? FRIENDLY_MG_SPEED : FRIENDLY_CANNON_SPEED);
      const bullet: Projectile = { id: allocateAttackId(), operationId: this.operationId, faction: 'friendly', kind,
        shooterId: request.tokenId, shooterGeneration: request.generation, owner: request.owner,
        position: origin, previous: origin.clone(), velocity: direction.multiplyScalar(speed),
        bornTick: tick, expiresTick: tick + FRIENDLY_BULLET_LIFETIME, distance: 0,
        baseDamageMilli: friendlyDamageMilli(request.owner, kind, 0) };
      this.projectiles.push(bullet);
      shots.push(bullet);
    }
    ammunition[kind] -= 2;
    ammunition[ready] = tick + (request.owner === 'player'
      ? kind === 'mg' ? PLAYER_MG_INTERVAL : PLAYER_CANNON_INTERVAL
      : kind === 'mg' ? WINGMAN_MG_INTERVAL : WINGMAN_CANNON_INTERVAL);
    if (ammunition.mg === 0 && ammunition.cannon === 0) ammunition.reloadUntilTick = tick + RELOAD_TICKS;
    this.maxObserved = Math.max(this.maxObserved, this.projectiles.length);
    return shots;
  }
  remove(id: number): void {
    const index = this.projectiles.findIndex(bullet => bullet.id === id);
    if (index >= 0) this.projectiles.splice(index, 1);
  }
  expire(tick: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) if (tick >= this.projectiles[index].expiresTick) this.projectiles.splice(index, 1);
  }
  assertInvariants(aircraft: readonly AircraftToken[]): void {
    if (this.projectiles.length > FRIENDLY_BULLET_CAPACITY
      || this.projectiles.filter(bullet => bullet.owner === 'wingman').length > FRIENDLY_BULLET_CAPACITY - PLAYER_BULLET_RESERVE
      || aircraft.some(plane => !Number.isInteger(plane.ammunition.mg) || plane.ammunition.mg < 0 || plane.ammunition.mg > MG_MAGAZINE
        || !Number.isInteger(plane.ammunition.cannon) || plane.ammunition.cannon < 0 || plane.ammunition.cannon > CANNON_MAGAZINE)) throw new Error('Weapon conservation violated');
  }
}
