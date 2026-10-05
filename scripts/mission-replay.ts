import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { FixedStepper, FlightSession } from '../src/game-state';
import { RULES_VERSION } from '../src/rules';
import type { CombatReport, FleetCounts, Projectile } from '../src/combat-types';
import type { FlightInput, GameMode } from '../src/types';

// Replay uses accepted controls only. It never writes a combat state, substitutes
// an AI, changes dt, or generates a fresh input from the replayed plane's pose.
interface Destruction { id: number; tick: number; face: string; owner: string | null }
interface InputRecord {
  mode: GameMode;
  seed: number;
  inputRows: FlightInput[];
  destroyedTurrets: Destruction[];
  report: CombatReport;
}
interface AcceptedMission {
  type: 'mission-result';
  mode: GameMode;
  seed: number;
  finalTick: number;
  status: string;
  report: CombatReport;
  fleet: FleetCounts;
  turretRemaining: number;
  finalTurretHpMilli: number;
  destroyedTurrets: Destruction[];
  finalMainBulletPool: number;
  finalMgBulletPool: number;
  enemyPoolFailures: number;
  friendlyPoolFailures: number;
  enemyShotCount: number;
  friendlyShotEventCount: number;
  abnormalReason: string | null;
}
interface Config { record: string; resultLog: string; output: string; rates: number[] }

function argumentsFor(argv: string[]): Config {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    assert.ok(['--record', '--result-log', '--output', '--hz'].includes(key), `Unexpected argument ${key}`);
    assert.ok(value && !value.startsWith('--'), `Missing value for ${key}`);
    assert.ok(!values.has(key), `Duplicate argument ${key}`);
    values.set(key, value);
  }
  for (const key of ['--record', '--result-log', '--output']) assert.ok(values.has(key), `${key} is required`);
  const rates = (values.get('--hz') ?? '30,60,120').split(',').map(Number);
  assert.ok(rates.length > 0 && new Set(rates).size === rates.length
    && rates.every(rate => [30, 60, 120].includes(rate)), '--hz must list distinct rates from 30,60,120');
  return { record: resolve(values.get('--record')!), resultLog: resolve(values.get('--result-log')!),
    output: resolve(values.get('--output')!), rates };
}

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['src/aircraft-weapons.ts', 'src/combat-types.ts', 'src/collision-world.ts', 'src/fleet.ts',
  'src/flight.ts', 'src/flight-assist.ts', 'src/flight-view.ts', 'src/game-state.ts', 'src/mothership-layout.ts',
  'src/mothership.ts', 'src/rules.ts', 'src/scoring.ts', 'src/turret-combat.ts', 'src/types.ts', 'src/wingman-ai.ts',
  'scripts/mission-runner.ts', 'scripts/mission-replay.ts', 'package.json', 'package-lock.json'];
function sourceHashes(): Record<string, string> {
  return Object.fromEntries(sourceFiles.map(path => [path, sha256(readFileSync(new URL(`../${path}`, import.meta.url)))]));
}

/** Canonical keys and exact IEEE-754 values; no positional rounding. */
function canonical(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) return { numeric: String(value) };
  if (Object.is(value, -0)) return { numeric: '-0' };
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
const exactJson = (value: unknown): string => JSON.stringify(canonical(value));

