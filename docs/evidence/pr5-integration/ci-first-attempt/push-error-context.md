# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p1-flow.spec.ts >> Easy one button fits specified viewports and ten repeated starts never duplicate app resources
- Location: browser-tests/p1-flow.spec.ts:51:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('#app')
Expected: "playing"
Received: "paused"
Timeout:  15000ms

Call log:
  - Expect "toHaveAttribute" with timeout 15000ms
  - waiting for locator('#app')
    34 × locator resolved to <div id="app" data-tick="1" data-mode="easy" data-ownership="0" data-phase="paused" data-operation-id="1" data-audio-voices="0" data-seed="1196097537" data-large-text="false" data-audio-contexts="0" data-compact-hud="false" data-destroyed-count="0" data-friendly-bullets="4" data-enemy-mg-bullets="0" data-audio-active="false" data-presentation="paused" data-audio-max-voices="16" data-audio-enabled="false" data-renderer-ready="true" data-enemy-main-bullets="0" data-destroyed-turret-ids="" data-enemy-…>…</div>
       - unexpected value "paused"

```

```yaml
- img "航空機と六面の砲台を持つ超大型母艦の戦闘画面"
- region "停止中":
  - paragraph: PAUSED
  - heading "停止中" [level=2]
  - paragraph: 処理が2秒以上停止したため戦闘を止めました。明示的に再開してください。
  - button "作戦を再開する"
  - button "操作設定"
  - button "遊び方"
  - button "音 OFF"
  - button "作戦を中断する"
  - button "ホームへ戻る"
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | 
  3   | async function start(page: Page, mode = 'easy') {
  4   |   await page.goto('/'); await expect(page.locator('#start')).toBeEnabled();
  5   |   await page.getByRole('radio', { name: mode === 'easy' ? /Easy/ : /Normal/ }).check(); await page.locator('#start').click();
> 6   |   await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
      |                                      ^ Error: expect(locator).toHaveAttribute(expected) failed
  7   | }
  8   | 
  9   | test('Normal keyboard flight, loop interruption, pause, settings, report and reflight use one operation', async ({ page }, info) => {
  10  |   const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  11  |   await start(page, 'normal'); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(3);
  12  |   await page.keyboard.down('w'); await expect.poll(async () => Number((await page.locator('#speed').textContent())!.split(' ')[0])).toBeGreaterThan(115); await page.keyboard.up('w');
  13  |   await page.keyboard.down('Space'); await expect(page.locator('#fire-status')).toContainText('ON');
  14  |   await page.keyboard.up('Space'); await expect(page.locator('#fire-status')).toContainText('待機');
  15  |   await page.keyboard.press('l'); await expect(page.locator('#loop-status')).toHaveText('実行中');
  16  |   await page.keyboard.down('ArrowRight'); await expect(page.locator('#loop-status')).not.toHaveText('実行中'); await page.keyboard.up('ArrowRight');
  17  |   await page.screenshot({ path: info.outputPath('normal-flight.png') });
  18  |   await page.keyboard.press('Escape'); await expect(page.locator('#paused')).toBeVisible();
  19  |   const elapsed = await page.locator('#elapsed').textContent(); await page.locator('#pause-controls').click(); await page.locator('#control-editor-touch').click();
  20  |   await expect(page.locator('#control-mode')).toBeDisabled(); await expect(page.locator('#control-mode')).toHaveValue('normal');
  21  |   await page.keyboard.press('Escape'); await expect(page.locator('#pause-controls')).toBeFocused(); expect(await page.locator('#elapsed').textContent()).toBe(elapsed);
  22  |   await page.locator('#resume').click(); await expect.poll(() => page.locator('#elapsed').textContent()).not.toBe(elapsed);
  23  |   await page.locator('#pause').click(); await page.locator('#finish').click(); await expect(page.locator('#result')).toBeVisible();
  24  |   await expect(page.locator('#result-outcome')).toContainText('中断');
  25  |   await expect(page.locator('#result-details')).toContainText('破壊 0/100'); await expect(page.locator('#result-mode')).toContainText('Normal');
  26  |   await page.screenshot({ path: info.outputPath('flight-report.png') });
  27  |   await page.locator('#result-controls').click(); await page.locator('#control-editor-touch').click(); await expect(page.locator('#control-mode')).toBeEnabled(); await page.locator('#control-close').click();
  28  |   await page.locator('#restart').click(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'normal'); await expect(page.locator('#speed')).toHaveText('110 m/s');
  29  |   await page.locator('#pause').click(); await page.locator('#pause-home').click(); await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
  30  |   expect(errors).toEqual([]);
  31  | });
  32  | 
  33  | test('multi-touch cancel, lost capture, resize and compatibility click release held input', async ({ page }) => {
  34  |   await start(page, 'normal'); const surface = page.locator('#flight-surface'), fire = page.locator('#fire');
  35  |   await surface.dispatchEvent('pointerdown', { pointerId: 501, pointerType: 'touch', isPrimary: true, buttons: 1, clientX: 170, clientY: 320 });
  36  |   await surface.dispatchEvent('pointermove', { pointerId: 501, pointerType: 'touch', buttons: 1, clientX: 205, clientY: 305, bubbles: true }); await expect(page.locator('#joystick')).toBeVisible();
  37  |   await fire.dispatchEvent('pointerdown', { pointerId: 502, pointerType: 'touch', isPrimary: false, buttons: 1 }); await expect(fire).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#fire-status')).toContainText('ON');
  38  |   await fire.dispatchEvent('pointercancel', { pointerId: 502, pointerType: 'touch', bubbles: true }); await expect(page.locator('#fire-status')).toContainText('待機'); await expect(page.locator('#joystick')).toBeVisible();
  39  |   await surface.dispatchEvent('pointercancel', { pointerId: 501, pointerType: 'touch', bubbles: true }); await expect(page.locator('#joystick')).not.toBeVisible();
  40  |   await fire.dispatchEvent('pointerdown', { pointerId: 503, pointerType: 'touch', isPrimary: true, buttons: 1 }); await fire.dispatchEvent('lostpointercapture', { pointerId: 503, pointerType: 'touch', bubbles: true });
  41  |   await expect(fire).toHaveAttribute('aria-pressed', 'false'); await expect(page.locator('#fire-status')).toContainText('待機');
  42  |   const layout = await fire.getAttribute('style'); await fire.dispatchEvent('click', { detail: 1, bubbles: true }); await expect(fire).toHaveAttribute('style', layout!); await expect(page.locator('#fire-status')).toContainText('待機');
  43  |   await page.keyboard.down('w'); await page.setViewportSize({ width: 852, height: 393 }); await page.keyboard.up('w'); await expect(fire).toHaveAttribute('aria-pressed', 'false');
  44  |   // The layout and visual viewport each dispatch a resize; begin the next
  45  |   // deliberate key press only after both rendering turns have completed.
  46  |   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  47  |   await page.keyboard.down('Space'); await expect(page.locator('#fire-status')).toContainText('ON'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  48  |   await expect(page.locator('#paused')).toBeVisible(); await page.keyboard.up('Space'); await page.locator('#resume').click(); await expect(page.locator('#fire-status')).toContainText('待機');
  49  | });
  50  | 
  51  | test('Easy one button fits specified viewports and ten repeated starts never duplicate app resources', async ({ page }, info) => {
  52  |   for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 568, height: 320 }, { width: 852, height: 393 }, { width: 1366, height: 768 }]) {
  53  |     await page.setViewportSize(viewport); await start(page); await expect(page.locator('[data-flight-control]:visible')).toHaveCount(1);
  54  |     const rect = (await page.locator('#loop').boundingBox())!;
  55  |     expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44); expect(rect.x).toBeGreaterThanOrEqual(7); expect(rect.y).toBeGreaterThanOrEqual(7);
  56  |     expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width - 7); expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height - 7);
  57  |   }
  58  |   await page.setViewportSize({ width: 393, height: 852 }); await start(page); await page.screenshot({ path: info.outputPath('easy-flight.png') });
  59  |   for (let repeat = 0; repeat < 10; repeat += 1) {
  60  |     await page.locator('#pause').click(); await page.locator('#finish').click(); await page.locator('#restart').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  61  |     await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing'); await expect(page.locator('#flight-canvas')).toHaveCount(1); await expect(page.locator('#control-settings')).toHaveCount(1);
  62  |   }
  63  | });
  64  | 
  65  | test('WebGL loss while paused or editing gives guidance and restoration needs explicit resume', async ({ page }) => {
  66  |   await start(page); await page.locator('#pause').click(); await page.locator('#pause-controls').click();
  67  |   const extension = await page.locator('#flight-canvas').evaluateHandle(canvas => (canvas as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context'));
  68  |   await extension.evaluate(extension => extension!.loseContext()); await expect(page.locator('#control-settings [data-graphics-status]')).toContainText('3D描画が停止');
  69  |   await page.locator('#control-close').click(); await expect(page.locator('#pause-reason')).toContainText('3D描画が停止'); await expect(page.locator('#resume')).toBeDisabled();
  70  |   await extension.evaluate(extension => extension!.restoreContext()); await expect(page.locator('#resume')).toBeEnabled(); await expect(page.locator('#pause-reason')).toContainText('復旧');
  71  |   await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused'); await page.locator('#resume').click(); await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing'); await extension.dispose();
  72  | });
  73  | 
  74  | test('an aborted combat report does not write a best record or make game API requests', async ({ page }) => {
  75  |   const requests: string[] = [], bestWrites: string[] = []; page.on('request', request => requests.push(request.url()));
  76  |   await page.exposeFunction('observeBestWrite', (key: string) => bestWrites.push(key));
  77  |   await page.addInitScript(() => {
  78  |     const original = Storage.prototype.setItem;
  79  |     Storage.prototype.setItem = function (key, value) {
  80  |       if (key.startsWith('gekichin-best-')) {
  81  |         void (window as unknown as { observeBestWrite: (key: string) => Promise<void> }).observeBestWrite(key);
  82  |       }
  83  |       return original.call(this, key, value);
  84  |     };
  85  |   });
  86  |   await start(page); await page.locator('#pause').click(); await page.locator('#finish').click(); await expect(page.locator('#result')).toBeVisible();
  87  |   await expect(page.locator('#result-outcome')).toContainText('中断');
  88  |   await expect(page.locator('#result-best')).toContainText('勝利した作戦');
  89  |   expect(bestWrites).toEqual([]); expect(requests.every(url => new URL(url).origin === 'http://127.0.0.1:4177')).toBe(true);
  90  |   expect(requests.some(url => /supabase|ranking|ordnance|bomb-guide/.test(url))).toBe(false);
  91  | });
  92  | 
  93  | test('an explicit visibilitychange fixture stops flight and visible recovery never resumes it', async ({ page }) => {
  94  |   await start(page);
  95  |   // Headless Chromium keeps all page targets visible. This is explicitly a
  96  |   // lifecycle fixture; the separate headed project verifies a native hidden tab.
  97  |   await page.evaluate(() => {
  98  |     Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  99  |     document.dispatchEvent(new Event('visibilitychange'));
  100 |   });
  101 |   await expect(page.locator('#app')).toHaveAttribute('data-phase', 'paused');
  102 |   await expect(page.locator('#pause-reason')).toContainText('非表示');
  103 |   const stopped = await page.locator('#elapsed').textContent();
  104 |   await page.evaluate(() => {
  105 |     Reflect.deleteProperty(document, 'hidden');
  106 |     document.dispatchEvent(new Event('visibilitychange'));
```