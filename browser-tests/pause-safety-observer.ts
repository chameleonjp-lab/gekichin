import type { FlightSession } from '../src/game-state';
import type { FlightControls } from '../src/input';

/** Detached values only. No sample(), state setters, or simulation commands. */
export function observePauseState(session: FlightSession, controls: Pick<FlightControls, 'peek'>, elapsed = '') {
  const aircraft = session.fleet.active.map(plane => ({ ...plane,
    position: plane.position.toArray(), previous: plane.previous.toArray(), quaternion: plane.quaternion.toArray(),
    ammunition: { ...plane.ammunition },
  }));
  const projectile = (bullet: FlightSession['enemyCombat']['bullets'][number]) => ({ ...bullet,
    position: bullet.position.toArray(), previous: bullet.previous.toArray(), velocity: bullet.velocity.toArray(),
  });
  return structuredClone({
    phase: session.phase, pauseReason: session.pauseReason, elapsed,
    world: {
      tick: session.tick, operationId: session.operationId, seed: session.seed, mode: session.mode,
      aircraft,
      fleet: { counts: { ...session.fleet.counts }, reservations: session.fleet.reservations.map(item => ({ ...item })),
        wait: session.fleet.wait, ownershipRevision: session.fleet.ownershipRevision },
      turrets: session.mothership.turrets.map(turret => ({ id: turret.id, hpMilli: turret.hpMilli, yaw: turret.yaw, pitch: turret.pitch })),
      mothership: { hpMilli: session.mothership.totalHpMilli, destroyedIds: [...session.mothership.destroyedIds] },
      friendlyBullets: session.weapons.bullets.map(projectile), enemyBullets: session.enemyCombat.bullets.map(projectile),
      enemyAI: [...session.enemyCombat.states.values()].map(state => ({ ...state,
        fixedPoint: state.fixedPoint?.toArray() ?? null, fixedDirection: state.fixedDirection?.toArray() ?? null,
      })),
      wingmanAI: [...session.wingmen.states.values()].map(state => ({ ...state, route: state.route.map(point => point.toArray()) })),
      controller: { ...session.controller },
      score: { totals: { ...session.score.totals }, components: { ...session.score.components(session.tick) }, retainedHitIds: session.score.retainedHitIds },
      events: session.events.map(event => ({ ...event, point: event.point?.toArray() })),
      report: session.report && { ...session.report, components: { ...session.report.components } },
      failures: { friendly: session.weapons.allocationFailures, enemy: session.enemyCombat.poolFailures, anomaly: session.abnormalReason },
    },
    input: controls.peek(),
  });
}

export type PauseSafetySnapshot = ReturnType<typeof observePauseState>;

export function installPauseSafetyObserver(session: FlightSession, controls: FlightControls): void {
  Object.defineProperty(window, '__gekichinPauseSafety', {
    configurable: false, writable: false,
    value: Object.freeze({ read: () => observePauseState(session, controls, document.querySelector('#elapsed')?.textContent ?? '') }),
  });
}

declare global {
  interface Window { readonly __gekichinPauseSafety: { read(): PauseSafetySnapshot } }
}
