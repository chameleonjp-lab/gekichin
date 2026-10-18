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

test('comparison normalizes only elapsed formatting and preserves the raw evidence', () => {
  const baseline = { elapsed: '0.20 s', phase: 'playing', mode: 'normal', speed: '110 m/s', altitude: '1000 m', loop: 'ready', fire: 'ready' };
  const candidate = { ...baseline, elapsed: '00:00.20' };
  assert.deepEqual(comparableThrottleState(candidate), comparableThrottleState(baseline));
  assert.equal(candidate.elapsed, '00:00.20');
  assert.equal(baseline.elapsed, '0.20 s');
  for (const key of ['phase', 'mode', 'speed', 'altitude', 'loop', 'fire']) {
    assert.notDeepEqual(comparableThrottleState({ ...candidate, [key]: 'changed' }), comparableThrottleState(baseline), key);
  }
  assert.notDeepEqual(comparableThrottleState({ ...candidate, elapsed: '00:00.22' }), comparableThrottleState(baseline));
});
