import { Quaternion, Vector3 } from 'three';
import { advanceThrottle, createFlightController, updatePlayerLoop, updateQuaternion, CRUISE_SPEED, MAX_SPEED, type FlightController } from './flight';
import { FIXED_DT, INITIAL_SEED, RULES_VERSION } from './rules';
import { getFlightAssist } from './flight-assist';
import type { Aircraft, FlightInput, FlightReport, GameMode, GamePhase, PauseReason } from './types';

export function createPlayer(): Aircraft {
  const player: Aircraft = {
    position: new Vector3(0, 1000, 2000), previous: new Vector3(0, 1000, 2000),
    quaternion: new Quaternion(), yaw: 0, pitch: 0, bank: 0,
    speed: CRUISE_SPEED, loopProgress: 0, loopCooldown: 0,
  };
  updateQuaternion(player);
  return player;
}

/** One operation, one fixed-tick owner. No draw or UI code can advance time. */
export class FlightSession {
  phase: GamePhase = 'home';
  mode: GameMode = 'easy';
  operationId = 0;
  seed = INITIAL_SEED;
  tick = 0;
  player = createPlayer();
  controller: FlightController = createFlightController(this.player);
  pauseReason: PauseReason | null = null;
  report: FlightReport | null = null;

  prepare(mode: GameMode): number | null {
    if (!['home', 'result'].includes(this.phase)) return null;
    this.operationId += 1;
    this.mode = mode;
    this.phase = 'preparing';
    this.tick = 0;
    this.player = createPlayer();
    this.controller = createFlightController(this.player);
    this.pauseReason = null;
    this.report = null;
    return this.operationId;
  }

  begin(operationId: number): boolean {
    if (this.phase !== 'preparing' || operationId !== this.operationId) return false;
    this.phase = 'playing';
    return true;
  }

  pause(reason: PauseReason): boolean {
    if (this.phase !== 'playing') return false;
    this.phase = 'paused';
    this.pauseReason = reason;
    return true;
  }

  resume(): boolean {
    if (this.phase !== 'paused') return false;
    this.phase = 'playing';
    this.pauseReason = null;
    return true;
  }

  step(input: FlightInput): void {
    if (this.phase !== 'playing') return;
    this.player.previous.copy(this.player.position);
    const speed = this.mode === 'easy' ? CRUISE_SPEED : MAX_SPEED;
    const preferredSpeed = advanceThrottle(this.controller, input, this.mode, FIXED_DT);
    // Target pull and auto-fire need valid turret/occlusion data from P2/P4.
    // The P1 placeholder intentionally provides neither a lock nor a shot.
    const assist = getFlightAssist(this.player, [], input, this.mode);
    updatePlayerLoop(this.player, this.controller, { ...input, turn: assist.turn, climb: assist.climb }, input, input.loop,
      FIXED_DT, preferredSpeed, speed, assist.responseMultiplier);
    this.tick += 1;
  }

  finish(reason: FlightReport['reason'] = 'completed'): boolean {
    if (this.phase !== 'playing' && this.phase !== 'paused') return false;
    this.report = Object.freeze({
      kind: 'flight-prototype', operationId: this.operationId, rulesVersion: RULES_VERSION,
      mode: this.mode, seed: this.seed, endTick: this.tick, reason,
    });
    this.phase = 'result';
    this.pauseReason = null;
    return true;
  }

  home(): void {
    // Invalidate a pending preparation callback even if it resolves later.
    this.operationId += 1;
    this.phase = 'home';
    this.pauseReason = null;
    this.report = null;
    this.tick = 0;
    this.player = createPlayer();
    this.controller = createFlightController(this.player);
  }
}

/** Frame scheduling is separate from flight, so gap/stop cannot create a giant dt. */
export class FixedStepper {
  private previous: number | null = null;
  private accumulated = 0;

  reset(now?: number): void {
    this.previous = now ?? null;
    this.accumulated = 0;
  }

  frame(now: number, active: boolean, step: () => void, gap: () => void): number {
    if (this.previous === null) { this.previous = now; return 0; }
    const elapsed = Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    if (!active) { this.accumulated = 0; return 0; }
    if (elapsed >= 2) { this.accumulated = 0; gap(); return 0; }
    this.accumulated += elapsed;
    // A short scheduling interruption runs bounded ordinary 60Hz steps.
    const ticks = Math.floor((this.accumulated + 1e-10) / FIXED_DT);
    for (let index = 0; index < ticks; index += 1) step();
    this.accumulated = Math.max(0, this.accumulated - ticks * FIXED_DT);
    return ticks;
  }
}
