import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { Vector3 } from 'three';
import type { CombatEvent, EnemyWeaponKind } from '../src/combat-types';
import { INITIAL_SEED } from '../src/rules';
import { ENEMY_PERFORMANCE } from '../src/turret-combat';
import type { FlightInput } from '../src/types';
import { createEvasionInitialFixture, EVASION_SCENARIOS, type EvasionScenario, type EvasionFixture } from './evasion-fixture';

const NEUTRAL: FlightInput = { turn: 0, climb: 0, fire: false, loop: false };
const MAX_TRIAL_TICKS = 720;

interface TraceTick {
  tick: number;
  input: Pick<FlightInput, 'turn' | 'climb' | 'loop'>;
  player: { position: number[]; yaw: number; pitch: number; speed: number; hpMilli: number | null };
  turret: { phase: string; yaw: number; pitch: number; warningStartedTick: number; fixedDirection: number[] | null };
  bullets: Array<{ id: number; bornTick: number; expiresTick: number; position: number[]; velocity: number[] }>;
  events: Array<Pick<CombatEvent, 'sequence' | 'tick' | 'kind' | 'weapon' | 'owner' | 'shooterId' | 'tokenId' | 'attackId' | 'damageMilli'>>;
}

interface TrialEvidence {
  scenario: { face: string; kind: EnemyWeaponKind; action: string; input: Pick<FlightInput, 'turn' | 'climb' | 'loop'>; yawOffsetDegrees: number };
  fixture: EvasionFixture['start'];
  outcome: {
    trackingStartedTick: number | null;
    warningStartedTick: number | null;
    warningToFireTicks: number | null;
    firstEvasiveInputTick: number | null;
    firstShotTick: number | null;
    shotTicks: number[];
    distinctHitAttackIds: number[];
    playerDamageMilli: number;
    playerHpMilli: number;
    endTick: number;
    maxAircraftStepMeters: number;
    activeIncomingBulletsAtEnd: number;
    turretHpMilliAtEnd: number;
  };
  trace: TraceTick[];
}

