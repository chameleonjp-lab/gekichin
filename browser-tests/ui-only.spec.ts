import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.use({ serviceWorkers: 'block' });

type ScreenState = 'home' | 'rules' | 'settings-touch' | 'settings-keyboard' | 'settings-conflict' | 'hud-dense'
  | 'hud-easy' | 'hud-normal' | 'notice-long' | 'preparing' | 'paused' | 'sinking'
  | 'settings-save-failure' | 'result-save-failure'
  | 'result-victory' | 'result-defeat' | 'result-mutual' | 'result-aborted' | 'webgl-unavailable' | 'webgl-unavailable-guidance';

const LONG_NOTICE = '主砲の予告を確認しました。操縦入力で射線を外し、僚機の残機と復帰状況を見ながら母艦の反対側へ回り込んでください。画面を閉じず、戦況の末尾まで確認できます。';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__gekichinUiOnly);
  await page.evaluate(() => window.__gekichinUiOnly!.showHome('easy'));
}

async function state(page: Page, name: keyof NonNullable<Window['__gekichinUiOnly']>, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(({ name, args }) => {
    const adapter = window.__gekichinUiOnly!;
    return (adapter[name] as (...values: unknown[]) => unknown)(...args);
  }, { name, args });
}

async function capture(page: Page, info: TestInfo, screen: ScreenState, mode: 'easy' | 'normal' | null, fontCondition = 'default browser text', displayFixture?: Record<string, unknown>): Promise<void> {
  const directory = info.outputPath('captures');
  await mkdir(directory, { recursive: true });
  const stem = screen + '-' + (mode ?? 'shared') + '-' + fontCondition.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const imagePath = join(directory, stem + '.png');
  const frame = await page.evaluate(async () => {
    const adapter = window.__gekichinUiOnly!;
    const fixture = adapter.inspect();
    const drawn = await adapter.drawStaticFrame(0);
    return { fixture, drawn, renderer: adapter.rendererStatus() };
  });
  if (mode !== null) expect(frame.fixture.mode).toBe(mode);
  expect(frame.drawn).toBe(frame.renderer.available && frame.renderer.ready);
  await page.screenshot({ path: imagePath, animations: 'disabled' });
  const metadata = {
    screen,
    mode: mode ?? frame.fixture.mode,
    modeScope: mode === null ? 'shared' : 'specific',
    phase: frame.fixture.phase,
    tick: frame.fixture.tick,
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    fontCondition,
    computedRootFontPx: await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize)),
    renderer: frame.renderer,
    fixedFrameDrawn: frame.drawn,
    displayFixture,
    evidenceKind: frame.drawn
      ? 'real Three.js WebGLRenderer frozen frame'
      : 'DOM fixture; real renderer unavailable',
  };
  await writeFile(join(directory, stem + '.json'), JSON.stringify(metadata, null, 2) + '\n');
  await info.attach(stem, { path: imagePath, contentType: 'image/png' });
  await info.attach(stem + '-metadata', { body: JSON.stringify(metadata, null, 2), contentType: 'application/json' });
}

async function expectWithinViewport(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(box, selector + ' has a visible box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectNoticeClearOfControls(page: Page, mode: 'easy' | 'normal' = 'normal', notices = ['#combat-notice']): Promise<void> {
  const controls = ['#game-sound', '#pause', '#fire', '#loop', '#throttle', '#face-toggle', '#combat-panel summary'];
  const boxes = await page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const element = document.querySelector<HTMLElement>(selector)!;
    const box = element.getBoundingClientRect();
    return [selector, element.getClientRects().length ? { x: box.x, y: box.y, width: box.width, height: box.height } : null];
  })), [...notices, ...controls]);
  for (const selector of mode === 'normal' ? controls : ['#game-sound', '#pause', '#loop', '#face-toggle', '#combat-panel summary']) {
    expect(boxes[selector], selector + ' is available during the HUD notice check').not.toBeNull();
  }
  for (const selector of notices) {
    const notice = boxes[selector];
    expect(notice, selector + ' has a layout box').not.toBeNull();
    for (const control of controls) {
      const box = boxes[control];
      if (!box) continue;
      const gap = 8;
      const separated = notice!.x + notice!.width + gap <= box.x
        || box.x + box.width + gap <= notice!.x
        || notice!.y + notice!.height + gap <= box.y
        || box.y + box.height + gap <= notice!.y;
      expect(separated, selector + ' stays at least 8px clear of ' + control).toBe(true);
    }
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    root: document.documentElement.scrollWidth > innerWidth,
    app: document.querySelector<HTMLElement>('#app')!.scrollWidth > document.querySelector<HTMLElement>('#app')!.clientWidth,
  }));
  expect(overflow, 'no horizontal overflow beyond the viewport or app').toEqual({ root: false, app: false });
}

