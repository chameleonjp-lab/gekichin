import { expect, test, type Page } from '@playwright/test';

async function home(page: Page) {
  await page.goto('/');
  await expect(page.locator('#home-controls')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'home');
}
async function editor(page: Page, method: 'touch' | 'keyboard' = 'touch') {
  await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator(`#control-editor-${method}`).click();
}
async function range(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((element, next) => {
    (element as HTMLInputElement).value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('nine keyboard actions reject duplicate, reserved, modifier and IME input; draft and focus are transactional', async ({ page }) => {
  await home(page); await editor(page, 'keyboard');
  await expect(page.locator('[data-key-action]')).toHaveCount(9);
  const left = page.locator('[data-key-action="left"]');
  await left.click(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#keyboard-capture-note')).toContainText('使用中');
  await page.keyboard.press('Control+q');
  await expect(page.locator('#keyboard-capture-note')).toContainText('ブラウザ操作用');
  await left.dispatchEvent('keydown', { code: 'F5', key: 'F5', bubbles: true });
  await expect(page.locator('#keyboard-capture-note')).toContainText('別のキー');
  await left.dispatchEvent('keydown', { code: 'KeyQ', key: 'Process', isComposing: true, bubbles: true });
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('q'); await expect(left).toHaveText('Q');
  expect(await page.evaluate(() => localStorage.getItem('gekichin-keyboard-v1'))).toBeNull();
  await page.locator('#control-close').click(); await expect(page.locator('#home-controls')).toBeFocused();
  await editor(page, 'keyboard'); await expect(left).toHaveText('←');
  await left.click(); await page.keyboard.press('q'); await page.locator('#control-save').click();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('gekichin-keyboard-v1')))!)).toMatchObject({ version: 1, bindings: { left: 'KeyQ' } });
  await expect(page.locator('#home-key-guide')).toContainText('Q 左旋回');
  await page.reload(); await expect(page.locator('#home-key-guide')).toContainText('Q 左旋回');
  await editor(page, 'keyboard');
  await page.locator('#control-close').focus(); await page.keyboard.press('Shift+Tab'); await expect(page.locator('#control-save')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#control-close')).toBeFocused();
  await left.click(); await page.keyboard.press('Escape'); await expect(page.locator('#control-settings')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#control-settings')).not.toBeVisible();
  await expect(page.locator('#home-controls')).toBeFocused();
});

test('home editors offer both modes and persist touch size, opacity and placement only after save', async ({ page }) => {
  await home(page); await editor(page); await expect(page.locator('#control-mode')).toBeEnabled();
  await page.locator('#control-mode').selectOption('normal'); await expect(page.locator('#control-target option:not([hidden])')).toHaveCount(3);
  await range(page, '#control-x', 55); await range(page, '#control-size', 100); await range(page, '#control-opacity', 65);
  expect(await page.locator('#fire').evaluate(element => element.style.getPropertyValue('--control-size'))).toBe('96px');
  await page.locator('#control-cancel').click(); expect(await page.evaluate(() => localStorage.getItem('gekichin-controls-v2'))).toBeNull();
  await editor(page); await page.locator('#control-mode').selectOption('normal');
  await range(page, '#control-x', 55); await range(page, '#control-size', 100); await range(page, '#control-opacity', 65);
  await page.locator('#control-mode').selectOption('easy'); await expect(page.locator('#control-target option:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#control-target')).toBeDisabled(); await range(page, '#control-x', 60); await page.locator('#control-save').click();
  const saved = await page.evaluate(() => [localStorage.getItem('gekichin-controls-v2'), localStorage.getItem('gekichin-controls-easy-v2')]);
  expect(JSON.parse(saved[0]!)).toMatchObject({ version: 2, controls: { fire: { x: .55, size: 100, opacity: .65 } } });
  expect(JSON.parse(saved[1]!)).toMatchObject({ version: 2, controls: { loop: { x: .6 } } });
  await page.reload(); await expect(page.locator('#home-controls')).toBeVisible();
  expect(await page.locator('#loop').evaluate(element => element.style.getPropertyValue('--control-x'))).toBe('60%');
  await page.getByRole('radio', { name: /ノーマル/ }).check();
  expect(await page.locator('#fire').evaluate(element => element.style.getPropertyValue('--control-size'))).toBe('100px');
  expect(await page.locator('#fire').evaluate(element => element.style.getPropertyValue('--control-opacity'))).toBe('0.65');
});

test('a multi-key save failure rolls back and only explicit session use changes active settings', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gekichin-controls-v1', JSON.stringify({ version: 1, controls: {} }));
    localStorage.setItem('gekichin-controls-easy-v1', JSON.stringify({ version: 1, controls: {} }));
    const original = Storage.prototype.setItem; let writes = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('gekichin-') && ++writes === 3) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await home(page); await editor(page);
  const old = await page.evaluate(() => [localStorage.getItem('gekichin-controls-v1'), localStorage.getItem('gekichin-controls-easy-v1')]);
  await page.locator('#control-mode').selectOption('normal'); await range(page, '#control-x', 55);
  await page.locator('#control-mode').selectOption('easy'); await range(page, '#control-x', 60); await page.locator('#control-save').click();
  await expect(page.locator('#control-storage-note')).toContainText('保存できませんでした'); await expect(page.locator('#control-save')).toHaveText('今回だけ使う');
  expect(await page.evaluate(() => [localStorage.getItem('gekichin-controls-v1'), localStorage.getItem('gekichin-controls-easy-v1')])).toEqual(old);
  expect(await page.locator('#loop').evaluate(element => element.style.getPropertyValue('--control-x'))).toBe('83%');
  await page.locator('#control-save').click(); await expect(page.locator('#control-settings')).not.toBeVisible();
  expect(await page.locator('#loop').evaluate(element => element.style.getPropertyValue('--control-x'))).toBe('60%');
  expect(await page.evaluate(() => [localStorage.getItem('gekichin-controls-v1'), localStorage.getItem('gekichin-controls-easy-v1')])).toEqual(old);
});

