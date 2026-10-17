import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { CRUISE_SPEED, ENEMY_MAX_PITCH, LOOP_DURATION, MAX_SPEED, STALL_SPEED, advanceThrottle, createFlightController, normalizeAngle, updateAircraftMotion, updatePlayerLoop, updateQuaternion } from '../src/flight';
import { FLIGHT_CAMERA_BANK_FACTOR, FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { applyEasyShotCorrection, EASY_SHOT_MAX_ANGLE, getFlightAssist } from '../src/flight-assist';
import { createPlayer, FixedStepper, FlightSession } from '../src/game-state';
import { FIXED_DT } from '../src/rules';
import { captureKey, DEFAULT_KEY_BINDINGS, isBindableCode, KEY_ACTIONS, parseKeyBindings, validKeyBindings } from '../src/keyboard-settings';
import type { FlightInput } from '../src/types';

const neutral = (): FlightInput => ({ turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false, steeringRevision: 0 });

function cameraForward(player: ReturnType<typeof createPlayer>, mode: 'easy' | 'normal'): Vector3 {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(player, mode, position, rotation);
  return new Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
}

function angleBetween(from: Vector3, to: Vector3): number {
  return Math.atan2(new Vector3().crossVectors(from, to).length(), from.dot(to));
}

function authority(speed: number): number {
  const lowSpeed = speed <= STALL_SPEED + 20
    ? 0.92 + ((speed - STALL_SPEED) / 20) * 0.23
    : speed <= CRUISE_SPEED
      ? 1.15 - ((speed - (STALL_SPEED + 20)) / (CRUISE_SPEED - (STALL_SPEED + 20))) * 0.15
      : 1;
  return lowSpeed * Math.max(0.78, Math.min(1, 1 - Math.max(0, speed - 115) * 0.008));
}

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

test('manual camera forward has equal total angle for all directions, modes, speeds and attitudes', () => {
  for (const mode of ['easy', 'normal'] as const) for (const speed of [65, 85, 110, 141]) {
    for (const pitch of [-0.9, 0, 0.9]) for (const bank of [-0.72, 0, 0.72]) {
      for (const yaw of [-3.14, 0, 3.14]) for (let direction = 0; direction < 8; direction += 1) {
        for (const strength of [0.25, 0.45, 0.6]) {
          const player = createPlayer();
          Object.assign(player, { speed, pitch, bank, yaw }); updateQuaternion(player);
          const before = cameraForward(player, mode);
          const theta = direction * Math.PI / 4;
          const input = { ...neutral(), turn: Math.cos(theta) * strength, climb: Math.sin(theta) * strength, steeringActive: true };
          updatePlayerLoop(player, createFlightController(player), input, input, false, FIXED_DT, speed, MAX_SPEED, 1, mode);
          const expected = 0.82 * authority(speed) * FIXED_DT * strength;
          const actual = angleBetween(before, cameraForward(player, mode));
          assert.ok(Math.abs(actual - expected) <= 1e-12,
            `${mode}, speed=${speed}, pitch=${pitch}, bank=${bank}, yaw=${yaw}, direction=${direction}, strength=${strength}: ${actual} vs ${expected}`);
        }
      }
    }
  }
});

test('manual horizontal turn holds pitch, while neutral leveling is rate-limited and directly counted', () => {
  for (const mode of ['easy', 'normal'] as const) for (const speed of [65, 85, 110, 141]) for (const pitch of [-0.9, 0.9]) {
    const player = createPlayer(); Object.assign(player, { speed, pitch, bank: 0.4, yaw: -2.2 }); updateQuaternion(player);
    const manual = { ...neutral(), turn: 0.6, steeringActive: true };
    const before = cameraForward(player, mode), pitchBefore = player.pitch;
    updatePlayerLoop(player, createFlightController(player), manual, manual, false, FIXED_DT, speed, MAX_SPEED, 1, mode);
    assert.equal(player.pitch, pitchBefore, 'horizontal manual steering must retain pitch');
    const actual = angleBetween(before, cameraForward(player, mode));
    const expected = 0.82 * authority(speed) * FIXED_DT * 0.6;
    assert.ok(Math.abs(actual - expected) <= 1e-12, `must measure camera forward before-to-after without subtracting leveling: ${actual} vs ${expected}`);

    const neutralPlayer = createPlayer(); Object.assign(neutralPlayer, { speed, pitch, bank: -0.3, yaw: 2.2 }); updateQuaternion(neutralPlayer);
    const neutralInput = { ...neutral(), steeringActive: true };
    const neutralBefore = cameraForward(neutralPlayer, mode), neutralPitch = neutralPlayer.pitch;
    updatePlayerLoop(neutralPlayer, createFlightController(neutralPlayer), neutralInput, neutralInput, false,
      FIXED_DT, speed, MAX_SPEED, 1, mode);
    const leveled = angleBetween(neutralBefore, cameraForward(neutralPlayer, mode));
    const rateCap = 0.82 * authority(speed) * FIXED_DT;
    assert.ok(Math.abs(neutralPlayer.pitch - neutralPitch) <= rateCap + 1e-12);
    assert.ok(Math.abs(leveled - Math.min(Math.abs(neutralPitch) * (1 - Math.exp(-FIXED_DT * 4.2)), rateCap)) <= 1e-12);
  }
});

test('manual response multiplier is horizontal-only and diagonals are circularly bounded', () => {
  for (const mode of ['easy', 'normal'] as const) for (const pitch of [-0.9, 0.9]) for (const strength of [0.25, 0.45, 0.6]) {
    const player = createPlayer(); Object.assign(player, { speed: 110, pitch, bank: 0.2, yaw: -0.7 }); updateQuaternion(player);
    const before = cameraForward(player, mode), input = { ...neutral(), turn: strength * Math.SQRT1_2, climb: strength * Math.SQRT1_2, steeringActive: true };
    updatePlayerLoop(player, createFlightController(player), input, input, false, FIXED_DT, 110, MAX_SPEED, 1.65, mode);
    const expected = 0.82 * authority(110) * FIXED_DT * Math.hypot(input.turn * 1.65, input.climb);
    assert.ok(Math.abs(angleBetween(before, cameraForward(player, mode)) - expected) <= 1e-12);
  }
  const player = createPlayer(); Object.assign(player, { pitch: 0, bank: 0, yaw: 0 }); updateQuaternion(player);
  const diagonal = { ...neutral(), turn: 1, climb: 1, steeringActive: true }, before = cameraForward(player, 'normal');
  updatePlayerLoop(player, createFlightController(player), diagonal, diagonal, false, FIXED_DT, 110, MAX_SPEED, 1, 'normal');
  assert.ok(Math.abs(angleBetween(before, cameraForward(player, 'normal')) - 0.82 * FIXED_DT) <= 1e-12,
    'a keyboard diagonal above unit length must normalize to the unit circle');
});

test('Easy absolute assistance and default AI motion keep their pre-manual operation order', () => {
  const player = createPlayer(); player.pitch = 0.6; updateQuaternion(player);
  const userInput = neutral(), adjusted = { ...neutral(), climb: -0.2 };
  updatePlayerLoop(player, createFlightController(player), adjusted, userInput, false, FIXED_DT, CRUISE_SPEED, CRUISE_SPEED, 1, 'easy');
  const expectedPitch = 0.6 + (-0.2 * 0.95 - 0.6) * (1 - Math.exp(-FIXED_DT * 4.2));
  assert.equal(player.pitch, expectedPitch, 'absolute Easy assistance keeps the old exponential pitch response');

  const npc = createPlayer(); Object.assign(npc, { speed: 85, pitch: 0.4, yaw: 0.3, bank: 0.2 }); updateQuaternion(npc);
  const before = { pitch: npc.pitch, yaw: npc.yaw, bank: npc.bank };
  const turn = 0.3, climb = -0.2, response = 1.65;
  updateAircraftMotion(npc, turn, climb, FIXED_DT, CRUISE_SPEED, false, MAX_SPEED, ENEMY_MAX_PITCH, response);
  const expectedAuthority = authority(85);
  assert.equal(npc.pitch, before.pitch + (climb * ENEMY_MAX_PITCH - before.pitch) * (1 - Math.exp(-FIXED_DT * 4.2)));
  let yawWrapped = (before.yaw - turn * 0.82 * expectedAuthority * response * FIXED_DT + Math.PI) % (Math.PI * 2);
  if (yawWrapped < 0) yawWrapped += Math.PI * 2;
  assert.equal(npc.yaw, yawWrapped - Math.PI, 'the preserved AI yaw normalization operation order is exact');
  assert.equal(npc.bank, before.bank + (turn * 0.72 - before.bank) * (1 - Math.exp(-FIXED_DT * 5.5)));
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
  for (const mode of ['easy','normal'] as const) for (const interruptedTick of [60,90,150,210,270]) {
    const cancelling=createPlayer(),cancellingMeta=createFlightController(cancelling),first={...neutral(),loop:true};
    updatePlayerLoop(cancelling,cancellingMeta,first,first,true,FIXED_DT,CRUISE_SPEED,MAX_SPEED,1,mode);
    for(let tick=0;tick<interruptedTick;tick+=1)updatePlayerLoop(cancelling,cancellingMeta,neutral(),neutral(),false,FIXED_DT,CRUISE_SPEED,MAX_SPEED,1,mode);
    const previous=cancelling.position.clone(),beforeCamera=cameraForward(cancelling,mode),pitchBefore=cancelling.pitch;
    const angularStep=0.82*authority(cancelling.speed)*FIXED_DT,input={...neutral(),turn:1,steeringRevision:1};
    updatePlayerLoop(cancelling,cancellingMeta,input,input,false,FIXED_DT,CRUISE_SPEED,MAX_SPEED,1,mode);
    assert.equal(cancelling.loopProgress,0);assert.equal(cancellingMeta.playerLoopActive,false);
    assert.ok(cancelling.position.distanceTo(previous)<=MAX_SPEED*FIXED_DT+1e-9);
    const actualCameraAngle=angleBetween(beforeCamera,cameraForward(cancelling,mode));
    assert.ok(actualCameraAngle<0.1,`${mode} interruption at ${interruptedTick} ticks uses actual camera forward before-to-after: ${actualCameraAngle}`);
    assert.ok(Math.abs(normalizeAngle(cancelling.pitch-pitchBefore))<=angularStep+1e-12,`${mode} loop recovery pitch is rate-limited modulo full turns at ${interruptedTick}`);
  }
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
  assert.equal(session.report?.kind, 'mission-result'); assert.equal(session.report?.outcome, 'aborted');
  assert.equal(session.report?.reason, 'aborted'); assert.equal(session.report?.endTick, 61); assert.ok(Object.isFrozen(session.report));
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
