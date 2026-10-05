import { Vector3 } from 'three';
import type { AircraftToken, WingmanIntent } from './combat-types';
import type { CollisionWorld } from './collision-world';
import type { Mothership, TurretState } from './mothership';
import { AIRCRAFT_RADIUS } from './mothership-layout';
import { clamp, ENEMY_MAX_PITCH, forwardOf, normalizeAngle } from './flight';

const REASSESS_TICKS = 30;
const ASSIGNMENT_CAP = 2;
const WAYPOINT_RADIUS = 130;
const DISENGAGE_DISTANCE = 320;
const EPSILON = 1e-8;

export interface WingmanState {
  tokenId: number;
  generation: number;
  targetId: number | null;
  phase: 'approach' | 'attack' | 'disengage' | 'holding';
  route: Vector3[];
  routeIndex: number;
  phaseStartedTick: number;
  lastEvaluationTick: number;
  lastProgressTick: number;
  bestDistance: number;
}

interface Navigation {
  approach: Vector3;
  departure: Vector3;
}

interface Route { points: Vector3[]; length: number }

/** R33: exterior routes and input intents; only the core may move or damage a plane. */
export class WingmanAI {
  readonly states = new Map<number, WingmanState>();
  private mothership: Mothership | null = null;
  private world: CollisionWorld | null = null;
  private nodes: Vector3[] = [];
  private edges: number[][] = [];
  private goalConnections = new Map<number, number[]>();

  targetFor(tokenId: number): TurretState | null {
    const state = this.states.get(tokenId);
    if (!state || state.targetId === null || !this.mothership) return null;
    const target = this.mothership.byId(state.targetId);
    return target && target.hpMilli > 0 ? target : null;
  }

  step(tick: number, aircraft: readonly AircraftToken[], mothership: Mothership, world: CollisionWorld): Map<number, WingmanIntent> {
    if (this.mothership !== mothership || this.world !== world) this.resetNavigation(mothership, world);
    const planes = aircraft.filter(plane => plane.owner === 'wingman' && plane.hpMilli > 0)
      .sort((a, b) => a.tokenId - b.tokenId);
    const aliveTokens = new Set(planes.map(plane => plane.tokenId));
    for (const [tokenId, state] of this.states) if (!aliveTokens.has(tokenId)) {
      state.targetId = null;
      this.states.delete(tokenId);
    }
    // Death and handoff release assignments immediately, not after another interval.
    for (const plane of planes) {
      const state = this.stateFor(plane, tick);
      const target = this.targetFor(plane.tokenId);
      if (state.targetId !== null && !target) this.release(state, tick);
    }
    const intents = new Map<number, WingmanIntent>();
    for (const plane of planes) {
      const state = this.stateFor(plane, tick);
      if (tick - state.lastEvaluationTick >= REASSESS_TICKS) {
        state.lastEvaluationTick = tick;
        this.reevaluate(plane, state, tick);
      }
      const target = this.targetFor(plane.tokenId);
      if (!target) {
        const angle = plane.tokenId * .71 + tick / 60 * .08;
        const hold = new Vector3(Math.sin(angle) * 1450, 1000 + Math.sin(angle * .7) * 250,
          Math.cos(angle) * 1900);
        // A holding aircraft still navigates around the solid ship.
        const safeHold = this.clear(plane.position, hold) ? hold : this.nearestClearNode(plane.position);
        const steering = this.steer(plane, safeHold ?? plane.position.clone().addScaledVector(forwardOf(plane), 500));
        intents.set(plane.tokenId, { ...steering, fire: false, preferredSpeed: 100 });
        continue;
      }
      const navigation = this.navigation(target);
      if (state.phase === 'approach') {
        while (state.routeIndex < state.route.length
          && plane.position.distanceTo(state.route[state.routeIndex]) <= WAYPOINT_RADIUS) state.routeIndex += 1;
        if (state.routeIndex >= state.route.length) {
          state.phase = 'attack';
          state.phaseStartedTick = tick;
          state.bestDistance = Infinity;
          state.lastProgressTick = tick;
        }
      }
      let point: Vector3;
      let fire = false;
      let speed = 100;
      if (state.phase === 'attack') {
        const distance = plane.position.distanceTo(target.layout.aimPoint);
        if (distance <= DISENGAGE_DISTANCE || tick - state.phaseStartedTick > 1200) {
          state.phase = 'disengage';
          state.phaseStartedTick = tick;
          state.lastProgressTick = tick;
          state.bestDistance = Infinity;
        } else {
          point = target.layout.aimPoint;
          const direction = point.clone().sub(plane.position).normalize();
          // The launch uses the actual nose and source scatter. A small visible
          // target is not a reason to bend a shot or grant an automatic hit.
          const allowance = Math.min(.018, (target.layout.kind === 'main' ? 10 : 5.5) / Math.max(distance, 1));
          fire = distance <= 1000 && forwardOf(plane).angleTo(direction) <= allowance
            && world.lineOfSight(plane.position, point, target.layout.id);
          const steering = this.steer(plane, point);
          intents.set(plane.tokenId, { ...steering, fire, preferredSpeed: 85 });
          continue;
        }
      }
      if (state.phase === 'disengage') {
        if (plane.position.distanceTo(navigation.departure) <= WAYPOINT_RADIUS) {
          const route = this.routeTo(plane.position, navigation.approach, target.layout.id);
          if (!route) { this.release(state, tick); intents.set(plane.tokenId, { turn: 0, climb: 0, fire: false, preferredSpeed: 100 }); continue; }
          state.phase = 'approach';
          state.phaseStartedTick = tick;
          state.route = route.points;
          state.routeIndex = 0;
          state.lastProgressTick = tick;
          state.bestDistance = Infinity;
        }
        point = state.phase === 'disengage' ? navigation.departure : state.route[state.routeIndex] ?? navigation.approach;
        speed = state.phase === 'disengage' ? 110 : 100;
      } else point = state.route[state.routeIndex] ?? navigation.approach;
      intents.set(plane.tokenId, { ...this.steer(plane, point), fire, preferredSpeed: speed });
    }
    return intents;
  }

