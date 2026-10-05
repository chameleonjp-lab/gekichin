import { Quaternion, Vector3 } from 'three';
import { advanceThrottle, createFlightController, updateAircraftMotion, updatePlayerLoop, updateQuaternion, CRUISE_SPEED, ENEMY_MAX_PITCH, MAX_SPEED, type FlightController } from './flight';
import { AIRCRAFT_RADIUS, BOUNDARY_GRACE_TICKS, BOUNDARY_HIGH, BOUNDARY_LOW, BOUNDARY_RADIUS, BOUNDARY_WARNING, FIXED_DT, INITIAL_SEED } from './rules';
import { getFlightAssist } from './flight-assist';
import { projectFlightTarget } from './flight-view';
import { AircraftWeapons, advanceAmmunition, friendlyDamageMilli, type FriendlyFireRequest } from './aircraft-weapons';
import { Fleet } from './fleet';
import { ScoreLedger } from './scoring';
import { Mothership, type TurretState } from './mothership';
import { CollisionWorld, type CollisionHit } from './collision-world';
import { EnemyTurretCombat } from './turret-combat';
import { WingmanAI } from './wingman-ai';
import type { AircraftToken, CombatEvent, CombatReport, EnemyFireRequest, MissionOutcome, Projectile } from './combat-types';
import type { Aircraft, FlightInput, GameMode, GamePhase, PauseReason } from './types';

export function createPlayer(): Aircraft {
  const player: Aircraft = {
    position: new Vector3(0, 1000, 2000), previous: new Vector3(0, 1000, 2000),
    quaternion: new Quaternion(), yaw: 0, pitch: 0, bank: 0,
    speed: CRUISE_SPEED, loopProgress: 0, loopCooldown: 0,
  };
  updateQuaternion(player);
  return player;
}

interface BulletPath { bullet: Projectile; from: Vector3; to: Vector3; distance: number }
interface BulletContact { type: 'bullet'; time: number; attackId: number; targetId: number; path: BulletPath; hit: CollisionHit; staticVersion: number }
interface AircraftContact { type: 'aircraft'; time: number; attackId: number; targetId: number; aircraft: AircraftToken; point: Vector3; reason: string }
interface FireEvent { type: 'friendly-fire' | 'enemy-fire'; time: number; shooterId: number; weaponOrder: number; requestId: number; request: FriendlyFireRequest | EnemyFireRequest }
type TickEvent = BulletContact | AircraftContact | FireEvent;
const EPSILON = 1e-9;
const MAX_PRESENTATION_EVENTS = 256;

/** Exact relative sweep, including a target's motion within the same tick. */
export function movingSphereContact(from: Vector3, to: Vector3, previous: Vector3, position: Vector3, radius: number): number | null {
  const offset = from.clone().sub(previous);
  const motion = to.clone().sub(from).sub(position.clone().sub(previous));
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const a = motion.lengthSq();
  if (a <= EPSILON) return null;
  const b = 2 * offset.dot(motion), discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  return time >= -EPSILON && time <= 1 + EPSILON ? Math.max(0, Math.min(1, time)) : null;
}

function eventOrder(a: TickEvent, b: TickEvent): number {
  if (Math.abs(a.time - b.time) > EPSILON) return a.time - b.time;
  const aContact = a.type === 'bullet' || a.type === 'aircraft';
  const bContact = b.type === 'bullet' || b.type === 'aircraft';
  if (aContact !== bContact) return aContact ? -1 : 1;
  if (aContact && bContact) return (a as BulletContact).attackId - (b as BulletContact).attackId || (a as BulletContact).targetId - (b as BulletContact).targetId;
  const first = a as FireEvent, second = b as FireEvent;
  return first.shooterId - second.shooterId || first.weaponOrder - second.weaponOrder || first.requestId - second.requestId;
}

