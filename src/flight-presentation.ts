import { Quaternion, Vector3 } from 'three';
import { normalizeAngle } from './flight';
import { selectFlightAssistTarget } from './flight-assist';
import type { AircraftToken, Projectile } from './combat-types';
import type { FlightSession } from './game-state';
import type { SceneCombatState } from './scene';
import type { Aircraft } from './types';

/** View selection is independent from the authoritative tick's automatic trigger. */
export function displayTarget(session: FlightSession, player: Aircraft, aspect: number) {
  const targets = session.mothership.turrets.filter(turret => turret.hpMilli > 0).map(turret => ({
    id: turret.id, aimPoint: turret.layout.aimPoint, alive: true, exposed: true, turret,
  }));
  return selectFlightAssistTarget(player, targets, aspect, session.mode, undefined, false, session.world,
    target => session.world.lineOfSight(player.position, target.aimPoint, target.id))?.enemy.turret ?? null;
}

export interface FlightPresentationFrame { player: Aircraft; state: SceneCombatState; tick: number }
interface Pose { position: Vector3; quaternion: Quaternion; pitch: number; yaw: number; bank: number; generation: number; owner: string }

/** Render-only fixed-pose history. Firing, collision, scoring and clocks use FlightSession. */
export class FlightPresentation {
  private session: FlightSession | null = null;
  private operation = -1;
  private tick = -1;
  private ownership = -1;
  private poses = new Map<number, Pose>();

  reset(): void { this.session = null; this.poses.clear(); }

  capture(session: FlightSession): void {
    this.session = session; this.operation = session.operationId; this.tick = session.tick;
    this.ownership = session.fleet.ownershipRevision; this.poses.clear();
    for (const plane of session.fleet.active) this.poses.set(plane.tokenId, {
      position: plane.position.clone(), quaternion: plane.quaternion.clone(),
      pitch: plane.pitch, yaw: plane.yaw, bank: plane.bank, generation: plane.generation, owner: plane.owner,
    });
  }

  sample(session: FlightSession, alpha: number): FlightPresentationFrame {
    const current = { player: session.player, state: session, tick: session.tick };
    if (session.phase !== 'playing') { this.reset(); return current; }
    if (this.session !== session || this.operation !== session.operationId || this.tick !== session.tick - 1
      || this.ownership !== session.fleet.ownershipRevision) return current;
    const fraction = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const samplePlane = (plane: AircraftToken): AircraftToken => {
      const previous = this.poses.get(plane.tokenId);
      if (!previous || previous.generation !== plane.generation || previous.owner !== plane.owner || plane.hpMilli <= 0) return plane;
      return { ...plane, position: previous.position.clone().lerp(plane.position, fraction),
        quaternion: previous.quaternion.clone().slerp(plane.quaternion, fraction),
        pitch: previous.pitch + (plane.pitch - previous.pitch) * fraction,
        yaw: previous.yaw + normalizeAngle(plane.yaw - previous.yaw) * fraction,
        bank: previous.bank + normalizeAngle(plane.bank - previous.bank) * fraction };
    };
    const active = session.fleet.active.map(samplePlane);
    const player = active.find(plane => plane.owner === 'player') ?? session.player;
    const sampleRound = (round: Projectile): Projectile => ({ ...round, position: round.previous.clone().lerp(round.position, fraction) });
    const state = { ...session, events: session.events, fleet: { active },
      weapons: { bullets: session.weapons.bullets.map(sampleRound) },
      enemyCombat: { bullets: session.enemyCombat.bullets.map(sampleRound), warnings: session.enemyCombat.warnings } };
    return { player, state, tick: session.tick - 1 + fraction };
  }
}
