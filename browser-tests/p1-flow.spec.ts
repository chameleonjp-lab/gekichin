import { expect, test, type Page } from '@playwright/test';
import { guardStaticTraffic } from './network-policy';

test.use({ serviceWorkers: 'block' });
if (process.env.GEKICHIN_CAMERA_CONTRACT_NO_ARTIFACTS === '1') test.use({ screenshot: 'off', trace: 'off' });

async function start(page: Page, mode = 'easy') {
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('radio', { name: mode === 'easy' ? /イージー/ : /ノーマル/ }).check(); await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
}

async function startWithControlledFrames(page: Page, mode = 'easy', beforeStart?: () => Promise<void>) {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00.000Z') });
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  let rendererReady = false;
  for (let frame = 0; frame < 100 && !rendererReady; frame += 1) {
    await page.clock.runFor(100);
    rendererReady = (await page.locator('#app').getAttribute('data-renderer-ready')) === 'true';
  }
  expect(rendererReady, 'the renderer must finish prewarming before the measured operation starts').toBe(true);
  // The layout/resource fixture measures a live start and repeated restart,
  // not how much wall time SwiftShader spends compiling its first frame.
  const pauseTime = await page.evaluate(() => Date.now() + 60_000);
  await page.clock.pauseAt(new Date(pauseTime));
  if (beforeStart) await beforeStart();
  await page.getByRole('radio', { name: mode === 'easy' ? /イージー/ : /ノーマル/ }).check(); await page.locator('#start').click();
  await page.clock.runFor(100);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
}

test('Normal keyboard flight, loop interruption, pause, settings, report and reflight use one operation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page, 'normal'); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(3);
  await page.keyboard.down('w'); await expect.poll(async () => Number((await page.locator('#speed').textContent())!.split(' ')[0])).toBeGreaterThan(115); await page.keyboard.up('w');
  await page.keyboard.down('Space'); await expect(page.locator('#fire-status')).toContainText('ON');
  await page.keyboard.up('Space'); await expect(page.locator('#fire-status')).toContainText('待機');
  await page.keyboard.press('l'); await expect(page.locator('#loop-status')).toHaveText('実行中');
  await page.keyboard.down('ArrowRight'); await expect(page.locator('#loop-status')).not.toHaveText('実行中'); await page.keyboard.up('ArrowRight');
  await page.screenshot({ path: info.outputPath('normal-flight.png') });
  await page.keyboard.press('Escape'); await expect(page.locator('#paused')).toBeVisible();
  const elapsed = await page.locator('#elapsed').textContent(); await page.locator('#pause-controls').click(); await page.locator('#control-editor-touch').click();
  await expect(page.locator('#control-mode')).toBeDisabled(); await expect(page.locator('#control-mode')).toHaveValue('normal');
  await page.keyboard.press('Escape'); await expect(page.locator('#pause-controls')).toBeFocused(); expect(await page.locator('#elapsed').textContent()).toBe(elapsed);
  await page.locator('#resume').click(); await expect.poll(() => page.locator('#elapsed').textContent()).not.toBe(elapsed);
  await page.locator('#pause').click(); await page.locator('#finish').click(); await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-outcome')).toContainText('中断');
  await expect(page.locator('#result-details')).toContainText('破壊 0/100'); await expect(page.locator('#result-mode')).toContainText('ノーマル');
  await page.screenshot({ path: info.outputPath('flight-report.png') });
  await page.locator('#result-controls').click(); await page.locator('#control-editor-touch').click(); await expect(page.locator('#control-mode')).toBeEnabled(); await page.locator('#control-close').click();
  await page.locator('#restart').click(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'normal'); await expect(page.locator('#speed')).toHaveText('110 m/s');
  await page.locator('#pause').click(); await page.locator('#pause-home').click(); await expect(page.getByRole('radio', { name: /ノーマル/ })).toBeChecked();
  expect(errors).toEqual([]);
});

