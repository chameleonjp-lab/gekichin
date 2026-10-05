import { expect, test, type Page } from '@playwright/test';

async function startCombat(page: Page, mode: 'easy' | 'normal'): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#app')).toHaveAttribute('data-renderer-ready', 'true');
  await page.clock.install({ time: new Date('2026-01-01T12:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:10.000Z'));
  await page.getByRole('radio', { name: mode === 'easy' ? /Easy/ : /Normal/ }).check();
  await page.locator('#start').click();
  await page.clock.runFor(500);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#app')).toHaveAttribute('data-mode', mode);
  await reduceRendererCadence(page);
}

async function reduceRendererCadence(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 250);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
  });
}

function readSpeed(page: Page): Promise<number> {
  return page.locator('#speed').textContent().then(text => Number.parseFloat(text ?? ''));
}

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('Normal lever retains its target, clears on controls pause, and Easy keeps cruise', async ({ page }) => {
  await startCombat(page, 'normal');
  await expect(page.locator('#throttle')).toBeVisible();
  await expect(page.locator('#accelerate')).toHaveCount(0);
  await expect(page.locator('#brake')).toHaveCount(0);
  await page.locator('#flight-surface').focus();

  const lever = await page.locator('#throttle').boundingBox();
  expect(lever).not.toBeNull();
  const centerX = lever!.x + lever!.width / 2;
  const highY = lever!.y + 22;
  const initialSpeed = await readSpeed(page);
  await page.mouse.move(centerX, highY);
  await page.mouse.down();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '100');
  await page.clock.runFor(750);
  const heldSpeed = await readSpeed(page);
  expect(heldSpeed).toBeGreaterThan(initialSpeed + 1);

  await page.mouse.up();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');
  await page.clock.runFor(500);
  expect(await readSpeed(page), 'releasing the lever keeps the adjusted target speed').toBeGreaterThan(heldSpeed);

  // Keep a fresh lever command held while pausing; pause/settings must clear
  // the live input before the same operation is resumed.
  await page.mouse.move(centerX, highY);
  await page.mouse.down();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#throttle')).not.toHaveClass(/is-pressed/);
  await page.mouse.up();
  const pausedTick = await page.locator('#app').getAttribute('data-tick');
  const pausedSpeed = await readSpeed(page);

  await page.locator('#pause-controls').click();
  await page.locator('#control-editor-touch').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');
  await page.locator('#control-cancel').click();
  await expect(page.locator('#resume')).toBeVisible();
  await page.clock.runFor(500);
  expect(await page.locator('#app').getAttribute('data-tick')).toBe(pausedTick);
  expect(await readSpeed(page)).toBe(pausedSpeed);
  await page.locator('#resume').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await page.clock.runFor(250);
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');

  await page.locator('#pause').click();
  await page.locator('#pause-home').click();
  await page.getByRole('radio', { name: /Easy/ }).check();
  await page.locator('#start').click();
  await page.clock.runFor(500);
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'easy');
  await expect(page.locator('#throttle')).toBeHidden();
  await expect(page.locator('#speed')).toHaveText('110 m/s');
  await page.locator('#flight-surface').focus();
  await page.keyboard.down('w');
  await page.clock.runFor(1000);
  await page.keyboard.up('w');
  await expect(page.locator('#speed')).toHaveText('110 m/s');
});

