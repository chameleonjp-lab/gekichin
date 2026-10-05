import { Box3, Quaternion, Vector3 } from 'three';
import { Mothership } from './mothership';
import { AIRCRAFT_RADIUS, type BoxSpec, type MothershipLayout, type TurretId } from './mothership-layout';

export interface AircraftCollider {
  tokenId: number;
  generation?: number;
  position: Vector3;
  previous?: Vector3;
  radius?: number;
  hpMilli?: number;
}
export interface SweepOptions {
  radius?: number;
  aircraft?: boolean;
  sea?: boolean;
  ignoreTokenId?: number;
  ignoreTurretId?: TurretId;
}
export interface CollisionHit {
  time: number;
  /** Moving sphere centre at first contact; contactPoint is the solid surface. */
  point: Vector3;
  contactPoint: Vector3;
  normal: Vector3;
  kind: 'hull' | 'turret' | 'aircraft' | 'sea';
  id?: TurretId;
  tokenId?: number;
  partId: string;
}
interface IndexedPart { key: string; box?: BoxSpec; turretId?: TurretId; }
const EPSILON = 1e-9;
const CELL_SIZE = 128;

export function boundsOfBox(box: BoxSpec): Box3 {
  const bounds = new Box3();
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) bounds.expandByPoint(new Vector3(
    x * box.halfSize.x, y * box.halfSize.y, z * box.halfSize.z).applyQuaternion(box.rotation).add(box.center));
  return bounds;
}

function localNormal(point: Vector3, half: Vector3): Vector3 {
  const closest = point.clone().clamp(half.clone().negate(), half), difference = point.clone().sub(closest);
  if (difference.lengthSq() > EPSILON * EPSILON) return difference.normalize();
  const gaps = [half.x - Math.abs(point.x), half.y - Math.abs(point.y), half.z - Math.abs(point.z)];
  const axis = gaps.indexOf(Math.min(...gaps));
  const normal = new Vector3(); normal.setComponent(axis, point.getComponent(axis) < 0 ? -1 : 1); return normal;
}

/** Exact rounded-box contact, not the conservative inflated-AABB approximation. */
export function sweepSphereBox(from: Vector3, to: Vector3, radius: number, box: BoxSpec): CollisionHit | null {
  const inverse = box.rotation.clone().invert();
  const start = from.clone().sub(box.center).applyQuaternion(inverse), finish = to.clone().sub(box.center).applyQuaternion(inverse);
  const velocity = finish.clone().sub(start), half = box.halfSize;
  const nearest = start.clone().clamp(half.clone().negate(), half);
  const initialDistance = start.distanceToSquared(nearest);
  if (initialDistance <= radius * radius + EPSILON) {
    const normal = localNormal(start, half);
    const boundary = radius > 0 ? Math.abs(initialDistance - radius * radius) <= EPSILON
      : Math.min(half.x - Math.abs(start.x), half.y - Math.abs(start.y), half.z - Math.abs(start.z)) <= EPSILON;
    if (!(boundary && velocity.dot(normal) > EPSILON)) return makeBoxHit(0, from, to, radius, box, normal);
    return null;
  }
  const partitions = [0, 1];
  for (let axis = 0; axis < 3; axis += 1) if (Math.abs(velocity.getComponent(axis)) > EPSILON) {
    for (const sign of [-1, 1]) {
      const time = (sign * half.getComponent(axis) - start.getComponent(axis)) / velocity.getComponent(axis);
      if (time > 0 && time < 1) partitions.push(time);
    }
  }
  partitions.sort((a, b) => a - b);
  for (let index = 0; index < partitions.length - 1; index += 1) {
    const low = partitions[index], high = partitions[index + 1], middle = (low + high) / 2;
    let a = 0, b = 0, c = -radius * radius;
    for (let axis = 0; axis < 3; axis += 1) {
      const speed = velocity.getComponent(axis), origin = start.getComponent(axis), extent = half.getComponent(axis), sample = origin + speed * middle;
      const boundary = sample < -extent ? -extent : sample > extent ? extent : null;
      if (boundary === null) continue;
      const offset = origin + speed * low - boundary;
      a += speed * speed; b += 2 * offset * speed; c += offset * offset;
    }
    let delta: number | null = c <= EPSILON ? 0 : null;
    if (delta === null && a > EPSILON) {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= -EPSILON) {
        const root = Math.sqrt(Math.max(0, discriminant));
        const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
        delta = candidates.find(value => value >= -EPSILON && value <= high - low + EPSILON) ?? null;
      }
    }
    if (delta !== null) {
      const time = Math.max(low, Math.min(high, low + delta));
      const atContact = start.clone().addScaledVector(velocity, time);
      return makeBoxHit(time, from, to, radius, box, localNormal(atContact, half));
    }
  }
  return null;
}

