import { FlightSession } from '../src/game-state';
import { FlightScene } from '../src/scene';
import { projectFlightTarget } from '../src/flight-view';
import { ENEMY_PERFORMANCE } from '../src/turret-combat';
import { Vector3 } from 'three';
import type { CombatEvent, EnemyWeaponKind } from '../src/combat-types';
import type { FlightInput } from '../src/types';
import { createEvasionInitialFixture, EVASION_SCENARIOS, type EvasionScenario } from '../tests/evasion-fixture';

type TrialRow = {
  tick: number;
  input: Pick<FlightInput, 'turn' | 'climb' | 'loop'>;
  player: { position: number[]; yaw: number; pitch: number; speed: number; hpMilli: number | null };
  turret: { phase: string; yaw: number; pitch: number; warningStartedTick: number; fixedDirection: number[] | null };
  bullets: Array<{ id: number; bornTick: number; expiresTick: number; position: number[]; velocity: number[] }>;
  events: Array<Pick<CombatEvent, 'sequence' | 'tick' | 'kind' | 'weapon' | 'owner' | 'shooterId' | 'tokenId' | 'attackId' | 'damageMilli'>>;
};

type BrowserTrial = {
  pairId: string;
  scenario: { face: string; kind: EnemyWeaponKind; action: string; input: Pick<FlightInput, 'turn' | 'climb' | 'loop'> };
  mode: 'baseline-no-evasion' | 'ordinary-evasion';
  fixture: ReturnType<typeof createEvasionInitialFixture>['start'];
  outcome: {
    trackingStartedTick: number | null;
    warningStartedTick: number | null;
    firstEvasiveInputTick: number | null;
    warningProjection: { emitterVisible: boolean; fixedAimVisible: boolean } | null;
    shotTicks: number[];
    distinctHitAttackIds: number[];
    playerDamageMilli: number;
    playerHpMilli: number;
    endTick: number;
    maxAircraftStepMeters: number;
    activeIncomingBulletsAtEnd: number;
  };
  frames: TrialRow[];
};

declare global {
  interface Window {
    __evasionBrowserDone?: boolean;
    __evasionBrowserError?: string;
    __evasionBrowserResult?: {
      title: string;
      capture: { renderPath: string; tickDriver: string; browser: string; excludedFromNormalClear: true };
      performanceConstants: typeof ENEMY_PERFORMANCE;
      pairs: Array<{ scenario: EvasionScenario; baseline: BrowserTrial; evasion: BrowserTrial }>;
    };
    __saveEvasionFrame?: (label: string) => Promise<void>;
  }
}

const NEUTRAL: FlightInput = { turn: 0, climb: 0, fire: false, loop: false };
const MAX_TICKS = 720;
const FACE_NAME: Record<EvasionScenario['face'], string> = { top: '上面', bottom: '下面', left: '左側面' };
const WEAPON_NAME: Record<EnemyWeaponKind, string> = { main: '主砲', mg: '大型機銃' };

const sceneContainer = document.querySelector<HTMLElement>('#scene')!;
const scenarioLabel = document.querySelector<HTMLElement>('#scenario')!;
const statusLabel = document.querySelector<HTMLElement>('#status')!;
const detailsLabel = document.querySelector<HTMLElement>('#details')!;
const progressBar = document.querySelector<HTMLElement>('#progress')!;

function nextAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function asPick(event: CombatEvent): TrialRow['events'][number] {
  return {
    sequence: event.sequence, tick: event.tick, kind: event.kind, weapon: event.weapon, owner: event.owner,
    shooterId: event.shooterId, tokenId: event.tokenId, attackId: event.attackId, damageMilli: event.damageMilli,
  };
}