type CameraContractSample = {
  calls: number; tick: number; mode: 'easy' | 'normal'; phase: string; frame: number;
  camera: { position: number[]; quaternion: number[] };
  player: { position: number[]; previous: number[]; quaternion: number[]; pitch: number; yaw: number; bank: number; speed: number };
  expectedCamera: { position: number[]; quaternion: number[] };
  sight: { x: number; y: number };
  expectedSight: { x: number; y: number };
  stateUnchanged: boolean;
};

// Keep the same passive, bounded render observation in Chromium and WebKit.
const cameraContractTest = test.extend({ screenshot: 'off', trace: 'off', video: 'off' });
const webkitCameraContractTest = cameraContractTest.extend({ browserName: 'webkit', launchOptions: { args: [] } });

async function installPassiveCameraProbe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ FlightScene }, view, { projectGunSight }] = await Promise.all([
      import('/src/scene.ts'), import('/src/flight-view.ts'), import('/src/gun-sight.ts'),
    ]);
    const prototype: any = FlightScene.prototype;
    if (prototype.__gekichinCameraContractOriginalRender) throw new Error('camera contract probe already installed');
    const originalRender = prototype.render;
    const probe = { calls: 0, samples: [] as any[] };
    (window as any).__gekichinCameraContract = probe;
    prototype.__gekichinCameraContractOriginalRender = originalRender;
    prototype.render = function (player: any, mode: any, tick: number, session: any, sinkingElapsedSeconds = 0) {
      const before = {
        tick: session?.tick ?? tick, phase: session?.phase ?? '',
        position: player.position.toArray(), previous: player.previous.toArray(), quaternion: player.quaternion.toArray(),
        pitch: player.pitch, yaw: player.yaw, bank: player.bank, speed: player.speed,
      };
      const result = originalRender.call(this, player, mode, tick, session, sinkingElapsedSeconds);
      probe.calls += 1;
      if (session?.phase === 'playing' && probe.calls % 3 === 0) {
        const center = this.layout.center;
        const ship = view.sinkingShipPose(center, sinkingElapsedSeconds, this.reducedMotion);
        const playerCopy: any = {
          position: new (player.position.constructor)().fromArray(before.position),
          previous: new (player.previous.constructor)().fromArray(before.previous),
          quaternion: new (player.quaternion.constructor)().fromArray(before.quaternion),
          pitch: before.pitch, yaw: before.yaw, bank: before.bank, speed: before.speed,
        };
        const expectedPosition = new (this.camera.position.constructor)();
        const expectedQuaternion = new (this.camera.quaternion.constructor)();
        view.getEffectiveFlightCameraPose(playerCopy, mode, expectedPosition, expectedQuaternion, session.world, ship);
        const expectedSight = projectGunSight(playerCopy, this.canvas.clientWidth, this.canvas.clientHeight, session.world, ship);
        const after = {
          tick: session?.tick ?? tick, phase: session?.phase ?? '',
          position: player.position.toArray(), previous: player.previous.toArray(), quaternion: player.quaternion.toArray(),
          pitch: player.pitch, yaw: player.yaw, bank: player.bank, speed: player.speed,
        };
        const circle = this.canvas.closest('#app')?.querySelector('.aim-circle') as HTMLElement | null;
        const actualSight = { x: Number.parseFloat(circle?.style.left ?? 'NaN'), y: Number.parseFloat(circle?.style.top ?? 'NaN') };
        const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        if (probe.samples.length === 16) probe.samples.shift();
        probe.samples.push({
          calls: probe.calls, tick, mode, phase: session.phase, frame: this.renderer.info.render.frame,
          camera: { position: this.camera.position.toArray(), quaternion: this.camera.quaternion.toArray() },
          player: before,
          expectedCamera: { position: expectedPosition.toArray(), quaternion: expectedQuaternion.toArray() },
          sight: actualSight, expectedSight: { x: expectedSight.x, y: expectedSight.y },
          stateUnchanged: same(before, after),
        });
      }
      return result;
    };
  });
}