function loadAccepted(config: Config): { record: InputRecord; accepted: AcceptedMission; artifactHashes: Record<string, string> } {
  const compressed = readFileSync(config.record), log = readFileSync(config.resultLog);
  const record = JSON.parse(gunzipSync(compressed).toString('utf8')) as InputRecord;
  const resultLines = log.toString('utf8').trim().split('\n').filter(line => line.startsWith('{"type":"mission-result",'));
  assert.equal(resultLines.length, 1, 'The accepted log must contain one complete mission-result');
  const accepted = JSON.parse(resultLines[0]) as AcceptedMission;
  assert.ok(record.mode === 'easy' || record.mode === 'normal');
  assert.ok(Number.isSafeInteger(record.seed) && record.seed >= 0 && record.seed <= 0xffff_ffff);
  assert.equal(record.mode, accepted.mode);
  assert.equal(record.seed, accepted.seed);
  assert.equal(accepted.status, 'victory');
  assert.equal(record.report.outcome, 'victory');
  assert.equal(record.report.rulesVersion, RULES_VERSION);
  assert.equal(record.report.mode, record.mode);
  assert.equal(record.report.seed, record.seed);
  assert.deepEqual(record.report, accepted.report, 'gzip and log reports differ');
  assert.ok(Array.isArray(record.inputRows) && record.inputRows.length > 0 && record.inputRows.length <= 108000);
  assert.equal(record.inputRows.length, record.report.endTick);
  assert.equal(record.report.endTick, accepted.finalTick);
  assert.equal(accepted.turretRemaining, 0);
  assert.equal(accepted.finalTurretHpMilli, 0);
  assert.deepEqual(record.destroyedTurrets, accepted.destroyedTurrets);
  assert.equal(record.destroyedTurrets.length, 100);
  assert.deepEqual(record.destroyedTurrets.map(kill => kill.id).sort((a, b) => a - b), Array.from({ length: 100 }, (_, id) => id));
  assert.equal(accepted.abnormalReason, null);
  assert.equal(accepted.enemyPoolFailures, 0);
  assert.equal(accepted.friendlyPoolFailures, 0);
  for (const [index, input] of record.inputRows.entries()) {
    assert.ok(input !== null && typeof input === 'object', `Missing input at tick ${index + 1}`);
    assert.ok(Number.isFinite(input.turn) && Math.abs(input.turn) <= 1, `Invalid turn at tick ${index + 1}`);
    assert.ok(Number.isFinite(input.climb) && Math.abs(input.climb) <= 1, `Invalid climb at tick ${index + 1}`);
    assert.equal(typeof input.fire, 'boolean');
    assert.equal(typeof input.loop, 'boolean');
    for (const key of ['accelerate', 'brake'] as const) if (input[key] !== undefined) assert.equal(typeof input[key], 'boolean');
    if (input.viewAspect !== undefined) assert.ok(Number.isFinite(input.viewAspect) && input.viewAspect > 0);
    if (input.steeringRevision !== undefined) assert.ok(Number.isSafeInteger(input.steeringRevision) && input.steeringRevision >= 0);
    Object.freeze(input);
  }
  return { record, accepted, artifactHashes: { [config.record]: sha256(compressed), [config.resultLog]: sha256(log) } };
}

function bulletSnapshot(bullet: Projectile) {
  return { ...bullet, position: bullet.position.toArray(), previous: bullet.previous.toArray(), velocity: bullet.velocity.toArray() };
}

/** Public authoritative observations only; render frame/clock metadata is excluded. */
function snapshot(session: FlightSession, destroyedTurrets: readonly Destruction[]) {
  return {
    phase: session.phase, operationId: session.operationId, mode: session.mode, seed: session.seed, tick: session.tick,
    report: session.report, score: session.score.totals, controller: { ...session.controller },
    pauseReason: session.pauseReason, abnormalReason: session.abnormalReason,
    fleet: { counts: session.fleet.counts, ownershipRevision: session.fleet.ownershipRevision, wait: session.fleet.wait,
      reservations: session.fleet.reservations.map(reservation => ({ ...reservation })),
      active: session.fleet.active.map(plane => ({ ...plane, position: plane.position.toArray(), previous: plane.previous.toArray(),
        quaternion: plane.quaternion.toArray(), ammunition: { ...plane.ammunition } })) },
    mothership: { remaining: session.mothership.remaining, totalHpMilli: session.mothership.totalHpMilli,
      lastDestroyedTick: session.mothership.lastDestroyedTick,
      destroyedIds: [...session.mothership.destroyedIds].sort((a, b) => a - b), destroyedTurrets,
      turrets: session.mothership.turrets.map(turret => ({ id: turret.id, kind: turret.layout.kind, face: turret.layout.face,
        hpMilli: turret.hpMilli, maxHpMilli: turret.maxHpMilli, yaw: turret.yaw, pitch: turret.pitch, stage: turret.stage })) },
    friendlyBullets: session.weapons.bullets.map(bulletSnapshot).sort((a, b) => a.id - b.id),
    enemyBullets: session.enemyCombat.bullets.map(bulletSnapshot).sort((a, b) => a.id - b.id),
    allocationFailures: { friendly: session.weapons.allocationFailures, enemy: session.enemyCombat.poolFailures },
    enemyStates: [...session.enemyCombat.states.values()].sort((a, b) => a.turretId - b.turretId)
      .map(state => ({ ...state, fixedPoint: state.fixedPoint?.toArray() ?? null, fixedDirection: state.fixedDirection?.toArray() ?? null })),
    wingmanStates: [...session.wingmen.states.values()].sort((a, b) => a.tokenId - b.tokenId)
      .map(state => ({ ...state, route: state.route.map(point => point.toArray()) })),
    events: session.events.map(event => ({ ...event, point: event.point?.toArray() })),
  };
}

