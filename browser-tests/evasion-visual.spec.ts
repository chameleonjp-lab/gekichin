import { expect, test } from '@playwright/test';

test('normal product camera shows a main-gun warning and an ordinary turn', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('radio', { name: /Normal/ }).check();
  await page.locator('#start').click();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'normal');

  // This capture uses the untouched product start and ordinary controls. It is
  // visual evidence of the warning/turn presentation only, not a 100-turret clear.
  await expect(page.locator('#combat-notice')).toContainText('主砲予告', { timeout: 35_000 });
  const warningTick = Number(await page.locator('#app').getAttribute('data-tick'));
  const beforeTurn = await page.locator('#hud').getAttribute('data-position');
  await page.screenshot({ path: info.outputPath('main-warning-normal-camera.png') });

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => await page.locator('#hud').getAttribute('data-position'), { timeout: 1500 }).not.toBe(beforeTurn);
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const afterTurn = await page.locator('#hud').getAttribute('data-position');
  expect(afterTurn).not.toBe(beforeTurn);
  await page.screenshot({ path: info.outputPath('main-warning-after-turn-normal-camera.png') });
  expect(Number(await page.locator('#app').getAttribute('data-tick'))).toBeGreaterThan(warningTick);
  expect(errors).toEqual([]);
});
