import type { PauseSafetySnapshot } from './pause-safety-observer';

function exact(value: unknown): string {
  // Infinity is a legitimate AI sentinel. Do not collapse it and NaN to null.
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item);
}

export function neutralInputViolations(input: PauseSafetySnapshot['input']): string[] {
  const failures: string[] = [];
  if (input.turn !== 0 || input.climb !== 0 || input.throttle !== 0) failures.push('held steering/throttle');
  if (input.steerPointer !== null || input.throttlePointer !== null) failures.push('held pointer owner');
  if (input.keys.length || Object.values(input.heldPointers).some(pointers => pointers.length)) failures.push('held keys/buttons');
  return failures;
}

/** Used unchanged by browser checks and isolated negative fixtures. */
export function gapFreezeViolations(before: PauseSafetySnapshot, after: PauseSafetySnapshot): string[] {
  const failures: string[] = [];
  if (after.phase !== 'paused' || after.pauseReason !== 'gap') failures.push('gap did not pause');
  if (after.elapsed !== before.elapsed) failures.push('elapsed display advanced');
  for (const key of Object.keys(before.world) as (keyof PauseSafetySnapshot['world'])[]) {
    if (exact(before.world[key]) !== exact(after.world[key])) failures.push(`authoritative ${key} advanced`);
  }
  return failures.concat(neutralInputViolations(after.input));
}