function updatePanel(scenario: EvasionScenario, mode: BrowserTrial['mode'], session: FlightSession, tickIndex: number,
  warningTick: number | null, firstShotTick: number | null, damageMilli: number, totalTicks: number): void {
  const state = session.enemyCombat.states.get(session.mothership.turrets.find(t =>
    t.layout.face === scenario.face && t.layout.kind === scenario.kind)?.id ?? -1);
  const phase = state?.phase ?? 'idle';
  const label = mode === 'ordinary-evasion' ? '予告後の通常回避入力' : '無回避比較（中立入力）';
  const actualInput = mode === 'ordinary-evasion' && warningTick !== null && session.tick > warningTick ? scenario.input : NEUTRAL;
  scenarioLabel.textContent = `${FACE_NAME[scenario.face]} / ${WEAPON_NAME[scenario.kind]} · ${label}`;
  statusLabel.className = (phase === 'warning' || phase === 'burst') ? 'warning' : damageMilli > 0 ? 'hit' : '';
  statusLabel.textContent = phase === 'warning' ? '実照準完了 · 予告中'
    : phase === 'burst' ? '実弾発射 / 攻撃継続'
      : firstShotTick !== null && session.tick > firstShotTick ? (damageMilli > 0 ? '実弾接触 · 損傷あり' : '飛翔後 · 被弾なし')
        : phase === 'tracking' ? '敵砲塔が実追尾中' : `敵状態: ${phase}`;
  detailsLabel.textContent = [
    `実 tick ${session.tick} · 警告 ${warningTick ?? '—'} · 初弾 ${firstShotTick ?? '—'}`,
    `入力 ${actualInput.turn}/${actualInput.climb}/${actualInput.loop ? 'loop' : '—'} (turn/climb/loop)`,
    `被害 ${(damageMilli / 1000).toFixed(1)} HP · captured tick ${tickIndex}/${totalTicks}`,
    'test-only fixture · production FlightSession / FlightScene / sweep',
  ].join('\n');
  progressBar.style.width = `${Math.min(100, 100 * (tickIndex + 1) / totalTicks)}%`;
}

function makeTrial(scenario: EvasionScenario,
  mode: BrowserTrial['mode'], start: ReturnType<typeof createEvasionInitialFixture>['start']): BrowserTrial {
  return {
    pairId: `${scenario.face}-${scenario.kind}`,
    scenario: { face: scenario.face, kind: scenario.kind, action: scenario.action,
      input: { turn: scenario.input.turn, climb: scenario.input.climb, loop: scenario.input.loop } },
    mode, fixture: start,
    outcome: {
      trackingStartedTick: null, warningStartedTick: null, firstEvasiveInputTick: null, shotTicks: [],
      warningProjection: null,
      distinctHitAttackIds: [], playerDamageMilli: 0, playerHpMilli: 0, endTick: 0,
      maxAircraftStepMeters: 0, activeIncomingBulletsAtEnd: 0,
    },
    frames: [],
  };
}

let scene: FlightScene;