/** One operation and one60Hz owner for motion, lives, damage and score. */
export class FlightSession {
  phase: GamePhase = 'home';
  mode: GameMode = 'easy';
  operationId = 0;
  seed = INITIAL_SEED;
  tick = 0;
  fleet: Fleet;
  mothership: Mothership;
  world: CollisionWorld;
  weapons: AircraftWeapons;
  enemyCombat: EnemyTurretCombat;
  wingmen = new WingmanAI();
  score = new ScoreLedger();
  controller: FlightController;
  pauseReason: PauseReason | null = null;
  abnormalReason: string | null = null;
  report: CombatReport | null = null;
  target: TurretState | null = null;
  private cameraAircraft = createPlayer();
  private eventSequence = 0;
  private attackSequence = 0;
  private readonly presentationEvents: CombatEvent[] = [];
  private controllerRevision = 0;
  private ignoreInputOnce = false;
  private previousWarnings = new Set<number>();

  constructor() {
    this.mothership = new Mothership();
    this.world = new CollisionWorld(this.mothership);
    this.fleet = new Fleet(this.operationId, this.mothership.layout.spawnCandidates.slice(0, 8));
    this.weapons = new AircraftWeapons(this.operationId);
    this.enemyCombat = new EnemyTurretCombat(this.operationId);
    this.cameraAircraft = this.fleet.player!;
    this.controller = createFlightController(this.cameraAircraft);
  }

  /** The retained destroyed plane provides a stable camera during the wait. */
  get player(): Aircraft { return this.fleet.player ?? this.cameraAircraft; }
  get events(): readonly CombatEvent[] { return this.presentationEvents; }
  get boundary(): { warning: boolean; outside: boolean; distance: number; direction: Vector3; remainingTicks: number } {
    const point = this.player.position, horizontal = Math.hypot(point.x, point.z);
    const clearances = [BOUNDARY_RADIUS - horizontal, point.y - BOUNDARY_LOW, BOUNDARY_HIGH - point.y];
    const distance = Math.min(...clearances), index = clearances.indexOf(distance);
    const direction = index === 0 ? new Vector3(-point.x, 0, -point.z).normalize() : new Vector3(0, index === 1 ? 1 : -1, 0);
    return { warning: distance <= BOUNDARY_WARNING, outside: distance < 0, distance, direction,
      remainingTicks: Math.max(0, BOUNDARY_GRACE_TICKS - (this.fleet.player?.outsideTicks ?? 0)) };
  }

  prepare(mode: GameMode, seed = INITIAL_SEED): number | null {
    if (!['home', 'result'].includes(this.phase)) return null;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Invalid mission seed');
    this.operationId += 1;
    this.mode = mode;
    this.seed = seed;
    this.phase = 'preparing';
    this.resetOperation();
    return this.operationId;
  }

  begin(operationId: number): boolean {
    if (this.phase !== 'preparing' || operationId !== this.operationId) return false;
    this.validateGeometry();
    this.phase = 'playing';
    return true;
  }

  pause(reason: PauseReason): boolean {
    if (this.phase !== 'playing') return false;
    this.phase = 'paused';
    this.pauseReason = reason;
    return true;
  }

  resume(): boolean {
    if (this.phase !== 'paused') return false;
    const retryAnomaly = this.pauseReason === 'abnormal';
    this.phase = 'playing';
    this.pauseReason = null;
    this.abnormalReason = null;
    if (retryAnomaly) { this.enemyCombat.clearAnomaly(); this.fleet.clearBlockedWaits(); }
    return true;
  }