test('Normal sea-loss clears a held lever and steering key; a fresh focused throttle command works after respawn', async ({ page }) => {
  await startCombat(page, 'normal');
  const initialOwnership = Number(await page.locator('#app').getAttribute('data-ownership'));
  await page.locator('#flight-surface').focus();
  await page.keyboard.down('ArrowDown');
  const lever = await page.locator('#throttle').boundingBox();
  expect(lever).not.toBeNull();
  await page.mouse.move(lever!.x + lever!.width / 2, lever!.y + 22);
  await page.mouse.down();
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '100');

  let virtualMs = 0;
  let lost: { ownership: number; altitude: number; hp: string } | null = null;
  while (virtualMs < 60_000) {
    await page.clock.runFor(250);
    virtualMs += 250;
    const observation = await page.evaluate(() => ({
      ownership: Number(document.querySelector<HTMLElement>('#app')?.dataset.ownership ?? -1),
      altitude: Number.parseInt(document.querySelector('#altitude')?.textContent?.replaceAll(',', '') ?? 'NaN', 10),
      hp: document.querySelector('#player-hp')?.textContent?.trim() ?? '',
    }));
    if (observation.hp === '復帰待ち') { lost = observation; break; }
  }
  expect(lost, 'held descent should cause a real sea contact without changing HP directly').not.toBeNull();
  expect(lost!.altitude).toBeLessThanOrEqual(10);
  expect(lost!.ownership).toBeGreaterThan(initialOwnership);
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');

  let recovered = false;
  while (virtualMs < 60_000 && !recovered) {
    await page.clock.runFor(250);
    virtualMs += 250;
    recovered = (await page.locator('#player-hp').textContent())?.trim() === '80.0 / 80';
  }
  expect(recovered, 'normal operation should return the lost player through the production respawn').toBe(true);
  await page.clock.runFor(500);
  expect(await page.locator('#app').getAttribute('data-phase')).toBe('playing');
  expect(await page.locator('#player-hp').textContent()).toBe('80.0 / 80');
  expect(await page.locator('#altitude').textContent()).not.toBe('0 m');
  expect(await page.locator('#speed').textContent()).toBe('110 m/s');
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');

  await page.keyboard.up('ArrowDown');
  await page.mouse.up();
  await page.locator('#flight-surface').focus();
  const recoveredSpeed = await readSpeed(page);
  expect(recoveredSpeed).toBe(110);
  await page.locator('#throttle').focus();
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '100');
  await page.clock.runFor(250);
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');
  await page.clock.runFor(1500);
  expect(await readSpeed(page), 'a fresh post-respawn keyboard pulse should raise target speed').toBeGreaterThan(recoveredSpeed);
  await page.clock.runFor(250);
  await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow', '0');
});

