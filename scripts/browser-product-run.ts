import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { chromium, type CDPSession, type Page } from '@playwright/test';

type Mode = 'easy' | 'normal';
type State = {
  phase: string; presentation: string; mode: string; tick: number; operationId: number; seed: number;
  position: [number, number, number]; yaw: number; destroyedCount: number; destroyedIds: number[];
  remainingHpMilli: number; friendlyBullets: number; enemyMainBullets: number; enemyMgBullets: number;
  friendlyPoolFailures: number; enemyPoolFailures: number; fleetRemaining: number;
  resultOutcome: string; resultTime: string; resultDetails: string; resultScore: string;
  target: string; faces: Record<string, number>; elapsedLabel: string;
  renderer: { geometries: number; textures: number; programs: number; drawCalls: number; particles: number; debris: number; wrecks: number };
  audio: { contexts: number; voices: number; maxVoices: number; activeVoices: number; contextState: string; enabled: boolean; active: boolean };
  domNodes: number; listenerRegistrations: number;
};

const DEFAULT_SEED = 0x474b0001;
const MAX_PITCH = 0.95;
const FRAME_MS = 1_000;
const FRAME_SECONDS = FRAME_MS / 1_000;
const TICK_CAP = 108_000;
const SAMPLE_TICKS = 1_800;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const normalizeAngle = (angle: number): number => {
  let wrapped = (angle + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) wrapped += Math.PI * 2;
  return wrapped - Math.PI;
};

async function readState(page: Page): Promise<State> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app')!;
    const hud = document.querySelector<HTMLElement>('#hud')!;
    const canvas = document.querySelector<HTMLCanvasElement>('#flight-canvas')!;
    const position = (hud.dataset.position ?? '').split(',').map(Number);
    const ids = (app.dataset.destroyedTurretIds ?? '').split(',').filter(Boolean).map(Number);
    return {
      phase: app.dataset.phase ?? '', presentation: app.dataset.presentation ?? '', mode: app.dataset.mode ?? '',
      tick: Number(app.dataset.tick ?? 0), operationId: Number(app.dataset.operationId ?? 0), seed: Number(app.dataset.seed ?? 0),
      position: position.length === 3 ? position as [number, number, number] : [0, 0, 0], yaw: Number(hud.dataset.yaw ?? 0),
      destroyedCount: Number(app.dataset.destroyedCount ?? 0), destroyedIds: ids,
      remainingHpMilli: Number(app.dataset.remainingHpMilli ?? -1),
      friendlyBullets: Number(app.dataset.friendlyBullets ?? 0), enemyMainBullets: Number(app.dataset.enemyMainBullets ?? 0),
      enemyMgBullets: Number(app.dataset.enemyMgBullets ?? 0),
      friendlyPoolFailures: Number(app.dataset.friendlyPoolFailures ?? -1), enemyPoolFailures: Number(app.dataset.enemyPoolFailures ?? -1),
      fleetRemaining: Number(document.querySelector('#fleet-left')?.textContent ?? 0),
      resultOutcome: document.querySelector('#result-outcome')?.textContent?.trim() ?? '',
      resultTime: document.querySelector('#result-time')?.textContent?.trim() ?? '',
      resultDetails: document.querySelector('#result-details')?.textContent?.trim() ?? '',
      resultScore: document.querySelector('#result-score')?.textContent?.trim() ?? '',
      target: document.querySelector('#target-status')?.textContent?.trim() ?? '',
      faces: Object.fromEntries([...document.querySelectorAll<HTMLElement>('#face-guide [data-face]')]
        .map(node => [node.dataset.face ?? '', Number(node.querySelector('b')?.textContent ?? 0)])),
      elapsedLabel: document.querySelector('#elapsed')?.textContent?.trim() ?? '',
      renderer: Object.fromEntries(['geometries', 'textures', 'programs', 'drawCalls', 'particles', 'debris', 'wrecks']
        .map(key => [key, Number(canvas.getAttribute(`data-render-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`) ?? 0)])) as State['renderer'],
      audio: { contexts: Number(app.dataset.audioContexts ?? 0), voices: Number(app.dataset.audioVoices ?? 0),
        maxVoices: Number(app.dataset.audioMaxVoices ?? 0), activeVoices: Number(app.dataset.audioActiveVoices ?? 0),
        contextState: app.dataset.audioContextState ?? 'absent', enabled: app.dataset.audioEnabled === 'true', active: app.dataset.audioActive === 'true' },
      domNodes: document.querySelectorAll('*').length,
      listenerRegistrations: Number((window as Window & { __gekichinListenerRegistrations?: number }).__gekichinListenerRegistrations ?? 0),
    };
  });
}

