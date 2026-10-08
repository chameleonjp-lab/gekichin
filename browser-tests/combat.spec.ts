import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function startCombat(page: Page, mode: 'easy' | 'normal'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#app')).toHaveAttribute('data-renderer-ready', 'true');
  // Drive the public browser clock so software-WebGL contention cannot create
  // a real two-second foreground gap in this deterministic UI test.
  await page.clock.install({ time: new Date('2026-01-01T12:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:10.000Z'));
  await page.getByRole('radio', { name: mode === 'easy' ? /イージー/ : /ノーマル/ }).check();
  await page.locator('#start').click();
  await page.clock.runFor(500);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#app')).toHaveAttribute('data-mode', mode);
  await expect(page.locator('#hud')).toBeVisible();
}

function faceCounts(text: string | null): number {
  return Number(text?.split('/')[0].trim() ?? 'NaN');
}

async function reduceRendererCadence(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 250);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
  });
}

test('Easy combat clock, six-face HUD, pause and explicit resume follow product controls', async ({ page }) => {
  await startCombat(page, 'easy');
  await page.clock.runFor(1000);
  await expect.poll(async () => Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(30);

  const remaining = faceCounts(await page.locator('#main-left').textContent()) + faceCounts(await page.locator('#mg-left').textContent());
  expect(remaining).toBe(100);
  await expect(page.locator('#destroyed')).toHaveText('0 / 100');
  const faces = page.locator('#face-guide [data-face] b');
  await expect(faces).toHaveCount(6);
  expect((await faces.allTextContents()).map(Number).reduce((sum, count) => sum + count, 0)).toBe(100);

  await page.keyboard.press('Escape'); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  const tick = await page.locator('#app').getAttribute('data-tick');
  const elapsed = await page.locator('#elapsed').textContent();
  const destroyed = await page.locator('#destroyed').textContent();
  const lives = await page.locator('#fleet-left').textContent();
  await page.clock.runFor(400);
  expect(await page.locator('#app').getAttribute('data-tick')).toBe(tick);
  expect(await page.locator('#elapsed').textContent()).toBe(elapsed);
  expect(await page.locator('#destroyed').textContent()).toBe(destroyed);
  expect(await page.locator('#fleet-left').textContent()).toBe(lives);

  await page.locator('#resume').click(); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await page.clock.runFor(500);
  await expect.poll(async () => Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(Number(tick));
});

test('Normal keyboard firing consumes real ammunition and updates flight HUD, then pauses cleanly', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await startCombat(page, 'normal');
  const positionBefore = await page.locator('#hud').getAttribute('data-position');
  const ammunitionBefore = await page.locator('#ammunition').textContent();
  await page.keyboard.down('Space');
  await page.clock.runFor(20);
  await expect(page.locator('#fire-status')).toContainText('ON');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('w');
  await page.clock.runFor(700);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('w'); await page.keyboard.up('Space');
  await page.clock.runFor(20);
  await expect(page.locator('#fire-status')).toContainText('待機');
  const positionAfter = await page.locator('#hud').getAttribute('data-position');
  expect(positionAfter).not.toBe(positionBefore);
  expect(await page.locator('#ammunition').textContent()).not.toBe(ammunitionBefore);
  expect(Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(30);
  await page.screenshot({ path: info.outputPath('normal-combat-hud.png') });

  await page.keyboard.press('Escape'); await expect(page.locator('#paused')).toBeVisible();
  const stoppedTick = await page.locator('#app').getAttribute('data-tick');
  const stoppedScore = await page.locator('#score').textContent();
  await page.clock.runFor(250);
  expect(await page.locator('#app').getAttribute('data-tick')).toBe(stoppedTick);
  expect(await page.locator('#score').textContent()).toBe(stoppedScore);
  await page.locator('#resume').click(); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await page.clock.runFor(500);
  await expect.poll(async () => Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(Number(stoppedTick));
  expect(errors).toEqual([]);
});

test('ten product restart cycles retain one bounded scene and stable WebGL resources', async ({ page }) => {
  await startCombat(page, 'easy');
  // After shader prewarm and the first rendered flight frame, four RAFs per
  // virtual second keep the resource loop bounded while FixedStepper still
  // consumes every elapsed 60 Hz tick and never receives a 2 s gap.
  await reduceRendererCadence(page);
  // Let the initial rendered session finish any first-use shader compilation
  // before taking the resource baseline.
  await page.clock.runFor(2500);
  await expect.poll(async () => Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(120);
  await page.locator('#hud [data-sound]').click();
  await page.clock.runFor(250);
  await expect(page.locator('#hud [data-sound]')).toContainText('ON');
  await expect(page.locator('#app')).toHaveAttribute('data-audio-contexts', '1');
  await expect(page.locator('#app')).toHaveAttribute('data-audio-voices', '16');
  const canvas = page.locator('#flight-canvas');
  const keys = ['renderGeometries', 'renderTextures', 'renderPrograms'] as const;
  const bounded = ['renderParticles', 'renderDebris', 'renderWrecks'] as const;
  for (const key of [...keys, ...bounded] as const) await expect(canvas).toHaveAttribute(`data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, /^\d+$/);
  const readCounter = async (key: string): Promise<number> => Number(await canvas.getAttribute(
    `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`));
  const stable = Object.fromEntries(await Promise.all(keys.map(async key => [key, await readCounter(key)])));

  for (let repeat = 0; repeat < 10; repeat += 1) {
    await page.locator('#pause').click(); await page.locator('#finish').click();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'result');
    await page.locator('#restart').click();
    await page.clock.runFor(500);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
    await page.clock.runFor(2500);
    await expect.poll(async () => Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(30);
    await expect(page.locator('#flight-canvas')).toHaveCount(1);
    await expect(page.locator('#control-settings')).toHaveCount(1);
    for (const key of keys) expect(await readCounter(key), `${key} after restart ${repeat + 1}`).toBe(stable[key]);
    await expect(page.locator('#app')).toHaveAttribute('data-audio-contexts', '1');
    await expect(page.locator('#app')).toHaveAttribute('data-audio-voices', '16');
    expect(await readCounter('renderParticles')).toBeLessThanOrEqual(1024);
    expect(await readCounter('renderDebris')).toBeLessThanOrEqual(256);
    expect(await readCounter('renderWrecks')).toBeLessThanOrEqual(100);
  }
});

test('abort replaces the previous result display before the next rendered frame', async ({ page }) => {
  await startCombat(page, 'normal');
  await page.clock.runFor(500);
  await page.locator('#pause').click();
  const bestBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('gekichin-best-'))));
  // A display-only previous-report fixture. Combat state and the frozen report
  // are never injected; the actual Finish button must replace all stale fields.
  await page.evaluate(() => {
    document.querySelector('#result-outcome')!.textContent = '勝利 · 全100基撃沈';
    document.querySelector('#result-score')!.textContent = '160,000';
    document.querySelector('#result-details')!.textContent = '破壊 100/100';
  });
  await page.locator('#finish').click();
  // The public clock stays paused: an extra RAF cannot repair a stale result.
  const result = await page.evaluate(() => ({
    phase: document.querySelector<HTMLElement>('#app')!.dataset.phase,
    outcome: document.querySelector('#result-outcome')!.textContent,
    score: document.querySelector('#result-score')!.textContent,
    details: document.querySelector('#result-details')!.textContent,
    componentCount: document.querySelector('#result-components')!.children.length,
    best: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('gekichin-best-'))),
  }));
  expect(result.phase).toBe('result');
  expect(result.outcome).toBe('中断');
  expect(result.score).toBe('0');
  expect(result.details).toContain('破壊 0/100');
  expect(result.componentCount).toBe(12);
  expect(result.best).toEqual(bestBefore);
});

test('Normal sea contact clears held controls and respawns the player under new ownership', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await startCombat(page, 'normal');
  await reduceRendererCadence(page);

  const readFlightHud = () => page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app')!;
    const hud = document.querySelector<HTMLElement>('#hud')!;
    return {
      phase: app.dataset.phase ?? '',
      tick: Number(app.dataset.tick ?? 0),
      ownership: Number(app.dataset.ownership ?? -1),
      position: (hud.dataset.position ?? '').split(',').map(Number),
      pitch: Number(hud.dataset.pitch ?? Number.NaN),
      altitudeText: document.querySelector('#altitude')?.textContent?.trim() ?? '',
      playerHp: document.querySelector('#player-hp')?.textContent?.trim() ?? '',
      ammunition: document.querySelector('#ammunition')?.textContent?.trim() ?? '',
      respawn: document.querySelector<HTMLElement>('#respawn-status')?.textContent?.trim() ?? '',
      respawnVisible: !document.querySelector<HTMLElement>('#respawn-status')!.hidden,
      fire: document.querySelector('#fire-status')?.textContent?.trim() ?? '',
    };
  });

  const initial = await readFlightHud();
  expect(initial.playerHp).toBe('80.0 / 80');
  expect(initial.ammunition).toBe('288 / 96');

  // Keep both real product-bound keys physically down across loss and
  // respawn. The aircraft descends into the sea; no mission state is written.
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('Space');
  let virtualMs = 0;
  let loss: Awaited<ReturnType<typeof readFlightHud>> | null = null;
  while (virtualMs < 60_000) {
    await page.clock.runFor(250);
    virtualMs += 250;
    const observed = await readFlightHud();
    if (observed.playerHp === '復帰待ち') { loss = observed; break; }
  }
  expect(loss, 'held descent should reach the sea within the virtual-time cap').not.toBeNull();
  const lost = loss!;
  const lossAltitude = Number.parseInt(lost.altitudeText.replaceAll(',', ''), 10);
  expect(lossAltitude, `loss should be sea contact; HUD altitude was ${lost.altitudeText}`).toBeLessThanOrEqual(10);
  expect(lost.phase).toBe('playing');
  expect(lost.ownership).toBeGreaterThan(initial.ownership);
  expect(lost.respawnVisible).toBe(true);
  expect(lost.respawn).toContain('自機復帰');
  const countdown = Number(lost.respawn.match(/·\s([\d.]+)秒/)?.[1] ?? Number.NaN);
  expect(countdown).toBeGreaterThanOrEqual(2.5);
  expect(countdown).toBeLessThanOrEqual(3);

  const atLoss = virtualMs;
  await page.clock.runFor(1000);
  virtualMs += 1000;
  const duringWait = await readFlightHud();
  expect(duringWait.playerHp).toBe('復帰待ち');
  expect(duringWait.tick).toBeGreaterThan(lost.tick + 50);
  expect(duringWait.ownership).toBe(lost.ownership);
  expect(duringWait.respawnVisible).toBe(true);

  let respawned = duringWait;
  while (virtualMs < 60_000 && respawned.playerHp === '復帰待ち') {
    await page.clock.runFor(250);
    virtualMs += 250;
    respawned = await readFlightHud();
  }
  const observedWaitMs = virtualMs - atLoss;
  const observedWaitTicks = respawned.tick - lost.tick;
  expect(observedWaitMs).toBeGreaterThanOrEqual(2500);
  expect(observedWaitMs).toBeLessThanOrEqual(4000);
  expect(observedWaitTicks).toBeGreaterThanOrEqual(150);
  expect(observedWaitTicks).toBeLessThanOrEqual(210);
  expect(respawned.playerHp, 'the same player slot should return within the virtual-time cap').toBe('80.0 / 80');
  expect(respawned.ownership).toBeGreaterThan(lost.ownership);
  expect(respawned.ammunition).toBe('288 / 96');
  expect(respawned.respawnVisible).toBe(false);

  // Continue with the physical keys still down. The cleared input state must
  // not leak either the dive or firing into the new aircraft generation.
  await page.clock.runFor(500);
  virtualMs += 500;
  const afterRespawn = await readFlightHud();
  expect(afterRespawn.phase).toBe('playing');
  expect(afterRespawn.ownership).toBe(respawned.ownership);
  expect(afterRespawn.playerHp).toBe('80.0 / 80');
  expect(afterRespawn.ammunition).toBe('288 / 96');
  expect(afterRespawn.fire).toContain('待機');
  expect(Math.abs(afterRespawn.pitch)).toBeLessThan(0.05);
  expect(afterRespawn.position).toHaveLength(3);
  expect(afterRespawn.position.every(Number.isFinite)).toBe(true);
  expect(afterRespawn.position[1]).toBeGreaterThan(900);
  expect(Math.hypot(
    afterRespawn.position[0] - lost.position[0],
    afterRespawn.position[1] - lost.position[1],
    afterRespawn.position[2] - lost.position[2],
  )).toBeGreaterThan(500);
  expect(afterRespawn.tick).toBeGreaterThan(respawned.tick);

  await page.keyboard.up('ArrowDown');
  await page.keyboard.up('Space');
  await page.clock.runFor(250);
  virtualMs += 250;
  const screenshotPath = info.outputPath('normal-sea-loss-respawn.png');
  await page.screenshot({ path: screenshotPath });
  expect(errors).toEqual([]);
  const observationsPath = info.outputPath('normal-sea-loss-respawn-observations.json');
  await writeFile(observationsPath, JSON.stringify({
      input: ['trusted ArrowDown held', 'trusted Space held', 'released after fresh aircraft checks'],
      virtualFrameMs: 250,
      virtualElapsedMs: virtualMs,
      lossAfterVirtualMs: atLoss,
      respawnWaitMs: observedWaitMs,
      respawnWaitTicks: observedWaitTicks,
      startingTick: initial.tick,
      initialOwnership: initial.ownership,
      loss: lost,
      oneSecondIntoRespawnWait: duringWait,
      respawn: respawned,
      afterHeldKeyClearCheck: afterRespawn,
      browserErrors: errors,
    }, null, 2));
  await info.attach('normal-sea-loss-respawn-observations.json', {
    path: observationsPath,
    contentType: 'application/json',
  });
});