  step(input: FlightInput): void {
    if (this.phase !== 'playing') return;
    const tick = this.tick + 1;
    const aircraft = this.fleet.active;
    const accepted = this.ignoreInputOnce ? { ...input, turn: 0, climb: 0, fire: false, loop: false, throttle: 0, accelerate: false, brake: false } : input;
    this.ignoreInputOnce = false;
    const player = this.fleet.player;
    if (player && this.controllerRevision !== this.fleet.ownershipRevision) {
      this.controller = createFlightController(player);
      this.controllerRevision = this.fleet.ownershipRevision;
    }
    for (const plane of aircraft) {
      plane.previous.copy(plane.position);
      advanceAmmunition(plane, tick);
    }
    this.weapons.expire(tick);
    for (const bullet of [...this.enemyCombat.bullets]) if (tick >= bullet.expiresTick) this.enemyCombat.remove(bullet.id);
    const targets = player ? this.mothership.turrets.filter(turret => turret.hpMilli > 0).map(turret => ({ turret,
      aimPoint: turret.layout.aimPoint, alive: true, exposed: this.world.lineOfSight(player.position, turret.layout.aimPoint, turret.layout.id) })) : [];
    const aspect = accepted.viewAspect ?? 393 / 852;
    const visible = player ? targets.filter(candidate => candidate.exposed && projectFlightTarget(player, candidate.aimPoint, aspect, this.mode).visible)
      .sort((a, b) => player.position.distanceToSquared(a.aimPoint) - player.position.distanceToSquared(b.aimPoint) || a.turret.layout.id - b.turret.layout.id) : [];
    this.target = visible[0]?.turret ?? null;
    const intents = this.wingmen.step(tick, aircraft, this.mothership, this.world);
    const enemyRequests = this.enemyCombat.step(tick, this.mothership.turrets, aircraft, this.world);
    const friendlyRequests: FriendlyFireRequest[] = [];
    for (const plane of aircraft) {
      if (plane.owner === 'player') {
        // Fire at the tick's starting position, attitude and speed; motion follows.
        const autoFire = this.mode === 'easy' && this.target !== null && projectFlightTarget(plane, this.target.layout.aimPoint, aspect, this.mode).inCircle;
        friendlyRequests.push(...this.weapons.plan(plane, tick, this.mode === 'easy' ? autoFire : accepted.fire, this.mode === 'easy', this.target?.layout.aimPoint ?? null));
        const preferredSpeed = advanceThrottle(this.controller, accepted, this.mode, FIXED_DT);
        const assist = getFlightAssist(plane, targets, accepted, this.mode);
        updatePlayerLoop(plane, this.controller, { ...accepted, turn: assist.turn, climb: assist.climb }, accepted, accepted.loop,
          FIXED_DT, preferredSpeed, this.mode === 'easy' ? CRUISE_SPEED : MAX_SPEED, assist.responseMultiplier);
      } else {
        const intent = intents.get(plane.tokenId) ?? { turn: 0, climb: 0, fire: false };
        friendlyRequests.push(...this.weapons.plan(plane, tick, intent.fire));
        updateAircraftMotion(plane, intent.turn, intent.climb, FIXED_DT, intent.preferredSpeed ?? CRUISE_SPEED, false, MAX_SPEED, ENEMY_MAX_PITCH, 1);
      }
    }
    this.separateAircraft(aircraft);
    const queue: TickEvent[] = [];
    const paths = new Map<number, BulletPath>();
    for (const bullet of [...this.weapons.bullets, ...this.enemyCombat.bullets]) this.scheduleBullet(bullet, paths, queue);
    for (const plane of aircraft) {
      const hit = this.world.sweep(plane.previous, plane.position, { radius: AIRCRAFT_RADIUS, aircraft: false, sea: true });
      if (hit) queue.push({ type: 'aircraft', time: hit.time, attackId: this.allocateAttackId(), targetId: plane.tokenId,
        aircraft: plane, point: hit.point, reason: hit.kind === 'sea' ? '海面と衝突' : '母艦と衝突' });
      const outside = Math.hypot(plane.position.x, plane.position.z) > BOUNDARY_RADIUS || plane.position.y < BOUNDARY_LOW || plane.position.y > BOUNDARY_HIGH;
      plane.outsideTicks = outside ? plane.outsideTicks + 1 : 0;
      if (plane.outsideTicks >= BOUNDARY_GRACE_TICKS) queue.push({ type: 'aircraft', time: 1, attackId: this.allocateAttackId(), targetId: plane.tokenId,
        aircraft: plane, point: plane.position.clone(), reason: '戦闘領域外に10秒滞在' });
    }
    for (const request of friendlyRequests) queue.push({ type: 'friendly-fire', time: request.time, shooterId: request.tokenId,
      weaponOrder: request.kind === 'mg' ? 0 : 1, requestId: request.requestId, request });
    for (const request of enemyRequests) queue.push({ type: 'enemy-fire', time: request.time, shooterId: 50 + request.turretId,
      weaponOrder: request.kind === 'mg' ? 0 : 1, requestId: request.requestId, request });
    this.resolveEvents(queue, paths, tick);
    for (const path of paths.values()) {
      if (!this.hasBullet(path.bullet)) continue;
      path.bullet.previous.copy(path.from);
      path.bullet.position.copy(path.to);
      path.bullet.distance += path.distance;
      if (tick + 1 >= path.bullet.expiresTick) this.removeBullet(path.bullet);
    }
    this.tick = tick;
    if (this.fleet.counts.remaining === 0) { this.terminate(this.mothership.remaining === 0 ? 'mutual' : 'defeat'); return; }
    if (this.mothership.remaining === 0) { this.terminate('victory'); return; }
    const revision = this.fleet.ownershipRevision;
    const post = this.fleet.postTick(tick, (slot, active) => this.selectSpawn(slot, active));
    for (const transition of post.transitions) this.emit({ tick, kind: transition.kind, point: transition.aircraft.position,
      tokenId: transition.aircraft.tokenId, generation: transition.aircraft.generation, owner: transition.aircraft.owner });
    if (this.fleet.player) this.cameraAircraft = this.fleet.player;
    if (this.fleet.ownershipRevision !== revision) this.ignoreInputOnce = true;
    const warnings = new Set(this.enemyCombat.warnings.map(warning => warning.turretId));
    for (const warning of this.enemyCombat.warnings) if (!this.previousWarnings.has(warning.turretId)) this.emit({ tick, kind: 'warning',
      targetId: warning.turretId, point: warning.origin, weapon: warning.kind, owner: 'enemy' });
    this.previousWarnings = warnings;
    const anomaly = post.anomaly ?? this.enemyCombat.anomaly;
    if (anomaly) { this.abnormalReason = anomaly; this.emit({ tick, kind: 'abnormal', message: anomaly }); this.pause('abnormal'); }
    const liveIds = this.weapons.bullets.map(bullet => bullet.id);
    const beforeId = liveIds.length ? Math.min(...liveIds) : this.attackSequence + 1;
    this.score.retireAttackIds(beforeId);
    this.mothership.retireAttackIds(beforeId);
    this.score.assertInvariants();
    this.fleet.assertInvariants();
    this.weapons.assertInvariants(this.fleet.active);
  }

