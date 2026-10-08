import { RULES_VERSION } from '../src/rules';
import { scoreComponents, type CombatReport, type ScoreTotals } from '../src/scoring';
import type { FlightSession } from '../src/game-state';
import type { CombatEvent, MissionOutcome } from '../src/combat-types';
import type { ControlSettings } from '../src/control-settings';
import type { GameMode } from '../src/types';

export type UiOnlyRendererStatus = { available: boolean; ready: boolean; canvas: boolean };
export type UiOnlyState = {
  showHome(mode?: GameMode): void;
  showPreparing(mode?: GameMode): void;
  showPaused(mode?: GameMode): void;
  showHud(mode?: GameMode, draw?: boolean): Promise<boolean>;
  showNotice(message: string, mode?: GameMode, draw?: boolean): Promise<boolean>;
  showResult(mode: GameMode, outcome: MissionOutcome, draw?: boolean): Promise<{ report: CombatReport; sinking: boolean; rendered: boolean }>;
  forceSettingsConflict(): { visible: boolean; text: string };
  drawStaticFrame(sinkSeconds?: number): Promise<boolean>;
  rendererStatus(): UiOnlyRendererStatus;
  inspect(): { phase: string; mode: GameMode; tick: number; operationId: number };
};

declare global {
  interface Window { __gekichinUiOnly?: UiOnlyState }
}

type UiOnlyBindings = {
  app: HTMLElement;
  session: FlightSession;
  guide: HTMLDialogElement;
  settings: ControlSettings;
  renderUi: (focus?: boolean) => void;
  updateHud: () => void;
  showReport: (report: CombatReport) => void;
  consumeEvents: () => void;
  fitHud: () => void;
  stopWorld: () => void;
  resetPresentation: () => void;
  drawStaticFrame: (sinkSeconds?: number) => Promise<boolean>;
  rendererStatus: () => UiOnlyRendererStatus;
};

function fixtureReport(session: FlightSession, mode: GameMode, outcome: MissionOutcome): CombatReport {
  const complete = outcome === 'victory' || outcome === 'mutual';
  const K = complete ? 100 : outcome === 'defeat' ? 64 : 47;
  const damageMilli = complete ? 24_000_000 : K * 180_000;
  const P = outcome === 'defeat' ? 14 : outcome === 'mutual' ? 15 : outcome === 'aborted' ? 2 : 0;
  const W = outcome === 'defeat' ? 36 : outcome === 'mutual' ? 35 : outcome === 'aborted' ? 3 : 0;
  const mainKills = complete ? 20 : Math.min(20, Math.round(K * 0.2));
  const mgKills = K - mainKills;
  const playerKills = Math.floor(K * 0.28);
  const totals: ScoreTotals = {
    K, damageMilli, P, W, N: 150, Hmain: 41, Hmg: 62,
    playerKills, wingmanKills: K - playerKills,
    playerDamageMilli: Math.floor(damageMilli * 0.37),
    wingmanDamageMilli: damageMilli - Math.floor(damageMilli * 0.37),
    mainKills, mgKills,
  };
  const endTick = 54_329;
  return {
    kind: 'mission-result', operationId: session.operationId, rulesVersion: RULES_VERSION,
    mode, seed: session.seed, endTick, reason: outcome === 'aborted' ? 'aborted' : 'completed', outcome,
    ...totals, components: scoreComponents(totals, endTick, outcome === 'victory'),
  };
}

export function installUiOnlyState(bindings: UiOnlyBindings): void {
  const { app, session } = bindings;
  bindings.stopWorld();

  function reset(mode: GameMode): void {
    bindings.stopWorld();
    bindings.resetPresentation();
    session.home();
    session.mode = mode;
    session.pauseReason = null;
    session.abnormalReason = null;
    session.report = null;
    bindings.settings.setActiveMode(mode);
    bindings.fitHud();
  }

  function showHome(mode: GameMode = 'easy'): void {
    reset(mode);
    for (const radio of app.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.checked = radio.value === mode;
    bindings.renderUi(true);
  }

  function showPreparing(mode: GameMode = 'easy'): void {
    reset(mode);
    if (session.prepare(mode) === null) throw new Error('UI-only preparation fixture could not enter preparing state');
    bindings.renderUi(true);
  }

  function showPaused(mode: GameMode = 'easy'): void {
    reset(mode);
    session.phase = 'paused';
    session.pauseReason = 'manual';
    bindings.renderUi(true);
  }

  async function showHud(mode: GameMode = 'easy', draw = true): Promise<boolean> {
    reset(mode);
    session.mode = mode;
    session.phase = 'playing';
    bindings.renderUi();
    bindings.updateHud();
    return draw ? bindings.drawStaticFrame() : false;
  }

  async function showNotice(message: string, mode: GameMode = 'normal', draw = false): Promise<boolean> {
    await showHud(mode, false);
    const events = session.events as CombatEvent[];
    events.push({ sequence: 1, operationId: session.operationId, tick: session.tick, kind: 'abnormal', message });
    bindings.consumeEvents();
    bindings.updateHud();
    return draw ? bindings.drawStaticFrame() : false;
  }

  async function showResult(mode: GameMode, outcome: MissionOutcome, draw = true): Promise<{ report: CombatReport; sinking: boolean; rendered: boolean }> {
    reset(mode);
    const report = fixtureReport(session, mode, outcome);
    session.phase = 'result';
    session.tick = report.endTick;
    session.report = report;
    bindings.showReport(report);
    const sinking = outcome === 'victory';
    const rendered = draw ? await bindings.drawStaticFrame(0) : false;
    return { report, sinking, rendered };
  }

  function forceSettingsConflict(): { visible: boolean; text: string } {
    const internals = bindings.settings as unknown as {
      measureLayoutObstacles: (layout: unknown, mode: GameMode) => Array<{ x: number; y: number; width: number; height: number }>;
      updateEditor: () => void;
    };
    const rect = app.getBoundingClientRect();
    internals.measureLayoutObstacles = () => [{ x: rect.width / 2, y: rect.height / 2, width: rect.width * 3, height: rect.height * 3 }];
    try { internals.updateEditor(); }
    finally { Reflect.deleteProperty(internals, 'measureLayoutObstacles'); }
    const note = app.querySelector<HTMLElement>('#control-storage-note');
    return { visible: !!note && !note.hidden, text: note?.textContent ?? '' };
  }

  const adapter: UiOnlyState = Object.freeze({
    showHome,
    showPreparing,
    showPaused,
    showHud,
    showNotice,
    showResult,
    forceSettingsConflict,
    drawStaticFrame: bindings.drawStaticFrame,
    rendererStatus: bindings.rendererStatus,
    inspect: () => ({ phase: session.phase, mode: session.mode, tick: session.tick, operationId: session.operationId }),
  });
  Object.defineProperty(window, '__gekichinUiOnly', { configurable: false, enumerable: false, value: adapter });
}
