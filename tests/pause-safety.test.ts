import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FixedStepper, FlightSession } from '../src/game-state';
import { observePauseState, type PauseSafetySnapshot } from '../browser-tests/pause-safety-observer';
import { gapFreezeViolations, neutralInputViolations } from '../browser-tests/pause-safety-oracle';
import type { FlightInput } from '../src/types';

const neutral = () => ({ turn: 0, climb: 0, steerPointer: null, throttle: 0, throttlePointer: null,
  heldPointers: { fire: [] as number[], loop: [] as number[], accelerate: [] as number[], brake: [] as number[] }, keys: [] as string[] });
const controls = { peek: neutral };
const none: FlightInput = { turn: 0, climb: 0, fire: false, loop: false };
const circleAndFire: FlightInput = { ...none, turn: 1, fire: true };
const snapshot = (session: FlightSession) => observePauseState(session, controls, 'frozen elapsed display');

function flight(): FlightSession {
  const session = new FlightSession();
  const operation = session.prepare('normal')!;
  assert.equal(session.begin(operation), true);
  return session;
}

test('the gap discards missed ticks and freezes live authoritative world state until explicit resume', () => {
  const session = flight(), stepper = new FixedStepper();
  stepper.frame(0, true, () => {}, () => assert.fail('no initial gap'));
  stepper.frame(500, true, () => session.step(circleAndFire), () => assert.fail('ordinary frames must progress'));
  const before = snapshot(session);
  assert.equal(before.world.tick, 30);
  assert.ok(before.world.friendlyBullets.length > 0);
  assert.equal(before.world.enemyAI.length, 100);
  assert.equal(before.world.wingmanAI.length, 7);
  assert.ok(before.world.score.totals.N > 0);
  assert.equal(stepper.frame(2600, true, () => session.step(circleAndFire), () => { session.pause('gap'); stepper.reset(); }), 0);
  const paused = snapshot(session);
  assert.deepEqual(gapFreezeViolations(before, paused), []);
  for (let attempt = 0; attempt < 600; attempt += 1) session.step(circleAndFire);
  stepper.frame(12600, false, () => session.step(circleAndFire), () => assert.fail('already paused'));
  assert.deepEqual(gapFreezeViolations(paused, snapshot(session)), []);
  assert.equal(session.resume(), true); stepper.reset();
  assert.equal(stepper.frame(12616, true, () => session.step(none), () => assert.fail('fresh resumed baseline')), 0);
  assert.equal(stepper.frame(13616, true, () => session.step(none), () => assert.fail('no missed time after resume')), 60);
  assert.equal(session.tick, 90);
  assert.notDeepEqual(snapshot(session).world.aircraft, paused.world.aircraft);
  assert.equal(session.score.totals.N, paused.world.score.totals.N);
});

test('ordinary circling/firing produces a real reload which pauses and completes only at its active deadline', () => {
  const session = flight();
  while (session.tick < 900 && session.fleet.player?.ammunition.reloadUntilTick === null) session.step(circleAndFire);
  assert.ok(session.fleet.player, 'the circling player must still be alive');
  const due = session.fleet.player.ammunition.reloadUntilTick;
  assert.ok(due !== null && due > session.tick);
  assert.equal(session.fleet.player.ammunition.mg, 0); assert.equal(session.fleet.player.ammunition.cannon, 0);
  const before = snapshot(session);
  session.pause('gap');
  for (let attempt = 0; attempt < 600; attempt += 1) session.step(none);
  assert.deepEqual(gapFreezeViolations(before, snapshot(session)), []);
  session.resume();
  while (session.tick < due - 1) session.step(none);
  assert.equal(session.fleet.player!.ammunition.reloadUntilTick, due);
  session.step(none);
  assert.equal(session.fleet.player!.ammunition.reloadUntilTick, null);
  assert.equal(session.fleet.player!.ammunition.mg, 288); assert.equal(session.fleet.player!.ammunition.cannon, 96);
  assert.equal(session.score.totals.N, before.world.score.totals.N);
});

test('ordinary diving produces a real respawn reservation that survives pause and fires no stale input', () => {
  const session = flight();
  while (session.tick < 1500 && session.fleet.player) session.step({ ...none, climb: -1, fire: true });
  const reservation = session.fleet.reservations.find(item => item.owner === 'player');
  assert.ok(reservation, 'the ordinary dive must lose the player and schedule a replacement');
  assert.equal(session.score.totals.P, 1);
  const before = snapshot(session);
  session.pause('gap');
  for (let attempt = 0; attempt < 600; attempt += 1) session.step(none);
  assert.deepEqual(gapFreezeViolations(before, snapshot(session)), []);
  session.resume();
  while (session.tick < reservation.dueTick - 1) session.step(none);
  assert.equal(session.fleet.player, null);
  session.step(none);
  assert.equal(session.fleet.player!.tokenId, reservation.tokenId);
  assert.equal(session.fleet.player!.generation, reservation.generation);
  assert.equal(session.fleet.player!.ammunition.mg, 288);
  assert.equal(session.score.totals.N, before.world.score.totals.N);
});