  private stateFor(plane: AircraftToken, tick: number): WingmanState {
    let state = this.states.get(plane.tokenId);
    if (!state || state.generation !== plane.generation) {
      state = { tokenId: plane.tokenId, generation: plane.generation, targetId: null, phase: 'holding',
        route: [], routeIndex: 0, phaseStartedTick: tick, lastEvaluationTick: tick - REASSESS_TICKS,
        lastProgressTick: tick, bestDistance: Infinity };
      this.states.set(plane.tokenId, state);
    }
    return state;
  }

  private release(state: WingmanState, tick: number): void {
    state.targetId = null;
    state.phase = 'holding';
    state.route = [];
    state.routeIndex = 0;
    state.bestDistance = Infinity;
    state.lastProgressTick = tick;
  }

  private reevaluate(plane: AircraftToken, state: WingmanState, tick: number): void {
    const current = this.targetFor(plane.tokenId);
    if (current) {
      const navigation = this.navigation(current);
      const waypoint = state.phase === 'attack'
        ? current.layout.aimPoint.clone().lerp(plane.position, Math.min(1, DISENGAGE_DISTANCE / Math.max(plane.position.distanceTo(current.layout.aimPoint), 1)))
        : state.phase === 'disengage' ? navigation.departure : state.route[state.routeIndex] ?? navigation.approach;
      const distance = plane.position.distanceTo(waypoint);
      if (distance < state.bestDistance - 10) { state.bestDistance = distance; state.lastProgressTick = tick; }
      if (!this.clear(plane.position, waypoint) || tick - state.lastProgressTick >= 900) {
        const route = this.routeTo(plane.position, navigation.approach, current.layout.id);
        if (!route) this.release(state, tick);
        else {
          state.phase = 'approach'; state.route = route.points; state.routeIndex = 0;
          state.phaseStartedTick = tick; state.lastProgressTick = tick; state.bestDistance = Infinity;
        }
      }
      if (state.targetId !== null) return;
    }
    if (!this.mothership) return;
    const assigned = new Map<number, number>();
    for (const other of this.states.values()) if (other.targetId !== null) assigned.set(other.targetId, (assigned.get(other.targetId) ?? 0) + 1);
    const candidates = this.mothership.turrets.filter(turret => turret.hpMilli > 0 && (assigned.get(turret.layout.id) ?? 0) < ASSIGNMENT_CAP);
    let selected: { target: TurretState; route: Route; count: number } | null = null;
    for (const target of candidates) {
      const count = assigned.get(target.layout.id) ?? 0;
      if (selected && count > selected.count) continue;
      const route = this.routeTo(plane.position, this.navigation(target).approach, target.layout.id);
      if (!route) continue;
      if (!selected || count < selected.count || route.length < selected.route.length - EPSILON
        || (Math.abs(route.length - selected.route.length) <= EPSILON && target.layout.id < selected.target.layout.id)) selected = { target, route, count };
    }
    if (!selected) return;
    state.targetId = selected.target.layout.id;
    state.phase = 'approach';
    state.route = selected.route.points;
    state.routeIndex = 0;
    state.phaseStartedTick = tick;
    state.lastProgressTick = tick;
    state.bestDistance = Infinity;
  }