function replay(record: InputRecord, accepted: AcceptedMission, hz: number, output: string) {
  const started = performance.now(), session = new FlightSession(), stepper = new FixedStepper();
  const operationId = session.prepare(record.mode, record.seed);
  assert.notEqual(operationId, null);
  assert.equal(session.begin(operationId!), true);
  stepper.reset(0);
  const destruction: Destruction[] = [], eventHash = createHash('sha256');
  let eventSequence = 0, inputCount = 0, callbackCount = 0, frameCount = 0, gapCount = 0;
  let enemyShotCount = 0, playerShotCount = 0;
  const maxFrames = Math.ceil(record.inputRows.length * hz / 60) + 2;
  console.log(JSON.stringify({ type: 'replay-rate-start', timestamp: new Date().toISOString(), mode: record.mode, hz,
    ticks: record.inputRows.length, simulatedSeconds: record.inputRows.length / 60 }));
  for (let frame = 1; frame <= maxFrames && session.phase === 'playing'; frame += 1) {
    frameCount = frame;
    stepper.frame(frame * 1000 / hz, true, () => {
      callbackCount += 1;
      // A 30Hz frame can schedule a second callback after the first wins. That
      // callback receives no input, just as the product ignores result ticks.
      if (session.phase !== 'playing') return;
      const input = record.inputRows[session.tick];
      assert.ok(input, `Replay exhausted controls at tick ${session.tick + 1}`);
      const previousTick = session.tick;
      session.step(input);
      inputCount += 1;
      assert.equal(session.tick, previousTick + 1);
      for (const event of session.events) {
        if (event.sequence <= eventSequence) continue;
        assert.equal(event.sequence, eventSequence + 1, 'Replay event capture overflowed its bounded presentation queue');
        eventSequence = event.sequence;
        eventHash.update(exactJson({ ...event, point: event.point?.toArray() }) + '\n');
        if (event.kind === 'turret-destroyed') {
          assert.notEqual(event.targetId, undefined);
          const turret = session.mothership.byId(event.targetId!);
          assert.ok(turret);
          destruction.push({ id: event.targetId!, tick: event.tick, face: turret.layout.face, owner: event.owner ?? null });
        }
        if (event.kind === 'shot' && event.owner === 'enemy') enemyShotCount += 1;
        if (event.kind === 'shot' && event.owner === 'player') playerShotCount += 1;
      }
      if (session.tick % 3600 === 0) console.log(JSON.stringify({ type: 'replay-progress', mode: record.mode, hz,
        tick: session.tick, remaining: session.mothership.remaining, wallSeconds: (performance.now() - started) / 1000 }));
    }, () => { gapCount += 1; });
    assert.equal(gapCount, 0, 'The replay unexpectedly crossed the product clock-gap pause');
  }
  assert.equal(session.phase, 'result');
  assert.equal(inputCount, record.inputRows.length, 'Victory changed the accepted input count');
  assert.equal(session.tick, accepted.finalTick, 'Victory tick differs from the ordinary single-step record');
  assert.equal(session.mode, accepted.mode);
  assert.equal(session.seed, accepted.seed);
  assert.deepEqual(session.report, record.report, 'Frozen result differs from accepted mission');
  assert.ok(Object.isFrozen(session.report) && Object.isFrozen(session.report?.components));
  assert.deepEqual(destruction, record.destroyedTurrets, 'Turret destruction order/tick/face/owner differs');
  assert.deepEqual([...session.mothership.destroyedIds].sort((a, b) => a - b), Array.from({ length: 100 }, (_, id) => id));
  assert.equal(session.mothership.totalHpMilli, accepted.finalTurretHpMilli);
  assert.equal(session.mothership.remaining, accepted.turretRemaining);
  assert.ok(session.mothership.turrets.every(turret => turret.hpMilli === 0));
  assert.deepEqual(session.fleet.counts, accepted.fleet, 'Finite fleet differs from accepted mission');
  assert.equal(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length, accepted.finalMainBulletPool);
  assert.equal(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length, accepted.finalMgBulletPool);
  assert.equal(session.enemyCombat.poolFailures, accepted.enemyPoolFailures);
  assert.equal(session.weapons.allocationFailures, accepted.friendlyPoolFailures);
  assert.equal(session.abnormalReason, accepted.abnormalReason);
  assert.equal(enemyShotCount, accepted.enemyShotCount);
  assert.equal(playerShotCount, accepted.friendlyShotEventCount);
  const finalSnapshot = snapshot(session, destruction), snapshotJson = exactJson(finalSnapshot);
  // Ordinary legal calls after result must leave all observed state frozen.
  session.step(record.inputRows.at(-1)!);
  stepper.frame((frameCount + 1) * 1000 / hz, false, () => assert.fail('Result scheduled an active tick'), () => assert.fail('Result gap'));
  assert.equal(exactJson(snapshot(session, destruction)), snapshotJson, 'Post-result state changed');
  const result = { type: 'mission-replay-result', timestamp: new Date().toISOString(), mode: record.mode, seed: record.seed, hz,
    finalTick: session.tick, activeSeconds: session.tick / 60, frameCount, schedulerCallbackCount: callbackCount,
    acceptedInputCount: inputCount, ignoredTerminalCallbacks: callbackCount - inputCount, gapCount,
    status: 'victory', report: session.report, fleet: session.fleet.counts, destroyedTurretCount: destruction.length,
    snapshotSha256: sha256(snapshotJson), eventStreamSha256: eventHash.digest('hex'), eventCount: eventSequence,
    enemyShotCount, playerShotCount, wallSeconds: (performance.now() - started) / 1000,
    checks: { originalReport: true, endTick: true, seed: true, turretIdsHpAndDestructionHistory: true, fleet: true,
      finalEnemyPools: true, shotCounts: true, allocationFailures: true, reportFrozen: true, postResultFrozen: true },
    snapshot: canonical(finalSnapshot) };
  writeFileSync(resolve(output, `${record.mode}-${hz}hz.json`), JSON.stringify(result, null, 2) + '\n');
  const { snapshot: _snapshot, ...summary } = result;
  console.log(JSON.stringify(summary));
  return summary;
}