function steeringFor(state: State): { turn: number; climb: number } {
  const [x, y, z] = state.position;
  const angle = Math.atan2(x, z);
  const nextAngle = angle + 0.24;
  const target = {
    x: Math.sin(nextAngle) * 1950,
    y: 1000 + Math.sin(state.tick / 60 / 90) * 520,
    z: Math.cos(nextAngle) * 1950,
  };
  const dx = target.x - x, dy = target.y - y, dz = target.z - z;
  const desiredYaw = Math.atan2(-dx, -dz);
  return {
    turn: clamp(-normalizeAngle(desiredYaw - state.yaw) / (0.82 * FRAME_SECONDS), -1, 1),
    climb: clamp(Math.atan2(dy, Math.hypot(dx, dz)) / MAX_PITCH, -1, 1),
  };
}

function pointerOffset(turn: number, climb: number): { x: number; y: number } {
  const magnitude = Math.min(1, Math.hypot(turn, climb));
  if (magnitude < 1e-6) return { x: 0, y: 0 };
  const distance = 36 * (0.08 + 0.92 * magnitude);
  return { x: distance * turn / magnitude, y: -distance * climb / magnitude };
}

function directoryDigests(directory: string): Record<string, string> {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();
  return Object.fromEntries(files.map(name => {
    const file = resolve(directory, name);
    return [name, createHash('sha256').update(readFileSync(file)).digest('hex')];
  }));
}

function fileDigest(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function readResources(page: Page, cdp: CDPSession) {
  const dom = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app')!;
    const canvas = document.querySelector<HTMLCanvasElement>('#flight-canvas')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      canvasCount: document.querySelectorAll('#flight-canvas').length,
      domNodes: document.querySelectorAll('*').length,
      listenerRegistrations: Number((window as Window & { __gekichinListenerRegistrations?: number }).__gekichinListenerRegistrations ?? 0),
      renderer: {
        geometries: Number(canvas.getAttribute('data-render-geometries') ?? 0),
        textures: Number(canvas.getAttribute('data-render-textures') ?? 0),
        programs: Number(canvas.getAttribute('data-render-programs') ?? 0),
        drawCalls: Number(canvas.getAttribute('data-render-draw-calls') ?? 0),
        particles: Number(canvas.getAttribute('data-render-particles') ?? 0),
        debris: Number(canvas.getAttribute('data-render-debris') ?? 0),
        wrecks: Number(canvas.getAttribute('data-render-wrecks') ?? 0),
      },
      audio: {
        contexts: Number(app.dataset.audioContexts ?? 0), voices: Number(app.dataset.audioVoices ?? 0),
        maxVoices: Number(app.dataset.audioMaxVoices ?? 0), activeVoices: Number(app.dataset.audioActiveVoices ?? 0),
        effectVoices: Number(app.dataset.audioEffectVoices ?? 0), contextState: app.dataset.audioContextState ?? 'absent',
        enabled: app.dataset.audioEnabled === 'true', active: app.dataset.audioActive === 'true',
      },
      graphics: {
        vendor: debug && gl ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR) ?? null,
        renderer: debug && gl ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null,
        webglVersion: gl?.getParameter(gl.VERSION) ?? null,
      },
      virtualEpochMs: Date.now(),
    };
  });
  const metrics = await cdp.send('Performance.getMetrics') as { metrics?: Array<{ name: string; value: number }> };
  return { ...dom, heapUsedBytes: metrics.metrics?.find(item => item.name === 'JSHeapUsedSize')?.value ?? null };
}

