import { expect, test, type Page } from '@playwright/test';

const app = 'http://127.0.0.1:4177/';

async function openFlight(page: Page): Promise<void> {
  await page.goto(app);
  await expect(page.locator('#start')).toBeEnabled();
}

test('a pause binding on Enter leaves home and result button activation with native Enter', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gekichin-keyboard-v1', JSON.stringify({
      version: 1,
      bindings: {
        left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
        fire: 'Space', loop: 'KeyL', accelerate: 'KeyW', brake: 'KeyS', pause: 'Enter',
      },
    }));
  });
  await openFlight(page);

  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');

  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  await page.locator('#finish').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'result');

  await page.locator('#restart').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
});

test('an event-loop stall of at least two seconds freezes the flight until explicit resume', async ({ page }) => {
  await openFlight(page);
  await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await expect.poll(async () => Number.parseFloat(await page.locator('#elapsed').innerText())).toBeGreaterThan(0);

  await page.evaluate(() => {
    const until = performance.now() + 2_100;
    while (performance.now() < until) { /* Deliberately suspend this tab's event loop. */ }
  });
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('#pause-reason')).toContainText('2秒以上');
  const frozenTime = await page.locator('#elapsed').innerText();
  await page.waitForTimeout(300);
  await expect(page.locator('#elapsed')).toHaveText(frozenTime);

  await page.locator('#resume').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await expect.poll(async () => Number.parseFloat(await page.locator('#elapsed').innerText())).toBeGreaterThan(Number.parseFloat(frozenTime));
});

test('when WebGL creation fails, settings and help remain available while flight stays disabled', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return getContext.call(this, type as never, ...args as never[]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto(app);

  await expect(page.locator('#render-note')).toContainText('この環境では3D描画を開始できません');
  await expect(page.locator('#start')).toBeDisabled();
  await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();
  await page.locator('#control-cancel').click();
  await page.locator('#home-guide').click();
  await expect(page.locator('#guide')).toBeVisible();
  await page.locator('#guide-done').click();
  await expect(page.locator('#guide')).toBeHidden();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'home');
});
