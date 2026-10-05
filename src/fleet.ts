import { Quaternion, Vector3 } from 'three';
import { CRUISE_SPEED, updateQuaternion } from './flight';
import { AIRCRAFT_HP_MILLI, ALLY_ACTIVE_LIMIT, ALLY_TOTAL, BLOCKED_RESPAWN_TICKS, CANNON_MAGAZINE, MG_MAGAZINE, RESPAWN_TICKS } from './rules';
import type { AircraftOwner, AircraftToken, FleetCounts } from './combat-types';

type TokenStatus = 'reserve' | 'reserved' | 'active' | 'lost';
export interface RespawnReservation {
  readonly operationId: number;
  readonly tokenId: number;
  readonly slotId: number;
  readonly generation: number;
  readonly owner: AircraftOwner;
  readonly dueTick: number;
  blockedSinceTick: number | null;
}
interface VacantSlot { slotId: number; owner: AircraftOwner; lossTick: number }
export interface FleetTransition { kind: 'respawn' | 'handoff'; aircraft: AircraftToken }
export interface FleetPostTick { transitions: FleetTransition[]; anomaly: string | null }
export type SpawnSelector = (slotId: number, active: readonly AircraftToken[]) => Vector3 | null;

export function createAircraftToken(operationId: number, tokenId: number, slotId: number, generation: number, owner: AircraftOwner, position: Vector3, bornTick = 0): AircraftToken {
  const aircraft: AircraftToken = {
    operationId, tokenId, slotId, generation, owner, bornTick,
    position: position.clone(), previous: position.clone(), quaternion: new Quaternion(),
    yaw: 0, pitch: 0, bank: 0, speed: CRUISE_SPEED, loopProgress: 0, loopCooldown: 0,
    hpMilli: AIRCRAFT_HP_MILLI, maxHpMilli: AIRCRAFT_HP_MILLI, outsideTicks: 0,
    ammunition: { mg: MG_MAGAZINE, cannon: CANNON_MAGAZINE, mgReadyTick: bornTick + 1, cannonReadyTick: bornTick + 1, reloadUntilTick: null },
  };
  updateQuaternion(aircraft);
  return aircraft;
}

/** Fifty finite identities. A display slot is never an extra life. */
export class Fleet {
  private readonly statuses: TokenStatus[] = Array.from({ length: ALLY_TOTAL }, () => 'reserve');
  private readonly aircraft = new Map<number, AircraftToken>();
  private readonly generations = Array.from({ length: ALLY_ACTIVE_LIMIT }, () => 0);
  private readonly vacancies: VacantSlot[] = [];
  private readonly pending: RespawnReservation[] = [];
  private lostPlayerTick: number | null = null;
  playerLosses = 0;
  wingmanLosses = 0;
  ownershipRevision = 0;

  constructor(readonly operationId: number, positions?: readonly Vector3[]) {
    for (let slotId = 0; slotId < ALLY_ACTIVE_LIMIT; slotId += 1) {
      const position = positions?.[slotId] ?? new Vector3((slotId % 4) * 40, 1000 + Math.floor(slotId / 4) * 40, 2000 + Math.floor(slotId / 4) * 40);
      this.statuses[slotId] = 'active';
      this.aircraft.set(slotId, createAircraftToken(operationId, slotId, slotId, 0, slotId === 0 ? 'player' : 'wingman', position));
    }
    this.assertInvariants();
  }

  get active(): AircraftToken[] { return [...this.aircraft.values()].filter(plane => this.statuses[plane.tokenId] === 'active').sort((a, b) => a.tokenId - b.tokenId); }
  get player(): AircraftToken | null { return this.active.find(plane => plane.owner === 'player') ?? null; }
  get reservations(): readonly RespawnReservation[] { return this.pending; }
  get counts(): FleetCounts {
    const active = this.statuses.filter(status => status === 'active').length;
    const reserved = this.statuses.filter(status => status === 'reserved').length;
    const reserve = this.statuses.filter(status => status === 'reserve').length;
    const lost = this.statuses.filter(status => status === 'lost').length;
    return { active, reserved, reserve, lost, remaining: ALLY_TOTAL - lost, playerLosses: this.playerLosses, wingmanLosses: this.wingmanLosses };
  }
  get wait(): { kind: 'respawn' | 'handoff' | 'deployment'; untilTick: number | null } | null {
    if (this.player) return null;
    const reservation = this.pending.find(item => item.owner === 'player');
    if (reservation) return { kind: 'respawn', untilTick: reservation.dueTick };
    if (this.active.length > 0 && this.lostPlayerTick !== null) return { kind: 'handoff', untilTick: this.lostPlayerTick + RESPAWN_TICKS };
    const first = this.pending.reduce<number | null>((tick, item) => tick === null ? item.dueTick : Math.min(tick, item.dueTick), null);
    return { kind: 'deployment', untilTick: first };
  }
  byId(tokenId: number): AircraftToken | null { return this.statuses[tokenId] === 'active' ? this.aircraft.get(tokenId) ?? null : null; }
  matches(tokenId: number, generation: number, operationId = this.operationId): boolean {
    return operationId === this.operationId && this.byId(tokenId)?.generation === generation;
  }
  clearBlockedWaits(): void { for (const reservation of this.pending) reservation.blockedSinceTick = null; }