async function advanceFrame(page: Page): Promise<void> { await page.clock.runFor(FRAME_MS); }

async function startMission(page: Page, mode: Mode): Promise<State> {
  const app = page.locator('#app');
  if (await app.getAttribute('data-phase') !== 'home') {
    await page.locator('#result-home').click();
    if (await app.getAttribute('data-phase') !== 'home') throw new Error(`Could not return to home from ${await app.getAttribute('data-phase')}`);
  }
  await page.locator(`input[name="mode"][value="${mode}"]`).check();
  await page.locator('#start').click();
  // Product preparation intentionally uses two RAFs. The paused public page
  // clock must advance them explicitly after the normal Start click.
  for (let index = 0; index < 6 && await app.getAttribute('data-phase') !== 'playing'; index += 1) await advanceFrame(page);
  if (await app.getAttribute('data-phase') !== 'playing') throw new Error(`Start did not enter playing (${await app.getAttribute('data-phase')})`);
  return readState(page);
}

function idsFromState(state: State): number[] { return state.destroyedIds; }

async function main(): Promise<void> {
  const modesArg = process.argv.indexOf('--modes');
  const modes = (modesArg >= 0 ? process.argv[modesArg + 1] : 'easy,normal').split(',') as Mode[];
  if (modes.length === 0 || modes.some(mode => mode !== 'easy' && mode !== 'normal') || new Set(modes).size !== modes.length) {
    throw new Error('--modes must be a unique comma-separated subset of easy,normal');
  }
  const outputPath = resolve(process.env.GEKICHIN_PRODUCT_OUTPUT ?? 'docs/evidence/acceptance/browser-product/product-run.json');
  const checkpointPath = outputPath.replace(/\.json$/i, '.progress.json');
  const screenshotDir = resolve(process.env.GEKICHIN_PRODUCT_SHOTS ?? 'docs/evidence/acceptance/browser-product');
  const url = process.env.GEKICHIN_URL ?? 'http://127.0.0.1:4177';
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  const startedAt = new Date().toISOString();
  const sourceFiles = directoryDigests(resolve('src'));
  const previewFiles = directoryDigests(resolve('dist/assets'));
  const provenance = {
    capturedAt: startedAt,
    invocation: `node --import tsx scripts/browser-product-run.ts${process.argv.slice(2).length ? ` ${process.argv.slice(2).join(' ')}` : ''}`,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeStatus: execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim(),
    sourceSha256: sourceFiles,
    runnerSha256: fileDigest(resolve('scripts/browser-product-run.ts')),
    productionPreviewAssetSha256: previewFiles,
  };
  const writeCheckpoint = (snapshot: Record<string, unknown>): void => {
    writeFileSync(checkpointPath, `${JSON.stringify({ type: 'browser-product-run-progress', startedAt, provenance, ...snapshot }, null, 2)}\n`);
  };
  const wallStart = process.hrtime.bigint();
  const errors: string[] = [];
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let cdp: CDPSession | null = null;
  try {
    context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1,
      recordVideo: { dir: screenshotDir, size: { width: 393, height: 852 } } });
    await context.addInitScript(() => {
      const target = window as Window & { __gekichinListenerRegistrations?: number };
      target.__gekichinListenerRegistrations = 0;
      const original = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
        if (listener) target.__gekichinListenerRegistrations = (target.__gekichinListenerRegistrations ?? 0) + 1;
        original.call(this, type, listener, options);
      };
    });
    const page = await context.newPage();
    const video = page.video();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#app')?.dataset.rendererReady === 'true', null, { timeout: 60_000 });
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const browserVersion = browser.version();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const realPageEpochAtPause = await page.evaluate(() => Date.now());
    const clockStart = new Date(realPageEpochAtPause + 10_000);
    await page.clock.install({ time: new Date(realPageEpochAtPause) });
    await page.clock.pauseAt(clockStart);
    const virtualStartEpochMs = await page.evaluate(() => Date.now());
    const frameSchedule = await page.evaluate((intervalMs) => {
      window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), intervalMs);
      window.cancelAnimationFrame = handle => window.clearTimeout(handle);
      return { kind: 'test-only timer-backed RAF cadence', intervalMs,
        logicalTicksPerRenderedFrame: intervalMs / 1_000 * 60,
        guardGapMilliseconds: intervalMs };
    }, FRAME_MS);
    writeCheckpoint({ status: 'started', environment: { browserVersion, userAgent, url,
      viewport: { width: 393, height: 852, deviceScaleFactor: 1 } }, virtualStartEpochMs, frameSchedule });

    // Turn audio on through the actual user-facing product button.
    await page.locator('#home [data-sound]').click();
    await advanceFrame(page);
    const audioWarmup = await readResources(page, cdp);
    if (audioWarmup.audio.contexts !== 1 || audioWarmup.audio.maxVoices !== 16 || !audioWarmup.audio.enabled) {
      throw new Error(`Product sound did not initialize one bounded context: ${JSON.stringify(audioWarmup.audio)}`);
    }

    const origin = { x: 196, y: 426 };
    const missions: Array<Record<string, unknown>> = [];
    const allSamples: Array<Record<string, unknown>> = [];
    let globalMax = { friendlyBullets: 0, enemyMainBullets: 0, enemyMgBullets: 0, particles: 0, debris: 0, wrecks: 0, activeVoices: 0 };
    let finalState: State | null = null;
    for (const mode of modes) {
      let state = await startMission(page, mode);
      if (state.seed !== DEFAULT_SEED) throw new Error(`Unexpected product seed ${state.seed}`);
      if (mode === 'normal') await page.keyboard.down('Space');
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await advanceFrame(page);
      await page.screenshot({ path: resolve(screenshotDir, `${mode}-start.png`) });

      const rows: Array<Record<string, unknown>> = [];
      const samples: Array<Record<string, unknown>> = [];
      const targetFrames = new Set<string>();
      const destroyedByFrame: Array<{ tick: number; destroyedCount: number; remainingHpMilli: number; newlyDestroyedIds: number[] }> = [];
      let previousIds = new Set(idsFromState(state));
      let previousTick = 0;
      let maxMissionPools = { friendlyBullets: 0, enemyMainBullets: 0, enemyMgBullets: 0 };
      let maxRendererPools = { particles: 0, debris: 0, wrecks: 0 };
      let lastCheckpointTick = 0;
      const screenTag = mode;
      writeCheckpoint({ status: 'mission-in-progress', mode, completedMissions: missions,
        activeMission: { seed: state.seed, operationId: state.operationId, tick: state.tick, activeSeconds: state.tick / 60 } });

      while (!(state.phase === 'result' && state.presentation === 'sinking')) {
        if (state.phase !== 'playing') throw new Error(`${mode} left active play early at tick ${state.tick}: ${state.phase}/${state.resultOutcome}`);
        if (state.tick >= TICK_CAP) throw new Error(`${mode} exceeded the 1800 active-second tick cap`);
        const before = state;
        const steering = steeringFor(before);
        const offset = pointerOffset(steering.turn, steering.climb);
        await page.mouse.move(origin.x + offset.x, origin.y + offset.y);
        rows.push({ tick: before.tick, turn: Number(steering.turn.toFixed(6)), climb: Number(steering.climb.toFixed(6)),
          pointerDx: Number(offset.x.toFixed(3)), pointerDy: Number(offset.y.toFixed(3)), fire: mode === 'normal' });
        await advanceFrame(page);
        state = await readState(page);
        if (state.phase === 'playing') {
          if (state.tick <= previousTick || state.tick - previousTick > 60) throw new Error(`${mode} fixed-step tick anomaly ${previousTick}→${state.tick}`);
          previousTick = state.tick;
        } else if (!(state.phase === 'result' && state.presentation === 'sinking')) {
          throw new Error(`${mode} left active play at ${state.tick}: ${state.phase}/${state.resultOutcome}`);
        }

        const newIds = state.destroyedIds.filter(id => !previousIds.has(id));
        if (newIds.length) destroyedByFrame.push({ tick: state.tick, destroyedCount: state.destroyedCount,
          remainingHpMilli: state.remainingHpMilli, newlyDestroyedIds: newIds });
        previousIds = new Set(state.destroyedIds);
        maxMissionPools.friendlyBullets = Math.max(maxMissionPools.friendlyBullets, state.friendlyBullets);
        maxMissionPools.enemyMainBullets = Math.max(maxMissionPools.enemyMainBullets, state.enemyMainBullets);
        maxMissionPools.enemyMgBullets = Math.max(maxMissionPools.enemyMgBullets, state.enemyMgBullets);
        maxRendererPools.particles = Math.max(maxRendererPools.particles, state.renderer.particles);
        maxRendererPools.debris = Math.max(maxRendererPools.debris, state.renderer.debris);
        maxRendererPools.wrecks = Math.max(maxRendererPools.wrecks, state.renderer.wrecks);
        globalMax = {
          friendlyBullets: Math.max(globalMax.friendlyBullets, state.friendlyBullets),
          enemyMainBullets: Math.max(globalMax.enemyMainBullets, state.enemyMainBullets),
          enemyMgBullets: Math.max(globalMax.enemyMgBullets, state.enemyMgBullets),
          particles: Math.max(globalMax.particles, state.renderer.particles),
          debris: Math.max(globalMax.debris, state.renderer.debris),
          wrecks: Math.max(globalMax.wrecks, state.renderer.wrecks),
          activeVoices: Math.max(globalMax.activeVoices, state.audio.activeVoices),
        };
        if (state.tick - (samples.at(-1)?.tick as number ?? 0) >= SAMPLE_TICKS) {
          const sample = { mode, tick: state.tick, activeSeconds: state.tick / 60, state, resources: await readResources(page, cdp) };
          samples.push(sample); allSamples.push(sample);
        }
        for (const face of ['bottom', 'rear']) {
          if (!targetFrames.has(face) && state.target.includes(face === 'bottom' ? '下面' : '後面')) {
            targetFrames.add(face);
            await page.screenshot({ path: resolve(screenshotDir, `${screenTag}-${face}-target.png`) });
          }
        }
        const liveRemaining = state.destroyedCount;
        if (liveRemaining >= 98 && !targetFrames.has('last-two')) {
          targetFrames.add('last-two');
          await page.screenshot({ path: resolve(screenshotDir, `${screenTag}-last-two-turrets.png`) });
        }
        if (state.tick - lastCheckpointTick >= SAMPLE_TICKS) {
          lastCheckpointTick = state.tick;
          writeCheckpoint({ status: 'mission-in-progress', mode, completedMissions: missions,
            activeMission: { seed: state.seed, operationId: state.operationId, tick: state.tick,
              activeSeconds: state.tick / 60, state, targetFrames: [...targetFrames], destroyedByFrame,
              maxMissionPools, maxRendererPools, samples, inputRows: rows } });
        }
      }

      await page.mouse.up();
      if (mode === 'normal') await page.keyboard.up('Space');
      const sinkState = await readState(page);
      const sinkStartedVirtualEpochMs = await page.evaluate(() => Date.now());
      await page.screenshot({ path: resolve(screenshotDir, `${screenTag}-sinking.png`) });
      const rawIds = sinkState.destroyedIds;
      const uniqueIds = new Set(rawIds);
      const allFacesEmpty = Object.keys(sinkState.faces).length === 6 && Object.values(sinkState.faces).every(value => value === 0);
      if (sinkState.destroyedCount !== 100 || rawIds.length !== 100 || uniqueIds.size !== 100 || sinkState.remainingHpMilli !== 0 || !allFacesEmpty) {
        throw new Error(`${mode} terminal DOM snapshot is not 100 unique destroyed turrets with zero HP/faces: ${JSON.stringify(sinkState)}`);
      }
      if (!sinkState.resultDetails.includes('破壊 100/100') || !sinkState.resultDetails.includes('主砲20/20') || !sinkState.resultDetails.includes('機銃80/80')) {
        throw new Error(`${mode} result DOM is missing 100/100 or 20/20+80/80 evidence: ${sinkState.resultDetails}`);
      }
      if (sinkState.friendlyPoolFailures !== 0 || sinkState.enemyPoolFailures !== 0 || sinkState.fleetRemaining <= 0) {
        throw new Error(`${mode} failed live combat integrity at terminal: ${JSON.stringify(sinkState)}`);
      }
      if (maxMissionPools.enemyMainBullets <= 0 || maxMissionPools.enemyMgBullets <= 0) {
        throw new Error(`${mode} did not observe both live enemy projectile pools: ${JSON.stringify(maxMissionPools)}`);
      }
      let sinkAdvanceFrames = 0;
      if (mode === 'easy') {
        await advanceFrame(page);
        sinkAdvanceFrames += 1;
        const frozen = await readState(page);
        if (frozen.tick !== sinkState.tick || frozen.resultTime !== sinkState.resultTime || frozen.resultScore !== sinkState.resultScore) {
          throw new Error(`Easy report changed during sink hold: before=${JSON.stringify(sinkState)} after=${JSON.stringify(frozen)}`);
        }
        await page.locator('#skip-sinking').click();
      } else {
        for (; sinkAdvanceFrames < 8 && await page.locator('#result').isHidden(); sinkAdvanceFrames += 1) await advanceFrame(page);
      }
      if (await page.locator('#result').isHidden()) throw new Error(`${mode} did not reach the visible result screen through the product sink/skip flow`);
      const resultVisibleVirtualEpochMs = await page.evaluate(() => Date.now());
      const sinkVirtualDurationMs = resultVisibleVirtualEpochMs - sinkStartedVirtualEpochMs;
      if (mode === 'normal' && (sinkVirtualDurationMs < 5_000 || sinkVirtualDurationMs > 6_000)) {
        throw new Error(`Normal cinematic sink did not remain visible for a measured five virtual seconds: ${sinkVirtualDurationMs} ms / ${sinkAdvanceFrames} frames`);
      }
      await advanceFrame(page);
      const resultState = await readState(page);
      if (!resultState.resultOutcome.includes('勝利') || resultState.resultTime !== sinkState.resultTime
        || resultState.resultScore !== sinkState.resultScore || resultState.destroyedIds.length !== 100) {
        throw new Error(`${mode} visible result does not preserve its confirmed win: ${JSON.stringify(resultState)}`);
      }
      await page.screenshot({ path: resolve(screenshotDir, `${screenTag}-result.png`) });
      const best = await page.evaluate(mode => {
        const key = `gekichin-best-gekichin-combat-v1-${mode}`;
        const raw = localStorage.getItem(key);
        return { key, envelope: raw === null ? null : JSON.parse(raw), allRecords: Object.fromEntries(Object.entries(localStorage)
          .filter(([storageKey]) => storageKey.startsWith('gekichin-best-')).map(([storageKey, value]) => [storageKey, JSON.parse(value)])) };
      }, mode);
      const bestRecord = best.envelope?.record;
      if (best.envelope?.version !== 1 || bestRecord?.mode !== mode || bestRecord?.outcome !== 'victory'
        || bestRecord?.K !== 100 || bestRecord?.endTick !== sinkState.tick || bestRecord?.seed !== sinkState.seed) {
        throw new Error(`${mode} did not persist the confirmed victory as a version-1 mode-specific best: ${JSON.stringify(best)}`);
      }
      const resourceAtWin = await readResources(page, cdp);
      const mission = {
        mode, seed: state.seed, operationId: state.operationId, outcome: resultState.resultOutcome,
        startInput: 'visible Easy/Normal mode radio + product Start button',
        flightInput: 'trusted Playwright mouse drag over #flight-surface; Normal additionally held product-bound Space key',
        activeTicks: sinkState.tick, activeSeconds: Number(sinkState.resultTime), tickCap: TICK_CAP,
        destroyedCount: sinkState.destroyedCount, destroyedTurretIds: rawIds, uniqueIdCount: uniqueIds.size,
        finalRemainingHpMilli: sinkState.remainingHpMilli, faceCounts: sinkState.faces,
        resultDetails: resultState.resultDetails, resultScore: resultState.resultScore, fleetRemaining: resultState.fleetRemaining,
        maxLiveProjectilePools: maxMissionPools, maxRendererPools, terminalPoolFailures: {
          friendly: sinkState.friendlyPoolFailures, enemy: sinkState.enemyPoolFailures,
        }, sinkPresentation: { shown: true, endTick: sinkState.tick,
          path: mode === 'easy' ? 'early product skip after report freeze check' : 'automatic result after measured five virtual seconds',
          sinkStartedVirtualEpochMs, resultVisibleVirtualEpochMs, sinkVirtualDurationMs, sinkAdvanceFrames },
        resultFrozen: true, bestRecordForMode: best.envelope, bestRecordsAfterResult: best.allRecords, samples,
        terminalResources: resourceAtWin, targetFramesCaptured: [...targetFrames],
        destroyedIdFrames: destroyedByFrame,
        inputRows: rows,
      };
      missions.push(mission);
      writeCheckpoint({ status: 'mission-complete', completedMissions: missions, activeMode: mode,
        finalState: resultState, accumulatedSamples: allSamples });
      if (mode !== modes.at(-1)) {
        await page.locator('#result-home').click();
        if (await page.locator('#app').getAttribute('data-phase') !== 'home') throw new Error(`Could not return home after ${mode} victory`);
      }
      finalState = resultState;
    }

    const preRestart = await readResources(page, cdp);
    const restartResults: Array<Record<string, unknown>> = [];
    // Ten ordinary result→restart→pause→abort loops; preserve the same rendered
    // scene, browser context, WebGL renderer and Web Audio context throughout.
    for (let count = 1; count <= 10; count += 1) {
      await page.locator('#restart').click();
      for (let frame = 0; frame < 6 && await page.locator('#app').getAttribute('data-phase') !== 'playing'; frame += 1) await advanceFrame(page);
      if (await page.locator('#app').getAttribute('data-phase') !== 'playing') throw new Error(`Restart ${count} failed to begin`);
      for (let frame = 0; frame < 10 && Number((await page.locator('#app').getAttribute('data-tick')) ?? 0) <= 120; frame += 1) await advanceFrame(page);
      await page.locator('#pause').click();
      await page.locator('#finish').click();
      await advanceFrame(page);
      const result = await readState(page);
      if (result.resultOutcome !== '中断') throw new Error(`Restart ${count} did not end through the normal abort button: ${result.resultOutcome}`);
      const resources = await readResources(page, cdp);
      if (resources.canvasCount !== 1 || resources.audio.contexts !== 1 || resources.audio.voices !== 16
        || resources.renderer.geometries !== preRestart.renderer.geometries
        || resources.renderer.textures !== preRestart.renderer.textures
        || resources.renderer.programs !== preRestart.renderer.programs
        || resources.domNodes !== preRestart.domNodes
        || resources.listenerRegistrations !== preRestart.listenerRegistrations) {
        throw new Error(`Renderer/audio/DOM/listener resources drifted at restart ${count}: ${JSON.stringify({ before: preRestart, after: resources })}`);
      }
      if (resources.renderer.particles > 1024 || resources.renderer.debris > 256 || resources.renderer.wrecks > 100) {
        throw new Error(`A renderer pool exceeded its fixed cap after restart ${count}: ${JSON.stringify(resources.renderer)}`);
      }
      restartResults.push({ restart: count, tick: result.tick, phase: result.phase, outcome: result.resultOutcome, resources });
      writeCheckpoint({ status: 'restart-resources-in-progress', completedMissions: missions,
        restartCyclesCompleted: restartResults.length, restartResults, preRestart });
    }
    finalState = await readState(page);
    await page.screenshot({ path: resolve(screenshotDir, 'ten-restarts-final-abort.png') });

    const finalEpochMs = await page.evaluate(() => Date.now());
    const cdpMetrics = await cdp.send('Performance.getMetrics') as { metrics?: Array<{ name: string; value: number }> };
    const finalHeap = cdpMetrics.metrics?.find(item => item.name === 'JSHeapUsedSize')?.value ?? null;
    const result = {
      type: 'browser-product-full-missions-and-resource-run',
      status: errors.length === 0 && missions.length === modes.length ? 'passed' : 'page-errors',
      startedAt, completedAt: new Date().toISOString(), wallElapsedMilliseconds: Number(process.hrtime.bigint() - wallStart) / 1e6,
      clock: { api: 'Playwright public page.clock.install + pauseAt + runFor', virtualStartEpochMs,
        virtualEndEpochMs: finalEpochMs, virtualTimeAdvancedMilliseconds: finalEpochMs - virtualStartEpochMs,
        frameSchedule, logicalTickRate: `FlightSession fixed 60Hz; each ${FRAME_MS}ms rendered RAF processes ${FRAME_MS / 1_000 * 60} sequential fixed ticks, <2s guard gap` },
      environment: { platform: process.platform, node: process.version, browser: 'Chromium', browserVersion,
        userAgent, url, viewport: { width: 393, height: 852, deviceScaleFactor: 1 },
        provenance, sourceCommit: provenance.gitHead },
      seed: DEFAULT_SEED,
      pilot: 'Read-only HUD data-position/data-yaw/data-tick feed a standard flight-surface drag controller at each virtual frame. No production state or setter writes. Normal mode held Space through the product key handler.',
      resources: { measured: ['Three renderer geometry/texture/program/draw-call/pool counters', 'Web Audio context and voice pool diagnostics',
        'CDP JSHeapUsedSize', 'DOM element count', 'cumulative addEventListener registrations'],
        listenerCounterScope: 'page-init wrapper counts registrations only; no per-operation listeners should be added; comparison is across visible product restarts',
        maximaAcrossMissions: globalMax, preRestart, finalHeapUsedBytes: finalHeap, samples: allSamples, restarts: restartResults },
      missions, errors, finalState,
      claims: { productControlPath: true, engineStateWritten: false, browserRendered: true, virtualTime: true,
        realWorldPerformance: false, physicalDeviceOrHumanTest: false },
    };
    if (errors.length) throw new Error(`Page errors during browser product run: ${errors.join('; ')}`);
    if (missions.some(item => item.outcome !== '勝利 · 全100基撃沈')) throw new Error('One or more product missions did not end in confirmed 100-turret victory');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    rmSync(checkpointPath, { force: true });
    console.log(JSON.stringify({ outputPath, status: result.status, wallElapsedMilliseconds: result.wallElapsedMilliseconds,
      modes, missions: missions.map(item => ({ mode: item.mode, tick: item.activeTicks, seconds: item.activeSeconds, outcome: item.outcome })),
      restartCycles: restartResults.length, finalHeapUsedBytes: finalHeap, errors }));
    if (video) {
      await cdp.detach(); cdp = null;
      await context.close(); context = null;
      const videoOut = resolve(screenshotDir, 'full-product-run.webm');
      await video.saveAs(videoOut);
      const updated = { ...result, video: videoOut };
      writeFileSync(outputPath, `${JSON.stringify(updated, null, 2)}\n`);
      console.log(JSON.stringify({ video: videoOut }));
    }
    await cdp?.detach(); cdp = null;
  } finally {
    await cdp?.detach().catch(() => undefined);
    await context?.close();
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
