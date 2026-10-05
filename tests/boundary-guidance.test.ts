import assert from 'node:assert/strict';
import test from 'node:test';
import { boundaryDirectionLabel } from '../src/boundary-guidance';

test('return arrows guide inward/outward and left/right using the inherited flight yaw', () => {
  // At the eastern boundary, the safe return direction is west.
  const west = { x: -1, y: 0, z: 0 };
  assert.equal(boundaryDirectionLabel(west, Math.PI / 2), '↑ 前方');
  assert.equal(boundaryDirectionLabel(west, -Math.PI / 2), '↶ 反転');
  assert.equal(boundaryDirectionLabel(west, 0), '← 左へ');
  assert.equal(boundaryDirectionLabel(west, Math.PI), '→ 右へ');
  assert.equal(boundaryDirectionLabel({ x: 1, y: 0, z: 0 }, 0), '→ 右へ');
  assert.equal(boundaryDirectionLabel({ x: 0, y: 0, z: -1 }, 0), '↑ 前方');
  assert.equal(boundaryDirectionLabel({ x: 0, y: 0, z: 1 }, 0), '↶ 反転');
  assert.equal(boundaryDirectionLabel(west, Math.PI / 2 + 4 * Math.PI), '↑ 前方');
  assert.equal(boundaryDirectionLabel({ x: 0, y: 1, z: 0 }, Math.PI), '↑ 上昇');
  assert.equal(boundaryDirectionLabel({ x: 0, y: -1, z: 0 }, 0), '↓ 降下');
});
