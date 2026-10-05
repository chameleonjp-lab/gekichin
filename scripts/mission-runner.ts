import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Vector3 } from 'three';
import { clamp, normalizeAngle } from '../src/flight';
import { FlightSession } from '../src/game-state';
import { INITIAL_SEED, PLAYER_MAX_PITCH } from '../src/rules';
import type { FlightInput, GameMode } from '../src/types';

const DEFAULT_TICK_CAP = 108_000;
const neutral = (): FlightInput => ({ turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false, steeringRevision: 0, viewAspect: 393 / 852 });

function args(argv: string[]): { mode: GameMode; seed: number; maxTicks: number; recordPath: string | null } {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) throw new Error(`Unexpected argument ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argv[index]}`);
    parsed.set(argv[index].slice(2), value); index += 1;
  }
  const mode = parsed.get('mode') ?? 'easy';
  if (mode !== 'easy' && mode !== 'normal') throw new Error('--mode must be easy or normal');
  const seed = Number(parsed.get('seed') ?? String(INITIAL_SEED));
  const maxTicks = Number(parsed.get('ticks') ?? String(DEFAULT_TICK_CAP));
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('--seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(maxTicks) || maxTicks < 1 || maxTicks > DEFAULT_TICK_CAP) throw new Error('--ticks must be in 1..108000');
  return { mode, seed, maxTicks, recordPath: parsed.has('record') ? resolve(parsed.get('record')!) : null };
}

/** A narrow, normal-input-only orbit. It observes the current player position and emits accepted flight controls. */
export function orbitalInput(session: FlightSession): FlightInput {
  const player = session.fleet.player;
  if (!player) return neutral();
  const angle = Math.atan2(player.position.x, player.position.z);
  const nextAngle = angle + 0.24;
  const target = new Vector3(Math.sin(nextAngle) * 1950,
    1000 + Math.sin(session.tick / 60 / 90) * 520,
    Math.cos(nextAngle) * 1950);
  const direction = target.sub(player.position);
  const yaw = Math.atan2(-direction.x, -direction.z);
  const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
  const steering = { turn: clamp(-normalizeAngle(yaw - player.yaw) / 0.16, -1, 1),
    climb: clamp(pitch / PLAYER_MAX_PITCH, -1, 1) };
  // Manual Normal fire stays held. Easy's product assist chooses whether a shot
  // is eligible, exactly as it does for a person holding the fire control.
  return { ...neutral(), ...steering, fire: true };
}

function assertTickInvariants(session: FlightSession): void {
  const counts = session.fleet.counts;
  if (counts.active + counts.reserved + counts.reserve + counts.lost !== 50 || counts.active + counts.reserved > 8
    || counts.remaining !== counts.active + counts.reserved + counts.reserve
    || counts.playerLosses + counts.wingmanLosses !== counts.lost) throw new Error(`Fleet invariant failed at tick ${session.tick}`);
  const totals = session.score.totals;
  if (totals.Hmain + totals.Hmg > totals.N || totals.P + totals.W > 50
    || totals.damageMilli + session.mothership.totalHpMilli !== 24_000_000
    || totals.K !== session.mothership.destroyedIds.size) throw new Error(`Combat invariant failed at tick ${session.tick}`);
  if (session.weapons.bullets.length > 256 || session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length > 256
    || session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length > 16) throw new Error(`Projectile pool exceeded at tick ${session.tick}`);
}

interface Evidence { enemyShotCount: number; friendlyShotCount: number; destroyed: Map<number, { tick: number; face: string; owner: string | null }> }
function takeEvents(session: FlightSession, after: number, evidence: Evidence): number {
  for (const event of session.events) {
    if (event.sequence <= after) continue;
    if (event.kind === 'turret-destroyed' && event.targetId !== undefined) {
      const turret = session.mothership.byId(event.targetId);
      if (turret) evidence.destroyed.set(event.targetId, { tick: event.tick, face: turret.layout.face, owner: event.owner ?? null });
    }
    if (event.kind === 'shot' && event.owner === 'enemy') evidence.enemyShotCount += 1;
    if (event.kind === 'shot' && event.owner === 'player') evidence.friendlyShotCount += 1;
    after = Math.max(after, event.sequence);
  }
  return after;
}

