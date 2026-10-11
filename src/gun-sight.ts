import { Vector3 } from 'three';
import { projectFlightTarget, type FlightCameraCollision, type ShipCameraTransform } from './flight-view';
import type { Aircraft } from './types';

/** Fixed 500m bore projection; enemies and fire state cannot move this point. */
export function projectGunSight(player: Aircraft, width: number, height: number, world?: FlightCameraCollision, ship?: ShipCameraTransform) {
  const forward = new Vector3(0, 0, -1).applyQuaternion(player.quaternion);
  const point = new Vector3(0, 0, -4.5).applyQuaternion(player.quaternion).add(player.position).addScaledVector(forward, 500);
  const projection = projectFlightTarget(player, point, width / height, 'normal', world, ship);
  return { x: (projection.x * .5 + .5) * width, y: (.5 - projection.y * .5) * height, depth: 500 };
}