async function expectAllResultComponents(page: Page): Promise<void> {
  await expect(page.locator('#result-components dt')).toHaveCount(6);
  await expect(page.locator('#result-components dd')).toHaveCount(6);
  for (const label of ['砲台破壊点', '実損傷点', '時間点（勝利時のみ）', '自機損失点', '僚機損失点', '命中率減点']) {
    await expect(page.locator('#result-components')).toContainText(label);
  }
}

test('393x852 portrait directly presents the product shell, mode HUDs, and all result states', async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await boot(page);
  await state(page, 'showHome', 'easy');
  await expect(page.locator('#home')).toBeVisible();
  await capture(page, info, 'home', null);
  await expect(page.locator('#home .mission-data')).toContainText('100');
  await expect(page.locator('#home .mission-data')).toContainText('主砲20・機銃80');
  await expect(page.locator('#home .mission-data')).toContainText('50');
  await expect(page.locator('#home .mission-data')).toContainText('自機を含む');
  await expect(page.locator('#home .mission-data')).toContainText('8');
  await expectNoHorizontalOverflow(page);

  await page.locator('#home-guide').click();
  await expect(page.getByRole('dialog', { name: 'ルールと操作方法' })).toBeVisible();
  await expect(page.locator('#guide-close')).toBeFocused();
  const guideBody = page.locator('.guide-content');
  await guideBody.focus();
  await page.keyboard.press('End');
  await expect.poll(() => guideBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await capture(page, info, 'rules', null);
  await page.locator('#guide-done').click();
  await expect(page.locator('#home-guide')).toBeFocused();
  await page.locator('#home-guide').click();
  await expect(page.locator('#guide')).toBeVisible();
  await page.locator('#guide-close').click();
  await expect(page.locator('#home-guide')).toBeFocused();

  await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-editor-touch').click();
  await expect(page.locator('#control-editor-touch')).toHaveAttribute('aria-pressed', 'true');
  await capture(page, info, 'settings-touch', null);
  await page.locator('#control-mode').selectOption('normal');
  await page.locator('#control-close').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#control-save')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#control-close')).toBeFocused();
  const conflict = await state(page, 'forceSettingsConflict') as { visible: boolean; text: string };
  expect(conflict.visible).toBe(true);
  expect(conflict.text).toContain('配置できません');
  await page.locator('#control-storage-note').scrollIntoViewIfNeeded();
  await capture(page, info, 'settings-conflict', null);
  await page.locator('#control-editor-keyboard').click();
  await expect(page.locator('#control-editor-keyboard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-key-action]')).toHaveCount(9);
  await page.locator('.settings-main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('#keyboard-reset').scrollIntoViewIfNeeded();
  await expect(page.locator('#keyboard-reset')).toBeVisible();
  await capture(page, info, 'settings-keyboard', null);
  await page.locator('#control-cancel').click();
  await expect(page.locator('#home-controls')).toBeFocused();
  await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-cancel').click();
  await expect(page.locator('#home-controls')).toBeFocused();

  await state(page, 'showPreparing', 'normal');
  await expect(page.locator('#preparing')).toBeVisible();
  await capture(page, info, 'preparing', 'normal');
  await page.locator('#cancel-preparing').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'home');
  await state(page, 'showPaused', 'normal');
  await expect(page.locator('#paused')).toBeVisible();
  await capture(page, info, 'paused', 'normal');
  await page.locator('#paused [data-guide]').click();
  await expect(page.locator('#guide')).toBeVisible();
  await page.locator('#guide-close').click();
  await expect(page.locator('#paused [data-guide]')).toBeFocused();
  await page.locator('#pause-controls').click();
  await expect(page.locator('#control-mode')).toBeDisabled();
  await page.locator('#control-cancel').click();
  await expect(page.locator('#pause-controls')).toBeFocused();

  await state(page, 'showHud', 'easy', false);
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud-mode')).toHaveText('イージー');
  await expect(page.locator('#destroyed')).toHaveText('0 / 100');
  await expect(page.locator('#main-left')).toHaveText('20 / 20');
  await expect(page.locator('#mg-left')).toHaveText('80 / 80');
  await expect(page.locator('#fleet-left')).toHaveText('50');
  await expect(page.locator('#fleet-active')).toHaveText('8 / 42');
  await expect(page.locator('#elapsed')).toHaveText('00:00.00');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await expect(page.locator('#face-guide')).toBeHidden();
  await expect(page.locator('#face-toggle')).toHaveAttribute('aria-pressed', 'false');
  for (const selector of ['#player-hp', '#health-bar', '#fleet-left', '#mg-ammo', '#cannon-ammo', '#reload', '#altitude', '#speed', '#score']) {
    await expect(page.locator(selector)).toBeVisible();
  }
  await expect(page.locator('#face-guide [data-face]')).toHaveCount(6);
  const faceTotal = await page.locator('#face-guide [data-face] b').evaluateAll(items => items.reduce((sum, item) => sum + Number(item.textContent), 0));
  expect(faceTotal).toBe(100);
  await expect(page.locator('#fire')).toBeHidden();
  await expect(page.locator('#throttle')).toBeHidden();
  await expect(page.locator('#loop')).toBeVisible();
  await capture(page, info, 'hud-easy', 'easy');

  await state(page, 'showHud', 'normal', false);
  await expect(page.locator('#hud-mode')).toHaveText('ノーマル');
  await expect(page.locator('#speed')).toHaveText('396 km/h');
  await expect(page.locator('#fire')).toBeVisible();
  await expect(page.locator('#loop')).toBeVisible();
  await expect(page.locator('#throttle')).toBeVisible();
  await expect(page.locator('#accuracy')).toHaveText('— 未射撃');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await capture(page, info, 'hud-normal', 'normal');
  await page.locator('#combat-panel summary').click();
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await expect(page.locator('.combat-reading-note')).toContainText('戦闘・作戦時計は進行中');
  await expect(page.locator('#app')).toHaveAttribute('data-reading-combat', 'true');
  await expect(page.locator('#target-status')).toBeVisible();
  await page.locator('#hit-breakdown').scrollIntoViewIfNeeded();
  await expect(page.locator('#hit-breakdown')).toBeVisible();
  await expect(page.locator('#face-guide [data-face]')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.locator('#combat-panel summary')).toBeFocused();
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await expect(page.locator('#app')).toHaveAttribute('data-reading-combat', 'false');

  const shortNotice = '主砲予告 1基 · 射線から離脱';
  await state(page, 'showNotice', shortNotice, 'normal', false);
  await expect(page.locator('#combat-notice')).toHaveText(shortNotice);
  await state(page, 'showNotice', LONG_NOTICE, 'normal', false);
  await expect(page.locator('#combat-notice')).toHaveText(LONG_NOTICE);
  await expectNoticeClearOfControls(page);
  await capture(page, info, 'notice-long', 'normal');

  await state(page, 'showResult', 'easy', 'victory', false);
  await expect(page.locator('#sinking')).toBeVisible();
  await expect(page.locator('#result-components dt')).toHaveCount(6);
  await capture(page, info, 'sinking', 'easy');
  await page.locator('#skip-sinking').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-outcome')).toContainText('勝利');
  await expectAllResultComponents(page);
  await expect(page.locator('#result-details')).toContainText('破壊 100/100');
  await expect(page.locator('#result-details')).toContainText('/20');
  await expect(page.locator('#result-details')).toContainText('/80');
  await expect(page.locator('#result-details')).toContainText('損失：自機');
  await expect(page.locator('#result-details')).toContainText('H/N：103/150');
  await expect(page.locator('#result-best')).toContainText('端末内ベスト');
  await capture(page, info, 'result-victory', 'easy');

  for (const outcome of ['defeat', 'mutual'] as const) {
    await state(page, 'showResult', 'normal', outcome, false);
    await expect(page.locator('#result')).toBeVisible();
    await expectAllResultComponents(page);
    await expect(page.locator('#result-details')).toContainText('/100');
    await expect(page.locator('#result-details')).toContainText('/20');
    await expect(page.locator('#result-details')).toContainText('/80');
    await expect(page.locator('#result-details')).toContainText('損失：自機');
    await expect(page.locator('#result-details')).toContainText('H/N：');
    await expect(page.locator('#result-best')).toBeVisible();
    await capture(page, info, outcome === 'defeat' ? 'result-defeat' : 'result-mutual', 'normal');
  }

  await state(page, 'showPaused', 'normal');
  await page.locator('#finish').click();
  await expect(page.locator('#result-outcome')).toHaveText('中断');
  await expectAllResultComponents(page);
  await expect(page.locator('#result-details')).toContainText('破壊 0/100');
  await expect(page.locator('#result-details')).toContainText('H/N：0/0');
  await expect(page.locator('#result-best')).toBeVisible();
  await capture(page, info, 'result-aborted', 'normal');
  await page.locator('#result-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-cancel').click();
  await expect(page.locator('#result-controls')).toBeFocused();
  const resultGuide = page.locator('#result [data-guide]');
  await resultGuide.click();
  await expect(page.locator('#guide')).toBeVisible();
  await page.locator('#guide-close').click();
  await expect(resultGuide).toBeFocused();
  await page.locator('#result-home').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'home');
  const rendererAvailable = await page.evaluate(() => window.__gekichinUiOnly!.rendererStatus().available);
  if (rendererAvailable) await expect(page.locator('#start')).toBeFocused();
  else {
    await expect(page.locator('#start')).toBeDisabled();
    await expect(page.locator('#home')).toBeVisible();
  }
});

