import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.use({ serviceWorkers: 'block' });

type ScreenState = 'home' | 'rules' | 'settings-touch' | 'settings-keyboard' | 'settings-conflict'
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

async function capture(page: Page, info: TestInfo, screen: ScreenState, mode: 'easy' | 'normal' | null, fontCondition = 'default browser text'): Promise<void> {
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

async function expectNoticeClearOfControls(page: Page): Promise<void> {
  const notice = await page.locator('#combat-notice').boundingBox();
  expect(notice, 'long combat notice has a layout box').not.toBeNull();
  for (const selector of ['#pause', '#fire', '#loop', '#throttle']) {
    await expect(page.locator(selector), selector + ' is available during the normal HUD notice check').toBeVisible();
  }
  for (const selector of ['#pause', '#fire', '#loop', '#throttle', '#combat-panel summary']) {
    const control = page.locator(selector);
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box, selector + ' has a layout box').not.toBeNull();
    const gap = 8;
    const separated = notice!.x + notice!.width + gap <= box!.x
      || box!.x + box!.width + gap <= notice!.x
      || notice!.y + notice!.height + gap <= box!.y
      || box!.y + box!.height + gap <= notice!.y;
    expect(separated, '#combat-notice stays at least 8px clear of ' + selector).toBe(true);
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
  await expect(page.locator('#face-guide [data-face]')).toHaveCount(6);
  const faceTotal = await page.locator('#face-guide [data-face] b').evaluateAll(items => items.reduce((sum, item) => sum + Number(item.textContent), 0));
  expect(faceTotal).toBe(100);
  await expect(page.locator('#fire')).toBeHidden();
  await expect(page.locator('#throttle')).toBeHidden();
  await expect(page.locator('#loop')).toBeVisible();
  await capture(page, info, 'hud-easy', 'easy');

  await state(page, 'showHud', 'normal', false);
  await expect(page.locator('#hud-mode')).toHaveText('ノーマル');
  await expect(page.locator('#fire')).toBeVisible();
  await expect(page.locator('#loop')).toBeVisible();
  await expect(page.locator('#throttle')).toBeVisible();
  await expect(page.locator('#accuracy')).toHaveText('— 未射撃');
  await expect(page.locator('#combat-panel')).toHaveJSProperty('open', true);
  await page.locator('#hit-breakdown').scrollIntoViewIfNeeded();
  await expect(page.locator('#hit-breakdown')).toBeVisible();
  await expect(page.locator('#face-guide [data-face]')).toHaveCount(6);
  await capture(page, info, 'hud-normal', 'normal');

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