  /** User termination is an interruption, never a forged victory. */
  finish(_reason: 'completed' | 'aborted' = 'aborted'): boolean {
    if (this.phase !== 'playing' && this.phase !== 'paused') return false;
    this.terminate('aborted');
    return true;
  }

  home(): void {
    this.operationId += 1;
    this.phase = 'home';
    this.resetOperation();
  }

  private resetOperation(): void {
    this.tick = 0;
    this.pauseReason = null;
    this.abnormalReason = null;
    this.report = null;
    this.target = null;
    this.presentationEvents.length = 0;
    this.eventSequence = 0;
    this.attackSequence = 0;
    this.previousWarnings.clear();
    this.mothership = new Mothership();
    this.world = new CollisionWorld(this.mothership);
    this.fleet = new Fleet(this.operationId, this.mothership.layout.spawnCandidates.slice(0, 8));
    this.cameraAircraft = this.fleet.player!;
    this.controller = createFlightController(this.cameraAircraft);
    this.controllerRevision = 0;
    this.ignoreInputOnce = false;
    this.weapons = new AircraftWeapons(this.operationId);
    this.enemyCombat = new EnemyTurretCombat(this.operationId);
    this.wingmen = new WingmanAI();
    this.score = new ScoreLedger();
  }

  private validateGeometry(): void {
    const turrets = this.mothership.turrets;
    if (turrets.length !== 100 || new Set(turrets.map(turret => turret.layout.id)).size !== 100
      || turrets.filter(turret => turret.layout.kind === 'main').length !== 20 || this.mothership.totalHpMilli !== 24_000_000) throw new Error('Invalid fixed turret layout');
    for (const turret of turrets) {
      const [start, end] = turret.layout.attackApproach;
      if (start.distanceTo(end) < 300 - EPSILON || this.world.sweep(start, end, { radius: AIRCRAFT_RADIUS + 10, aircraft: false, sea: false })
        || !this.world.lineOfSight(start, turret.layout.aimPoint, turret.layout.id)) throw new Error(`No legal attack approach for turret ${turret.layout.id}`);
    }
    for (const plane of this.fleet.active) if (!this.spawnClear(plane.position, this.fleet.active.filter(other => other.tokenId !== plane.tokenId))) throw new Error('Unsafe initial sortie');
  }

