import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logicalTick, comparableThrottleState } from '../scripts/capture-throttle-time.mjs';
import { formatOperationTime } from '../src/hud-presentation';

test('current minute clock identifies exact capture and minute-boundary ticks', () => {
  for (const tick of [0, 1, 2, 11, 12, 13, 59, 60, 3599, 3600, 3601, 359999, 360000]) {
    assert.equal(logicalTick({ elapsed: formatOperationTime(tick) }), tick);
  }
});

test('preserved baseline decimal seconds identify the same logical ticks', () => {
  for (let tick = 0; tick <= 7200; tick += 1) {
    assert.equal(logicalTick({ elapsed: `${(tick / 60).toFixed(2)} s` }), tick);
    assert.equal(logicalTick({ elapsed: formatOperationTime(tick) }), tick);
  }
});

test('unknown or malformed elapsed values fail instead of fabricating tick zero', () => {
  for (const elapsed of ['', '0', '00:60.00', '00:00', '0:00.00', '00:00.000', '-1.00 s', 'NaN s', '00:00.20 trailing', ' 00:00.20', null, undefined, '99999999999999999999:00.00']) {
    assert.throws(() => logicalTick({ elapsed }));
  }
});

test('comparison preserves raw evidence and differences in every state field', () => {
  const baseline = { elapsed: '0.20 s', phase: 'playing', mode: 'normal', speed: '110 m/s', altitude: '1000 m', loop: 'ready', fire: 'ready' };
  const candidate = { ...baseline, elapsed: '00:00.20' };
  assert.deepEqual(comparableThrottleState(candidate), comparableThrottleState(baseline));
  assert.equal(candidate.elapsed, '00:00.20');
  assert.equal(baseline.elapsed, '0.20 s');
  for (const key of ['phase', 'mode', 'altitude', 'loop', 'fire']) {
    assert.notDeepEqual(comparableThrottleState({ ...candidate, [key]: 'changed' }), comparableThrottleState(baseline), key);
  }
  assert.notDeepEqual(comparableThrottleState({ ...candidate, speed: '111 m/s' }), comparableThrottleState(baseline));
  assert.notDeepEqual(comparableThrottleState({ ...candidate, elapsed: '00:00.22' }), comparableThrottleState(baseline));
});

test('comparison matches exact displayed speed quantities across m/s and km/h without rounding tolerance', () => {
  for (const [metresPerSecond, kilometresPerHour] of [[0, 0], [40, 144], [110, 396], [125, 450]]) {
    const before = { elapsed: '0.20 s', speed: `${metresPerSecond} m/s` };
    const after = { elapsed: '00:00.20', speed: `${kilometresPerHour} km/h` };
    assert.deepEqual(comparableThrottleState(after), comparableThrottleState(before));
    assert.equal(before.speed, `${metresPerSecond} m/s`);
    assert.equal(after.speed, `${kilometresPerHour} km/h`);
    for (const differentSpeed of [kilometresPerHour + 1, Math.max(0, kilometresPerHour - 1)].filter(value => value !== kilometresPerHour)) {
      assert.notDeepEqual(comparableThrottleState({ ...after, speed: `${differentSpeed} km/h` }), comparableThrottleState(before));
    }
  }
  // Display rounding must not silently accept a neighbouring whole km/h.
  assert.notDeepEqual(comparableThrottleState({ elapsed: '0.20 s', speed: '111 m/s' }), comparableThrottleState({ elapsed: '00:00.20', speed: '400 km/h' }));
});

test('invalid speed displays fail instead of removing the speed comparison', () => {
  for (const speed of ['', '110', '110 mph', '-1 m/s', '110.0 m/s', '396 km/h extra', ' 396 km/h', 'NaN km/h', undefined, null, '999999999999999999 m/s']) {
    assert.throws(() => comparableThrottleState({ elapsed: '00:00.20', speed }));
  }
});
