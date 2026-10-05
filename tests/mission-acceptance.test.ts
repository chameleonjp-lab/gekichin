import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { AircraftToken, FleetCounts } from '../src/combat-types';
import { Fleet } from '../src/fleet';
import { FixedStepper, FlightSession } from '../src/game-state';
import { FIXED_DT, INITIAL_SEED } from '../src/rules';
import { orbitalInput } from '../scripts/mission-runner';
import {
  createMothershipLayout, FACE_NAMES, MOTHERSHIP_CENTER, MOTHERSHIP_LENGTH,
  MOTHERSHIP_THICKNESS, MOTHERSHIP_WIDTH, TURRET_TOTAL_HP_MILLI, turretBoxes,
} from '../src/mothership-layout';
import { bestKey, readBest, saveBest, ScoreLedger, scoreComponents, validCombatReport, type BestStorage, type ScoreTotals } from '../src/scoring';

function assertFleetConservation(counts: FleetCounts): void {
  assert.equal(counts.active + counts.reserved + counts.reserve + counts.lost, 50);
  assert.ok(counts.active + counts.reserved <= 8);
  assert.equal(counts.remaining, counts.active + counts.reserved + counts.reserve);
  assert.equal(counts.playerLosses + counts.wingmanLosses, counts.lost);
}

function missionSnapshot(session: FlightSession) {
  const aircraft = (plane: AircraftToken) => ({ tokenId: plane.tokenId, generation: plane.generation, owner: plane.owner,
    hpMilli: plane.hpMilli, position: plane.position.toArray(), quaternion: plane.quaternion.toArray(), speed: plane.speed,
    ammunition: { ...plane.ammunition } });
  const enemyStates = [...session.enemyCombat.states.values()].sort((a, b) => a.turretId - b.turretId).map(state => ({
    ...state, fixedPoint: state.fixedPoint?.toArray() ?? null, fixedDirection: state.fixedDirection?.toArray() ?? null,
  }));
  const projectile = (bullet: (typeof session.weapons.bullets)[number]) => ({ id: bullet.id, kind: bullet.kind,
    owner: bullet.owner, shooterId: bullet.shooterId, position: bullet.position.toArray(), velocity: bullet.velocity.toArray(), distance: bullet.distance });
  return JSON.stringify({ tick: session.tick, phase: session.phase, counts: session.fleet.counts,
    active: session.fleet.active.map(aircraft), turrets: session.mothership.turrets.map(turret => [turret.layout.id, turret.hpMilli]),
    destroyed: [...session.mothership.destroyedIds].sort((a, b) => a - b), score: session.score.totals,
    friendly: session.weapons.bullets.map(projectile), enemy: session.enemyCombat.bullets.map(projectile), enemyStates,
    events: session.events.map(event => ({ ...event, point: event.point?.toArray() ?? null })) });
}

const zeroTotals = (): ScoreTotals => ({
  K: 0, damageMilli: 0, P: 0, W: 0, N: 0, Hmain: 0, Hmg: 0,
  playerKills: 0, wingmanKills: 0, playerDamageMilli: 0, wingmanDamageMilli: 0,
  mainKills: 0, mgKills: 0,
});

test('layout data fixes 100 unique turrets, six face counts, unit axes, HP and approach intervals', () => {
  const layout = createMothershipLayout();
  assert.deepEqual(MOTHERSHIP_CENTER.toArray(), [0, 1000, 0]);
  assert.deepEqual([MOTHERSHIP_LENGTH, MOTHERSHIP_WIDTH, MOTHERSHIP_THICKNESS], [1200, 600, 240]);
  assert.equal(layout.turrets.length, 100);
  assert.equal(new Set(layout.turrets.map(turret => turret.id)).size, 100);
  assert.equal(layout.turrets.filter(turret => turret.kind === 'main').length, 20);
  assert.equal(layout.turrets.filter(turret => turret.kind === 'mg').length, 80);
  assert.equal(layout.turrets.reduce((total, turret) => total + turret.maxHpMilli, 0), TURRET_TOTAL_HP_MILLI);

  const faceCounts = new Map(FACE_NAMES.map(face => [face, layout.turrets.filter(turret => turret.face === face).length]));
  assert.deepEqual([...faceCounts.entries()], [
    ['top', 20], ['bottom', 20], ['left', 20], ['right', 20], ['front', 10], ['rear', 10],
  ]);
  for (const turret of layout.turrets) {
    assert.ok(turret.position.distanceTo(turret.localPosition.clone().add(layout.center)) < 1e-9);
    assert.ok(Math.abs(turret.normal.length() - 1) < 1e-9);
    assert.ok(Math.abs(turret.tangent.length() - 1) < 1e-9);
    assert.ok(Math.abs(turret.right.length() - 1) < 1e-9);
    assert.ok(Math.abs(turret.normal.dot(turret.tangent)) < 1e-9);
    assert.ok(Math.abs(turret.normal.dot(turret.right)) < 1e-9);
    assert.ok(Math.abs(turret.tangent.dot(turret.right)) < 1e-9);
    assert.ok(Math.abs(turret.attackApproach[0].distanceTo(turret.aimPoint) - 600) < 1e-8);
    assert.ok(Math.abs(turret.attackApproach[1].distanceTo(turret.aimPoint) - 250) < 1e-8);
    assert.ok(turret.attackApproach[0].distanceTo(turret.attackApproach[1]) >= 300);
    assert.ok(Math.abs(turret.outwardWaypoint.distanceTo(turret.aimPoint) - 900) < 1e-8);
    assert.equal(turretBoxes(turret).length, 4);
    assert.ok(turretBoxes(turret).every(box => box.turretId === turret.id));
    assert.ok(turretBoxes(turret, 0, Math.PI / 4, true).every(box => box.kind === 'wreck'));
  }

  const spawn = layout.spawnCandidates[0];
  assert.ok(spawn);
  for (const turret of layout.turrets) {
    const minimum = turret.kind === 'main' ? 1300 : 800;
    assert.ok(spawn.distanceTo(turret.muzzle) >= minimum, `spawn is too close to turret ${turret.id}`);
  }
});

