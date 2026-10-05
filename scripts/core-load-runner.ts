import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AircraftWeapons, advanceAmmunition } from '../src/aircraft-weapons';
import { createAircraftToken } from '../src/fleet';
import { updateQuaternion } from '../src/flight';
import { CollisionWorld } from '../src/collision-world';
import { Mothership } from '../src/mothership';
import { EnemyTurretCombat, ENEMY_PERFORMANCE } from '../src/turret-combat';
import { INITIAL_SEED, RULES_VERSION } from '../src/rules';
import { ScoreLedger } from '../src/scoring';

// Synthetic pool/clock endurance: pilot poses stay fixed and projectile contacts
// are deliberately omitted. This is never a victory or ordinary-play record.
const operationId = 81;
const ticks = Number(process.env.GEKICHIN_LOAD_TICKS ?? 54000);
assert.ok(Number.isSafeInteger(ticks) && ticks > 0 && ticks <= 54000);
const mothership = new Mothership(), world = new CollisionWorld(mothership);
const main = mothership.turrets.filter(turret => turret.layout.face === 'top' && turret.layout.kind === 'main');
const mg = mothership.turrets.filter(turret => turret.layout.face === 'top' && turret.layout.kind === 'mg'
  && Math.abs(turret.layout.localPosition.z) === 480 && Math.abs(turret.layout.localPosition.x) === 65);
