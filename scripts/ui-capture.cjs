const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const baseUrl = process.env.GEKICHIN_BASE_URL || 'http://127.0.0.1:4177';
const output = path.resolve(__dirname, '../docs/evidence/acceptance/ui');
const viewports = [[1366,768],[393,852],[568,320],[320,568],[852,393]];
const storageFixture = Object.fromEntries(['kaisen-keyboard-v1','kaisen-controls-v1','kaisen-controls-easy-v1',
  'faitofuraito-keyboard-v1','faitofuraito-controls-v1','faitofuraito-controls-easy-v1'].map((key,index)=>[key,`foreign-fixture-${index}`]));
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const manifest = { capturedAtUTC: new Date().toISOString(), baseUrl, browser: browser.version(), physicalDevice: false,
    kind: 'product DOM input and software-rendered visual capture; controlled clock, not performance acceptance',
    clock: 'public Playwright clock; initialized after shader preparation, then 600ms runFor; gameplay inputs are DOM radio/button/keyboard only',
    input: { mode: 'normal', seed: 1196097537, rootTextScale: [1,2] }, frames: [], screens: [], network: [], storage: [] };
  try {
    for (const scale of [1,2]) for (const [width,height] of viewports) {
      const first = scale === 1 && width === 1366;
      const context = await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:1,
        ...(first ? {recordHar:{path:path.join(output,'product-static-network.har'),mode:'minimal',content:'omit'}} : {}) });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (first) page.on('request', request => manifest.network.push({url:request.url(),method:request.method(),resourceType:request.resourceType()}));
      await page.addInitScript(fixture => { for (const [key,value] of Object.entries(fixture)) localStorage.setItem(key,value); }, storageFixture);
      try {
        await page.goto(baseUrl);
        await page.locator('#app[data-renderer-ready="true"]').waitFor();
        const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
        await page.clock.install({time:new Date('2026-10-05T12:00:00Z')});
        await page.clock.pauseAt(new Date('2026-10-05T12:00:10Z'));
        if (scale === 2) await page.evaluate(() => document.documentElement.style.fontSize = '200%');
        const prefix = `${width}x${height}-${scale}x`;
        async function captureScreen(screen, selector, scroller) {
          const region = page.locator(selector);
          const buttons = region.locator('button:visible');
          const controls = [];
          for (let index = 0; index < await buttons.count(); index++) {
            const button = buttons.nth(index);
            await button.scrollIntoViewIfNeeded();
            const row = await button.evaluate(element => ({id:element.id,name:element.getAttribute('aria-label') || element.textContent.trim(),rect:element.getBoundingClientRect().toJSON()}));
            if (row.rect.width < 43.5 || row.rect.height < 43.5 || row.rect.x < -1 || row.rect.right > width + 1 || row.rect.y < -1 || row.rect.bottom > height + 1 || !row.name) {
              throw new Error(`${screen} ${prefix} inaccessible control: ${JSON.stringify(row)}`);
            }
            controls.push(row);
          }
          if (scroller) await page.locator(scroller).evaluate(element => { element.scrollTop = 0; });
          await page.screenshot({path:path.join(output,`${screen}-${prefix}.png`)});
          let scroll = null;
          if (scroller) {
            scroll = await page.locator(scroller).evaluate(element => {element.scrollTop=element.scrollHeight; return {height:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop};});
            await page.screenshot({path:path.join(output,`${screen}-${prefix}-end.png`)});
          }
          manifest.screens.push({screen,width,height,scale,controls,scroll,errors:[...errors],file:`${screen}-${prefix}.png`});
        }
        async function checkDialogFocus(selector, expectedReturn) {
          for (let index = 0; index < 14; index++) {
            await page.keyboard.press('Tab');
            if (!await page.locator(selector).evaluate(element => element.contains(document.activeElement))) throw new Error(`${selector} lost Tab focus containment`);
          }
          await page.keyboard.press('Escape');
          if (!await page.locator(expectedReturn).evaluate(element => element === document.activeElement)) throw new Error(`${selector} failed focus restoration`);
        }
        await page.locator('input[value="normal"]').check();
        await captureScreen('home','#home','#home');
        await page.locator('#home-guide').click();
        await captureScreen('guide','#guide','.guide-content');
        await checkDialogFocus('#guide','#home-guide');
        await page.locator('#home-controls').click();
        await captureScreen('touch-settings','#control-settings','#control-settings .settings-main');
        await page.locator('#control-editor-keyboard').click();
        await captureScreen('keyboard-settings','#control-settings','#control-settings .settings-main');
        const keyCount = await page.locator('#control-keyboard-editor [data-key-action]').count();
        if (keyCount !== 9) throw new Error(`Expected nine keyboard actions, found ${keyCount}`);
        await checkDialogFocus('#control-settings','#home-controls');
        await page.locator('#start').click();
        await page.clock.runFor(600); await page.locator('#app[data-phase="playing"]').waitFor();
        const name = `combat-${width}x${height}-${scale}x`;
        await page.waitForTimeout(100); await page.screenshot({path:path.join(output,name+'.png')});
        const geometry = await page.evaluate(() => ({phase:document.querySelector('#app').dataset.phase,tick:Number(document.querySelector('#app').dataset.tick),
          rootFontSize:getComputedStyle(document.documentElement).fontSize,compact:document.querySelector('#app').dataset.compactHud,
          controls:[...document.querySelectorAll('[data-flight-control]:not([hidden])')].map(element => ({id:element.id,rect:element.getBoundingClientRect().toJSON(),name:element.innerText})),
          canvas:{...document.querySelector('canvas').dataset}}));
        const frame = {name,file:name+'.png',width,height,scale,errors,geometry};
        if (scale === 2 || height <= 450) {
          await page.locator('#combat-panel summary').click(); await page.clock.runFor(20);
          await page.waitForTimeout(100); await page.screenshot({path:path.join(output,name+'-details.png')});
          await page.locator('#combat-panel').evaluate(panel => {panel.scrollTop=panel.scrollHeight;});
          await page.screenshot({path:path.join(output,name+'-details-end.png')});
          frame.drawer = await page.locator('#combat-panel').evaluate(panel => ({rect:panel.getBoundingClientRect().toJSON(),scrollHeight:panel.scrollHeight,
            scrollTop:panel.scrollTop,lastValue:panel.querySelector('#hit-breakdown').getBoundingClientRect().toJSON()}));
          await page.keyboard.press('Escape');
          if (await page.locator('#combat-panel').evaluate(panel => panel.open)) throw new Error('Escape failed to close compact drawer');
        }
        await page.locator('#pause').click();
        await captureScreen('paused','#paused','#paused');
        await page.locator('#finish').click();
        await captureScreen('result','#result','#result');
        const after = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
        if (Object.entries(storageFixture).some(([key,value]) => after[key] !== value)) throw new Error('Foreign storage key was modified');
        manifest.storage.push({viewport:[width,height],scale,before,after,foreignUnchanged:true,abortedBestUnchanged:!Object.keys(after).some(key=>key.startsWith('gekichin-best-'))});
        if (errors.length) throw new Error(errors.join('; '));
        manifest.frames.push(frame);
      } finally { await context.close(); }
    }
    manifest.networkStaticOnly = manifest.network.every(row => row.method === 'GET' && new URL(row.url).origin === new URL(baseUrl).origin);
    manifest.sourceSHA256 = Object.fromEntries(['src/main.ts','src/style.css','src/scene.ts','src/audio.ts'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')]));
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    if (!manifest.networkStaticOnly) throw new Error('Unexpected outbound runtime request');
    console.log(JSON.stringify({kind:'ui-capture-complete',frames:manifest.frames.length,screens:manifest.screens.length,networkStaticOnly:manifest.networkStaticOnly,errors:manifest.frames.flatMap(frame=>frame.errors)}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
