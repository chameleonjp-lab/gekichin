import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

/** Native tab visibility requires a headed browser and a display (CI uses Xvfb). */
test('a native headed tab hides the flight, freezes its clock and requires explicit resume', async ({}, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), 'gekichin-native-visibility-'));
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let spawnError: Error | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;

  try {
    child = spawn(chromium.executablePath(), [
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1366,768',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ], { stdio: 'ignore' });
    childClosed = new Promise((resolve) => child?.once('close', () => resolve()));
    child.once('error', (error) => { spawnError = error; });

    // Connect to Chromium's native default context without Playwright's
    // default focus emulation. That lets document.hidden report actual tab
    // visibility instead of Playwright's simulated active-page state.
    const activePort = join(profile, 'DevToolsActivePort');
    let portText = '';
    const startupDeadline = Date.now() + 20000;
    while (!portText && Date.now() < startupDeadline) {
      if (spawnError) throw new Error(`Could not start headed Chromium: ${spawnError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Headed Chromium exited (code ${child.exitCode}, signal ${child.signalCode})`);
      try { portText = await readFile(activePort, 'utf8'); } catch { /* browser is still starting */ }
      if (!portText) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!portText) throw new Error('Headed Chromium did not publish DevToolsActivePort');
    const [port] = portText.trim().split('\n');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { isLocal: true, noDefaults: true });

    const context = browser.contexts()[0];
    if (!context) throw new Error('Headed Chromium has no default browser context');
    const page = context.pages()[0] ?? await context.newPage();
    const baseURL = String(testInfo.project.use.baseURL ?? 'http://127.0.0.1:4177');
    await page.goto(new URL('/', baseURL).href);
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }));
    testInfo.annotations.push({ type: 'native-browser', description: `${browser.version()}; viewport=${viewport.width}x${viewport.height}; DPR=${viewport.devicePixelRatio}` });
    await expect(page.locator('#start')).toBeEnabled();
    await page.locator('#start').click();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');

    const other = await context.newPage();
    await other.goto('about:blank');
    const browserCdp = await browser.newBrowserCDPSession();
    const targetInfo = async (target: typeof page) => {
      const session = await context.newCDPSession(target);
      try { return await session.send('Target.getTargetInfo'); }
      finally { await session.detach(); }
    };
    const [gameTarget, otherTarget] = await Promise.all([targetInfo(page), targetInfo(other)]);
    const gameWindow = await browserCdp.send('Browser.getWindowForTarget', { targetId: gameTarget.targetInfo.targetId });
    const otherWindow = await browserCdp.send('Browser.getWindowForTarget', { targetId: otherTarget.targetInfo.targetId });
    expect(otherWindow.windowId).toBe(gameWindow.windowId);

    await other.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
    const stopped = await page.locator('#elapsed').textContent();
    await page.waitForTimeout(600);
    expect(await page.locator('#elapsed').textContent()).toBe(stopped);
    await other.close();
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
    await page.waitForTimeout(250);
    expect(await page.locator('#elapsed').textContent()).toBe(stopped);
    await page.locator('#resume').click();
    await expect.poll(() => page.locator('#elapsed').textContent()).not.toBe(stopped);

    await browserCdp.detach();
  } finally {
    await browser?.close().catch(() => undefined);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const didExit = await Promise.race([
        childClosed?.then(() => true) ?? Promise.resolve(true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (!didExit && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await childClosed;
      }
    }
    await rm(profile, { recursive: true, force: true });
  }
});