async function runTrial(scenario: EvasionScenario, evasive: boolean, trialIndex: number, session: FlightSession): Promise<BrowserTrial> {
  if (session.phase !== 'home' && session.phase !== 'result') session.home();
  const fixture = createEvasionInitialFixture(scenario, session);
  const { turretId, tokenId } = fixture;
  const mode: BrowserTrial['mode'] = evasive ? 'ordinary-evasion' : 'baseline-no-evasion';
  const trial = makeTrial(scenario, mode, fixture.start);
  const weaponPerformance = ENEMY_PERFORMANCE[scenario.kind];
  let lastSequence = 0;
  let firstShotTick: number | null = null;
  let endTick = MAX_TICKS;
  let warningStartedTick: number | null = null;
  let fixedDirection: number[] | null = null;
  let priorPosition = session.player.position.clone();
  let warningFrameSaved = false;
  let movementFrameSaved = false;
  let shotFrameSaved = false;

  scenarioLabel.textContent = FACE_NAME[scenario.face] + ' / ' + WEAPON_NAME[scenario.kind] + ' · ' + mode;
  statusLabel.className = '';
  statusLabel.textContent = 'tick 0 fixture initialized · identical pair pose';
  detailsLabel.textContent = 'The deterministic pre-tick fixture is isolated from normal clear evidence.';
  progressBar.style.width = (100 * trialIndex / (EVASION_SCENARIOS.length * 2)) + '%';
  scene.render(session.player, 'normal', session.tick, session);
  for (let intro = 0; intro < 3; intro += 1) await nextAnimationFrame();

  for (let step = 0; step < MAX_TICKS; step += 1) {
    if (session.phase !== 'playing') throw new Error('fixture ended before projectile observation: ' + scenario.face + '/' + scenario.kind + '/' + mode);
    if (session.tick !== step) throw new Error('unexpected fixture tick ' + session.tick + ', expected ' + step);
    const state = session.enemyCombat.states.get(turretId);
    if (state && trial.outcome.trackingStartedTick === null) trial.outcome.trackingStartedTick = state.trackingStartedTick;
    if (state && warningStartedTick === null && (state.phase === 'warning' || state.phase === 'burst')) {
      warningStartedTick = state.warningStartedTick;
      trial.outcome.warningStartedTick = warningStartedTick;
      fixedDirection = state.fixedDirection?.toArray() ?? null;
    }
    if (fixedDirection && state && (state.phase === 'warning' || state.phase === 'burst')) {
      const live = state.fixedDirection?.toArray();
      if (!live || Math.hypot(...live.map((value, index) => value - fixedDirection![index]!)) >= 1e-12) {
        throw new Error('enemy warning aim changed after being fixed');
      }
    }

    const input = evasive && warningStartedTick !== null ? scenario.input : NEUTRAL;
    if (evasive && warningStartedTick !== null && trial.outcome.firstEvasiveInputTick === null) {
      trial.outcome.firstEvasiveInputTick = session.tick + 1;
    }
    session.step(input);

    const player = session.player;
    const stepDistance = player.position.distanceTo(priorPosition);
    trial.outcome.maxAircraftStepMeters = Math.max(trial.outcome.maxAircraftStepMeters, stepDistance);
    if (stepDistance > 141 / 60 + 1e-7) throw new Error('aircraft movement exceeded the ordinary finite-flight step');
    priorPosition.copy(player.position);

    const additions = session.events.filter(event => event.sequence > lastSequence);
    for (const event of additions) lastSequence = Math.max(lastSequence, event.sequence);
    const currentState = session.enemyCombat.states.get(turretId);
    if (currentState && trial.outcome.trackingStartedTick === null) trial.outcome.trackingStartedTick = currentState.trackingStartedTick;
    if (currentState && warningStartedTick === null && (currentState.phase === 'warning' || currentState.phase === 'burst')) {
      warningStartedTick = currentState.warningStartedTick;
      trial.outcome.warningStartedTick = warningStartedTick;
      fixedDirection = currentState.fixedDirection?.toArray() ?? null;
      const turret = session.mothership.byId(turretId)!;
      const normalCameraProjection = (target: Vector3) => projectFlightTarget(player, target, 960 / 540, 'normal').visible;
      trial.outcome.warningProjection = {
        emitterVisible: normalCameraProjection(turret.muzzle),
        fixedAimVisible: normalCameraProjection(currentState.fixedPoint ?? turret.muzzle),
      };
      if (!trial.outcome.warningProjection.emitterVisible || !trial.outcome.warningProjection.fixedAimVisible) {
        throw new Error('actual emitter or fixed aim falls outside the normal flight camera in ' + scenario.face + '/' + scenario.kind);
      }
    }
    const enemyEvents = additions.filter(event => event.owner === 'enemy' && event.shooterId === turretId);
    const shots = enemyEvents.filter(event => event.kind === 'shot' && event.weapon === scenario.kind);
    for (const shot of shots) {
      trial.outcome.shotTicks.push(shot.tick);
      if (firstShotTick === null) firstShotTick = shot.tick;
    }
    const hits = enemyEvents.filter(event => event.kind === 'hit' && event.weapon === scenario.kind
      && event.tokenId === tokenId && (event.damageMilli ?? 0) > 0);
    trial.outcome.playerDamageMilli += hits.reduce((sum, event) => sum + (event.damageMilli ?? 0), 0);
    trial.outcome.distinctHitAttackIds = [...new Set([...trial.outcome.distinctHitAttackIds,
      ...hits.flatMap(event => typeof event.attackId === 'number' ? [event.attackId] : [])])].sort((a, b) => a - b);

    const turret = session.mothership.byId(turretId)!;
    const hpMilli = session.fleet.byId(tokenId)?.hpMilli ?? 0;
    trial.outcome.playerHpMilli = hpMilli;
    trial.frames.push({
      tick: session.tick,
      input: { turn: input.turn, climb: input.climb, loop: input.loop },
      player: { position: player.position.toArray(), yaw: player.yaw, pitch: player.pitch, speed: player.speed, hpMilli: hpMilli || null },
      turret: { phase: currentState?.phase ?? 'idle', yaw: turret.yaw, pitch: turret.pitch,
        warningStartedTick: currentState?.warningStartedTick ?? 0, fixedDirection: currentState?.fixedDirection?.toArray() ?? null },
      bullets: session.enemyCombat.bullets.filter(bullet => bullet.shooterId === turretId).map(bullet => ({
        id: bullet.id, bornTick: bullet.bornTick, expiresTick: bullet.expiresTick,
        position: bullet.position.toArray(), velocity: bullet.velocity.toArray(),
      })),
      events: enemyEvents.map(asPick),
    });

    let captureLabel: string | null = null;
    let renderFrame = false;
    if (warningStartedTick !== null && !warningFrameSaved) {
      warningFrameSaved = true;
      renderFrame = true;
      if (evasive) captureLabel = scenario.face + '-' + scenario.kind + '-warning';
    }
    if (evasive && warningStartedTick !== null && session.tick > warningStartedTick
      && (session.tick - warningStartedTick) % 10 === 0) {
      renderFrame = true;
      if (!movementFrameSaved && session.tick >= warningStartedTick + 30) {
        movementFrameSaved = true;
        captureLabel = scenario.face + '-' + scenario.kind + '-maneuver';
      }
    }
    if (!evasive && session.tick % 30 === 0 && firstShotTick === null) renderFrame = true;
    if (shots.length > 0) {
      renderFrame = true;
      if (evasive && !shotFrameSaved) {
        shotFrameSaved = true;
        captureLabel = scenario.face + '-' + scenario.kind + '-projectile';
      }
    }
    if (hits.length > 0) renderFrame = true;

    if (firstShotTick !== null) {
      const lastShotTick = firstShotTick + (weaponPerformance.shots - 1) * weaponPerformance.intervalTicks;
      endTick = lastShotTick + weaponPerformance.lifeTicks;
    }
    if (session.tick >= endTick) renderFrame = true;

    if (renderFrame) {
      updatePanel(scenario, mode, session, session.tick, warningStartedTick, firstShotTick, trial.outcome.playerDamageMilli, endTick);
      scene.render(session.player, 'normal', session.tick, session);
      if (captureLabel) await window.__saveEvasionFrame?.(captureLabel);
      await nextAnimationFrame();
    }
    if (session.tick >= endTick) break;
  }

  if (trial.outcome.trackingStartedTick === null || warningStartedTick === null || firstShotTick === null) {
    throw new Error('actual enemy tracking/warning/projectile missing for ' + scenario.face + '/' + scenario.kind + '/' + mode);
  }
  trial.outcome.endTick = session.tick;
  trial.outcome.activeIncomingBulletsAtEnd = session.enemyCombat.bullets.filter(bullet => bullet.shooterId === turretId).length;
  if (session.tick !== endTick || trial.outcome.activeIncomingBulletsAtEnd !== 0) throw new Error('projectile lifetime boundary was not fully observed');
  if (trial.outcome.shotTicks.length !== weaponPerformance.shots) throw new Error('actual projectile count differs from fixed weapon rules');
  if (evasive && trial.outcome.firstEvasiveInputTick !== warningStartedTick + 1) throw new Error('ordinary evasion did not begin on the first post-warning tick');
  if (evasive ? trial.outcome.distinctHitAttackIds.length !== 0 : trial.outcome.distinctHitAttackIds.length === 0) {
    throw new Error('baseline/evasion collision result did not match the expected paired behavior: ' + scenario.face + '/' + scenario.kind + '/' + mode);
  }

  scenarioLabel.textContent = FACE_NAME[scenario.face] + ' / ' + WEAPON_NAME[scenario.kind] + ' · ' + mode;
  statusLabel.className = trial.outcome.playerDamageMilli > 0 ? 'hit' : '';
  statusLabel.textContent = trial.outcome.playerDamageMilli > 0 ? 'baseline: actual projectile hit' : 'ordinary flight: all observed shots missed';
  detailsLabel.textContent = 'end tick ' + session.tick + ' · hits ' + trial.outcome.distinctHitAttackIds.length
    + ' · damage ' + (trial.outcome.playerDamageMilli / 1000).toFixed(1) + ' HP\nall ' + weaponPerformance.shots + ' projectile(s) swept or expired · no bullet removal';
  scene.render(session.player, 'normal', session.tick, session);
  await nextAnimationFrame();
  return trial;
}