  private navigation(target: TurretState): Navigation {
    const layout = target.layout;
    return { approach: layout.outwardWaypoint.clone(),
      departure: layout.aimPoint.clone().addScaledVector(layout.normal, 550).addScaledVector(layout.tangent, -450) };
  }

  private steer(plane: AircraftToken, point: Vector3): { turn: number; climb: number } {
    const direction = point.clone().sub(plane.position);
    if (direction.lengthSq() < EPSILON) return { turn: 0, climb: 0 };
    const desiredYaw = Math.atan2(-direction.x, -direction.z);
    const desiredPitch = Math.atan2(direction.y, Math.max(Math.hypot(direction.x, direction.z), EPSILON));
    return { turn: clamp(-normalizeAngle(desiredYaw - plane.yaw) / .16, -1, 1),
      climb: clamp(desiredPitch / ENEMY_MAX_PITCH, -1, 1) };
  }

  private clear(from: Vector3, to: Vector3): boolean {
    return this.world !== null && this.world.sweep(from, to, { radius: AIRCRAFT_RADIUS + 10, aircraft: false, sea: false }) === null;
  }

  private nearestClearNode(from: Vector3): Vector3 | null {
    let best: Vector3 | null = null;
    for (const node of this.nodes) if ((!best || from.distanceToSquared(node) < from.distanceToSquared(best)) && this.clear(from, node)) best = node;
    return best;
  }

  private resetNavigation(mothership: Mothership, world: CollisionWorld): void {
    this.states.clear();
    this.mothership = mothership;
    this.world = world;
    this.nodes = mothership.layout.outerWaypoints.map(point => point.clone());
    this.goalConnections.clear();
    this.edges = this.nodes.map((from, i) => this.nodes.map((to, j) => i === j ? 0
      : this.clear(from, to) ? from.distanceTo(to) : Infinity));
  }

  private routeTo(from: Vector3, goal: Vector3, targetId: number): Route | null {
    if (this.clear(from, goal)) return { points: [goal.clone()], length: from.distanceTo(goal) };
    let terminalEdges = this.goalConnections.get(targetId);
    if (!terminalEdges) {
      terminalEdges = this.nodes.map(node => this.clear(node, goal) ? node.distanceTo(goal) : Infinity);
      this.goalConnections.set(targetId, terminalEdges);
    }
    const distances = this.nodes.map(node => this.clear(from, node) ? from.distanceTo(node) : Infinity);
    const predecessors = this.nodes.map(() => -1);
    const visited = this.nodes.map(() => false);
    for (let iteration = 0; iteration < this.nodes.length; iteration += 1) {
      let chosen = -1;
      for (let index = 0; index < distances.length; index += 1) if (!visited[index]
        && Number.isFinite(distances[index]) && (chosen < 0 || distances[index] < distances[chosen])) chosen = index;
      if (chosen < 0) break;
      visited[chosen] = true;
      for (let next = 0; next < this.nodes.length; next += 1) {
        const distance = distances[chosen] + this.edges[chosen][next];
        if (distance < distances[next] - EPSILON) { distances[next] = distance; predecessors[next] = chosen; }
      }
    }
    let endpoint = -1, length = Infinity;
    for (let index = 0; index < this.nodes.length; index += 1) {
      const candidate = distances[index] + terminalEdges[index];
      if (candidate < length - EPSILON) { endpoint = index; length = candidate; }
    }
    if (endpoint < 0 || !Number.isFinite(length)) return null;
    const path: Vector3[] = [goal.clone()];
    while (endpoint >= 0) { path.unshift(this.nodes[endpoint].clone()); endpoint = predecessors[endpoint]; }
    return { points: path, length };
  }
}
