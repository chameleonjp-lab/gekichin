/** Flight yaw uses forward=(-sin(yaw), 0, -cos(yaw)); screen-right is positive. */
export function boundaryDirectionLabel(direction: Readonly<{ x: number; y: number; z: number }>, yaw: number): string {
  if (Math.abs(direction.y) > .5) return direction.y > 0 ? '↑ 上昇' : '↓ 降下';
  const angle = Math.atan2(direction.x, -direction.z) + yaw;
  const relative = Math.atan2(Math.sin(angle), Math.cos(angle));
  return Math.abs(relative) < .5 ? '↑ 前方' : Math.abs(relative) > 2.5 ? '↶ 反転' : relative > 0 ? '→ 右へ' : '← 左へ';
}