async function capture(): Promise<void> {
  scene = new FlightScene(sceneContainer, available => {
    document.body.dataset.webgl = available ? 'ready' : 'unavailable';
  });
  await scene.ready;
  if (!scene.available) throw new Error('production FlightScene WebGL context is unavailable');
  const pairs: Array<{ scenario: EvasionScenario; baseline: BrowserTrial; evasion: BrowserTrial }> = [];
  const recordingSession = new FlightSession();
  for (let index = 0; index < EVASION_SCENARIOS.length; index += 1) {
    const scenario = EVASION_SCENARIOS[index]!;
    const baseline = await runTrial(scenario, false, index * 2, recordingSession);
    const evasion = await runTrial(scenario, true, index * 2 + 1, recordingSession);
    if (JSON.stringify(baseline.fixture) !== JSON.stringify(evasion.fixture)) throw new Error('paired browser trials did not clone an identical tick-zero fixture');
    if (baseline.outcome.warningStartedTick !== evasion.outcome.warningStartedTick
      || JSON.stringify(baseline.outcome.shotTicks) !== JSON.stringify(evasion.outcome.shotTicks)) {
      throw new Error('paired browser trials did not receive the same warning and shot schedule');
    }
    pairs.push({ scenario, baseline, evasion });
  }
  window.__evasionBrowserResult = {
    title: 'A12 / R45 six-scenario controlled browser evasion recording; not a normal 100-mount clear',
    capture: { renderPath: 'production FlightScene normal camera rendered at browser requestAnimationFrame',
      tickDriver: 'every ordinary fixed FlightSession.step is executed and logged; FlightScene is sampled at warning/fire/contact/expiry plus every 10 ticks during evasion, so WebM is a test-only sampled capture and not real-time FPS evidence',
      browser: navigator.userAgent, excludedFromNormalClear: true },
    performanceConstants: ENEMY_PERFORMANCE,
    pairs,
  };
  document.body.dataset.capture = 'complete';
}

void capture().then(() => { window.__evasionBrowserDone = true; }).catch(error => {
  window.__evasionBrowserError = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  document.body.dataset.capture = 'failed';
  statusLabel.className = 'hit';
  statusLabel.textContent = 'capture failed';
  detailsLabel.textContent = window.__evasionBrowserError;
  console.error(window.__evasionBrowserError);
}).finally(() => {
  // The running one-shot page is an inspection harness and is disposed only
  // after capture completion, never while any recorded tick is in flight.
});
