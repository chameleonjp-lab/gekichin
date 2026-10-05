import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';

const URL = process.env.GEKICHIN_URL ?? 'http://127.0.0.1:4177';
const OUT = resolve(process.env.GEKICHIN_ENEMY_RESPAWN_OUTPUT ?? 'docs/evidence/acceptance/ordinary-enemy-recovery/dom');
const FRAME_MS = 1000;
const TICK_CAP = 120 * 60;
const ORBIT_RADIUS = 900;
const YAW_LEAD = 0.24;
const YAW_GAIN_SECONDS = 0.82;
const ORIGIN = { x: 196, y: 426 };

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function directoryDigests(directory) {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => entry.name).sort()
    .map(name => [name, sha256(resolve(directory, name))]));
}
function normalizeAngle(angle) {
  let wrapped = (angle + Math.PI) % (2 * Math.PI);
  if (wrapped < 0) wrapped += 2 * Math.PI;
  return wrapped - Math.PI;
}
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function steeringFor(state) {
  const [x, , z] = state.position;
  const nextAngle = Math.atan2(x, z) + YAW_LEAD;
  const target = { x: Math.sin(nextAngle) * ORBIT_RADIUS, z: Math.cos(nextAngle) * ORBIT_RADIUS };
  const desiredYaw = Math.atan2(-(target.x - x), -(target.z - z));
  return clamp(-normalizeAngle(desiredYaw - state.yaw) / YAW_GAIN_SECONDS, -1, 1);
}
function pointerOffset(turn) {
  const magnitude = Math.min(1, Math.abs(turn));
  if (magnitude < 1e-6) return 0;
  const distance = 36 * (0.08 + 0.92 * magnitude);
  return Math.sign(turn) * distance;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const startedAt = new Date().toISOString();
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceHashes = directoryDigests(resolve('src'));
  const assetHashes = directoryDigests(resolve('dist/assets'));
  const driverHash = sha256(resolve('scripts/normal-enemy-respawn-run.mjs'));
  const pageErrors = [];
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const artifactPath = name => resolve(OUT, name);
  const readHud = () => page.evaluate(() => {
    const app = document.querySelector('#app');
    const hud = document.querySelector('#hud');
    const position = (hud?.dataset.position ?? '').split(',').map(Number);
    const rawHp = document.querySelector('#player-hp')?.textContent?.trim() ?? '';
    const match = rawHp.match(/^([\d.]+)\s*\/\s*80$/);
    return {
      phase: app?.dataset.phase ?? '', mode: app?.dataset.mode ?? '',
      seed: Number(app?.dataset.seed ?? 0), tick: Number(app?.dataset.tick ?? 0),
      ownership: Number(app?.dataset.ownership ?? -1), position,
      yaw: Number(hud?.dataset.yaw ?? Number.NaN), pitch: Number(hud?.dataset.pitch ?? Number.NaN),
      playerHpText: rawHp, playerHp: match ? Number(match[1]) : null,
      ammunition: document.querySelector('#ammunition')?.textContent?.trim() ?? '',
      fire: document.querySelector('#fire-status')?.textContent?.trim() ?? '',
      respawn: document.querySelector('#respawn-status')?.textContent?.trim() ?? '',
      respawnVisible: !document.querySelector('#respawn-status')?.hidden,
      altitude: document.querySelector('#altitude')?.textContent?.trim() ?? '',
      speed: document.querySelector('#speed')?.textContent?.trim() ?? '',
      enemyMainBullets: Number(app?.dataset.enemyMainBullets ?? 0),
      enemyMgBullets: Number(app?.dataset.enemyMgBullets ?? 0),
      friendlyPoolFailures: Number(app?.dataset.friendlyPoolFailures ?? -1),
      enemyPoolFailures: Number(app?.dataset.enemyPoolFailures ?? -1),
    };
  });
  const advance = () => page.clock.runFor(FRAME_MS);

  let finished = false;
  let errorMessage = null;
  let initial = null;
  let current = null;
  let loss = null;
  let respawn = null;
  let afterRespawn = null;
  let lossObservedFrames = null;
  let respawnObservedFrames = null;
  const damageRows = [];
  const samples = [];
  const controllerRows = [];
  const startedWall = process.hrtime.bigint();
  let virtualFrames = 0;
  let pointerHeld = false;
  let spaceHeld = false;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#app')?.dataset.rendererReady === 'true', null, { timeout: 60_000 });
    const initialEpoch = await page.evaluate(() => Date.now());
    await page.clock.install({ time: new Date(initialEpoch) });
    await page.clock.pauseAt(new Date(initialEpoch + 10_000));
    await page.evaluate(intervalMs => {
      window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), intervalMs);
      window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    }, FRAME_MS);
    // Switch the already-running product RAF loop to the timer cadence before
    // Start. This follows the validated full-mission input runner.
    await advance();

    await page.locator('input[name="mode"][value="normal"]').check();
    await page.locator('#start').click();
    for (let frame = 0; frame < 8 && await page.locator('#app').getAttribute('data-phase') !== 'playing'; frame += 1) await advance();
    if (await page.locator('#app').getAttribute('data-phase') !== 'playing') throw new Error('Product Start did not enter Normal combat after eight prepared RAFs');

    initial = await readHud();
    current = initial;
    if (initial.mode !== 'normal' || initial.playerHp !== 80 || initial.ammunition !== '288 / 96') {
      throw new Error(`Unexpected Normal mission start HUD: ${JSON.stringify(initial)}`);
    }
    await page.screenshot({ path: artifactPath('normal-enemy-respawn-start.png') });
    await page.mouse.move(ORIGIN.x, ORIGIN.y);
    await page.mouse.down();
    pointerHeld = true;
    await page.keyboard.down('Space');
    spaceHeld = true;

    let previousHp = initial.playerHp;
    let previousTick = initial.tick;
    let firstDamageScreenshot = false;
    const frameCap = Math.ceil(TICK_CAP / 60) + 4;
    for (let frame = 1; frame <= frameCap; frame += 1) {
      const turn = steeringFor(current);
      const pointerDx = pointerOffset(turn);
      await page.mouse.move(ORIGIN.x + pointerDx, ORIGIN.y);
      await advance();
      virtualFrames += 1;
      current = await readHud();
      if (current.phase !== 'playing') {
        errorMessage = `Mission left active play before respawn: ${current.phase} at tick ${current.tick}`;
        break;
      }
      if (current.tick < previousTick || current.tick - previousTick > 60) {
        errorMessage = `Fixed-step tick anomaly ${previousTick}→${current.tick}`;
        break;
      }
      previousTick = Math.max(previousTick, current.tick);
      const radius = Math.hypot(current.position[0], current.position[2]);
      controllerRows.push({ frame, tick: current.tick, turn: Number(turn.toFixed(9)), pointerDx: Number(pointerDx.toFixed(3)),
        playerHp: current.playerHp, ownership: current.ownership, position: current.position, yaw: current.yaw, pitch: current.pitch });
      const row = { frame, tick: current.tick, activeSeconds: (current.tick - initial.tick) / 60,
        hp: current.playerHp, playerHp: current.playerHp, playerHpText: current.playerHpText, ownership: current.ownership,
        position: current.position, radius: Number(radius.toFixed(2)), yaw: current.yaw, pitch: current.pitch,
        altitude: current.altitude, enemyMainBullets: current.enemyMainBullets, enemyMgBullets: current.enemyMgBullets,
        ammo: current.ammunition, ammunition: current.ammunition, fire: current.fire, respawn: current.respawn };
      if (frame % 5 === 0 || current.playerHp === null || current.playerHp !== previousHp) samples.push(row);

      if (current.playerHp === null && !loss) {
        loss = { ...row, respawnVisible: current.respawnVisible };
        lossObservedFrames = frame;
        await page.screenshot({ path: artifactPath('normal-enemy-respawn-loss.png') });
      } else if (current.playerHp !== null && current.playerHp < previousHp) {
        const damage = { ...row, previousHp, damageMilli: Math.round((previousHp - current.playerHp) * 1000) };
        damageRows.push(damage);
        previousHp = current.playerHp;
        if (!firstDamageScreenshot) {
          await page.screenshot({ path: artifactPath('normal-enemy-respawn-first-damage.png') });
          firstDamageScreenshot = true;
        }
      } else if (current.playerHp !== null && current.playerHp > previousHp) {
        previousHp = current.playerHp;
        if (loss && !respawn) {
          respawn = { ...row, respawnVisible: current.respawnVisible };
          respawnObservedFrames = frame;
          await page.screenshot({ path: artifactPath('normal-enemy-respawn-return.png') });
        } else if (respawn && !afterRespawn) afterRespawn = { ...row, respawnVisible: current.respawnVisible };
      }
      if (loss && current.playerHp !== null && !respawn) {
        respawn = { ...row, respawnVisible: current.respawnVisible };
        respawnObservedFrames = frame;
        await page.screenshot({ path: artifactPath('normal-enemy-respawn-return.png') });
      } else if (respawn && !afterRespawn && frame - respawnObservedFrames >= 1) {
        afterRespawn = { ...row, respawnVisible: current.respawnVisible };
      }
      if (loss && respawn && afterRespawn) break;
      if (current.tick - initial.tick >= TICK_CAP) break;
    }
    if (!loss) errorMessage ??= `No player loss within ${TICK_CAP / 60} active seconds`;
    if (loss && !respawn) errorMessage ??= 'Player loss occurred but no player respawn was observed before the 120-second active-time cap';
    if (loss && respawn && !afterRespawn) {
      // The frame where the respawn is visible also performs the stale-input
      // check; preserve that first replacement-aircraft sample as the check.
      afterRespawn = respawn;
    }
    await page.keyboard.up('Space');
    spaceHeld = false;
    await page.mouse.up();
    pointerHeld = false;
    await page.screenshot({ path: artifactPath('normal-enemy-respawn-final.png') });
    finished = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (spaceHeld) await page.keyboard.up('Space').catch(() => {});
    if (pointerHeld) await page.mouse.up().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const virtualDurationMs = virtualFrames * FRAME_MS;
  const validationFailures = [];
  if (!initial || initial.mode !== 'normal' || initial.playerHp !== 80 || initial.ammunition !== '288 / 96') validationFailures.push('Normal mode did not start with full player HP/ammunition');
  if (!damageRows.length) validationFailures.push('No real player HP reduction was observed through the product HUD');
  if (!loss) validationFailures.push('No enemy-caused player loss was observed within 120 active seconds');
  if (loss && initial && loss.ownership <= initial.ownership) validationFailures.push('Ownership revision did not change on player loss');
  if (loss && !loss.respawnVisible) validationFailures.push('Respawn wait was not visible after player loss');
  if (loss && !respawn) validationFailures.push('Player did not respawn before the active-time cap');
  if (loss && respawn && respawn.tick - loss.tick !== 180) validationFailures.push(`Observed HUD tick samples differed by ${respawn.tick - loss.tick}, expected the 180-tick respawn interval`);
  if (loss && respawn && respawn.ownership <= loss.ownership) validationFailures.push('Ownership revision did not change on player respawn');
  if (respawn && (respawn.playerHp !== 80 || respawn.ammunition !== '288 / 96')) validationFailures.push('Respawn HUD did not show full 80 HP and fresh ammunition');
  if (respawn && respawn.respawnVisible) validationFailures.push('Respawn indicator remained visible with the player returned');
  if (!afterRespawn || afterRespawn.fire !== '射撃：待機' || afterRespawn.playerHp !== 80 || afterRespawn.ammunition !== '288 / 96') {
    validationFailures.push('Held firing input was not cleared after the new player ownership');
  }
  if (afterRespawn && Math.abs(afterRespawn.pitch) >= 0.05) validationFailures.push('Held pointer steering affected the replacement aircraft pitch');
  if (afterRespawn && Math.abs(afterRespawn.yaw) >= 0.05) validationFailures.push('Held pointer turning affected the replacement aircraft yaw');
  if (afterRespawn && Math.abs(afterRespawn.position[0]) >= 100) validationFailures.push('Held pointer turning moved the replacement aircraft away from the straight-ahead spawn line');
  if (loss && afterRespawn && Math.hypot(afterRespawn.position[0] - loss.position[0], afterRespawn.position[1] - loss.position[1],
    afterRespawn.position[2] - loss.position[2]) < 500) validationFailures.push('HUD/camera did not move to a distinct replacement aircraft pose');
  if (pageErrors.length) validationFailures.push(`Browser page errors: ${pageErrors.join('; ')}`);
  const response = {
    type: 'normal-enemy-damage-loss-respawn-product-dom-run',
    status: 'pending',
    startedAt,
    completedAt: new Date().toISOString(),
    wallElapsedMilliseconds: Number(process.hrtime.bigint() - startedWall) / 1e6,
    source: { gitHead, sourceSha256Before: sourceHashes, builtAssetSha256Before: assetHashes, runnerSha256Before: driverHash },
    fixture: { url: URL, browser: 'Chromium', viewport: { width: 393, height: 852, deviceScaleFactor: 1 },
      clock: 'Playwright public page.clock.install + pauseAt + runFor', frameMs: FRAME_MS,
      fixedLogicHz: 60, activeTickCap: TICK_CAP, activeSecondsCap: TICK_CAP / 60,
      steering: { source: 'read-only #hud data-position and data-yaw', radius: ORBIT_RADIUS, altitude: 1000,
        nextAngleRadians: YAW_LEAD, yawGainSeconds: YAW_GAIN_SECONDS, updatesEveryTicks: 60 },
      productInputs: ['Normal radio + Start button', 'trusted pointer drag on #flight-surface', 'trusted Space key held'],
      stateWrites: 'None; mission readings use HUD text and read-only #app/#hud datasets.' },
    result: { status: 'pending', initial, final: current,
      playerLoss: loss, respawn, afterRespawn, damageRows, samples,
      controllerRows,
      virtualDurationMs, activeTicks: current && initial ? current.tick - initial.tick : 0,
      lossAfterTicks: loss && initial ? loss.tick - initial.tick : null,
      respawnWaitTicks: loss && respawn ? respawn.tick - loss.tick : null,
      respawnWaitFrames: lossObservedFrames !== null && respawnObservedFrames !== null ? respawnObservedFrames - lossObservedFrames : null,
      staleInputCheckWhilePointerAndSpaceWereHeld: !!(loss && respawn && afterRespawn),
      pageErrors, validationFailures, error: errorMessage },
    claims: { browserRendered: true, ordinaryProductInputPath: true, engineStateWritten: false,
      humanOrPhysicalDeviceTesting: false, native120FpsOrPerformance: false },
  };
  const sourceHashesAfter = directoryDigests(resolve('src'));
  const assetHashesAfter = directoryDigests(resolve('dist/assets'));
  const runnerHashAfter = sha256(resolve('scripts/normal-enemy-respawn-run.mjs'));
  const gitHeadAfter = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const hashesUnchanged = JSON.stringify(sourceHashes) === JSON.stringify(sourceHashesAfter)
    && JSON.stringify(assetHashes) === JSON.stringify(assetHashesAfter) && driverHash === runnerHashAfter && gitHead === gitHeadAfter;
  response.source.gitHeadAfter = gitHeadAfter;
  response.source.sourceSha256After = sourceHashesAfter;
  response.source.builtAssetSha256After = assetHashesAfter;
  response.source.runnerSha256After = runnerHashAfter;
  response.source.hashesUnchanged = hashesUnchanged;
  if (!hashesUnchanged) validationFailures.push('Source, built assets, runner, or git HEAD changed during the run');
  if (validationFailures.length && !errorMessage) errorMessage = validationFailures.join('; ');
  const finalStatus = finished && !errorMessage && !validationFailures.length ? 'passed' : 'not-complete';
  response.status = finalStatus;
  response.result.status = finalStatus;
  response.result.validationFailures = validationFailures;
  response.result.error = errorMessage;
  writeFileSync(artifactPath('normal-enemy-respawn.json'), `${JSON.stringify(response, null, 2)}\n`);
  const screenshotHashes = Object.fromEntries(readdirSync(OUT).filter(name => name.endsWith('.png')).sort()
    .map(name => [name, sha256(artifactPath(name))]));
  const resultHash = sha256(artifactPath('normal-enemy-respawn.json'));
  writeFileSync(artifactPath('normal-enemy-respawn.manifest.json'), `${JSON.stringify({
    name: response.type,
    status: response.status,
    resultFile: 'normal-enemy-respawn.json',
    resultSha256: resultHash,
    screenshotSha256: screenshotHashes,
    gitHead,
    gitHeadAfter,
    sourceSha256Before: sourceHashes,
    sourceSha256After: sourceHashesAfter,
    builtAssetSha256Before: assetHashes,
    builtAssetSha256After: assetHashesAfter,
    runner: 'scripts/normal-enemy-respawn-run.mjs',
    runnerSha256Before: driverHash,
    runnerSha256After: runnerHashAfter,
    hashesUnchanged,
    capturedAt: startedAt,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ status: response.status, output: artifactPath('normal-enemy-respawn.json'),
    activeTicks: response.result.activeTicks, lossTick: loss?.tick ?? null, respawnTick: respawn?.tick ?? null,
    error: errorMessage, pageErrors }, null, 2));
  if (response.status !== 'passed') process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