function main(config: Config): void {
  const { record, accepted, artifactHashes } = loadAccepted(config), hashes = sourceHashes();
  mkdirSync(config.output, { recursive: true });
  console.log(JSON.stringify({ type: 'mission-replay-start', timestamp: new Date().toISOString(),
    classification: 'ordinary-recorded-flight-input-through-unmodified-fixed-stepper', mode: record.mode, seed: record.seed,
    requirementsCommit: 'e9212a73a7b36c33dff7e88d3a7308be6cdcea35', rulesVersion: RULES_VERSION,
    environment: { node: process.version, platform: process.platform, architecture: process.arch }, rates: config.rates,
    command: process.argv, artifactHashes, sourceHashes: hashes,
    interventions: ['Only prepare(), begin() and ordinary step(input) initialize/advance the combat session.',
      'Synthetic render timestamps schedule FixedStepper; these runs do not measure browser/device FPS.',
      'Every control object is read from the accepted gzip by logical tick without regeneration or modification.'] }));
  const runs = config.rates.map(hz => replay(record, accepted, hz, config.output));
  for (const run of runs) {
    assert.equal(run.snapshotSha256, runs[0].snapshotSha256, 'Final authoritative snapshots differ between render rates');
    assert.equal(run.eventStreamSha256, runs[0].eventStreamSha256, 'Entire emitted event streams differ between render rates');
  }
  assert.deepEqual(sourceHashes(), hashes, 'Simulation or replay source changed during verification');
  for (const [path, hash] of Object.entries(artifactHashes)) assert.equal(sha256(readFileSync(path)), hash, 'Accepted evidence changed during verification');
  const manifest = { type: 'mission-replay-verification', timestamp: new Date().toISOString(), mode: record.mode, seed: record.seed,
    requirementsCommit: 'e9212a73a7b36c33dff7e88d3a7308be6cdcea35', rulesVersion: RULES_VERSION,
    command: process.argv, environment: { node: process.version, platform: process.platform, architecture: process.arch },
    rates: config.rates, ticksPerRun: record.inputRows.length, artifactHashes, sourceHashes: hashes, runs,
    equalFinalSnapshots: true, equalFullEventStreams: true, allOriginalMissionChecksPassed: true,
    sourceAndAcceptedArtifactsStable: true,
    limitation: 'Synthetic render cadence checks deterministic simulation, not actual browser or device frame performance.' };
  writeFileSync(resolve(config.output, `${record.mode}-manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ type: 'replay-rates-equal', mode: record.mode, rates: config.rates,
    snapshotSha256: runs[0].snapshotSha256, eventStreamSha256: runs[0].eventStreamSha256,
    finalTick: accepted.finalTick, allChecksPassed: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(argumentsFor(process.argv.slice(2)));