  lose(tokenId: number, tick: number): AircraftToken | null {
    const plane = this.byId(tokenId);
    if (!plane) return null;
    plane.hpMilli = 0;
    this.statuses[tokenId] = 'lost';
    this.vacancies.push({ slotId: plane.slotId, owner: plane.owner, lossTick: tick });
    if (plane.owner === 'player') { this.playerLosses += 1; this.lostPlayerTick = tick; this.ownershipRevision += 1; }
    else this.wingmanLosses += 1;
    this.assertInvariants();
    return plane;
  }

  /** Run only after the tick's terminal test, so no life is spent after victory. */
  postTick(tick: number, selectSpawn: SpawnSelector): FleetPostTick {
    const transitions: FleetTransition[] = [];
    this.vacancies.sort((a, b) => Number(b.owner === 'player') - Number(a.owner === 'player') || a.slotId - b.slotId);
    for (const vacancy of this.vacancies.splice(0)) {
      const tokenId = this.statuses.indexOf('reserve');
      if (tokenId < 0) continue;
      this.statuses[tokenId] = 'reserved';
      this.generations[vacancy.slotId] += 1;
      this.pending.push({ operationId: this.operationId, tokenId, slotId: vacancy.slotId,
        generation: this.generations[vacancy.slotId], owner: vacancy.owner,
        dueTick: vacancy.lossTick + RESPAWN_TICKS, blockedSinceTick: null });
    }
    this.pending.sort((a, b) => Number(b.owner === 'player') - Number(a.owner === 'player') || a.slotId - b.slotId);
    let anomaly: string | null = null;
    for (const reservation of [...this.pending]) {
      if (tick < reservation.dueTick) continue;
      const position = selectSpawn(reservation.slotId, this.active);
      if (!position) {
        reservation.blockedSinceTick ??= tick;
        if (tick - reservation.blockedSinceTick + 1 >= BLOCKED_RESPAWN_TICKS) anomaly = '安全な復帰回廊を5秒間確保できませんでした';
        continue;
      }
      const plane = createAircraftToken(this.operationId, reservation.tokenId, reservation.slotId, reservation.generation, reservation.owner, position, tick);
      this.aircraft.set(plane.tokenId, plane);
      this.statuses[plane.tokenId] = 'active';
      this.pending.splice(this.pending.indexOf(reservation), 1);
      if (plane.owner === 'player') { this.lostPlayerTick = null; this.ownershipRevision += 1; }
      transitions.push({ kind: 'respawn', aircraft: plane });
    }
    if (!this.player && this.lostPlayerTick !== null && tick >= this.lostPlayerTick + RESPAWN_TICKS && !this.pending.some(item => item.owner === 'player')) {
      const inheritor = this.active[0];
      if (inheritor) {
        inheritor.owner = 'player';
        this.lostPlayerTick = null;
        this.ownershipRevision += 1;
        transitions.push({ kind: 'handoff', aircraft: inheritor });
      }
    }
    this.assertInvariants();
    return { transitions, anomaly };
  }

  assertInvariants(): void {
    const counts = this.counts;
    if (counts.active + counts.reserved + counts.reserve + counts.lost !== ALLY_TOTAL || counts.active + counts.reserved > ALLY_ACTIVE_LIMIT
      || counts.playerLosses + counts.wingmanLosses !== counts.lost || this.active.filter(plane => plane.owner === 'player').length > 1
      || new Set(this.active.map(plane => plane.slotId).concat(this.pending.map(item => item.slotId))).size !== counts.active + counts.reserved
      || this.pending.some(item => item.operationId !== this.operationId || this.statuses[item.tokenId] !== 'reserved')) throw new Error('Fleet conservation violated');
  }
}