test('synthetic finite-fleet fixture preserves all 50 identities through simultaneous losses and respawns', () => {
  const fleet = new Fleet(71);
  const bornIds = new Set(fleet.active.map(aircraft => aircraft.tokenId));
  assert.deepEqual(fleet.counts, {
    active: 8, reserved: 0, reserve: 42, lost: 0, remaining: 50,
    playerLosses: 0, wingmanLosses: 0,
  });
  assertFleetConservation(fleet.counts);

  const spawn = (slotId: number, active: readonly { slotId: number }[]) =>
    new Vector3(5000 + slotId * 50, 1000, 5000 + active.length * 100);
  let tick = 0;
  while (fleet.active.length > 0) {
    tick += 1;
    const simultaneous = fleet.active;
    for (const aircraft of simultaneous) {
      assert.equal(fleet.lose(aircraft.tokenId, tick)?.hpMilli, 0);
      assertFleetConservation(fleet.counts);
    }
    const scheduled = fleet.postTick(tick, spawn);
    assert.equal(scheduled.anomaly, null);
    assertFleetConservation(fleet.counts);

    const due = tick + 180;
    while (tick < due) {
      tick += 1;
      const transitions = fleet.postTick(tick, spawn);
      assert.equal(transitions.anomaly, null);
      for (const transition of transitions.transitions) {
        assert.equal(transition.kind, 'respawn');
        assert.ok(!bornIds.has(transition.aircraft.tokenId), `token ${transition.aircraft.tokenId} was reused`);
        bornIds.add(transition.aircraft.tokenId);
      }
      assertFleetConservation(fleet.counts);
    }
  }

  assert.equal(bornIds.size, 50);
  assert.deepEqual([...bornIds].sort((a, b) => a - b), Array.from({ length: 50 }, (_, index) => index));
  assert.deepEqual(fleet.counts, {
    active: 0, reserved: 0, reserve: 0, lost: 50, remaining: 0,
    playerLosses: 7, wingmanLosses: 43,
  });
  assert.equal(fleet.postTick(tick + 1, spawn).transitions.length, 0, 'no token exists after finite reserve exhaustion');
  assertFleetConservation(fleet.counts);
});

test('scoring preserves the fixed 160,000 example, time monotonicity, negative totals and N=0 semantics', () => {
  const example: ScoreTotals = {
    K: 100, damageMilli: 24_000_000, P: 1, W: 2, N: 1000, Hmain: 200, Hmg: 300,
    playerKills: 60, wingmanKills: 40, playerDamageMilli: 14_400_000, wingmanDamageMilli: 9_600_000,
    mainKills: 20, mgKills: 80,
  };
  const fast = scoreComponents(example, 18_000, true);
  const slow = scoreComponents(example, 36_000, true);
  assert.equal(fast.total, 160_000);
  assert.ok(slow.total < fast.total);
  assert.equal(fast.accuracy, 0.5);

  const noShots = scoreComponents(zeroTotals(), 0, false);
  assert.equal(noShots.accuracy, null);
  assert.equal(noShots.accuracyLoss, 0);
  assert.equal(noShots.time, 0);

  const losses: ScoreTotals = { ...zeroTotals(), P: 50 };
  assert.equal(scoreComponents(losses, 0, false).total, -100_000);
});

