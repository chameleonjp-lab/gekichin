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
 assert.equal(typeof state.speed, 'string', 'Speed HUD must contain a speed string');
 const speed = /^(\d+) (m\/s|km\/h)$/.exec(state.speed);
 assert.ok(speed, 'Speed HUD must contain integer m/s or km/h');
 // Compare exact displayed quantities in eighteenths of m/s. Multiplication
 // by integers avoids conversion rounding; a neighbouring km/h still fails.
 const speedUnits = Number(speed[1]) * (speed[2] === 'm/s' ? 18 : 5);
 assert.ok(Number.isSafeInteger(speedUnits), 'Speed HUD must contain a safe integer quantity');
 // Preserve both raw displays in capture evidence, and every other field.
 return { ...state, elapsed: logicalTick(state), speed: speedUnits };
}