function runTrial(scenario: EvasionScenario, evasive: boolean): TrialEvidence {
  const fixture = createEvasionInitialFixture(scenario);
  const { session, turretId, tokenId } = fixture;
  const performance = ENEMY_PERFORMANCE[scenario.kind];
  const trace: TraceTick[] = [];
  const newEvents: CombatEvent[] = [];
  let lastSequence = 0;
  let trackingStartedTick: number | null = null;
  let warningStartedTick: number | null = null;
  let fixedDirection: Vector3 | null = null;
  let firstShotTick: number | null = null;
  let firstEvasiveInputTick: number | null = null;
  let maxAircraftStepMeters = 0;
  let previousPlayerPosition = session.player.position.clone();
  let endTick = MAX_TRIAL_TICKS;

  for (let step = 0; step < MAX_TRIAL_TICKS; step += 1) {
    assert.equal(session.phase, 'playing');
    assert.equal(session.tick, step, 'the fixture is never rewritten after tick 0');
    const state = session.enemyCombat.states.get(turretId);
    if (state && trackingStartedTick === null) trackingStartedTick = state.trackingStartedTick;
    if (state && warningStartedTick === null && (state.phase === 'warning' || state.phase === 'burst')) {
      warningStartedTick = state.warningStartedTick;
      fixedDirection = state.fixedDirection?.clone() ?? null;
    }
    if (fixedDirection && state && (state.phase === 'warning' || state.phase === 'burst')) {
      assert.ok(state.fixedDirection?.distanceTo(fixedDirection) < 1e-12, 'the enemy aim stays fixed after the warning');
    }

    const input = evasive && warningStartedTick !== null ? scenario.input : NEUTRAL;
    if (evasive && warningStartedTick !== null && firstEvasiveInputTick === null) firstEvasiveInputTick = session.tick + 1;
    session.step(input);

    const player = session.player;
    const aircraftStep = player.position.distanceTo(previousPlayerPosition);
    maxAircraftStepMeters = Math.max(maxAircraftStepMeters, aircraftStep);
    assert.ok(aircraftStep <= 141 / 60 + 1e-7, 'every post-fixture aircraft movement uses finite production flight');
    previousPlayerPosition.copy(player.position);

    const additions = session.events.filter(event => event.sequence > lastSequence);
    for (const event of additions) {
      newEvents.push(event);
      lastSequence = Math.max(lastSequence, event.sequence);
    }
    const currentState = session.enemyCombat.states.get(turretId);
    if (currentState && trackingStartedTick === null) trackingStartedTick = currentState.trackingStartedTick;
    if (currentState && warningStartedTick === null && (currentState.phase === 'warning' || currentState.phase === 'burst')) {
      warningStartedTick = currentState.warningStartedTick;
      fixedDirection = currentState.fixedDirection?.clone() ?? null;
    }

    const shotEvents = newEvents.filter(event => event.kind === 'shot' && event.owner === 'enemy'
      && event.shooterId === turretId && event.weapon === scenario.kind);
    if (shotEvents.length && firstShotTick === null) firstShotTick = shotEvents[0].tick;

    const targetTurret = session.mothership.byId(turretId)!;
    const hpMilli = session.fleet.byId(tokenId)?.hpMilli ?? 0;
    trace.push({
      tick: session.tick,
      input: { turn: input.turn, climb: input.climb, loop: input.loop },
      player: { position: player.position.toArray(), yaw: player.yaw, pitch: player.pitch, speed: player.speed, hpMilli: hpMilli || null },
      turret: { phase: currentState?.phase ?? 'idle', yaw: targetTurret.yaw, pitch: targetTurret.pitch,
        warningStartedTick: currentState?.warningStartedTick ?? 0, fixedDirection: currentState?.fixedDirection?.toArray() ?? null },
      bullets: session.enemyCombat.bullets.filter(bullet => bullet.shooterId === turretId).map(bullet => ({
        id: bullet.id, bornTick: bullet.bornTick, expiresTick: bullet.expiresTick,
        position: bullet.position.toArray(), velocity: bullet.velocity.toArray(),
      })),
      events: additions.filter(event => event.owner === 'enemy' && event.shooterId === turretId).map(event => ({
        sequence: event.sequence, tick: event.tick, kind: event.kind, weapon: event.weapon, owner: event.owner,
        shooterId: event.shooterId, tokenId: event.tokenId, attackId: event.attackId, damageMilli: event.damageMilli,
      })),
    });

    if (firstShotTick !== null) {
      const lastShotTick = firstShotTick + (performance.shots - 1) * performance.intervalTicks;
      endTick = lastShotTick + performance.lifeTicks;
      if (session.tick >= endTick) break;
    }
  }

  assert.notEqual(trackingStartedTick, null, `${scenario.face}/${scenario.kind} entered actual enemy tracking`);
  assert.notEqual(warningStartedTick, null, `${scenario.face}/${scenario.kind} showed a real combat warning`);
  assert.notEqual(firstShotTick, null, `${scenario.face}/${scenario.kind} fired a real projectile`);
  assert.ok(fixedDirection, 'the warning stores one fixed direction');
  assert.equal(session.tick, endTick, 'the observation includes the last projectile expiration boundary');
  assert.equal(session.phase, 'playing', 'this is a combat fixture, not a forged mission outcome');

  const warnings = newEvents.filter(event => event.kind === 'warning' && event.weapon === scenario.kind && event.targetId === turretId);
  const shots = newEvents.filter(event => event.kind === 'shot' && event.owner === 'enemy'
    && event.shooterId === turretId && event.weapon === scenario.kind);
  const hits = newEvents.filter(event => event.kind === 'hit' && event.owner === 'enemy'
    && event.shooterId === turretId && event.weapon === scenario.kind && event.tokenId === tokenId && (event.damageMilli ?? 0) > 0);
  const distinctHitAttackIds = [...new Set(hits.flatMap(event => typeof event.attackId === 'number' ? [event.attackId] : []))].sort((a, b) => a - b);
  const playerDamageMilli = hits.reduce((sum, event) => sum + (event.damageMilli ?? 0), 0);
  const observedBullets = trace.flatMap(row => row.bullets);
  const expectedShotTicks = Array.from({ length: performance.shots }, (_, index) => firstShotTick! + index * performance.intervalTicks);
  const player = session.fleet.byId(tokenId);
  assert.ok(player, 'the player survives this controlled first projectile group');
  assert.equal(session.enemyCombat.bullets.filter(bullet => bullet.shooterId === turretId).length, 0,
    'all projectiles in the observed attack have been swept, hit or expired by the fixed lifetime');
  assert.equal(session.mothership.byId(turretId)!.hpMilli, session.mothership.byId(turretId)!.maxHpMilli,
    'the isolated target mount did not take fixture-external damage');
  assert.equal(shots.length, performance.shots, 'the fixture observes the fixed one-shot or ten-shot attack');
  assert.equal(warnings.length, 1);
  assert.equal(firstShotTick, warningStartedTick! + performance.warningTicks);
  assert.deepEqual(shots.map(event => event.tick), expectedShotTicks, 'the observed shot cadence matches the fixed rules');
  assert.ok(observedBullets.length > 0, 'the actual native bullet path was observed between fire and contact/expiry');
  assert.ok(observedBullets.every(bullet => Math.abs(Math.hypot(...bullet.velocity) - performance.speed) < 1e-8
    && bullet.expiresTick - bullet.bornTick === performance.lifeTicks), 'observed bullets keep fixed speed and lifetime');
  if (evasive) assert.equal(firstEvasiveInputTick, warningStartedTick! + 1, 'the evasion starts on the first input tick after warning entry');
  else assert.equal(firstEvasiveInputTick, null);
  assert.ok(maxAircraftStepMeters <= 141 / 60 + 1e-7);
  if (evasive) assert.deepEqual(distinctHitAttackIds, [], 'ordinary evasion input avoids every projectile from this warning');
  else assert.ok(distinctHitAttackIds.length > 0, 'the paired no-evasion path is physically hit by the same fixed attack');

  return {
    scenario: { face: scenario.face, kind: scenario.kind, action: scenario.action,
      input: { turn: scenario.input.turn, climb: scenario.input.climb, loop: scenario.input.loop }, yawOffsetDegrees: scenario.yawOffsetDegrees },
    fixture: fixture.start,
    outcome: {
      trackingStartedTick, warningStartedTick, warningToFireTicks: firstShotTick! - warningStartedTick!, firstShotTick,
      firstEvasiveInputTick,
      shotTicks: shots.map(event => event.tick), distinctHitAttackIds, playerDamageMilli,
      playerHpMilli: player.hpMilli, endTick: session.tick, maxAircraftStepMeters,
      activeIncomingBulletsAtEnd: session.enemyCombat.bullets.filter(bullet => bullet.shooterId === turretId).length,
      turretHpMilliAtEnd: session.mothership.byId(turretId)!.hpMilli,
    },
    trace,
  };
}

