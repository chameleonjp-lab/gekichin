import { FIXED_HZ } from './rules';

/** Display the active operation clock without feeding rounded values back into play. */
export function formatOperationTime(tick: number): string {
  const centiseconds = Math.round(Math.max(0, tick) * 100 / FIXED_HZ);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}

/** Keep action, direction and deadline readable in the narrow warning column. */
export function formatHudNotice(message: string, compact: boolean): string {
  if (!compact) return message;
  return message
    .replace(/^主砲予告 (\d+)基 · 射線から離脱$/, '主砲予告 $1基・射線回避')
    .replace(/^([↑↓↶→←]) (上昇|降下|前方|反転|右へ|左へ) 帰還 · 戻らないと(\d+)秒で機体損失$/, '$1$2・帰還・$3秒で機体損失')
    .replace(/^([↑↓↶→←]) (上昇|降下|前方|反転|右へ|左へ) 帰還 · 境界まで(\d+)m$/, '$1$2・帰還・境界$3m')
    .replace(/^(自機復帰|僚機へ引継ぎ|出撃回廊の空きを待機) · (まもなく|\d+\.\d+秒)$/, '$1・$2');
}
