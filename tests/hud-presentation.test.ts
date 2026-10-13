import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHudNotice, formatOperationTime } from '../src/hud-presentation';

test('operation HUD clock carries seconds into minutes at fixed 60 Hz', () => {
  assert.equal(formatOperationTime(0), '00:00.00');
  assert.equal(formatOperationTime(1), '00:00.02');
  assert.equal(formatOperationTime(59), '00:00.98');
  assert.equal(formatOperationTime(60), '00:01.00');
  assert.equal(formatOperationTime(3599), '00:59.98');
  assert.equal(formatOperationTime(3600), '01:00.00');
  assert.equal(formatOperationTime(54_329), '15:05.48');
  assert.equal(formatOperationTime(360_000), '100:00.00');
});

test('narrow notices preserve the threat, direction, deadline and wait kind', () => {
  const fixtures = [
    ['主砲予告 1基 · 射線から離脱', '主砲予告 1基・射線回避'],
    ['← 左へ 帰還 · 戻らないと7秒で機体損失', '←左へ・帰還・7秒で機体損失'],
    ['↑ 上昇 帰還 · 境界まで38m', '↑上昇・帰還・境界38m'],
    ['↶ 反転 帰還 · 戻らないと10秒で機体損失', '↶反転・帰還・10秒で機体損失'],
    ['自機復帰 · 1.0秒', '自機復帰・1.0秒'],
    ['僚機へ引継ぎ · まもなく', '僚機へ引継ぎ・まもなく'],
    ['出撃回廊の空きを待機', '出撃回廊の空きを待機'],
    ['出撃または射撃を継続できないため停止しました。', '出撃または射撃を継続できないため停止しました。'],
  ];
  for (const [full, compact] of fixtures) {
    assert.equal(formatHudNotice(full, true), compact);
    assert.equal(formatHudNotice(full, false), full);
  }
});
