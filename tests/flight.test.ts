import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { CRUISE_SPEED, LOOP_DURATION, MAX_SPEED, STALL_SPEED, advanceThrottle, createFlightController, updateAircraftMotion, updatePlayerLoop } from '../src/flight';
import { FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { applyEasyShotCorrection, EASY_SHOT_MAX_ANGLE, getFlightAssist } from '../src/flight-assist';
import { createPlayer, FixedStepper, FlightSession } from '../src/game-state';
import { FIXED_DT } from '../src/rules';
import { captureKey, DEFAULT_KEY_BINDINGS, isBindableCode, KEY_ACTIONS, parseKeyBindings, validKeyBindings } from '../src/keyboard-settings';
import type { FlightInput } from '../src/types';

const neutral = (): FlightInput => ({ turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false, steeringRevision: 0 });

test('fixed source flight and camera tuning remain unchanged', () => {
  assert.equal(CRUISE_SPEED, 110); assert.equal(MAX_SPEED, 141); assert.equal(STALL_SPEED, 65);
  assert.equal(LOOP_DURATION, 5); assert.equal(FLIGHT_FOV, 64); assert.equal(FLIGHT_CAMERA_BANK_FACTOR, 0.45);
  const aircraft = createPlayer();
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(aircraft, 'easy', position, rotation);
  assert.deepEqual(position.toArray(), [0, 1011, 2029]);
  const forward = new Vector3(0, 0, -1).applyQuaternion(rotation);
  assert.ok(Math.abs(forward.y / -forward.z + 11 / 479) < 1e-12);
});

test('right turn, climb and throttle preserve physical signs and bounded speed', () => {
  const aircraft = createPlayer();
  for (let tick = 0; tick < 60; tick += 1) updateAircraftMotion(aircraft, 1, 1, FIXED_DT, MAX_SPEED, false, MAX_SPEED, 0.95);
  assert.ok(aircraft.yaw < 0 && aircraft.bank > 0);
  assert.ok(aircraft.position.x > 0 && aircraft.position.y > 1000);
  const meta = createFlightController(aircraft);
  for (let tick = 0; tick < 1000; tick += 1) advanceThrottle(meta, { ...neutral(), accelerate: true }, 'normal', FIXED_DT);
  assert.equal(meta.playerTargetSpeed, MAX_SPEED);
  for (let tick = 0; tick < 1000; tick += 1) advanceThrottle(meta, { ...neutral(), brake: true }, 'normal', FIXED_DT);
  assert.equal(meta.playerTargetSpeed, STALL_SPEED);
  const easyMeta = createFlightController(createPlayer());
  advanceThrottle(easyMeta, { ...neutral(), accelerate: true, brake: true }, 'easy', 20);
  assert.equal(easyMeta.playerTargetSpeed, CRUISE_SPEED);
});

test('five second loop ends once and new steering interrupts without teleportation', () => {
  const aircraft = createPlayer(), meta = createFlightController(aircraft);
  let completions = 0;
  for (let tick = 0; tick < 301; tick += 1) {
    const input = { ...neutral(), loop: tick === 0 };
    completions += Number(updatePlayerLoop(aircraft, meta, input, input, input.loop, FIXED_DT, CRUISE_SPEED, MAX_SPEED, 1));
  }
  assert.equal(completions, 1); assert.equal(aircraft.loopProgress, 0); assert.ok(aircraft.loopCooldown > 1.9);
  assert.ok(Math.abs(aircraft.pitch) < 1e-10);
  const cancelling = createPlayer(), cancellingMeta = createFlightController(cancelling);
  const first = { ...neutral(), loop: true };
  updatePlayerLoop(cancelling, cancellingMeta, first, first, true, FIXED_DT, CRUISE_SPEED, MAX_SPEED, 1);
  for (let tick = 0; tick < 60; tick += 1) updatePlayerLoop(cancelling, cancellingMeta, neutral(), neutral(), false, FIXED_DT, CRUISE_SPEED, MAX_SPEED, 1);
  const previous = cancelling.position.clone(), input = { ...neutral(), turn: 1, steeringRevision: 1 };
  updatePlayerLoop(cancelling, cancellingMeta, input, input, false, FIXED_DT, CRUISE_SPEED, MAX_SPEED, 1);
  assert.equal(cancelling.loopProgress, 0); assert.equal(cancellingMeta.playerLoopActive, false);
  assert.ok(cancelling.position.distanceTo(previous) <= MAX_SPEED * FIXED_DT + 1e-9);
});

test('no P1 placeholder target pulls steering; hidden/dead targets are rejected and shot correction is finite', () => {
  const aircraft = createPlayer(), input = { ...neutral(), turn: -0.5, climb: 0.3 };
  assert.deepEqual(getFlightAssist(aircraft, [], input, 'easy'), { turn: -0.5, climb: 0.3, responseMultiplier: 1, hasVisibleTarget: false });
  const result = getFlightAssist(aircraft, [{ aimPoint: new Vector3(0, 1000, 1900), alive: true, exposed: false }], neutral(), 'easy');
  assert.equal(result.hasVisibleTarget, false); assert.equal(result.turn, 0); assert.equal(result.climb, 0);
  const forward = new Vector3(0, 0, -1), prediction = new Vector3(Math.sin(0.12), 0, -Math.cos(0.12));
  const corrected = applyEasyShotCorrection(forward, prediction);
  assert.ok(forward.angleTo(corrected) <= EASY_SHOT_MAX_ANGLE + 1e-10);
  assert.deepEqual(forward.toArray(), [0, 0, -1]);
  assert.deepEqual(applyEasyShotCorrection(forward, new Vector3(1, 0, 0)).toArray(), forward.toArray());
});

test('preparation, pause, report and stale callbacks keep one authoritative operation', () => {
  const session = new FlightSession();
  session.step(neutral()); assert.equal(session.tick, 0);
  const first = session.prepare('normal')!;
  assert.equal(session.prepare('easy'), null);
  session.home();
  const second = session.prepare('normal')!;
  assert.equal(session.begin(first), false); assert.equal(session.begin(second), true);
  for (let tick = 0; tick < 60; tick += 1) session.step(neutral());
  session.pause('manual');
  const position = session.player.position.clone();
  for (let tick = 0; tick < 100; tick += 1) session.step({ ...neutral(), turn: 1, loop: true });
  assert.equal(session.tick, 60); assert.ok(session.player.position.equals(position));
  assert.equal(session.resume(), true); session.step(neutral()); assert.equal(session.tick, 61);
  assert.equal(session.finish('aborted'), true); assert.equal(session.finish('aborted'), false);
  assert.equal(session.report?.kind, 'flight-prototype'); assert.equal(session.report?.endTick, 61); assert.ok(Object.isFrozen(session.report));
  session.step(neutral()); assert.equal(session.tick, 61);
  const third = session.prepare(session.mode)!;
  assert.equal(session.mode, 'normal'); assert.equal(session.tick, 0); assert.equal(session.report, null); assert.ok(third > second);
});

test('accepted fixed-tick inputs produce the same final flight at 30/60/120Hz rendering', () => {
  const samples = [30, 60, 120].map(hz => {
    const session = new FlightSession(), clock = new FixedStepper();
    session.begin(session.prepare('normal')!); clock.reset(0);
    for (let frame = 1; frame <= hz * 10; frame += 1) {
      clock.frame(frame * 1000 / hz, true, () => {
        const tick = session.tick;
        session.step({ ...neutral(), turn: tick > 120 && tick < 240 ? 0.3 : 0,
          climb: tick > 300 && tick < 420 ? 0.4 : 0, accelerate: tick < 120, loop: tick === 480,
          steeringRevision: tick > 420 ? 2 : tick > 300 ? 1 : 0 });
      }, () => assert.fail('ordinary frames must not cause a gap stop'));
    }
    return { tick: session.tick, position: session.player.position.toArray(), quaternion: session.player.quaternion.toArray(), speed: session.player.speed, loop: session.player.loopProgress };
  });
  assert.equal(samples[0].tick, 600); assert.deepEqual(samples[0], samples[1]); assert.deepEqual(samples[1], samples[2]);
});

test('keyboard schema exposes nine actions and rejects invalid or duplicate settings', () => {
  assert.equal(KEY_ACTIONS.length, 9); assert.ok(validKeyBindings(DEFAULT_KEY_BINDINGS));
  assert.equal(isBindableCode('Tab'), false); assert.equal(isBindableCode('F5'), false); assert.equal(isBindableCode('Escape', 'fire'), false);
  assert.equal(validKeyBindings({ ...DEFAULT_KEY_BINDINGS, left: 'ArrowRight' }), false);
  assert.deepEqual(parseKeyBindings(JSON.stringify({ version: 4, bindings: { ...DEFAULT_KEY_BINDINGS, left: 'KeyQ' } })), DEFAULT_KEY_BINDINGS);
  const modified = { ...DEFAULT_KEY_BINDINGS, left: 'KeyQ' };
  assert.deepEqual(parseKeyBindings(JSON.stringify({ version: 1, bindings: modified })), modified);
  const keyboardEvent = (props = {}) => ({ code: 'KeyQ', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...props } as KeyboardEvent);
  assert.equal(captureKey(keyboardEvent({ isComposing: true })).kind, 'ignore');
  assert.equal(captureKey(keyboardEvent({ ctrlKey: true })).kind, 'error');
  assert.equal(captureKey(keyboardEvent({ code: 'Escape' })).kind, 'cancel');
});