test('score events are idempotent and retain shooter ownership across the finishing hit', () => {
  const ledger = new ScoreLedger();
  ledger.recordShot(100, 'player');
  ledger.recordShot(100, 'player');
  ledger.recordDamage(100, 'player', 'main', 7, 594_000, false);
  ledger.recordDamage(100, 'player', 'main', 7, 594_000, false);
  ledger.recordShot(101, 'wingman');
  ledger.recordDamage(101, 'wingman', 'main', 7, 6_000, true);
  ledger.assertInvariants();

  assert.equal(ledger.totals.N, 1);
  assert.equal(ledger.totals.Hmain, 1);
  assert.equal(ledger.totals.Hmg, 0);
  assert.equal(ledger.totals.K, 1);
  assert.equal(ledger.totals.playerKills, 0);
  assert.equal(ledger.totals.wingmanKills, 1);
  assert.equal(ledger.totals.damageMilli, 600_000);
  assert.equal(ledger.totals.playerDamageMilli, 594_000);
  assert.equal(ledger.totals.wingmanDamageMilli, 6_000);

  const report = ledger.report(12, 'easy', 29, 180, 'defeat');
  assert.equal(report.components.total, 2_200);
  assert.equal(validCombatReport(report), true);
  assert.equal(validCombatReport({ ...report, Hmain: 2 }), false);
});

test('mode-specific best records accept only valid victories and preserve future envelopes', () => {
  const makeVictory = (mode: 'easy' | 'normal', endTick: number) => {
    const ledger = new ScoreLedger();
    for (let id = 0; id < 100; id += 1) {
      const kind = id < 20 ? 'main' : 'mg';
      const damage = id < 20 ? 600_000 : 150_000;
      ledger.recordShot(id + 1, 'player');
      ledger.recordDamage(id + 1, 'player', kind, id, damage, true);
    }
    return ledger.report(1, mode, 123, endTick, 'victory');
  };
  const values = new Map<string, string>();
  const storage: BestStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  const easyFast = makeVictory('easy', 9000);
  const easySlow = makeVictory('easy', 18000);
  const normal = makeVictory('normal', 9000);
  const defeated = new ScoreLedger().report(3, 'easy', 123, 100, 'defeat');

  assert.equal(validCombatReport(easyFast, 'easy'), true);
  assert.equal(easyFast.K, 100);
  assert.equal(easyFast.damageMilli, TURRET_TOTAL_HP_MILLI);
  assert.equal(saveBest(easyFast, storage).saved, true);
  assert.equal(saveBest(easySlow, storage).saved, false);
  assert.equal(saveBest(normal, storage).saved, true);
  assert.equal(saveBest(defeated, storage).saved, false);
  assert.equal(readBest('easy', storage)?.endTick, 9000);
  assert.equal(readBest('normal', storage)?.endTick, 9000);

  values.set(bestKey('easy'), JSON.stringify({ version: 2, record: { future: true } }));
  assert.deepEqual(saveBest(makeVictory('easy', 6000), storage), {
    saved: false, best: null, error: 'future-version',
  });
  assert.deepEqual(JSON.parse(values.get(bestKey('easy'))!), { version: 2, record: { future: true } });
});

test('ordinary combat inputs preserve the same logical snapshot at 30, 60 and 120 Hz', () => {
  const runs = [30, 60, 120].map(hz => {
    const session = new FlightSession(), clock = new FixedStepper(), accepted: unknown[] = [];
    const operation = session.prepare('normal', INITIAL_SEED);
    assert.ok(operation !== null); assert.equal(session.begin(operation), true); clock.reset(0);
    for (let frame = 1; frame <= hz * 30; frame += 1) {
      clock.frame(frame * 1000 / hz, true, () => {
        const input = orbitalInput(session);
        accepted.push({ ...input });
        session.step(input);
        assertFleetConservation(session.fleet.counts);
        assert.equal(session.score.totals.Hmain + session.score.totals.Hmg <= session.score.totals.N, true);
        assert.equal(session.score.totals.damageMilli + session.mothership.totalHpMilli, TURRET_TOTAL_HP_MILLI);
        assert.equal(session.score.totals.K, session.mothership.destroyedIds.size);
        assert.ok(session.weapons.bullets.length <= 256);
        assert.ok(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length <= 16);
        assert.ok(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length <= 256);
      }, () => assert.fail('thirty seconds of regular frames must not request a gap stop'));
    }
    assert.equal(session.tick, 1800);
    return { accepted, snapshot: missionSnapshot(session), fixedDt: FIXED_DT };
  });
  assert.deepEqual(runs[0].accepted, runs[1].accepted);
  assert.deepEqual(runs[1].accepted, runs[2].accepted);
  assert.equal(runs[0].snapshot, runs[1].snapshot);
  assert.equal(runs[1].snapshot, runs[2].snapshot);
});
