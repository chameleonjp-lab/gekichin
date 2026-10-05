import { RULES_VERSION } from './rules';
import type { AircraftOwner, CombatReport, MissionOutcome, ScoreComponents, ScoreTotals } from './combat-types';
import type { GameMode } from './types';
export type { CombatReport, ScoreComponents, ScoreTotals } from './combat-types';

export function scoreComponents(totals: ScoreTotals, endTick: number, victory: boolean): ScoreComponents {
  const accuracy = totals.N > 0 ? (totals.Hmain + totals.Hmg) / totals.N : null;
  const destruction = 1_000 * totals.K;
  const damage = 2 * totals.damageMilli / 1_000;
  const time = victory ? 50_000 / (1 + endTick / 18_000) : 0;
  const playerLoss = 2_000 * totals.P, wingmanLoss = 500 * totals.W;
  const accuracyLoss = accuracy === null ? 0 : 20_000 * (1 - accuracy);
  return { destruction, damage, time, playerLoss, wingmanLoss, accuracyLoss,
    total: Math.floor(destruction + damage + time - playerLoss - wingmanLoss - accuracyLoss), accuracy };
}

/** The same confirmed events feed HUD, results and best comparison. */
export class ScoreLedger {
  readonly totals: ScoreTotals = { K: 0, damageMilli: 0, P: 0, W: 0, N: 0, Hmain: 0, Hmg: 0,
    playerKills: 0, wingmanKills: 0, playerDamageMilli: 0, wingmanDamageMilli: 0, mainKills: 0, mgKills: 0 };
  private lastShotAttackId = -1;
  private retiredAttackId = -1;
  private readonly hits = new Set<number>();
  private readonly losses = new Set<number>();
  private readonly kills = new Set<number>();

  recordShot(attackId: number, owner: AircraftOwner): void {
    // Allocated attack IDs are monotonic; old callbacks cannot add a shot twice.
    if (attackId <= this.lastShotAttackId) return;
    this.lastShotAttackId = attackId;
    if (owner === 'player') this.totals.N += 1;
  }
  recordDamage(attackId: number, owner: AircraftOwner, kind: 'main' | 'mg', targetId: number, actualMilli: number, killed: boolean): void {
    if (actualMilli <= 0 || attackId <= this.retiredAttackId || this.hits.has(attackId)) return;
    this.hits.add(attackId);
    this.totals.damageMilli += actualMilli;
    this.totals[owner === 'player' ? 'playerDamageMilli' : 'wingmanDamageMilli'] += actualMilli;
    if (owner === 'player') this.totals[kind === 'main' ? 'Hmain' : 'Hmg'] += 1;
    if (killed && !this.kills.has(targetId)) {
      this.kills.add(targetId);
      this.totals.K += 1;
      this.totals[owner === 'player' ? 'playerKills' : 'wingmanKills'] += 1;
      this.totals[kind === 'main' ? 'mainKills' : 'mgKills'] += 1;
    }
  }
  recordLoss(tokenId: number, owner: AircraftOwner): void {
    if (this.losses.has(tokenId)) return;
    this.losses.add(tokenId);
    this.totals[owner === 'player' ? 'P' : 'W'] += 1;
  }
  /** Only IDs of live, finite-lifetime projectiles can ever produce new hits. */
  retireAttackIds(beforeId: number): void {
    this.retiredAttackId = Math.max(this.retiredAttackId, beforeId - 1);
    for (const id of this.hits) if (id <= this.retiredAttackId) this.hits.delete(id);
  }
  get retainedHitIds(): number { return this.hits.size; }
  components(tick: number, victory = false): ScoreComponents { return scoreComponents(this.totals, tick, victory); }
  report(operationId: number, mode: GameMode, seed: number, endTick: number, outcome: MissionOutcome): CombatReport {
    return Object.freeze({ kind: 'mission-result', operationId, rulesVersion: RULES_VERSION, mode, seed, endTick,
      reason: outcome === 'aborted' ? 'aborted' : 'completed', outcome, ...this.totals,
      components: Object.freeze(this.components(endTick, outcome === 'victory')) });
  }
  assertInvariants(): void {
    const t = this.totals;
    if (t.K < 0 || t.K > 100 || t.damageMilli < 0 || t.damageMilli > 24_000_000 || t.Hmain + t.Hmg > t.N
      || t.playerKills + t.wingmanKills !== t.K || t.mainKills + t.mgKills !== t.K
      || t.playerDamageMilli + t.wingmanDamageMilli !== t.damageMilli || t.P + t.W > 50) throw new Error('Score conservation violated');
  }
}

