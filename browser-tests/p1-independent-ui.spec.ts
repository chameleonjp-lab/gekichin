import { expect, test, type Page } from '@playwright/test';

const app = 'http://127.0.0.1:4177/';

async function openHome(page: Page): Promise<void> {
  await page.goto(app);
  await expect(page.locator('#home')).toBeVisible();
}

test('touch preview controls fit their scroller and Gekichin settings leave other games storage untouched', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => {
    const foreign = {
      'kaisen-controls-v1': JSON.stringify({ version: 1, controls: {
        fire: { x: 0.2, y: 0.3, size: 88, opacity: 0.9 },
        loop: { x: 0.12, y: 0.33, size: 56, opacity: 0.88 },
        accelerate: { x: 0.7, y: 0.3, size: 76, opacity: 0.82 },
        brake: { x: 0.7, y: 0.66, size: 76, opacity: 0.82 },
      } }),
      'kaisen-keyboard-v1': JSON.stringify({ version: 1, bindings: {
        left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', fire: 'KeyF', loop: 'KeyL',
        accelerate: 'KeyQ', brake: 'KeyE', pause: 'KeyP',
      } }),
      'faitofuraito-controls-v1': 'foreign-settings-sentinel-normal',
      'faitofuraito-controls-easy-v1': 'foreign-settings-sentinel-easy',
      'faitofuraito-keyboard-v1': 'foreign-settings-sentinel-keyboard',
    };
    for (const [key, value] of Object.entries(foreign)) localStorage.setItem(key, value);
  });
  await openHome(page);

  const foreignBefore = await page.evaluate(() => Object.fromEntries(
    ['kaisen-controls-v1', 'kaisen-controls-easy-v1', 'kaisen-keyboard-v1',
      'faitofuraito-controls-v1', 'faitofuraito-controls-easy-v1', 'faitofuraito-keyboard-v1']
      .map(key => [key, localStorage.getItem(key)]),
  ));
  await expect(page.locator('#home-key-guide')).toContainText('Esc 一時停止・再開');
  await page.locator('#home-controls').tap();
  await expect(page.locator('#control-mode')).toHaveValue('easy');
  await expect(page.locator('.preview-control[data-control="loop"]')).toBeVisible();
  for (const name of ['fire', 'throttle']) {
    await expect(page.locator(`.preview-control[data-control="${name}"]`)).toBeHidden();
  }

  const preview = page.locator('#control-preview');
  await preview.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const box = await preview.boundingBox();
    return Boolean(box && box.height > 0);
  }).toBe(true);
  await page.locator('#control-mode').selectOption('normal');
  await expect(page.locator('.preview-control:not([hidden])')).toHaveCount(3);

  const geometry = await page.evaluate(() => {
    const region = document.querySelector('#control-settings .settings-main')!.getBoundingClientRect();
    const previewBox = document.querySelector('#control-preview')!.getBoundingClientRect();
    const appWidth = document.querySelector('#app')!.getBoundingClientRect().width;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.preview-control:not([hidden])')).map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, name: element.dataset.control };
    });
    return { region: { x: region.x, y: region.y, right: region.right, bottom: region.bottom },
      preview: { x: previewBox.x, y: previewBox.y, right: previewBox.right, bottom: previewBox.bottom, width: previewBox.width },
      appWidth, controls };
  });
  expect(geometry.preview.x).toBeGreaterThanOrEqual(geometry.region.x - 1);
  expect(geometry.preview.y).toBeGreaterThanOrEqual(geometry.region.y - 1);
  expect(geometry.preview.right).toBeLessThanOrEqual(geometry.region.right + 1);
  expect(geometry.preview.bottom).toBeLessThanOrEqual(geometry.region.bottom + 1);
  const baseSizes: Record<string, number> = { fire: 96, loop: 72, throttle: 64 };
  for (const control of geometry.controls) {
    expect(control.width, `${control.name} preview diameter`).toBeGreaterThan(0);
    expect(Math.abs(control.width - baseSizes[control.name!] * geometry.preview.width / geometry.appWidth),
      `${control.name} preview diameter should match its scaled 1:1 touch placement`).toBeLessThan(0.75);
    expect(control.x).toBeGreaterThanOrEqual(geometry.preview.x - 1);
    expect(control.y).toBeGreaterThanOrEqual(geometry.preview.y - 1);
    expect(control.right).toBeLessThanOrEqual(geometry.preview.right + 1);
    expect(control.bottom).toBeLessThanOrEqual(geometry.preview.bottom + 1);
  }

  await page.locator('#control-mode').selectOption('easy');
  await page.locator('#control-x').evaluate((input: HTMLInputElement) => {
    input.value = '70'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#control-save').click();
  const storage = await page.evaluate(() => ({
    foreign: Object.fromEntries(['kaisen-controls-v1', 'kaisen-controls-easy-v1', 'kaisen-keyboard-v1',
      'faitofuraito-controls-v1', 'faitofuraito-controls-easy-v1', 'faitofuraito-keyboard-v1']
      .map(key => [key, localStorage.getItem(key)])),
    gekichin: JSON.parse(localStorage.getItem('gekichin-controls-easy-v2') ?? 'null'),
  }));
  expect(storage.foreign).toEqual(foreignBefore);
  expect(storage.gekichin.version).toBe(2);
  expect(storage.gekichin.controls.loop.x).toBe(0.7);
});