async function restorePassiveCameraProbe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { FlightScene } = await import('/src/scene.ts');
    const prototype: any = FlightScene.prototype;
    if (prototype.__gekichinCameraContractOriginalRender) {
      prototype.render = prototype.__gekichinCameraContractOriginalRender;
      delete prototype.__gekichinCameraContractOriginalRender;
    }
    delete (window as any).__gekichinCameraContract;
  });
}

async function latestCameraSample(page: Page): Promise<CameraContractSample> {
  const sample = await page.evaluate(() => (window as any).__gekichinCameraContract?.samples.at(-1) ?? null);
  expect(sample, 'the actual FlightScene.render path should provide a bounded camera sample').not.toBeNull();
  return sample!;
}

async function runCameraContract(page: Page, expectedBrowser: 'chromium' | 'webkit'): Promise<void> {
  expect(page.context().browser()?.browserType().name()).toBe(expectedBrowser);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let probeInstalled = false;
  try {
    await startWithControlledFrames(page, 'normal', async () => {
      await installPassiveCameraProbe(page);
      probeInstalled = true;
    });
    await page.clock.runFor(250);
    const initial = await latestCameraSample(page);
    expect(initial.mode).toBe('normal');
    expect(initial.frame).toBeGreaterThan(0);
    expectCameraMatchesRenderedPose(initial);
    expectSightMatchesProjection(initial);

    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(500);
    const climbed = await latestCameraSample(page);
    expect(climbed.player.pitch).toBeGreaterThan(initial.player.pitch + 0.02);
    expectCameraMatchesRenderedPose(climbed);
    expectSightMatchesProjection(climbed);

    const beforeVerticalRelease = await latestCameraSample(page);
    await page.keyboard.up('ArrowUp');
    await page.clock.runFor(100);
    const releasedVertical = await latestCameraSample(page);
    expect(releasedVertical.calls).toBeGreaterThan(beforeVerticalRelease.calls);
    expect(releasedVertical.tick).toBeGreaterThan(beforeVerticalRelease.tick);
    await page.clock.runFor(200);
    const horizontalOnly = await latestCameraSample(page);
    expect(climbed.player.pitch).toBeGreaterThan(initial.player.pitch + 0.02);
    expect(Math.abs(horizontalOnly.player.pitch - releasedVertical.player.pitch)).toBeLessThan(1e-9);
    expectCameraMatchesRenderedPose(horizontalOnly);
    expectSightMatchesProjection(horizontalOnly);

    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('l');
    await page.clock.runFor(200);
    await expect(page.locator('#loop-status')).toHaveText('実行中');
    const looping = await latestCameraSample(page);
    expectCameraMatchesRenderedPose(looping);
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(100);
    await expect(page.locator('#loop-status')).not.toHaveText('実行中');
    const interrupted = await latestCameraSample(page);
    expectCameraMatchesRenderedPose(interrupted);
    expectSightMatchesProjection(interrupted);
    expect(errors).toEqual([]);
  } finally {
    await page.keyboard.up('ArrowUp').catch(() => {});
    await page.keyboard.up('ArrowRight').catch(() => {});
    await page.keyboard.up('l').catch(() => {});
    if (probeInstalled) await restorePassiveCameraProbe(page);
  }
}

cameraContractTest('[camera-contract:chromium] actual rendered camera pose and horizontal pitch retention', async ({ page }) => {
  await runCameraContract(page, 'chromium');
});

webkitCameraContractTest('[camera-contract:webkit] actual rendered camera pose and horizontal pitch retention', async ({ page }) => {
  await runCameraContract(page, 'webkit');
});

function maxQuaternionComponentDelta(left: number[], right: number[]): number {
  const direct = Math.max(...left.map((value, i) => Math.abs(value - right[i]!)));
  const opposite = Math.max(...left.map((value, i) => Math.abs(value + right[i]!)));
  return Math.min(direct, opposite);
}