function makeBoxHit(time: number, from: Vector3, to: Vector3, radius: number, box: BoxSpec, local: Vector3): CollisionHit {
  const point = from.clone().lerp(to, time), normal = local.applyQuaternion(box.rotation).normalize();
  return { time, point, contactPoint: point.clone().addScaledVector(normal, -radius), normal,
    kind: box.kind === 'turret' || box.kind === 'wreck' ? 'turret' : 'hull', id: box.turretId, partId: box.id };
}

/** Relative moving-sphere sweep also covers a fast aircraft crossing a bullet path. */
export function sweepSphereAircraft(from: Vector3, to: Vector3, radius: number, aircraft: AircraftCollider): CollisionHit | null {
  const startPosition = aircraft.previous ?? aircraft.position;
  const relative = from.clone().sub(startPosition);
  const movement = to.clone().sub(from).sub(aircraft.position.clone().sub(startPosition));
  const combined = radius + (aircraft.radius ?? AIRCRAFT_RADIUS);
  const c = relative.lengthSq() - combined * combined, a = movement.lengthSq(), b = 2 * relative.dot(movement);
  let time = c <= 0 ? 0 : null;
  if (time === null && a > EPSILON) {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (root >= 0 && root <= 1) time = root;
    }
  }
  if (time === null) return null;
  const point = from.clone().lerp(to, time), target = startPosition.clone().lerp(aircraft.position, time);
  const normal = point.clone().sub(target).normalize();
  return { time, point, contactPoint: point.clone().addScaledVector(normal, -radius), normal, kind: 'aircraft', tokenId: aircraft.tokenId, partId: `aircraft-${aircraft.tokenId}` };
}

export class CollisionWorld {
  readonly mothership: Mothership;
  readonly layout: MothershipLayout;
  private readonly grid = new Map<string, Set<IndexedPart>>();
  constructor(ship: Mothership | MothershipLayout, private readonly aircraftProvider: () => readonly AircraftCollider[] = () => []) {
    this.mothership = ship instanceof Mothership ? ship : new Mothership(ship);
    this.layout = this.mothership.layout;
    for (const box of this.layout.hullParts) this.index({ key: box.id, box }, boundsOfBox(box));
    for (const turret of this.layout.turrets) {
      const reach = turret.kind === 'main' ? 48 : 28;
      const size = new Vector3(reach, reach, reach);
      this.index({ key: `turret-${turret.id}`, turretId: turret.id }, new Box3(turret.position.clone().sub(size), turret.position.clone().add(size)));
    }
  }

  private index(part: IndexedPart, bounds: Box3): void {
    for (let x = Math.floor(bounds.min.x / CELL_SIZE); x <= Math.floor(bounds.max.x / CELL_SIZE); x += 1)
      for (let y = Math.floor(bounds.min.y / CELL_SIZE); y <= Math.floor(bounds.max.y / CELL_SIZE); y += 1)
        for (let z = Math.floor(bounds.min.z / CELL_SIZE); z <= Math.floor(bounds.max.z / CELL_SIZE); z += 1) {
          const key = `${x},${y},${z}`, entries = this.grid.get(key) ?? new Set<IndexedPart>();
          entries.add(part); this.grid.set(key, entries);
        }
  }