test('future-version values are never downgraded and failed drafts can be cancelled', async ({ page }) => {
  const future = '{"version":9,"controls":{"futureSetting":true}}';
  await page.addInitScript(value => localStorage.setItem('gekichin-controls-v1', value), future);
  await home(page); await editor(page); await page.locator('#control-mode').selectOption('normal');
  await range(page, '#control-x', 55); await page.locator('#control-save').click();
  await expect(page.locator('#control-save')).toHaveText('今回だけ使う'); expect(await page.evaluate(() => localStorage.getItem('gekichin-controls-v1'))).toBe(future);
  await page.locator('#control-cancel').click(); await editor(page); await page.locator('#control-mode').selectOption('normal');
  await expect(page.locator('#control-x')).toHaveValue('83');
  await range(page, '#control-x', 55); await page.locator('#control-save').click(); await page.locator('#control-save').click();
  await page.getByRole('radio', { name: /ノーマル/ }).check();
  expect(await page.locator('#fire').evaluate(element => parseFloat(element.style.getPropertyValue('--control-x')))).toBeCloseTo(55);
  expect(await page.evaluate(() => localStorage.getItem('gekichin-controls-v1'))).toBe(future);
});

test('home, settings and guide stay reachable at all required viewports and 200 percent text', async ({ page }, info) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }, { width: 852, height: 393 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport); await home(page); await editor(page, 'keyboard');
    const rect = (await page.locator('#control-settings').boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.locator('[data-key-action="pause"]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-key-action="pause"]')).toBeVisible();
    await page.locator('#control-save').click(); await page.locator('#home-guide').click(); await expect(page.locator('#guide')).toBeVisible();
    await page.locator('#guide-done').click(); await expect(page.locator('#home-guide')).toBeFocused();
  }
  await page.setViewportSize({ width: 393, height: 852 }); await home(page);
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await editor(page, 'keyboard'); await page.locator('[data-key-action="pause"]').scrollIntoViewIfNeeded(); await expect(page.locator('[data-key-action="pause"]')).toBeVisible();
  await page.locator('#control-close').click(); await page.evaluate(() => document.documentElement.style.fontSize = '');
  await editor(page); await page.screenshot({ path: info.outputPath('touch-editor.png') });
});