function expectCameraMatchesRenderedPose(sample: CameraContractSample): void {
  const delta = (left: number[], right: number[]) => Math.hypot(...left.map((value, i) => value - right[i]!));
  expect(delta(sample.camera.position, sample.expectedCamera.position)).toBeLessThan(1e-6);
  expect(maxQuaternionComponentDelta(sample.camera.quaternion, sample.expectedCamera.quaternion)).toBeLessThan(1e-8);
  expect(sample.stateUnchanged, 'the render probe and expected-pose observation must not mutate game state').toBe(true);
  expect(sample.phase).toBe('playing');
}

function expectSightMatchesProjection(sample: CameraContractSample): void {
  expect(Number.isFinite(sample.sight.x) && Number.isFinite(sample.sight.y)).toBe(true);
  expect(Math.abs(sample.sight.x - sample.expectedSight.x)).toBeLessThan(1e-6);
  expect(Math.abs(sample.sight.y - sample.expectedSight.y)).toBeLessThan(1e-6);
}

test('multi-touch cancel, lost capture, resize and compatibility click release held input', async ({ page }) => {
  await start(page, 'normal'); const surface = page.locator('#flight-surface'), fire = page.locator('#fire');
  await surface.dispatchEvent('pointerdown', { pointerId: 501, pointerType: 'touch', isPrimary: true, buttons: 1, clientX: 170, clientY: 320 });
  await surface.dispatchEvent('pointermove', { pointerId: 501, pointerType: 'touch', buttons: 1, clientX: 205, clientY: 305, bubbles: true }); await expect(page.locator('#joystick')).toBeVisible();
  await fire.dispatchEvent('pointerdown', { pointerId: 502, pointerType: 'touch', isPrimary: false, buttons: 1 }); await expect(fire).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#fire-status')).toContainText('ON');
  await fire.dispatchEvent('pointercancel', { pointerId: 502, pointerType: 'touch', bubbles: true }); await expect(page.locator('#fire-status')).toContainText('待機'); await expect(page.locator('#joystick')).toBeVisible();
  await surface.dispatchEvent('pointercancel', { pointerId: 501, pointerType: 'touch', bubbles: true }); await expect(page.locator('#joystick')).not.toBeVisible();
  await fire.dispatchEvent('pointerdown', { pointerId: 503, pointerType: 'touch', isPrimary: true, buttons: 1 }); await fire.dispatchEvent('lostpointercapture', { pointerId: 503, pointerType: 'touch', bubbles: true });
  await expect(fire).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#fire-status')).toContainText('待機');
  const layout = await fire.getAttribute('style'); await fire.dispatchEvent('click', { detail: 1, bubbles: true }); await expect(fire).toHaveAttribute('style', layout!); await expect(page.locator('#fire-status')).toContainText('待機');
  await page.keyboard.down('w'); await page.setViewportSize({ width: 852, height: 393 }); await page.keyboard.up('w'); await expect(fire).toHaveAttribute('aria-pressed', 'false');
  // The layout and visual viewport each dispatch a resize; begin the next
  // deliberate key press only after both rendering turns have completed.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.down('Space'); await expect(page.locator('#fire-status')).toContainText('ON'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#paused')).toBeVisible(); await page.keyboard.up('Space'); await page.locator('#resume').click(); await expect(page.locator('#fire-status')).toContainText('待機');
});

test('Easy one button fits specified viewports and ten repeated starts never duplicate app resources', async ({ page }, info) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }, { width: 852, height: 393 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport); await startWithControlledFrames(page); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(1);
    const rect = (await page.locator('#loop').boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.x).toBeGreaterThanOrEqual(7); expect(rect.y).toBeGreaterThanOrEqual(7);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 7); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 7);
  }
  await page.setViewportSize({ width: 393, height: 852 }); await startWithControlledFrames(page); await page.screenshot({ path: info.outputPath('easy-flight.png') });
  for (let repeat = 0; repeat < 10; repeat += 1) {
    await page.locator('#pause').click(); await page.locator('#finish').click(); await page.locator('#restart').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await page.clock.runFor(100);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing'); await expect(page.locator('#flight-canvas')).toHaveCount(1); await expect(page.locator('#control-settings')).toHaveCount(1);
  }
});