  private candidates(from: Vector3, to: Vector3, radius: number): Set<IndexedPart> {
    const result = new Set<IndexedPart>(), direction = to.clone().sub(from);
    const cell = [from.x, from.y, from.z].map(value => Math.floor(value / CELL_SIZE));
    const end = [to.x, to.y, to.z].map(value => Math.floor(value / CELL_SIZE));
    const steps = [direction.x, direction.y, direction.z].map(value => Math.sign(value));
    const delta = [direction.x, direction.y, direction.z].map(value => value === 0 ? Infinity : CELL_SIZE / Math.abs(value));
    const maximum = cell.map((coordinate, axis) => steps[axis] === 0 ? Infinity
      : ((coordinate + (steps[axis] > 0 ? 1 : 0)) * CELL_SIZE - from.getComponent(axis)) / direction.getComponent(axis));
    const neighbours = Math.ceil(radius / CELL_SIZE), budget = cell.reduce((sum, value, axis) => sum + Math.abs(end[axis] - value), 0) + 1;
    for (let visited = 0; visited < budget; visited += 1) {
      for (let x = -neighbours; x <= neighbours; x += 1) for (let y = -neighbours; y <= neighbours; y += 1) for (let z = -neighbours; z <= neighbours; z += 1) {
        for (const entry of this.grid.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? []) result.add(entry);
      }
      if (cell.every((value, axis) => value === end[axis])) break;
      const next = Math.min(...maximum);
      for (let axis = 0; axis < 3; axis += 1) if (maximum[axis] <= next + EPSILON) { cell[axis] += steps[axis]; maximum[axis] += delta[axis]; }
    }
    return result;
  }

  sweep(from: Vector3, to: Vector3, options: SweepOptions = {}): CollisionHit | null {
    const radius = options.radius ?? 0;
    if (!Number.isFinite(radius) || radius < 0) throw new Error('Sweep radius must be finite and non-negative.');
    let first: CollisionHit | null = null;
    const accept = (hit: CollisionHit | null) => {
      if (hit && (!first || hit.time < first.time - EPSILON
        || Math.abs(hit.time - first.time) <= EPSILON && hit.partId < first.partId)) first = hit;
    };
    for (const part of this.candidates(from, to, radius)) {
      if (part.turretId !== undefined) {
        if (part.turretId === options.ignoreTurretId) continue;
        for (const box of this.mothership.byId(part.turretId)?.boxes ?? []) accept(sweepSphereBox(from, to, radius, box));
      } else if (part.box) accept(sweepSphereBox(from, to, radius, part.box));
    }
    if (options.aircraft !== false) for (const aircraft of this.aircraftProvider()) {
      if (aircraft.tokenId !== options.ignoreTokenId && (aircraft.hpMilli === undefined || aircraft.hpMilli > 0)) accept(sweepSphereAircraft(from, to, radius, aircraft));
    }
    if (options.sea !== false) {
      const dy = to.y - from.y;
      const time = from.y < radius || from.y === radius && dy < 0 ? 0 : dy < 0 ? (radius - from.y) / dy : -1;
      if (time >= 0 && time <= 1) {
        const point = from.clone().lerp(to, time), normal = new Vector3(0, 1, 0);
        accept({ time, point, contactPoint: point.clone().addScaledVector(normal, -radius), normal, kind: 'sea', partId: 'sea' });
      }
    }
    return first;
  }

  lineOfSight(from: Vector3, to: Vector3, targetTurretId?: TurretId, ignoreTurretId?: TurretId): boolean {
    const hit = this.sweep(from, to, { aircraft: false, ignoreTurretId });
    return hit === null || targetTurretId !== undefined && hit.kind === 'turret' && hit.id === targetTurretId;
  }
  cameraCast(from: Vector3, to: Vector3, radius = 1.5): CollisionHit | null {
    return this.sweep(from, to, { radius, aircraft: false });
  }
}