test('large-text landscape throttle placement stays clear of real controls and matches the saved preview', async ({ page }) => {
  const candidate = {
    version: 2,
    controls: {
      fire: { x: 0.83, y: 0.84, size: 96, opacity: 0.9 },
      loop: { x: 0.83, y: 0.66, size: 72, opacity: 0.78 },
      throttle: { x: 0.56, y: 0.75, size: 64, opacity: 0.82 },
    },
  };
  await page.setViewportSize({ width: 568, height: 320 });
  await page.addInitScript(layout => localStorage.setItem('gekichin-controls-v2', JSON.stringify(layout)), candidate);
  await page.goto('/');
  await page.getByRole('radio', { name: /Normal/ }).check();
  await page.locator('#home-controls').click();
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-mode').selectOption('normal');
  await page.locator('#control-target').selectOption('throttle');
  await expect(page.locator('.preview-control[data-control="throttle"]')).toBeVisible();
  await expect(page.locator('.preview-control[data-control="throttle"]')).not.toHaveAttribute('aria-disabled', 'true');

  const readPreview = () => page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#control-preview')!;
    const rootRect = root.getBoundingClientRect();
    const bounds = (selector: string) => {
      const rect = root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
        cx: (rect.x + rect.width / 2 - rootRect.x) / rootRect.width,
        cy: (rect.y + rect.height / 2 - rootRect.y) / rootRect.height,
        width: rect.width / rootRect.width, height: rect.height / rootRect.height };
    };
    return { throttle: bounds('[data-control="throttle"]'), fire: bounds('[data-control="fire"]'), loop: bounds('[data-control="loop"]') };
  });
  const previewAt100 = await readPreview();
  const overlaps = (a: { x: number; y: number; right: number; bottom: number }, b: { x: number; y: number; right: number; bottom: number }) =>
    a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;

  // Change text size while the settings editor is already open. Its preview
  // must remeasure the real 200% generic-control boxes, including loop/fire.
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.locator('#app')).toHaveAttribute('data-large-text', 'true');
  await expect(page.locator('.preview-control[data-control="throttle"]')).not.toHaveAttribute('aria-disabled', 'true');
  const preview = await readPreview();
  expect(Math.abs(preview.throttle.cx - previewAt100.throttle.cx) + Math.abs(preview.throttle.cy - previewAt100.throttle.cy))
    .toBeGreaterThan(0.02);
  expect(overlaps(preview.throttle, preview.fire), '200% preview lever must not overlap the actual-layout fire peer').toBe(false);
  expect(overlaps(preview.throttle, preview.loop), '200% preview lever must not overlap the actual-layout loop peer').toBe(false);

  // Persist a real editor transaction so the preview and production layout
  // are both driven by the same v2 settings entry.
  await setRange(page, '#control-opacity', '81');
  await page.locator('#control-save').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gekichin-controls-v2') ?? 'null'));
  expect(saved.version).toBe(2);
  expect(saved.controls.throttle.opacity).toBe(0.81);

  await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  const actual = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app')!;
    const appRect = app.getBoundingClientRect();
    const bounds = (selector: string) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
        cx: (rect.x + rect.width / 2 - appRect.x) / appRect.width,
        cy: (rect.y + rect.height / 2 - appRect.y) / appRect.height,
        width: rect.width / appRect.width, height: rect.height / appRect.height };
    };
    return {
      app: { x: appRect.x, y: appRect.y, right: appRect.right, bottom: appRect.bottom },
      throttle: bounds('#throttle'), fire: bounds('#fire'), loop: bounds('#loop'),
      utilities: [...document.querySelectorAll<HTMLElement>('#hud .hud-utility button, #combat-panel summary')]
        .filter(element => !element.hidden && element.getBoundingClientRect().width > 0)
        .map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }; }),
      blocked: document.querySelector<HTMLElement>('#throttle')!.getAttribute('aria-disabled'),
    };
  });
  expect(actual.blocked).toBe('false');
  expect(actual.throttle.x).toBeGreaterThanOrEqual(actual.app.x);
  expect(actual.throttle.y).toBeGreaterThanOrEqual(actual.app.y);
  expect(actual.throttle.right).toBeLessThanOrEqual(actual.app.right);
  expect(actual.throttle.bottom).toBeLessThanOrEqual(actual.app.bottom);
  expect(overlaps(actual.throttle, actual.fire)).toBe(false);
  expect(overlaps(actual.throttle, actual.loop)).toBe(false);
  for (const utility of actual.utilities) expect(overlaps(actual.throttle, utility)).toBe(false);
  expect(Math.abs(actual.throttle.cx - preview.throttle.cx)).toBeLessThan(0.02);
  expect(Math.abs(actual.throttle.cy - preview.throttle.cy)).toBeLessThan(0.02);
  expect(Math.abs(actual.throttle.width - preview.throttle.width)).toBeLessThan(0.02);
  expect(Math.abs(actual.throttle.height - preview.throttle.height)).toBeLessThan(0.02);
  expect(Math.abs(actual.fire.cx - preview.fire.cx)).toBeLessThan(0.02);
  expect(Math.abs(actual.fire.cy - preview.fire.cy)).toBeLessThan(0.02);
  expect(Math.abs(actual.fire.width - preview.fire.width)).toBeLessThan(0.02);
  expect(Math.abs(actual.fire.height - preview.fire.height)).toBeLessThan(0.02);
  expect(Math.abs(actual.loop.cx - preview.loop.cx)).toBeLessThan(0.02);
  expect(Math.abs(actual.loop.cy - preview.loop.cy)).toBeLessThan(0.02);
  expect(Math.abs(actual.loop.width - preview.loop.width)).toBeLessThan(0.02);
  expect(Math.abs(actual.loop.height - preview.loop.height)).toBeLessThan(0.02);
});