test('852x393 landscape captures representative shared screens and preserves reachable controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 852, height: 393 });
  await boot(page);
  await state(page, 'showHome', 'easy');
  await capture(page, info, 'home', null);
  await page.locator('#home-guide').click();
  await expect(page.locator('#guide')).toBeVisible();
  await capture(page, info, 'rules', null);
  await page.locator('#guide-done').click();
  await page.locator('#home-controls').click();
  await page.locator('#control-editor-touch').click();
  await capture(page, info, 'settings-touch', null);
  await page.locator('#control-editor-keyboard').click();
  await capture(page, info, 'settings-keyboard', null);
  await page.locator('#control-cancel').click();
  await state(page, 'showHud', 'normal', false);
  await expect(page.locator('#hud-mode')).toHaveText('ノーマル');
  await capture(page, info, 'hud-normal', 'normal');
  await state(page, 'showNotice', LONG_NOTICE, 'normal', false);
  await expect(page.locator('#combat-notice')).toHaveText(LONG_NOTICE);
  await expectNoticeClearOfControls(page);
  await capture(page, info, 'notice-long', 'normal');
  await page.locator('#combat-panel summary').click();
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await page.locator('#hit-breakdown').scrollIntoViewIfNeeded();
  await expect(page.locator('#hit-breakdown')).toBeVisible();
  await state(page, 'showResult', 'normal', 'defeat', false);
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#result-home').scrollIntoViewIfNeeded();
  await expectWithinViewport(page, '#result-home');
  await capture(page, info, 'result-defeat', 'normal');
  await expectNoHorizontalOverflow(page);
});

