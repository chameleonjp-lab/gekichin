import { expect, test, type Page } from '@playwright/test';
import { guardStaticTraffic, type BlockedRequest, type StaticAssets } from './network-policy';
import { buildPauseSafetyAssets } from './pause-safety-assets';
import { gapFreezeViolations, neutralInputViolations } from './pause-safety-oracle';
import type { PauseSafetySnapshot } from './pause-safety-observer';

test.use({ serviceWorkers: 'block' });
let assets: StaticAssets;
let blocked: BlockedRequest[];
test.beforeAll(async () => { assets = await buildPauseSafetyAssets(); });
test.beforeEach(async ({ context, baseURL }) => {
  // Installed before navigation, clock preparation, and every input attempt.
  blocked = await guardStaticTraffic(context, baseURL!, assets);
});
test.afterEach(async ({ context }) => {
  await context.close();
  expect(blocked, 'all requests must use exact local static bytes').toEqual([]);
});

const read = (page: Page) => page.evaluate(() => window.__gekichinPauseSafety.read());

async function startControlledFlight(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  let ready = false;
  for (let frame = 0; frame < 100 && !ready; frame += 1) {
    await page.clock.runFor(100);
    ready = await page.locator('#app').getAttribute('data-renderer-ready') === 'true';
  }
  expect(ready, 'shader preparation must finish before the safety scenario').toBe(true);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1_000)));
  await page.getByRole('radio', { name: /ノーマル/ }).check();
  await page.locator('#start').click();
  await page.clock.runFor(100);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'playing');
  // Four rendered frames per virtual second, still every ordinary 60 Hz tick.
  // This is safety evidence only. No GPU/FPS threshold is altered or measured.
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 250);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
  });
  await page.clock.runFor(300);
}

async function gapAndHold(page: Page, before: PauseSafetySnapshot) {
  // fastForward delivers the next callback after the missing interval once.
  // The unchanged real 2.1 s event-loop-stall and native-tab tests remain separate.
  await page.clock.fastForward(2_100);
  const paused = await read(page);
  expect(gapFreezeViolations(before, paused)).toEqual([]);
  await expect(page.locator('#pause-reason')).toContainText('2秒以上');
  // Waiting and focus/visible recovery cannot count paused time or auto-resume.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(10_000);
  expect(gapFreezeViolations(paused, await read(page))).toEqual([]);
  return paused;
}

test('long-gap safety freezes authoritative flight, live bullets, AI, score and held input until explicit resume', async ({ page }, info) => {
  await startControlledFlight(page);
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('w');
  await page.mouse.move(180, 490); await page.mouse.down(); await page.mouse.move(208, 475);
  await page.clock.runFor(500);
  const before = await read(page);
  expect(before.world.friendlyBullets.length).toBeGreaterThan(0);
  expect(before.world.enemyAI).toHaveLength(100);
  expect(before.world.wingmanAI).toHaveLength(7);
  expect(before.world.wingmanAI.some(state => state.targetId !== null)).toBe(true);
  expect(before.world.score.totals.N).toBeGreaterThan(0);
  expect(before.input.keys).toEqual(expect.arrayContaining(['Space', 'ArrowRight', 'KeyW']));
  expect(before.input.steerPointer).not.toBeNull();
  const paused = await gapAndHold(page, before);
  await page.locator('#resume').press('Enter'); await page.clock.runFor(1_000);
  const resumed = await read(page);
  expect(resumed.phase).toBe('playing');
  expect(resumed.world.tick - paused.world.tick).toBeGreaterThan(0);
  expect(resumed.world.tick - paused.world.tick).toBeLessThanOrEqual(60);
  expect(resumed.world.aircraft).not.toEqual(paused.world.aircraft);
  expect(resumed.world.friendlyBullets).not.toEqual(paused.world.friendlyBullets);
  expect(neutralInputViolations(resumed.input)).toEqual([]);
  expect(resumed.world.score.totals.N).toBe(paused.world.score.totals.N);
  expect(resumed.world.aircraft.find(plane => plane.owner === 'player')!.yaw).toBe(paused.world.aircraft.find(plane => plane.owner === 'player')!.yaw);
  // Physically held old keys/pointer were not released before the above checks.
  await page.mouse.up(); await page.keyboard.up('Space'); await page.keyboard.up('ArrowRight'); await page.keyboard.up('w');
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight'); await page.clock.runFor(500);
  const fresh = await read(page);
  expect(fresh.world.score.totals.N).toBeGreaterThan(resumed.world.score.totals.N);
  expect(fresh.world.aircraft.find(plane => plane.owner === 'player')!.yaw).not.toBe(resumed.world.aircraft.find(plane => plane.owner === 'player')!.yaw);
  await info.attach('authoritative-gap-snapshots', { body: JSON.stringify({ before, paused, resumed, fresh }), contentType: 'application/json' });
});