  private allocateAttackId = (): number => ++this.attackSequence;
  private hasBullet(bullet: Projectile): boolean {
    return bullet.operationId === this.operationId && (bullet.faction === 'friendly' ? this.weapons.bullets : this.enemyCombat.bullets).some(candidate => candidate.id === bullet.id);
  }
  private removeBullet(bullet: Projectile): void { if (bullet.faction === 'friendly') this.weapons.remove(bullet.id); else this.enemyCombat.remove(bullet.id); }

  private scheduleBullet(bullet: Projectile, paths: Map<number, BulletPath>, queue: TickEvent[]): void {
    const from = bullet.position.clone(), to = from.clone().addScaledVector(bullet.velocity, FIXED_DT);
    const path: BulletPath = { bullet, from, to, distance: from.distanceTo(to) };
    paths.set(bullet.id, path);
    this.scheduleContact(path, queue, 0);
  }

  private scheduleContact(path: BulletPath, queue: TickEvent[], after: number): void {
    const from = path.from.clone().lerp(path.to, after);
    let closest = this.world.sweep(from, path.to, { aircraft: false, sea: true,
      ignoreTurretId: path.bullet.faction === 'enemy' ? path.bullet.shooterId : undefined });
    if (closest) closest = { ...closest, time: after + closest.time * (1 - after) };
    for (const plane of this.fleet.active) {
      if (path.bullet.faction === 'friendly' && plane.tokenId === path.bullet.shooterId && plane.generation === path.bullet.shooterGeneration) continue;
      const previous = plane.previous.clone().lerp(plane.position, after);
      const localTime = movingSphereContact(from, path.to, previous, plane.position, AIRCRAFT_RADIUS);
      if (localTime === null) continue;
      const time = after + localTime * (1 - after);
      if (closest && (time > closest.time + EPSILON || (Math.abs(time - closest.time) <= EPSILON && plane.tokenId >= (closest.tokenId ?? -1)))) continue;
      const point = path.from.clone().lerp(path.to, time);
      const center = plane.previous.clone().lerp(plane.position, time);
      closest = { time, point, contactPoint: point.clone(), normal: point.clone().sub(center).normalize(), kind: 'aircraft', tokenId: plane.tokenId, id: plane.tokenId, partId: `aircraft-${plane.tokenId}` };
    }
    // The final endpoint is the first instant outside [born,born+life).
    if (closest && !(closest.time >= 1 && this.tick + 2 >= path.bullet.expiresTick)) queue.push({ type: 'bullet', time: closest.time, attackId: path.bullet.id,
      targetId: closest.tokenId ?? closest.id ?? -1, path, hit: closest, staticVersion: this.mothership.destroyedIds.size });
  }

  private resolveEvents(queue: TickEvent[], paths: Map<number, BulletPath>, tick: number): void {
    while (queue.length) {
      queue.sort(eventOrder);
      const event = queue.shift()!;
      if (event.type === 'friendly-fire') {
        const request = event.request as FriendlyFireRequest;
        if (!this.fleet.matches(request.tokenId, request.generation, request.operationId)) continue;
        for (const bullet of this.weapons.fire(request, tick, this.allocateAttackId)) {
          this.score.recordShot(bullet.id, bullet.owner as 'player' | 'wingman');
          this.emit({ tick, kind: 'shot', point: bullet.position, weapon: bullet.kind, owner: bullet.owner, attackId: bullet.id, tokenId: bullet.shooterId,
            time: event.time, shooterId: bullet.shooterId, shooterGeneration: bullet.shooterGeneration });
          this.scheduleBullet(bullet, paths, queue);
        }
      } else if (event.type === 'enemy-fire') {
        const bullet = this.enemyCombat.fire(event.request as EnemyFireRequest, tick, this.allocateAttackId);
        if (bullet) { this.emit({ tick, kind: 'shot', point: bullet.position, weapon: bullet.kind, owner: 'enemy', attackId: bullet.id, targetId: bullet.shooterId,
          time: event.time, shooterId: bullet.shooterId, shooterGeneration: bullet.shooterGeneration }); this.scheduleBullet(bullet, paths, queue); }
      } else if (event.type === 'aircraft') {
        if (this.fleet.matches(event.aircraft.tokenId, event.aircraft.generation)) {
          event.aircraft.position.copy(event.point);
          this.loseAircraft(event.aircraft, tick, event.reason);
        }
      } else if (event.type === 'bullet') {
        if (!this.hasBullet(event.path.bullet)) continue;
        if ((event.hit.kind === 'aircraft' && !this.fleet.byId(event.hit.tokenId!)) || event.staticVersion !== this.mothership.destroyedIds.size) {
          this.scheduleContact(event.path, queue, event.time);
          continue;
        }
        const bullet = event.path.bullet;
        bullet.previous.copy(event.path.from);
        bullet.position.copy(event.hit.point);
        bullet.distance += event.path.distance * event.time;
        this.resolveHit(bullet, event.hit, event.time, tick);
        this.removeBullet(bullet);
      }
    }
  }