test('WebGL loss while paused or editing gives guidance and restoration needs explicit resume', async ({ page }) => {
  await start(page); await page.locator('#pause').click(); await page.locator('#pause-controls').click();
  const extension = await page.locator('#flight-canvas').evaluateHandle(canvas => (canvas as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context'));
  await extension.evaluate(extension => extension!.loseContext()); await expect(page.locator('#control-settings [data-graphics-status]')).toContainText('3D描画が停止');
  await page.locator('#control-close').click(); await expect(page.locator('#pause-reason')).toContainText('3D描画が停止'); await expect(page.locator('#resume')).toBeDisabled();
  await extension.evaluate(extension => extension!.restoreContext()); await expect(page.locator('#resume')).toBeEnabled(); await expect(page.locator('#pause-reason')).toContainText('復旧');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused'); await page.locator('#resume').click(); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing'); await extension.dispose();
});

test('an aborted combat report does not write a best record or make game API requests', async ({ page, context, baseURL }) => {
  const blockedRequests = await guardStaticTraffic(context, baseURL!);
  const bestWrites: string[] = [];
  await page.exposeFunction('observeBestWrite', (key: string) => bestWrites.push(key));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('gekichin-best-')) {
        void (window as unknown as { observeBestWrite: (key: string) => Promise<void> }).observeBestWrite(key);
      }
      return original.call(this, key, value);
    };
  });
  // R84 measures attempted communication and storage; isolate SwiftShader's cold
  // frame latency using the existing prewarmed clock fixture, without changing
  // the separate native lifecycle, graphics-loss or wall-gap acceptance checks.
  await startWithControlledFrames(page); await page.locator('#pause').click(); await page.locator('#finish').click(); await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-outcome')).toContainText('中断');
  await expect(page.locator('#result-best')).toContainText('勝利した作戦');
  await context.close();
  expect(bestWrites).toEqual([]);
  expect(blockedRequests, 'R84 permits only known GET static assets').toEqual([]);
});

test('an explicit visibilitychange fixture stops flight and visible recovery never resumes it', async ({ page }) => {
  await start(page);
  // Headless Chromium keeps all page targets visible. This is explicitly a
  // lifecycle fixture; the separate headed project verifies a native hidden tab.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('#pause-reason')).toContainText('非表示');
  const stopped = await page.locator('#elapsed').textContent();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  expect(await page.locator('#elapsed').textContent()).toBe(stopped);
  await page.locator('#resume').click();
  await expect.poll(() => page.locator('#elapsed').textContent()).not.toBe(stopped);
});

test('sound starts OFF, pauses with flight and reuses one audio context after replay', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalAudioContext = window.AudioContext;
    window.AudioContext = class extends OriginalAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        const html = document.documentElement;
        html.dataset.audioContexts = String(Number(html.dataset.audioContexts ?? 0) + 1);
        this.addEventListener('statechange', () => { html.dataset.audioState = this.state; });
      }
    };
  });
  await start(page);
  await expect(page.locator('#hud [data-sound]')).toHaveText('音 OFF');
  expect(await page.locator('html').getAttribute('data-audio-contexts')).toBeNull();
  await page.locator('#hud [data-sound]').click();
  await expect(page.locator('#hud [data-sound]')).toHaveText('音 ON');
  await expect(page.locator('html')).toHaveAttribute('data-audio-contexts', '1');
  await expect(page.locator('html')).toHaveAttribute('data-audio-state', 'running');
  await page.locator('#pause').click(); await expect(page.locator('html')).toHaveAttribute('data-audio-state', 'suspended');
  await page.locator('#resume').click(); await expect(page.locator('html')).toHaveAttribute('data-audio-state', 'running');
  await page.locator('#pause').click(); await page.locator('#finish').click(); await page.locator('#restart').click();
  await expect(page.locator('#hud')).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-audio-contexts', '1');
  await page.locator('#hud [data-sound]').click(); await expect(page.locator('#hud [data-sound]')).toHaveText('音 OFF');
  await expect(page.locator('html')).toHaveAttribute('data-audio-state', 'suspended');
});
