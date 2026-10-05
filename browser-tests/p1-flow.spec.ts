import { expect, test, type Page } from '@playwright/test';

async function start(page: Page, mode = 'easy') {
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('radio', { name: mode === 'easy' ? /Easy/ : /Normal/ }).check(); await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
}

test('Normal keyboard flight, loop interruption, pause, settings, report and reflight use one operation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await start(page, 'normal'); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(4);
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
  await expect(page.locator('#result-details')).toContainText('破壊 0/100'); await expect(page.locator('#result-mode')).toContainText('Normal');
  await page.screenshot({ path: info.outputPath('flight-report.png') });
  await page.locator('#result-controls').click(); await page.locator('#control-editor-touch').click(); await expect(page.locator('#control-mode')).toBeEnabled(); await page.locator('#control-close').click();
  await page.locator('#restart').click(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'normal'); await expect(page.locator('#speed')).toHaveText('110 m/s');
  await page.locator('#pause').click(); await page.locator('#pause-home').click(); await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
  expect(errors).toEqual([]);
});

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
    await page.setViewportSize(viewport); await start(page); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(1);
    const rect = (await page.locator('#loop').boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.x).toBeGreaterThanOrEqual(7); expect(rect.y).toBeGreaterThanOrEqual(7);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 7); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 7);
  }
  await page.setViewportSize({ width: 393, height: 852 }); await start(page); await page.screenshot({ path: info.outputPath('easy-flight.png') });
  for (let repeat = 0; repeat < 10; repeat += 1) {
    await page.locator('#pause').click(); await page.locator('#finish').click(); await page.locator('#restart').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
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

test('an aborted combat report does not write a best record or make game API requests', async ({ page }) => {
  const requests: string[] = [], bestWrites: string[] = []; page.on('request', request => requests.push(request.url()));
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
  await start(page); await page.locator('#pause').click(); await page.locator('#finish').click(); await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-outcome')).toContainText('中断');
  await expect(page.locator('#result-best')).toContainText('勝利した作戦');
  expect(bestWrites).toEqual([]); expect(requests.every(url => new URL(url).origin === 'http://127.0.0.1:4177')).toBe(true);
  expect(requests.some(url => /supabase|ranking|ordnance|bomb-guide/.test(url))).toBe(false);
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