test('A12/R45 inspection fixture compares ordinary evasion with no evasion through the real projectile sweep', async () => {
  const captures: Array<{ baseline: TrialEvidence; evasion: TrialEvidence }> = [];
  const trackingByFace = new Map<EvasionScenario['face'], number>();

  for (const scenario of EVASION_SCENARIOS) {
    const baseline = runTrial(scenario, false);
    const evasion = runTrial(scenario, true);
    assert.deepEqual(evasion.fixture, baseline.fixture, 'paired runs share seed, pose, turret, HP and starting geometry');
    assert.equal(evasion.outcome.trackingStartedTick, baseline.outcome.trackingStartedTick);
    assert.equal(evasion.outcome.warningStartedTick, baseline.outcome.warningStartedTick);
    assert.equal(evasion.outcome.warningToFireTicks, baseline.outcome.warningToFireTicks);
    assert.deepEqual(evasion.outcome.shotTicks, baseline.outcome.shotTicks, 'paired runs receive the same warning and firing schedule');
    assert.equal(evasion.outcome.shotTicks.length, ENEMY_PERFORMANCE[scenario.kind].shots);
    assert.equal(baseline.outcome.distinctHitAttackIds.length > 0, true, `${scenario.face}/${scenario.kind} control path takes a hit`);
    assert.equal(evasion.outcome.distinctHitAttackIds.length, 0, `${scenario.face}/${scenario.kind} input path dodges the attack`);
    trackingByFace.set(scenario.face, Math.max(trackingByFace.get(scenario.face) ?? 0,
      (baseline.outcome.warningStartedTick ?? 0) - (baseline.outcome.trackingStartedTick ?? 0)));
    captures.push({ baseline, evasion });
  }

  for (const face of ['top', 'bottom', 'left'] as const) {
    assert.ok((trackingByFace.get(face) ?? 0) > 0, `${face} includes finite enemy barrel tracking before its warning`);
  }

  // Opt-in capture preserves the raw fixed-rule, per-tick fixture trace. It is
  // excluded from the regular product-clear gate and never alters the session.
  if (process.env.GEKICHIN_EVASION_CAPTURE === '1') {
    const outputPath = resolve('docs/evidence/acceptance/evasion/evasion-trials.json.gz');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, gzipSync(`${JSON.stringify({
      title: 'A12/R45 controlled evasion fixture; not a normal 100-turret clear',
      source: { requirements: 'R40–R45 / A10–A12', implementationPlan: 'P4 / P7',
        performanceConstants: ENEMY_PERFORMANCE },
      fixtureRules: {
        mode: 'normal', seed: INITIAL_SEED, startingTick: 0,
        initialStateSetup: 'Start and validate the standard 100-mount operation; before its first tick, use fixture damage IDs to leave only the named mount alive and place player at its default barrel ray +90m with 110m/s level attitude.',
        postTickZeroWrites: 'none by the test; all subsequent state changes come from ordinary FlightInput passed to FlightSession.step.',
        solver: 'FlightSession warning/tracking/fire/event queue + production CollisionWorld sweep + production damage resolution.',
        comparison: 'Each baseline/evasion pair uses identical seed and complete tick-zero fixture. Evasion input starts on the tick after warning entry. Fixed enemy speed, warning duration, burst cadence and projectile life are read from ENEMY_PERFORMANCE.',
        exclusions: ['not an ordinary 100-turret clear', 'not a product victory path', 'not evidence of full-mission operation', 'no invulnerability, bullet deletion or physics warp'],
      },
      trials: captures,
    }, null, 2)}\n`));
  }
});