export interface BestStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void }
export type BestError = 'unavailable' | 'future-version' | 'write-failed' | null;
export interface BestSaveResult { saved: boolean; best: CombatReport | null; error: BestError }
export const bestKey = (mode: GameMode) => `gekichin-best-${RULES_VERSION}-${mode}`;
const integers: (keyof ScoreTotals)[] = ['K', 'damageMilli', 'P', 'W', 'N', 'Hmain', 'Hmg', 'playerKills', 'wingmanKills', 'playerDamageMilli', 'wingmanDamageMilli', 'mainKills', 'mgKills'];

export function validCombatReport(value: unknown, mode?: GameMode): value is CombatReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as CombatReport;
  if (r.kind !== 'mission-result' || r.rulesVersion !== RULES_VERSION || !['easy', 'normal'].includes(r.mode) || (mode && r.mode !== mode)
    || !['victory', 'defeat', 'mutual', 'aborted'].includes(r.outcome) || r.reason !== (r.outcome === 'aborted' ? 'aborted' : 'completed')
    || !Number.isSafeInteger(r.endTick) || r.endTick < 0 || !Number.isSafeInteger(r.operationId) || r.operationId < 0
    || !Number.isSafeInteger(r.seed) || r.seed < 0 || r.seed > 0xffff_ffff
    || integers.some(key => !Number.isSafeInteger(r[key]) || r[key] < 0)) return false;
  if (r.K > 100 || r.damageMilli > 24_000_000 || r.P + r.W > 50 || r.Hmain + r.Hmg > r.N || r.mainKills > 20 || r.mgKills > 80
    || r.playerKills + r.wingmanKills !== r.K || r.mainKills + r.mgKills !== r.K || r.playerDamageMilli + r.wingmanDamageMilli !== r.damageMilli
    || (r.outcome === 'victory' && (r.K !== 100 || r.damageMilli !== 24_000_000))) return false;
  const expected = scoreComponents(r, r.endTick, r.outcome === 'victory');
  return !!r.components && Object.keys(expected).every(key => r.components[key as keyof ScoreComponents] === expected[key as keyof ScoreComponents]);
}

function browserStorage(): BestStorage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
function parseBest(raw: string | null, mode: GameMode): { best: CombatReport | null; future: boolean } {
  try {
    const envelope = raw ? JSON.parse(raw) : null;
    if (typeof envelope?.version === 'number' && envelope.version > 1) return { best: null, future: true };
    return { best: envelope?.version === 1 && validCombatReport(envelope.record, mode) && envelope.record.outcome === 'victory' ? envelope.record : null, future: false };
  } catch { return { best: null, future: false }; }
}
export function readBest(mode: GameMode, storage: BestStorage | null = browserStorage()): CombatReport | null {
  try { return storage ? parseBest(storage.getItem(bestKey(mode)), mode).best : null; } catch { return null; }
}
export function isBetterBest(candidate: CombatReport, previous: CombatReport | null): boolean {
  if (candidate.outcome !== 'victory') return false;
  if (!previous) return true;
  return candidate.components.total > previous.components.total
    || (candidate.components.total === previous.components.total && candidate.endTick < previous.endTick)
    || (candidate.components.total === previous.components.total && candidate.endTick === previous.endTick && candidate.P + candidate.W < previous.P + previous.W);
}
export function saveBest(report: CombatReport, storage: BestStorage | null = browserStorage()): BestSaveResult {
  if (!storage) return { saved: false, best: null, error: 'unavailable' };
  let current: ReturnType<typeof parseBest>;
  let previous: string | null;
  const key = bestKey(report.mode);
  try { previous = storage.getItem(key); current = parseBest(previous, report.mode); }
  catch { return { saved: false, best: null, error: 'unavailable' }; }
  if (current.future) return { saved: false, best: null, error: 'future-version' };
  if (!validCombatReport(report) || !isBetterBest(report, current.best)) return { saved: false, best: current.best, error: null };
  try { storage.setItem(key, JSON.stringify({ version: 1, record: report })); return { saved: true, best: report, error: null }; }
  catch {
    // localStorage writes are atomic; wrappers may still fail after a write.
    // Restore the previous value when that storage remains writable.
    try { if (previous === null) storage.removeItem?.(key); else storage.setItem(key, previous); } catch { /* Report the failed save; keep the confirmed in-memory best. */ }
    return { saved: false, best: current.best, error: 'write-failed' };
  }
}