  private resolveHit(bullet: Projectile, hit: CollisionHit, time: number, tick: number): void {
    let actual = 0;
    let calculatedDamage = 0;
    const targetGeneration = hit.tokenId === undefined ? 0 : this.fleet.byId(hit.tokenId)?.generation;
    if (bullet.faction === 'friendly') {
      const damage = friendlyDamageMilli(bullet.owner as 'player' | 'wingman', bullet.kind as 'mg' | 'cannon', bullet.distance);
      calculatedDamage = damage;
      if (hit.kind === 'turret' && hit.id !== undefined) {
        const turret = this.mothership.byId(hit.id);
        if (turret) {
          const result = this.mothership.applyDamage(turret.layout.id, damage, { attackId: bullet.id, tick });
          actual = result.actual;
          this.score.recordDamage(bullet.id, bullet.owner as 'player' | 'wingman', turret.layout.kind, turret.layout.id, actual, result.killed);
          if (result.killed) {
            this.enemyCombat.destroyTurret(turret.layout.id, tick);
            this.emit({ tick, kind: 'turret-destroyed', point: turret.layout.aimPoint, targetId: turret.layout.id, owner: bullet.owner, attackId: bullet.id, time });
          }
        }
      } else if (hit.kind === 'aircraft' && this.mode === 'normal' && bullet.owner === 'player') {
        const plane = this.fleet.byId(hit.tokenId!);
        actual = this.damageAircraft(hit.tokenId!, damage, tick, plane?.previous.clone().lerp(plane.position, time));
      }
    } else {
      calculatedDamage = bullet.baseDamageMilli;
      if (hit.kind === 'aircraft') {
        const plane = this.fleet.byId(hit.tokenId!);
        actual = this.damageAircraft(hit.tokenId!, bullet.baseDamageMilli, tick, plane?.previous.clone().lerp(plane.position, time));
      }
      if (bullet.kind === 'main') {
        for (const plane of this.fleet.active) {
          if (hit.kind === 'aircraft' && plane.tokenId === hit.tokenId) continue;
          const position = plane.previous.clone().lerp(plane.position, time);
          const distance = hit.point.distanceTo(position);
          if (distance >= 20) continue;
          const origin = hit.point.clone().addScaledVector(hit.normal, 0.02);
          if (!this.world.lineOfSight(origin, position)) continue;
          const calculated = Math.round(12_000 * (1 - distance / 20));
          const splash = this.damageAircraft(plane.tokenId, calculated, tick, position);
          this.emit({ tick, kind: 'hit', point: position, weapon: 'main', owner: 'enemy', attackId: bullet.id, time,
            shooterId: bullet.shooterId, shooterGeneration: bullet.shooterGeneration, tokenId: plane.tokenId,
            targetGeneration: plane.generation, calculatedDamageMilli: calculated, damageMilli: splash });
        }
      }
    }
    this.emit({ tick, kind: 'hit', point: hit.contactPoint, weapon: bullet.kind, owner: bullet.owner,
      attackId: bullet.id, targetId: hit.id, tokenId: hit.tokenId, damageMilli: actual, time, targetGeneration,
      calculatedDamageMilli: calculatedDamage, shooterId: bullet.shooterId, shooterGeneration: bullet.shooterGeneration });
  }