test('negative fixture rejects a frozen elapsed display while the real simulation advances', () => {
  const session = flight();
  for (let tick = 0; tick < 30; tick += 1) session.step(circleAndFire);
  const before = snapshot(session);
  session.step(circleAndFire); session.pause('gap');
  const broken = snapshot(session);
  assert.equal(broken.elapsed, before.elapsed);
  const violations = gapFreezeViolations(before, broken);
  assert.ok(violations.includes('authoritative tick advanced'));
  assert.ok(violations.includes('authoritative aircraft advanced'));
  assert.ok(violations.includes('authoritative friendlyBullets advanced'));
});

test('negative fixtures reject independently advancing subsystems even with a frozen tick and elapsed display', () => {
  const session = flight();
  for (let tick = 0; tick < 30; tick += 1) session.step(circleAndFire);
  session.pause('gap'); const before = snapshot(session);
  const corruptions: [keyof PauseSafetySnapshot['world'], (state: PauseSafetySnapshot) => void][] = [
    ['aircraft', state => { state.world.aircraft[0].position[0] += 1; }],
    ['friendlyBullets', state => { state.world.friendlyBullets[0].position[2] += 1; }],
    ['enemyBullets', state => { state.world.enemyBullets.push({ ...state.world.friendlyBullets[0], faction: 'enemy', owner: 'enemy' }); }],
    ['enemyAI', state => { state.world.enemyAI[0].readyTick += 1; }],
    ['wingmanAI', state => { state.world.wingmanAI[0].lastEvaluationTick += 1; }],
    ['aircraft', state => { state.world.aircraft[0].ammunition.reloadUntilTick = state.world.tick + 360; }],
    ['fleet', state => { state.world.fleet.reservations.push({ operationId: 1, tokenId: 8, slotId: 0, generation: 1, owner: 'player', dueTick: state.world.tick + 180, blockedSinceTick: null }); }],
    ['score', state => { state.world.score.totals.N += 2; }],
    ['turrets', state => { state.world.turrets[0].hpMilli -= 1; }],
  ];
  for (const [field, corrupt] of corruptions) {
    const broken = structuredClone(before); corrupt(broken);
    assert.equal(broken.world.tick, before.world.tick); assert.equal(broken.elapsed, before.elapsed);
    assert.ok(gapFreezeViolations(before, broken).includes(`authoritative ${field} advanced`), field);
  }
});

test('negative fixture rejects old held input at pause and explicit resume', () => {
  const session = flight(); session.step(circleAndFire); session.pause('gap');
  const before = snapshot(session), broken = structuredClone(before);
  broken.input.keys = ['Space', 'ArrowRight', 'KeyW']; broken.input.turn = 1; broken.input.steerPointer = 501;
  assert.deepEqual(neutralInputViolations(broken.input), ['held steering/throttle', 'held pointer owner', 'held keys/buttons']);
  assert.ok(gapFreezeViolations(before, broken).includes('held keys/buttons'));
  broken.phase = 'playing'; broken.pauseReason = null;
  assert.ok(neutralInputViolations(broken.input).includes('held keys/buttons'));
});

test('observer reads are detached and cannot advance simulation, consume input or mutate observed state', () => {
  const session = flight(); session.step(circleAndFire);
  const before = snapshot(session), copy = snapshot(session);
  copy.world.aircraft[0].position[0] += 10; copy.world.score.totals.N += 10;
  copy.world.aircraft[0].ammunition.mg -= 10;
  copy.world.controller.playerTargetSpeed += 10;
  copy.world.wingmanAI[0].route[0][0] += 10;
  assert.deepEqual(snapshot(session), before);
  while (session.tick < 1500 && session.fleet.player) session.step({ ...none, climb: -1 });
  const waiting = snapshot(session), detachedWait = snapshot(session);
  assert.ok(detachedWait.world.fleet.wait);
  detachedWait.world.fleet.wait.untilTick = -1;
  detachedWait.world.fleet.reservations[0].dueTick = -1;
  assert.deepEqual(snapshot(session), waiting);
  const source = readFileSync('browser-tests/pause-safety-observer.ts', 'utf8');
  assert.doesNotMatch(source, /controls\.sample\(|session\.(step|pause|resume|prepare|begin)\(/);
  const real = readFileSync('browser-tests/p1-independent.spec.ts', 'utf8');
  const stall = real.slice(real.indexOf("test('an event-loop stall"), real.indexOf("test('when WebGL"));
  assert.match(stall, /performance\.now\(\) \+ 2_100/);
  assert.match(stall, /while \(performance\.now\(\) < until\)/);
  assert.doesNotMatch(stall, /page\.clock/);
});