const mountingPoints = [...main, ...mg];
assert.equal(mountingPoints.length, 8);
const aircraft = mountingPoints.map((turret, slot) => {
  const position = turret.layout.aimPoint.clone().addScaledVector(turret.layout.normal, 200)
    .addScaledVector(turret.layout.tangent, Math.sqrt(120000));
  const plane = createAircraftToken(operationId, slot, slot, 0, slot === 0 ? 'player' : 'wingman', position);
  plane.yaw = turret.layout.tangent.z < 0 ? 0 : Math.PI;
  updateQuaternion(plane);
  assert.equal(world.sweep(position, position, { radius: 5, aircraft: false }), null);
  return plane;
});
const friendly = new AircraftWeapons(operationId), enemy = new EnemyTurretCombat(operationId), ledger = new ScoreLedger();
const observed = { friendly: 0, enemyMain: 0, enemyMG: 0, mainActive: 0, mgActive: 0, mainShots: 0, mgShots: 0, friendlyShots: 0 };
let attackId = 0;
const allocate = () => ++attackId;
const sourceHashes = Object.fromEntries(['src/aircraft-weapons.ts', 'src/combat-types.ts', 'src/collision-world.ts', 'src/fleet.ts',
  'src/flight.ts', 'src/mothership-layout.ts', 'src/mothership.ts', 'src/rules.ts', 'src/scoring.ts', 'src/turret-combat.ts', 'src/types.ts',
  'scripts/core-load-runner.ts'].map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
const started = performance.now();
console.log(JSON.stringify({ kind: 'synthetic-load-start', timestamp: new Date().toISOString(), environment: { node: process.version, platform: process.platform, architecture: process.arch },
  requirementsCommit: 'e9212a73a7b36c33dff7e88d3a7308be6cdcea35', rulesVersion: RULES_VERSION, seed: INITIAL_SEED, ticks, sourceHashes,
  classification: 'frozen-pilot-poses-and-no-projectile-contacts', aircraft: aircraft.map(plane => ({ tokenId: plane.tokenId, position: plane.position.toArray(), yaw: plane.yaw, speed: plane.speed })),
  interventions: ['Pilot poses stay fixed; projectile contacts and HP damage are omitted.', 'This validates rates, legal reservations and pool capacity, and provides no victory or real-device performance evidence.'] }));

for (let tick = 1; tick <= ticks; tick += 1) {
  friendly.expire(tick);
  for (const bullet of [...enemy.bullets]) if (tick >= bullet.expiresTick) enemy.remove(bullet.id);
  for (const plane of aircraft) {
    advanceAmmunition(plane, tick);
    for (const request of friendly.plan(plane, tick, true)) for (const shot of friendly.fire(request, tick, allocate)) {
      ledger.recordShot(shot.id, shot.owner as 'player' | 'wingman'); observed.friendlyShots += 1;
    }
  }
  for (const request of enemy.step(tick, mothership.turrets, aircraft, world)) {
    const shot = enemy.fire(request, tick, allocate);
    if (shot) observed[shot.kind === 'main' ? 'mainShots' : 'mgShots'] += 1;
  }
  const reservations = new Map<string, number>();
  let activeMain = 0, activeMG = 0;
  for (const state of enemy.states.values()) {
    if (!['tracking', 'warning', 'burst'].includes(state.phase)) continue;
    if (state.kind === 'main') activeMain += 1; else activeMG += 1;
    const key = `${state.kind}:${state.targetTokenId}:${state.targetGeneration}`;
    reservations.set(key, (reservations.get(key) ?? 0) + 1);
    const turret = mothership.byId(state.turretId)!;
    const plane = aircraft.find(plane => plane.tokenId === state.targetTokenId && plane.generation === state.targetGeneration)!;
    assert.ok(plane && plane.hpMilli > 0);
    const direction = plane.position.clone().sub(turret.muzzle), range = direction.length(); direction.normalize();
    const yaw = Math.atan2(direction.dot(turret.layout.right), direction.dot(turret.layout.tangent));
    const pitch = Math.asin(direction.dot(turret.layout.normal));
    assert.ok(range <= ENEMY_PERFORMANCE[state.kind].range + 1e-8);
    assert.ok(yaw >= turret.layout.yawMin - 1e-8 && yaw <= turret.layout.yawMax + 1e-8);
    assert.ok(pitch >= turret.layout.pitchMin - 1e-8 && pitch <= turret.layout.pitchMax + 1e-8);
    assert.ok(world.lineOfSight(turret.muzzle, plane.position));
  }
  assert.ok(activeMain <= 4 && activeMG <= 12);
  for (const [key, count] of reservations) assert.ok(count <= (key.startsWith('main:') ? 1 : 3));
  observed.mainActive = Math.max(observed.mainActive, activeMain); observed.mgActive = Math.max(observed.mgActive, activeMG);
  observed.friendly = Math.max(observed.friendly, friendly.bullets.length);
  observed.enemyMain = Math.max(observed.enemyMain, enemy.bullets.filter(bullet => bullet.kind === 'main').length);
  observed.enemyMG = Math.max(observed.enemyMG, enemy.bullets.filter(bullet => bullet.kind === 'mg').length);
  assert.ok(observed.friendly <= 256 && observed.enemyMain <= 16 && observed.enemyMG <= 256);
  assert.equal(friendly.allocationFailures, 0); assert.equal(enemy.poolFailures, 0); assert.equal(enemy.anomaly, null);
  for (const bullet of [...friendly.bullets, ...enemy.bullets]) {
    bullet.previous.copy(bullet.position); bullet.position.addScaledVector(bullet.velocity, 1 / 60); bullet.distance += bullet.velocity.length() / 60;
    if (tick + 1 >= bullet.expiresTick) { if (bullet.faction === 'friendly') friendly.remove(bullet.id); else enemy.remove(bullet.id); }
  }
  friendly.assertInvariants(aircraft); ledger.assertInvariants();
  const liveIds = friendly.bullets.map(bullet => bullet.id);
  const floor = liveIds.length ? Math.min(...liveIds) : attackId + 1;
  ledger.retireAttackIds(floor); mothership.retireAttackIds(floor);
  if (tick % 9000 === 0) console.log(JSON.stringify({ kind: 'synthetic-load-progress', tick, activeSeconds: tick / 60, observed, playerN: ledger.totals.N,
    friendlyAllocationFailures: friendly.allocationFailures, enemyAllocationFailures: enemy.poolFailures }));
}
assert.equal(observed.mainActive, 4); assert.equal(observed.mgActive, 12);
assert.ok(observed.mainShots > 0 && observed.mgShots > 0);
assert.equal(mothership.totalHpMilli, 24000000); assert.equal(mothership.remaining, 100);
console.log(JSON.stringify({ kind: 'synthetic-load-complete', ticks, activeSeconds: ticks / 60, wallSeconds: (performance.now() - started) / 1000,
  observed, playerN: ledger.totals.N, friendlyAllocationFailures: friendly.allocationFailures, enemyAllocationFailures: enemy.poolFailures,
  remainingTurrets: mothership.remaining, totalHpMilli: mothership.totalHpMilli, retainedHitIds: ledger.retainedHitIds, retainedTurretAttackIds: mothership.retainedAttackCount }));