export function runMission(mode: GameMode, seed: number, maxTicks: number, onInput?: (tick: number, input: FlightInput) => void, recordInputs = false) {
  const session = new FlightSession();
  const operation = session.prepare(mode, seed);
  if (operation === null || !session.begin(operation)) throw new Error('Could not begin the test operation');
  const evidence: Evidence = { enemyShotCount: 0, friendlyShotCount: 0, destroyed: new Map() };
  let eventSequence = 0;
  let maxEnemyBulletsObserved = 0;
  let maxEnemyMainBulletsObserved = 0;
  let maxEnemyMgBulletsObserved = 0;
  let maxFriendlyBulletsObserved = 0;
  let maxWingmanFriendlyBulletsObserved = 0;
  let maxActiveMainTurrets = 0;
  let maxActiveMgTurrets = 0;
  let maxMainTargetsPerAircraft = 0;
  let maxMgTargetsPerAircraft = 0;
  let maxActiveAircraft = 0;
  let enemyPoolFailuresAtEnd = 0;
  let friendlyPoolFailuresAtEnd = 0;
  const inputRows: FlightInput[] = [];
  for (let tick = 1; tick <= maxTicks && session.phase === 'playing'; tick += 1) {
    const input = orbitalInput(session);
    onInput?.(tick, input);
    if (recordInputs) inputRows.push(input);
    session.step(input);
    assertTickInvariants(session);
    eventSequence = takeEvents(session, eventSequence, evidence);
    maxEnemyBulletsObserved = Math.max(maxEnemyBulletsObserved, session.enemyCombat.bullets.length);
    maxEnemyMainBulletsObserved = Math.max(maxEnemyMainBulletsObserved, session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length);
    maxEnemyMgBulletsObserved = Math.max(maxEnemyMgBulletsObserved, session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length);
    maxFriendlyBulletsObserved = Math.max(maxFriendlyBulletsObserved, session.weapons.bullets.length);
    maxWingmanFriendlyBulletsObserved = Math.max(maxWingmanFriendlyBulletsObserved,
      session.weapons.bullets.filter(bullet => bullet.owner === 'wingman').length);
    maxActiveAircraft = Math.max(maxActiveAircraft, session.fleet.counts.active);
    const activeTurrets = [...session.enemyCombat.states.values()].filter(state =>
      state.phase === 'tracking' || state.phase === 'warning' || state.phase === 'burst');
    const activeMain = activeTurrets.filter(state => state.kind === 'main');
    const activeMg = activeTurrets.filter(state => state.kind === 'mg');
    maxActiveMainTurrets = Math.max(maxActiveMainTurrets, activeMain.length);
    maxActiveMgTurrets = Math.max(maxActiveMgTurrets, activeMg.length);
    for (const plane of session.fleet.active) {
      maxMainTargetsPerAircraft = Math.max(maxMainTargetsPerAircraft,
        activeMain.filter(state => state.targetTokenId === plane.tokenId && state.targetGeneration === plane.generation).length);
      maxMgTargetsPerAircraft = Math.max(maxMgTargetsPerAircraft,
        activeMg.filter(state => state.targetTokenId === plane.tokenId && state.targetGeneration === plane.generation).length);
    }
    enemyPoolFailuresAtEnd = session.enemyCombat.poolFailures;
    friendlyPoolFailuresAtEnd = session.weapons.allocationFailures;
    if (session.tick > 0 && session.tick % 3600 === 0) {
      const faceKills = [...evidence.destroyed.values()].reduce<Record<string, number>>((all, kill) => { all[kill.face] = (all[kill.face] ?? 0) + 1; return all; }, {});
      console.log(JSON.stringify({ tick: session.tick, activeSeconds: session.tick / 60, remaining: session.mothership.remaining,
        hpMilli: session.mothership.totalHpMilli, fleet: session.fleet.counts, faceKills,
        enemyShotCount: evidence.enemyShotCount, friendlyShotCount: evidence.friendlyShotCount,
        activeProjectiles: { friendly: session.weapons.bullets.length,
          enemyMain: session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length,
          enemyMg: session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length }, eventsRetained: session.events.length }));
    }
  }
  eventSequence = takeEvents(session, eventSequence, evidence);
  const report = session.report;
  const result = {
    mode, seed, maxTicks, finalTick: session.tick, activeSeconds: session.tick / 60,
    status: report?.outcome === 'victory' ? 'victory' : report ? report.outcome : 'unreached',
    report, fleet: session.fleet.counts,
    turretRemaining: session.mothership.remaining,
    finalTurretHpMilli: session.mothership.totalHpMilli,
    destroyedTurrets: [...evidence.destroyed.entries()].map(([id, kill]) => ({ id, ...kill })),
    finalMainBulletPool: session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length,
    finalMgBulletPool: session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length,
    maxFriendlyBulletsObserved,
    maxEnemyBulletsObserved,
    maxEnemyMainBulletsObserved,
    maxEnemyMgBulletsObserved,
    maxWingmanFriendlyBulletsObserved,
    maxActiveMainTurrets,
    maxActiveMgTurrets,
    maxMainTargetsPerAircraft,
    maxMgTargetsPerAircraft,
    maxActiveAircraft,
    enemyPoolFailures: enemyPoolFailuresAtEnd,
    friendlyPoolFailures: friendlyPoolFailuresAtEnd,
    firedPlayerShots: session.score.totals.N,
    enemyShotCount: evidence.enemyShotCount,
    friendlyShotEventCount: evidence.friendlyShotCount,
    abnormalReason: session.abnormalReason,
  };
  if (result.status === 'victory' && (result.turretRemaining !== 0 || result.finalTurretHpMilli !== 0 || result.destroyedTurrets.length !== 100)) {
    throw new Error('Victory did not preserve the 100 unique turret destruction evidence');
  }
  return { result, inputRows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = args(process.argv.slice(2));
  console.log(JSON.stringify({ type: 'mission-start', mode: config.mode, seed: config.seed, tickCap: config.maxTicks, activeSecondsCap: config.maxTicks / 60 }));
  const { result, inputRows } = runMission(config.mode, config.seed, config.maxTicks, undefined, config.recordPath !== null);
  if (config.recordPath) {
    mkdirSync(dirname(config.recordPath), { recursive: true });
    writeFileSync(config.recordPath, gzipSync(Buffer.from(JSON.stringify({ mode: config.mode, seed: config.seed,
      inputRows, destroyedTurrets: result.destroyedTurrets, report: result.report }))));
    console.log(JSON.stringify({ type: 'input-record', path: config.recordPath, ticks: inputRows.length, encoding: 'gzip-json' }));
  }
  console.log(JSON.stringify({ type: 'mission-result', ...result }));
  if (result.status !== 'victory') process.exitCode = 2;
}
