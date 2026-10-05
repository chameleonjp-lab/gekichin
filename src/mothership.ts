import { createMothershipLayout, turretBoxes, turretMuzzle, type BoxSpec, type MothershipFace, type MothershipLayout, type TurretDefinition, type TurretId } from './mothership-layout';
import type { Vector3 } from 'three';

export type DamageStage = 'healthy' | 'damaged' | 'critical' | 'destroyed';
/** Production IDs are monotonically increasing numbers; strings are bounded fixtures. */
export interface TurretDamageContext { attackId: number | string; tick: number; }
export interface TurretEvent {
  type: 'turret-damaged' | 'turret-destroyed';
  attackId: number | string;
  targetId: TurretId;
  tick: number;
  actualMilli: number;
}
export interface TurretDamageResolution {
  /** Actual damage in integer1/1000HP, never the unclipped requested amount. */
  actual: number;
  killed: boolean;
  events: readonly TurretEvent[];
}

export class TurretState {
  hpMilli: number;
  yaw = 0;
  pitch = Math.PI / 4;
  private cachedBoxes: BoxSpec[] = [];
  private cachedYaw = NaN;
  private cachedPitch = NaN;
  private cachedDestroyed = false;

  constructor(readonly layout: TurretDefinition) { this.hpMilli = layout.maxHpMilli; }
  get id(): TurretId { return this.layout.id; }
  get maxHpMilli(): number { return this.layout.maxHpMilli; }
  get muzzle(): Vector3 { return turretMuzzle(this.layout, this.yaw, this.pitch); }
  get stage(): DamageStage {
    return this.hpMilli === 0 ? 'destroyed' : this.hpMilli > this.maxHpMilli / 2 ? 'healthy'
      : this.hpMilli > this.maxHpMilli / 4 ? 'damaged' : 'critical';
  }
  get boxes(): readonly BoxSpec[] {
    const destroyed = this.hpMilli === 0;
    if (this.cachedYaw !== this.yaw || this.cachedPitch !== this.pitch || this.cachedDestroyed !== destroyed || !this.cachedBoxes.length) {
      this.cachedBoxes = turretBoxes(this.layout, this.yaw, this.pitch, destroyed);
      this.cachedYaw = this.yaw; this.cachedPitch = this.pitch; this.cachedDestroyed = destroyed;
    }
    return this.cachedBoxes;
  }
}

/** HP/state owner; geometry and the score ledger only read its resolved events. */
export class Mothership {
  readonly turrets: TurretState[];
  readonly destroyedIds = new Set<TurretId>();
  private readonly byIdentifier = new Map<TurretId, TurretState>();
  private readonly consumedAttacks = new Set<number>();
  private readonly fixtureAttacks = new Set<string>();
  private retiredAttackFloor = 0;
  private nextAnonymousAttack = 0;
  lastDestroyedTick: number | null = null;
  private frozen = false;

  constructor(readonly layout: MothershipLayout = createMothershipLayout()) {
    this.turrets = layout.turrets.map(definition => new TurretState(definition));
    for (const turret of this.turrets) {
      if (this.byIdentifier.has(turret.id)) throw new Error('Duplicate turret ID.');
      this.byIdentifier.set(turret.id, turret);
    }
  }
  byId(id: TurretId): TurretState | undefined { return this.byIdentifier.get(id); }
  get remaining(): number { return this.turrets.length - this.destroyedIds.size; }
  get remainingMain(): number { return this.turrets.filter(turret => turret.layout.kind === 'main' && turret.hpMilli > 0).length; }
  get remainingMG(): number { return this.turrets.filter(turret => turret.layout.kind === 'mg' && turret.hpMilli > 0).length; }
  get totalHpMilli(): number { return this.turrets.reduce((sum, turret) => sum + turret.hpMilli, 0); }
  get allDestroyed(): boolean { return this.remaining === 0; }
  remainingOnFace(face: MothershipFace): number { return this.turrets.filter(turret => turret.layout.face === face && turret.hpMilli > 0).length; }

  applyDamage(id: TurretId, amountMilli: number, context?: TurretDamageContext): TurretDamageResolution {
    const empty: TurretDamageResolution = { actual: 0, killed: false, events: [] };
    if (this.frozen || !Number.isFinite(amountMilli) || amountMilli < 0) return empty;
    const turret = this.byIdentifier.get(id);
    if (!turret) return empty;
    const attackId = context?.attackId ?? `local-damage-${this.nextAnonymousAttack++}`;
    if (context && typeof attackId === 'number') {
      if (!Number.isSafeInteger(attackId) || attackId < this.retiredAttackFloor || this.consumedAttacks.has(attackId)) return empty;
      this.consumedAttacks.add(attackId);
    } else if (context && typeof attackId === 'string') {
      if (this.fixtureAttacks.has(attackId)) return empty;
      this.fixtureAttacks.add(attackId);
      // Strings are only for bounded synthetic fixtures. Runtime numeric IDs
      // retain exact replay rejection via the monotone retirement floor below.
      if (this.fixtureAttacks.size > 256) this.fixtureAttacks.delete(this.fixtureAttacks.values().next().value!);
    }
    const actual = Math.min(turret.hpMilli, Math.round(amountMilli));
    if (actual <= 0) return empty;
    const tick = context?.tick ?? 0;
    turret.hpMilli -= actual;
    const events: TurretEvent[] = [{ type: 'turret-damaged', attackId, targetId: id, tick, actualMilli: actual }];
    const killed = turret.hpMilli === 0;
    if (killed) {
      this.destroyedIds.add(id);
      events.push({ type: 'turret-destroyed', attackId, targetId: id, tick, actualMilli: actual });
      if (this.allDestroyed) this.lastDestroyedTick = tick;
    }
    return { actual, killed, events };
  }

  freeze(): void { this.frozen = true; }
  retireAttackIds(minLiveId: number): void {
    if (!Number.isSafeInteger(minLiveId) || minLiveId < 0) throw new Error('Minimum live attack ID must be a non-negative integer.');
    this.retiredAttackFloor = Math.max(this.retiredAttackFloor, minLiveId);
    for (const id of this.consumedAttacks) if (id < this.retiredAttackFloor) this.consumedAttacks.delete(id);
  }
  get retainedAttackCount(): number { return this.consumedAttacks.size; }
}