test('small, landscape, desktop, and computed 200 percent text retain screen geometry and control access', async ({ page }) => {
  await boot(page);
  const viewports = [
    { width: 320, height: 568 },
    { width: 568, height: 320 },
    { width: 1440, height: 900 },
    { width: 393, height: 852 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await state(page, 'showHome', 'easy');
    await page.locator('#start').scrollIntoViewIfNeeded();
    await expectWithinViewport(page, '#start');
    await page.locator('#home-controls').scrollIntoViewIfNeeded();
    await expectWithinViewport(page, '#home-controls');
    await expectNoHorizontalOverflow(page);

    await state(page, 'showHud', 'normal', false);
    for (const selector of ['#pause', '#fire', '#loop', '#throttle']) {
      await expect(page.locator(selector)).toBeVisible();
      await expectWithinViewport(page, selector);
    }
    await expectNoHorizontalOverflow(page);

    await state(page, 'showHome', 'normal');
    await page.locator('#home-controls').click();
    await expectWithinViewport(page, '#control-close');
    await page.locator('#control-editor-keyboard').click();
    await page.locator('.settings-main').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.locator('#keyboard-reset').scrollIntoViewIfNeeded();
    await expect(page.locator('#keyboard-reset')).toBeVisible();
    await expectWithinViewport(page, '#control-save');
    await page.locator('#control-cancel').click();

    await state(page, 'showResult', 'normal', 'defeat', false);
    await page.locator('#result-home').scrollIntoViewIfNeeded();
    await expectWithinViewport(page, '#result-home');
    await expectNoHorizontalOverflow(page);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
  await expect(page.locator('#app')).toHaveAttribute('data-large-text', 'true');
  await state(page, 'showHome', 'easy');
  await page.locator('#start').scrollIntoViewIfNeeded();
  await expectWithinViewport(page, '#start');
  await state(page, 'showHud', 'normal', false);
  for (const selector of ['#pause', '#fire', '#loop', '#throttle']) await expectWithinViewport(page, selector);
  await state(page, 'showHome', 'normal');
  await page.locator('#home-controls').click();
  await page.locator('#control-editor-keyboard').click();
  await page.locator('.settings-main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('#keyboard-reset').scrollIntoViewIfNeeded();
  await expect(page.locator('#keyboard-reset')).toBeVisible();
  await expectWithinViewport(page, '#control-save');
  await page.locator('#control-cancel').click();
  await state(page, 'showResult', 'normal', 'defeat', false);
  await page.locator('#result-home').scrollIntoViewIfNeeded();
  await expectWithinViewport(page, '#result-home');
});

test('HUD choices persist through a new sortie and resizing never opens the combat details', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await boot(page);
  await state(page, 'showHud', 'normal', false);
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await expect(page.locator('#face-guide')).toBeHidden();
  await expect(page.locator('#target-status')).toBeHidden();

  await page.locator('#face-toggle').click();
  await expect(page.locator('#face-guide')).toBeVisible();
  await expect(page.locator('#face-toggle')).toHaveAttribute('aria-pressed', 'true');
  await state(page, 'showHome', 'normal');
  await state(page, 'showHud', 'normal', false);
  await expect(page.locator('#face-guide')).toBeVisible();
  await expect(page.locator('#target-status')).toBeHidden();

  for (const viewport of [{ width: 852, height: 393 }, { width: 1366, height: 768 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
    await expect(page.locator('#face-guide')).toBeVisible();
    await expect(page.locator('#target-status')).toBeHidden();
  }

  await page.locator('#combat-panel summary').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await expect(page.locator('#flight-surface')).toHaveJSProperty('inert', true);
  for (const selector of ['#fire', '#loop', '#throttle']) await expect(page.locator(selector)).toHaveJSProperty('inert', true);
  await page.keyboard.press('Space');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await expect(page.locator('#flight-surface')).toHaveJSProperty('inert', false);
  expect(await page.evaluate(() => window.__gekichinUiOnly!.inspectInput().keys)).toEqual([]);
  await page.keyboard.press('Space');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await expect(page.locator('#hit-breakdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await expect(page.locator('#combat-panel summary')).toBeFocused();
  await expect(page.locator('#flight-surface')).toHaveJSProperty('inert', false);
  for (const selector of ['#fire', '#loop', '#throttle']) await expect(page.locator(selector)).toHaveJSProperty('inert', false);
});

test('HUD toggles release held flight input and combat reading blocks new steering and fire until it closes', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await boot(page);
  await state(page, 'showHud', 'normal', false);
  const input = () => page.evaluate(() => window.__gekichinUiOnly!.inspectInput());
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  expect((await input()).keys).toEqual(expect.arrayContaining(['ArrowRight', 'Space']));
  await page.locator('#face-toggle').click();
  expect((await input()).keys).toEqual([]);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await expect(page.locator('#joystick')).toBeHidden();

  // A second pointer can open a HUD control while steering is still held.
  await page.locator('#flight-surface').dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: 195, clientY: 400 });
  await page.locator('#flight-surface').dispatchEvent('pointermove', { pointerId: 41, pointerType: 'touch', buttons: 1, clientX: 230, clientY: 400 });
  expect((await input()).turn).toBeGreaterThan(0);
  await page.locator('#combat-panel summary').click();
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await expect.poll(async () => (await input()).steerPointer).toBeNull();
  expect((await input()).turn).toBe(0);
  expect((await input()).climb).toBe(0);
  await expect(page.locator('#joystick')).toBeHidden();
  await expect(page.locator('#flight-surface')).toHaveJSProperty('inert', true);
  await page.locator('#combat-panel .combat-metrics').focus();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  await page.keyboard.press('L');
  await page.locator('#flight-surface').dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: 195, clientY: 400 });
  expect((await input()).keys).toEqual([]);
  expect((await input()).steerPointer).toBeNull();
  for (const pointers of Object.values((await input()).heldPointers)) expect(pointers).toEqual([]);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await expect(page.locator('#flight-surface')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#combat-panel summary')).toBeFocused();
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
  await page.keyboard.down('ArrowRight');
  expect((await input()).keys).toContain('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Space');
  expect((await input()).keys).toEqual(expect.arrayContaining(['ArrowRight', 'Space']));
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Space');
  await page.locator('#combat-panel summary').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
});

test('both modes keep essential flight information and HUD toggles reachable at small sizes and 200 percent text', async ({ page }, info) => {
  await boot(page);
  for (const fontSize of ['100%', '200%']) {
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = fontSize; }, fontSize);
    for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }, { width: 852, height: 393 }]) {
      await page.setViewportSize(viewport);
      for (const mode of ['easy', 'normal'] as const) {
        await state(page, 'showHud', mode, false);
        const fixtureBefore = await state(page, 'inspect');
        // This is a display fixture only: no HP, score, flight, or combat state
        // is injected into the simulation, and its frozen tick must stay intact.
        await page.evaluate(() => {
          document.querySelector('#score')!.textContent = '148,000';
          document.querySelector('#reload')!.textContent = '復帰待ち';
          document.querySelector('#combat-notice')!.textContent = '';
          for (const selector of ['#respawn-status', '#boundary-status']) {
            const notice = document.querySelector<HTMLElement>(selector)!;
            notice.textContent = ''; notice.hidden = true;
          }
        });
        expect(await state(page, 'inspect')).toEqual(fixtureBefore);
        await expect(page.locator('#combat-panel')).toHaveJSProperty('open', false);
        for (const selector of ['#elapsed', '#destroyed', '#player-hp', '#mg-ammo', '#cannon-ammo', '#reload', '#fleet-left', '#altitude', '#speed', '#score']) {
          await expect(page.locator(selector)).toBeVisible();
          await expectWithinViewport(page, selector);
        }
        for (const selector of ['#game-sound', '#pause', '#face-toggle', '#combat-panel summary']) {
          await expectWithinViewport(page, selector);
          const box = await page.locator(selector).boundingBox();
          expect(box!.width, selector + ' minimum tap width').toBeGreaterThanOrEqual(44);
          expect(box!.height, selector + ' minimum tap height').toBeGreaterThanOrEqual(44);
        }
        await page.locator('#face-toggle').click();
        await expect(page.locator('#face-guide')).toBeVisible();
        await expectWithinViewport(page, '#face-guide');
        const dataBox = await page.locator('.flight-data').boundingBox();
        const faceBox = await page.locator('#face-guide').boundingBox();
        const flightControls = mode === 'easy' ? ['#loop'] : ['#fire', '#loop', '#throttle'];
        for (const selector of flightControls) {
          await expect(page.locator(selector)).toBeVisible();
          await expectWithinViewport(page, selector);
          const box = await page.locator(selector).boundingBox();
          const separated = dataBox!.x + dataBox!.width <= box!.x
            || box!.x + box!.width <= dataBox!.x
            || dataBox!.y + dataBox!.height <= box!.y
            || box!.y + box!.height <= dataBox!.y;
          expect(separated, '.flight-data remains clear of ' + selector).toBe(true);
          const facesSeparated = faceBox!.x + faceBox!.width <= box!.x
            || box!.x + box!.width <= faceBox!.x
            || faceBox!.y + faceBox!.height <= box!.y
            || box!.y + box!.height <= faceBox!.y;
          expect(facesSeparated, 'visible .face-guide remains clear of ' + selector).toBe(true);
        }
        await expectNoHorizontalOverflow(page);
        await page.evaluate(() => {
          document.querySelector('#player-hp-value')!.textContent = '復帰待ち';
          document.querySelector('#player-hp-max')!.textContent = '';
          document.querySelector<HTMLElement>('#player-hp-max')!.hidden = true;
          document.querySelector<HTMLElement>('#health-bar')!.style.width = '0%';
        });
        await expect(page.locator('#player-hp')).toHaveText('復帰待ち');
        await expectWithinViewport(page, '#player-hp');
        const fixtureAfter = await state(page, 'inspect');
        expect(fixtureAfter).toEqual(fixtureBefore);
        let criticalNotices: Record<string, string> | null = null;
        if (fontSize === '200%' && viewport.width === 320) {
          const main = ['主砲予告 1基 · 射線から離脱', '主砲予告 1基・射線回避'];
          const boundary = ['← 左へ 帰還 · 戻らないと7秒で機体損失', '←左へ・帰還・7秒で機体損失'];
          const respawn = ['自機復帰 · 1.0秒', '自機復帰・1.0秒'];
          // These combinations can coexist in the product, including when the
          // retained camera is outside the boundary while no player is alive.
          const stacks: Array<Record<string, string[]>> = [
            { '#combat-notice': main },
            { '#combat-notice': main, '#boundary-status': boundary },
            { '#combat-notice': main, '#respawn-status': respawn },
            { '#combat-notice': main, '#respawn-status': respawn, '#boundary-status': boundary },
            { '#combat-notice': main, '#respawn-status': ['僚機へ引継ぎ · 3.0秒', '僚機へ引継ぎ・3.0秒'], '#boundary-status': boundary },
            { '#combat-notice': main, '#respawn-status': ['出撃回廊の空きを待機', '出撃回廊の空きを待機'], '#boundary-status': boundary },
          ];
          for (const stack of stacks) {
            const sources = Object.fromEntries(Object.entries(stack).map(([selector, values]) => [selector, values[0]]));
            criticalNotices = Object.fromEntries(Object.entries(stack).map(([selector, values]) => [selector, values[1]]));
            await page.evaluate(messages => {
              for (const selector of ['#combat-notice', '#respawn-status', '#boundary-status']) {
                const notice = document.querySelector<HTMLElement>(selector)!;
                notice.textContent = messages[selector] ?? ''; notice.hidden = !(selector in messages);
              }
              window.dispatchEvent(new Event('resize'));
            }, sources);
            for (const [selector, text] of Object.entries(criticalNotices)) {
              await expect(page.locator(selector)).toHaveText(text);
              await expectWithinViewport(page, selector);
            }
            await expectWithinViewport(page, '.hud-alerts');
            await expectNoticeClearOfControls(page, mode, Object.keys(criticalNotices));
            expect(await state(page, 'inspect')).toEqual(fixtureBefore);
          }
          // Restoring the full source on resize does not advance any logical
          // state or change the selected display settings.
          await page.setViewportSize({ width: 393, height: 852 });
          await expect(page.locator('#combat-notice')).toHaveText(main[0]);
          await expect(page.locator('#boundary-status')).toHaveText(boundary[0]);
          await page.setViewportSize(viewport);
          await expect(page.locator('#combat-notice')).toHaveText(main[1]);
          await expect(page.locator('#boundary-status')).toHaveText(boundary[1]);
          expect(await state(page, 'inspect')).toEqual(fixtureBefore);
        }
        if (fontSize === '200%' && (viewport.width === 320 || viewport.width === 568)) {
          const logicalStateAfter = await state(page, 'inspect');
          expect(logicalStateAfter).toEqual(fixtureBefore);
          await capture(page, info, 'hud-dense', mode, `200 percent text at ${viewport.width}x${viewport.height}; DOM display fixture`, {
            overrides: { score: '148,000', reload: '復帰待ち', playerHp: '復帰待ち', healthBar: '0%', faceGuide: 'on', criticalNotices },
            logicalStateUnchanged: true,
            logicalStateBefore: fixtureBefore,
            logicalStateAfter,
          });
        }
        await page.locator('#combat-panel summary').click();
        await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
        await expectWithinViewport(page, '#combat-details');
        await page.locator('#combat-close').scrollIntoViewIfNeeded();
        await expectWithinViewport(page, '#combat-close');
        await page.locator('#combat-close').click();
        await expect(page.locator('#combat-panel summary')).toBeFocused();
        await page.locator('#face-toggle').click();
        await expect(page.locator('#face-guide')).toBeHidden();
      }
    }
  }
});

