import { expect, test } from '@playwright/test';

/** Native tab visibility requires a display (CI uses Xvfb), not headless emulation. */
test('a native headed tab hides the flight, freezes its clock and requires explicit resume', async ({ page, context }) => {
  await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').click(); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  const other = await context.newPage();
  await other.goto('about:blank'); await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  const stopped = await page.locator('#elapsed').textContent();
  await other.close(); await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  expect(await page.locator('#elapsed').textContent()).toBe(stopped);
  await page.locator('#resume').click();
  await expect.poll(() => page.locator('#elapsed').textContent()).not.toBe(stopped);
});
