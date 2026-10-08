import { expect, test, type Page } from '@playwright/test';
import { guardStaticTraffic } from './network-policy';

test.use({ serviceWorkers: 'block' });

// Reuse the existing prewarmed public-clock approach. No gameplay state is injected.
async function preparedHome(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00.000Z') });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  let ready = false;
  for (let frame = 0; frame < 100 && !ready; frame += 1) {
    await page.clock.runFor(100);
    ready = (await page.locator('#app').getAttribute('data-renderer-ready')) === 'true';
  }
  expect(ready).toBe(true);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 60_000)));
}

for (const mode of ['easy', 'normal'] as const) {
  test(`${mode}: common shell follows real start, pause, abort, restart and home actions`, async ({ page, context, baseURL }) => {
    const blocked = await guardStaticTraffic(context, baseURL!);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await preparedHome(page);
    const label = mode === 'easy' ? 'イージー' : 'ノーマル';
    await page.getByRole('radio', { name: new RegExp(label) }).check();
    for (const text of ['100', '主砲20・機銃80', '50', '自機を含む', '8', '残機があれば復帰']) await expect(page.locator('#home .mission-data')).toContainText(text);
    await page.getByRole('button', { name: 'ルールと操作方法', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'ルールと操作方法' })).toBeVisible();
    await expect(page.locator('#guide-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(page.locator('#guide-done')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.locator('#guide-close')).toBeFocused();
    await page.getByRole('region', { name: 'ルールと操作方法の本文' }).focus();
    await page.keyboard.press('End');
    await page.getByRole('button', { name: '元の画面へ戻る' }).click();
    await expect(page.locator('#home-guide')).toBeFocused();
    await page.locator('#home-controls').click();
    await expect(page.locator('#control-mode')).toBeEnabled();
    await page.locator('#control-editor-keyboard').click(); await expect(page.locator('[data-key-action]')).toHaveCount(9);
    await page.locator('#control-editor-touch').click(); await page.locator('#control-cancel').click();
    await expect(page.locator('#home-controls')).toBeFocused();
    await page.locator('#home-controls').click(); await page.locator('#control-save').click();
    await page.getByRole('button', { name: '出撃する', exact: true }).click();
    await page.clock.runFor(100);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('#hud-mode')).toHaveText(label);
    await expect(page.locator('[data-flight-control]:visible')).toHaveCount(mode === 'normal' ? 3 : 1);
    await page.locator('#pause').click(); await expect(page.locator('#pause-title')).toHaveText('一時停止');
    const tick = await page.locator('#app').getAttribute('data-tick');
    await page.locator('#paused [data-guide]').click(); await page.locator('#guide-done').click();
    await expect(page.locator('#paused [data-guide]')).toBeFocused();
    await page.locator('#pause-controls').click(); await expect(page.locator('#control-mode')).toBeDisabled();
    await expect(page.locator('#control-mode')).toHaveValue(mode); await page.locator('#control-cancel').click();
    await page.clock.runFor(500);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
    expect(await page.locator('#app').getAttribute('data-tick')).toBe(tick);
    await page.getByRole('button', { name: '飛行を再開', exact: true }).click(); await page.clock.runFor(100);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
    const bestBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('gekichin-best-'))));
    await page.locator('#pause').click(); await page.getByRole('button', { name: '作戦を中断する' }).click();
    await expect(page.locator('#result-outcome')).toHaveText('中断');
    await expect(page.locator('#result-mode')).toContainText(label);
    await expect(page.locator('#result-components dt')).toHaveCount(6);
    for (const text of ['主砲', '/20', '機銃', '/80', '自機', '僚機', '損失', '砲台命中 H/N', '有効命中']) await expect(page.locator('#result-details')).toContainText(text);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('gekichin-best-'))))).toEqual(bestBefore);
    await page.locator('#result-controls').click(); await expect(page.locator('#control-mode')).toBeEnabled(); await page.locator('#control-close').click();
    await page.locator('#result [data-guide]').click(); await page.locator('#guide-close').click();
    await page.getByRole('button', { name: 'もう一度出撃' }).click(); await page.clock.runFor(100);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('#app')).toHaveAttribute('data-mode', mode);
    await page.locator('#pause').click(); await page.locator('#pause-home').click();
    await expect(page.getByRole('radio', { name: new RegExp(label) })).toBeChecked();
    expect(errors).toEqual([]); expect(blocked).toEqual([]);
  });
}

test('sound labels express an action on Home and state with accessible action elsewhere', async ({ page, context, baseURL }) => {
  const blocked = await guardStaticTraffic(context, baseURL!);
  await preparedHome(page);
  await expect(page.locator('#home-sound')).toHaveText('音をオンにする');
  await expect(page.locator('#home-sound')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#home-sound').click();
  await expect(page.locator('#home-sound')).toHaveText('音をオフにする');
  for (const item of await page.locator('[data-sound]').all()) {
    await expect(item).toHaveAttribute('aria-label', '音をオフにする');
    await expect(item).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#start').click(); await page.clock.runFor(100);
  await expect(page.locator('#hud [data-sound]')).toHaveText('音 ON');
  await page.locator('#hud [data-sound]').click();
  await expect(page.locator('#hud [data-sound]')).toHaveText('音 OFF');
  await expect(page.locator('#home-sound')).toHaveText('音をオンにする');
  for (const item of await page.locator('[data-sound]').all()) {
    await expect(item).toHaveAttribute('aria-label', '音をオンにする');
    await expect(item).toHaveAttribute('aria-pressed', 'false');
  }
  expect(blocked).toEqual([]);
});

test('initial WebGL failure keeps Home rules and both settings editors available', async ({ page, context, baseURL }) => {
  const blocked = await guardStaticTraffic(context, baseURL!);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto('/'); await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#render-note')).toContainText('3D描画を開始できません');
  await page.locator('#home-guide').click(); await expect(page.locator('#guide')).toBeVisible(); await page.locator('#guide-done').click();
  await page.locator('#home-controls').click();
  for (const editor of ['touch', 'keyboard']) {
    await page.locator(`#control-editor-${editor}`).click(); await expect(page.locator(`#control-editor-${editor}`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#control-cancel').click(); await expect(page.locator('#home-controls')).toBeFocused();
  await expect(page.locator('#start')).toBeDisabled(); expect(blocked).toEqual([]);
});