test('settings storage failure, session-only use, and result save failure are visible', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value: function (this: Storage, key: string, value: string) {
        if (key.startsWith('gekichin-')) throw new DOMException('quota exceeded', 'QuotaExceededError');
        return Reflect.apply(original, this, [key, value]);
      },
    });
  });
  await boot(page);
  await page.locator('#home-controls').click();
  await page.locator('#control-editor-touch').click();
  await page.locator('#control-x').evaluate(element => {
    const input = element as HTMLInputElement;
    input.value = '85';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#control-save').click();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  await expect(page.locator('#control-storage-note')).toContainText('設定を保存できませんでした');
  await page.locator('#control-storage-note').scrollIntoViewIfNeeded();
  await capture(page, info, 'settings-save-failure', null);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gekichin-')))).toEqual([]);
  await page.locator('#control-save').click();
  await expect(page.locator('#control-settings')).toBeHidden();
  await expect(page.locator('#home-controls')).toBeFocused();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gekichin-')))).toEqual([]);

  await state(page, 'showResult', 'easy', 'victory', false);
  await page.locator('#skip-sinking').click();
  await expect(page.locator('#save-status')).toContainText('保存できませんでした');
  await capture(page, info, 'result-save-failure', 'easy');

});

test('initial WebGL failure uses the product guidance while rules and settings remain usable', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await boot(page);
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#render-note')).toContainText('3D描画を開始できません');
  await capture(page, info, 'webgl-unavailable', null);
  await page.locator('#render-note').scrollIntoViewIfNeeded();
  await expect(page.locator('#render-note')).toBeInViewport();
  await capture(page, info, 'webgl-unavailable-guidance', null);
  await page.locator('#home-guide').click();
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('#guide [data-graphics-status]')).toContainText('確認できます');
  await page.locator('#guide-done').click();
  await expect(page.locator('#home-guide')).toBeFocused();
  await page.locator('#home-controls').click();
  for (const editor of ['touch', 'keyboard']) {
    await page.locator('#control-editor-' + editor).click();
    await expect(page.locator('#control-editor-' + editor)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#control-cancel').click();
  await expect(page.locator('#home-controls')).toBeFocused();
  await expect(page.locator('#start')).toBeDisabled();
});