test('a real magazine reload cannot complete during a long-gap pause and resumes on active ticks only', async ({ page }, info) => {
  await startControlledFlight(page);
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowRight');
  let before = await read(page);
  for (let sample = 0; sample < 60 && !before.world.aircraft.some(plane => plane.owner === 'player' && plane.ammunition.reloadUntilTick !== null); sample += 1) {
    await page.clock.runFor(250); before = await read(page);
  }
  const player = before.world.aircraft.find(plane => plane.owner === 'player')!;
  expect(player, 'ordinary circling input must keep the firing player alive').toBeDefined();
  expect(player.ammunition.mg).toBe(0); expect(player.ammunition.cannon).toBe(0);
  expect(player.ammunition.reloadUntilTick).toBeGreaterThan(before.world.tick);
  const due = player.ammunition.reloadUntilTick!;
  const paused = await gapAndHold(page, before);
  await page.locator('#resume').press('Enter'); await page.clock.runFor(1_000);
  const early = await read(page);
  expect(early.world.tick).toBeLessThan(due);
  expect(early.world.aircraft.find(plane => plane.owner === 'player')!.ammunition.reloadUntilTick).toBe(due);
  await page.clock.runFor(6_000);
  const completed = await read(page);
  expect(completed.world.tick).toBeGreaterThanOrEqual(due);
  expect(completed.world.aircraft.find(plane => plane.owner === 'player')!.ammunition).toMatchObject({ mg: 288, cannon: 96, reloadUntilTick: null });
  expect(completed.world.score.totals.N).toBe(paused.world.score.totals.N);
  expect(neutralInputViolations(completed.input)).toEqual([]);
  await info.attach('reload-gap-snapshots', { body: JSON.stringify({ before, paused, early, completed }), contentType: 'application/json' });
});

test('a real player-loss reservation freezes through the gap and restores ownership without stale held input', async ({ page }, info) => {
  await startControlledFlight(page);
  await page.keyboard.down('ArrowDown'); await page.keyboard.down('Space');
  let before = await read(page);
  for (let sample = 0; sample < 100 && !before.world.fleet.reservations.some(item => item.owner === 'player'); sample += 1) {
    await page.clock.runFor(250); before = await read(page);
  }
  const reservation = before.world.fleet.reservations.find(item => item.owner === 'player');
  expect(reservation, 'ordinary dive input must produce a player-loss reservation').toBeDefined();
  expect(before.world.score.totals.P).toBe(1);
  expect(before.world.aircraft.some(plane => plane.owner === 'player')).toBe(false);
  expect(before.world.enemyBullets.length, 'the freeze includes live enemy projectiles').toBeGreaterThan(0);
  expect(before.world.enemyAI.some(state => ['warning', 'burst', 'reload'].includes(state.phase))).toBe(true);
  const paused = await gapAndHold(page, before);
  await page.locator('#resume').press('Enter'); await page.clock.runFor(1_000);
  const early = await read(page);
  expect(early.world.tick).toBeLessThan(reservation!.dueTick);
  expect(early.world.fleet.reservations).toContainEqual(reservation);
  await page.clock.runFor(3_000);
  const respawned = await read(page);
  expect(respawned.world.tick).toBeGreaterThanOrEqual(reservation!.dueTick);
  const player = respawned.world.aircraft.find(plane => plane.owner === 'player')!;
  expect(player.tokenId).toBe(reservation!.tokenId); expect(player.generation).toBe(reservation!.generation);
  expect(player.pitch).toBe(0);
  expect(player.ammunition).toMatchObject({ mg: 288, cannon: 96, reloadUntilTick: null });
  expect(respawned.world.score.totals.N).toBe(paused.world.score.totals.N);
  expect(neutralInputViolations(respawned.input)).toEqual([]);
  await info.attach('respawn-gap-snapshots', { body: JSON.stringify({ before, paused, early, respawned }), contentType: 'application/json' });
});
