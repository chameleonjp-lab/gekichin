import assert from 'node:assert/strict';

export function logicalTick(state) {
 assert.equal(typeof state.elapsed, 'string', 'Elapsed HUD must contain a time string');
 const clock = /^(\d{2,}):([0-5]\d)\.(\d{2})$/.exec(state.elapsed);
 const seconds = /^(\d+)\.(\d{2}) s$/.exec(state.elapsed);
 assert.ok(clock || seconds, 'Elapsed HUD must contain MM:SS.cc or decimal seconds to two places');
 const centiseconds = clock
  ? Number(clock[1]) * 6000 + Number(clock[2]) * 100 + Number(clock[3])
  : Number(seconds[1]) * 100 + Number(seconds[2]);
 assert.ok(Number.isSafeInteger(centiseconds), 'Elapsed HUD time must be a safe integer number of centiseconds');
 // At 60 Hz, two decimal places identify each tick without overlap.
 return Math.round(centiseconds * .6);
}

export function comparableThrottleState(state) {
 // Preserve the original HUD text in capture evidence; normalize only the
 // elapsed display format when comparing old and current HUD versions.
 return { ...state, elapsed: logicalTick(state) };
}