  private damageAircraft(tokenId: number, damageMilli: number, tick: number, position?: Vector3): number {
    const plane = this.fleet.byId(tokenId);
    if (!plane) return 0;
    const actual = Math.min(plane.hpMilli, Math.max(0, Math.round(damageMilli)));
    plane.hpMilli -= actual;
    if (plane.hpMilli === 0) { if (position) plane.position.copy(position); this.loseAircraft(plane, tick, '被弾'); }
    return actual;
  }
  private loseAircraft(plane: AircraftToken, tick: number, reason: string): void {
    const lost = this.fleet.lose(plane.tokenId, tick);
    if (!lost) return;
    this.score.recordLoss(lost.tokenId, lost.owner);
    this.emit({ tick, kind: 'aircraft-lost', point: lost.position, owner: lost.owner, tokenId: lost.tokenId, generation: lost.generation, message: reason });
    if (lost.owner === 'player') this.cameraAircraft = lost;
  }

  private separateAircraft(aircraft: readonly AircraftToken[]): void {
    for (let a = 0; a < aircraft.length; a += 1) for (let b = a + 1; b < aircraft.length; b += 1) {
      const first = aircraft[a], second = aircraft[b];
      const away = first.position.clone().sub(second.position), distance = away.length();
      if (distance >= AIRCRAFT_RADIUS * 2) continue;
      if (distance < EPSILON) away.set(first.tokenId < second.tokenId ? -1 : 1, 0, 0); else away.divideScalar(distance);
      const displacement = (AIRCRAFT_RADIUS * 2 - distance) / 2 + 0.001;
      for (const [plane, sign] of [[first, 1], [second, -1]] as const) {
        const end = plane.position.clone().addScaledVector(away, displacement * sign);
        if (!this.world.sweep(plane.position, end, { radius: AIRCRAFT_RADIUS, aircraft: false, sea: true })) plane.position.copy(end);
      }
    }
  }

  private spawnClear(position: Vector3, active: readonly AircraftToken[]): boolean {
    if (this.world.sweep(position, position, { radius: AIRCRAFT_RADIUS, aircraft: false, sea: true })
      || active.some(plane => plane.position.distanceTo(position) < 30)
      || [...this.weapons.bullets, ...this.enemyCombat.bullets].some(bullet => bullet.position.distanceTo(position) <= AIRCRAFT_RADIUS + 1)) return false;
    return !this.mothership.turrets.some(turret => position.distanceTo(turret.muzzle) < (turret.layout.kind === 'main' ? 1300 : 800));
  }
  private selectSpawn(slotId: number, active: readonly AircraftToken[]): Vector3 | null {
    const candidates = this.mothership.layout.spawnCandidates;
    for (let index = 0; index < candidates.length; index += 1) {
      const position = candidates[(slotId + index) % candidates.length];
      if (this.spawnClear(position, active)) return position.clone();
    }
    return null;
  }

  private terminate(outcome: MissionOutcome): void {
    if (this.report) return;
    this.mothership.freeze();
    this.report = this.score.report(this.operationId, this.mode, this.seed, this.tick, outcome);
    this.phase = 'result';
    this.pauseReason = null;
    this.target = null;
    this.emit({ tick: this.tick, kind: outcome === 'victory' ? 'victory' : 'defeat', message: outcome });
  }
  private emit(event: Omit<CombatEvent, 'sequence' | 'operationId'>): void {
    this.presentationEvents.push(Object.freeze({ ...event, point: event.point?.clone(), sequence: ++this.eventSequence, operationId: this.operationId }));
    if (this.presentationEvents.length > MAX_PRESENTATION_EVENTS) this.presentationEvents.splice(0, this.presentationEvents.length - MAX_PRESENTATION_EVENTS);
  }
}

/** Draw cadence schedules ordinary fixed ticks and never alters combat dt. */
export class FixedStepper {
  private previous: number | null = null;
  private accumulated = 0;

  reset(now?: number): void { this.previous = now ?? null; this.accumulated = 0; }
  frame(now: number, active: boolean, step: () => void, gap: () => void): number {
    if (this.previous === null) { this.previous = now; return 0; }
    const elapsed = Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    if (!active) { this.accumulated = 0; return 0; }
    if (elapsed >= 2) { this.accumulated = 0; gap(); return 0; }
    this.accumulated += elapsed;
    const ticks = Math.floor((this.accumulated + 1e-10) / FIXED_DT);
    for (let index = 0; index < ticks; index += 1) step();
    this.accumulated = Math.max(0, this.accumulated - ticks * FIXED_DT);
    return ticks;
  }
}
