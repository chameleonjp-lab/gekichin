import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { AircraftWeapons, advanceAmmunition, friendlyDamageMilli } from '../src/aircraft-weapons';
import type { AircraftToken, Projectile } from '../src/combat-types';
import { CollisionWorld } from '../src/collision-world';
import { createAircraftToken } from '../src/fleet';
import { forwardOf, MAX_SPEED, updateAircraftMotion } from '../src/flight';
import { FlightSession } from '../src/game-state';
import { Mothership, TurretState } from '../src/mothership';
import { AIRCRAFT_RADIUS, turretDirection, type TurretDefinition } from '../src/mothership-layout';
import { ENEMY_PERFORMANCE, EnemyTurretCombat, solveIntercept } from '../src/turret-combat';
import { WingmanAI } from '../src/wingman-ai';

const OPERATION = 17;
const clearWorld = { lineOfSight: () => true, sweep: () => null } as unknown as CollisionWorld;

function aimedFixture(kind: 'main' | 'mg') {
  const ship = new Mothership();
  const turret = ship.turrets.find(candidate => candidate.layout.kind === kind && candidate.layout.face === 'top')!;
  const plane = createAircraftToken(OPERATION, 0, 0, 0, 'player', turret.muzzle.clone()
    .addScaledVector(turretDirection(turret.layout, turret.yaw, turret.pitch), 450));
  plane.speed = 0;
  return { ship, turret, plane, enemy: new EnemyTurretCombat(OPERATION), world: new CollisionWorld(ship) };
}

function syntheticTurret(id: number, kind: 'main' | 'mg'): TurretState {
  const original = new Mothership().turrets.find(turret => turret.layout.kind === kind)!;
  const position = new Vector3(0, 2000, 0);
  const definition: TurretDefinition = { ...original.layout, id, position, localPosition: position.clone(),
    aimPoint: position.clone(), normal: new Vector3(0, 1, 0), tangent: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0) };
  return new TurretState(definition);
}

test('intercept includes the fixed warning delay, chooses a positive root, and rejects an unreachable target', () => {
  const origin = new Vector3(), position = new Vector3(0, 0, 400), velocity = new Vector3(0, 0, 100);
  const solution = solveIntercept(origin, position, velocity, 1, 400, 4)!;
  assert.ok(Math.abs(solution.flightTime - 5 / 3) < 1e-12);
  assert.ok(Math.abs(solution.point.z - 2000 / 3) < 1e-10);
  assert.equal(solveIntercept(origin, position, new Vector3(0, 0, 500), 1, 400, 4), null);
  assert.equal(solveIntercept(origin, position, new Vector3(), 0, 400, .999), null);
  assert.equal(solveIntercept(origin, position, new Vector3(), 0, 400, 1)!.flightTime, 1);
  assert.deepEqual(position.toArray(), [0, 0, 400]);
});

test('the integrated tick-start warning uses actual moving-aircraft velocity after previous is reset', () => {
  const session = new FlightSession();
  session.begin(session.prepare('normal')!);
  let checked = false;
  for (let tick = 0; tick < 3600 && !checked; tick += 1) {
    const snapshots = new Map(session.fleet.active.map(plane => [plane.tokenId,
      { position: plane.position.clone(), velocity: forwardOf(plane).multiplyScalar(plane.speed) }]));
    session.step({ turn: .1, climb: 0, fire: false, loop: false });
    for (const state of session.enemyCombat.states.values()) {
      if (state.phase !== 'warning' || state.warningStartedTick !== session.tick) continue;
      const turret = session.mothership.byId(state.turretId)!;
      const snapshot = snapshots.get(state.targetTokenId!)!;
      const performance = ENEMY_PERFORMANCE[state.kind];
      const expected = solveIntercept(turret.muzzle, snapshot.position, snapshot.velocity,
        performance.warningTicks / 60, performance.speed, performance.lifeTicks / 60)!;
      assert.ok(snapshot.velocity.length() >= 65);
      assert.ok(state.fixedPoint!.distanceTo(expected.point) < 1e-8);
      assert.ok(state.fixedPoint!.distanceTo(snapshot.position) > 20, 'warning must lead a moving aircraft');
      checked = true;
      break;
    }
  }
  assert.equal(checked, true, 'normal enemy logic entered a moving-target warning');
});

test('main warning lasts sixty ticks, keeps its physical aim fixed, and fires one 400m/s shot', () => {
  const { turret, plane, enemy, world } = aimedFixture('main');
  assert.deepEqual(enemy.step(0, [turret], [plane], world), []);
  const state = enemy.states.get(turret.id)!;
  assert.equal(state.phase, 'warning');
  assert.equal(state.warningEndsTick, 60);
  const originalPoint = state.fixedPoint!.clone(), yaw = turret.yaw, pitch = turret.pitch;
  plane.position.addScaledVector(turret.layout.right, 90); plane.previous.copy(plane.position);
  for (let tick = 1; tick < 60; tick += 1) assert.equal(enemy.step(tick, [turret], [plane], world).length, 0);
  assert.equal(turret.yaw, yaw); assert.equal(turret.pitch, pitch);
  assert.ok(state.fixedPoint!.equals(originalPoint));
  const request = enemy.step(60, [turret], [plane], world)[0];
  assert.ok(request);
  const bullet = enemy.fire(request, 60, () => 1)!;
  assert.ok(Math.abs(bullet.velocity.length() - 400) < 1e-10);
  assert.equal(bullet.baseDamageMilli, 24_000);
  assert.equal(bullet.expiresTick, 300);
  assert.equal(bullet.owner, 'enemy');
  assert.ok(bullet.position.equals(turret.muzzle));
  assert.equal(state.phase, 'reload'); assert.equal(state.readyTick, 360);
  assert.equal(state.targetTokenId, null);
  assert.equal(enemy.fire(request, 60, () => 2), null);
});

test('MG fires F, F+6, … F+54, then releases its reservation for 120ticks after the last shot', () => {
  const { turret, plane, enemy, world } = aimedFixture('mg');
  const shots: Projectile[] = [];
  for (let tick = 0; tick <= 191; tick += 1) for (const request of enemy.step(tick, [turret], [plane], world)) {
    const bullet = enemy.fire(request, tick, () => shots.length + 1);
    if (bullet) shots.push(bullet);
  }
  assert.deepEqual(shots.map(shot => shot.bornTick), [18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
  assert.ok(shots.every(shot => Math.abs(shot.velocity.length() - 650) < 1e-10 && shot.baseDamageMilli === 1200 && shot.expiresTick - shot.bornTick === 90));
  const state = enemy.states.get(turret.id)!;
  assert.equal(state.phase, 'reload'); assert.equal(state.readyTick, 192); assert.equal(state.targetTokenId, null);
  enemy.step(192, [turret], [plane], world);
  assert.equal(state.phase, 'warning'); assert.equal(state.warningEndsTick, 210);
});

test('MG cancellation after two real shots reloads from the last shot; target generation changes cancel pending shots', () => {
  const { turret, plane, enemy, world } = aimedFixture('mg');
  for (let tick = 0; tick <= 24; tick += 1) for (const request of enemy.step(tick, [turret], [plane], world)) enemy.fire(request, tick, () => tick);
  assert.equal(enemy.bullets.length, 2);
  plane.generation += 1;
  assert.equal(enemy.step(25, [turret], [plane], world).length, 0);
  const state = enemy.states.get(turret.id)!;
  assert.equal(state.phase, 'cancelled'); assert.equal(state.readyTick, 144); assert.equal(state.targetTokenId, null);
  assert.equal(enemy.bullets.length, 2, 'the dead shooter/target does not erase already fired ammunition');
});

test('a turret destroyed by an earlier contact cannot commit its same-tick pending shot', () => {
  const { turret, plane, enemy, world } = aimedFixture('main');
  enemy.step(0, [turret], [plane], world);
  const request = enemy.step(60, [turret], [plane], world)[0];
  turret.hpMilli = 0;
  let allocated = 0;
  assert.equal(enemy.fire(request, 60, () => ++allocated), null);
  assert.equal(allocated, 0); assert.equal(enemy.bullets.length, 0);
  assert.equal(enemy.states.get(turret.id)!.phase, 'destroyed');
  assert.equal(enemy.states.get(turret.id)!.targetTokenId, null);
});

for (const kind of ['main', 'mg'] as const) test(`${kind} finite tracking does not exceed its turn speed and times out after 120ticks`, () => {
  const turret = syntheticTurret(0, kind), enemy = new EnemyTurretCombat(OPERATION);
  const plane = createAircraftToken(OPERATION, 0, 0, 0, 'player', new Vector3());
  plane.speed = 0;
  let previousAxis = turretDirection(turret.layout, turret.yaw, turret.pitch);
  for (let tick = 0; tick <= 120; tick += 1) {
    const yaw = (tick % 2 ? -1 : 1) * 70 * Math.PI / 180;
    plane.position.copy(turret.layout.aimPoint).addScaledVector(turretDirection(turret.layout, yaw, Math.PI / 4), 450);
    plane.previous.copy(plane.position);
    enemy.step(tick, [turret], [plane], clearWorld);
    const axis = turretDirection(turret.layout, turret.yaw, turret.pitch);
    assert.ok(axis.angleTo(previousAxis) <= (kind === 'main' ? Math.PI / 360 : Math.PI / 120) + 1e-10);
    previousAxis = axis;
  }
  assert.equal(enemy.states.get(0)!.phase, 'cancelled');
  assert.equal(enemy.states.get(0)!.readyTick, kind === 'main' ? 180 : 138);
});

test('local yaw/pitch limits reject internal and off-axis targets on every exterior face', () => {
  const ship = new Mothership();
  for (const face of ['top', 'bottom', 'left', 'right', 'front', 'rear'] as const) {
    const turret = ship.turrets.find(candidate => candidate.layout.face === face)!;
    for (const [yaw, pitch] of [[76, 45], [0, 4], [0, 86], [0, -20]]) {
      const enemy = new EnemyTurretCombat(OPERATION);
      const plane = createAircraftToken(OPERATION, 0, 0, 0, 'player', turret.layout.aimPoint.clone()
        .addScaledVector(turretDirection(turret.layout, yaw * Math.PI / 180, pitch * Math.PI / 180), 650));
      plane.speed = 0;
      enemy.step(0, [turret], [plane], clearWorld);
      assert.equal(enemy.states.get(turret.id)!.phase, 'idle', `${face} yaw=${yaw} pitch=${pitch}`);
    }
  }
});

test('active and per-aircraft caps are enforced, and unused IDs precede recently released reservations', () => {
  const turrets = [...Array.from({ length: 6 }, (_, id) => syntheticTurret(id, 'main')),
    ...Array.from({ length: 15 }, (_, id) => syntheticTurret(20 + id, 'mg'))];
  const planes = Array.from({ length: 8 }, (_, id) => createAircraftToken(OPERATION, id, id, 0, id === 0 ? 'player' : 'wingman',
    new Vector3(0, 2400, -400)));
  for (const plane of planes) plane.speed = 0;
  const enemy = new EnemyTurretCombat(OPERATION);
  enemy.step(0, turrets, planes, clearWorld);
  const active = () => [...enemy.states.values()].filter(state => ['tracking', 'warning', 'burst'].includes(state.phase));
  assert.equal(active().filter(state => state.kind === 'main').length, 4);
  assert.equal(active().filter(state => state.kind === 'mg').length, 12);
  for (const plane of planes) {
    assert.ok(active().filter(state => state.kind === 'main' && state.targetTokenId === plane.tokenId).length <= 1);
    assert.ok(active().filter(state => state.kind === 'mg' && state.targetTokenId === plane.tokenId).length <= 3);
  }
  planes[0].hpMilli = 0;
  enemy.step(1, turrets, planes, clearWorld);
  assert.equal(enemy.states.get(0)!.phase, 'cancelled');
  assert.ok(['tracking', 'warning'].includes(enemy.states.get(4)!.phase));
  assert.equal(active().filter(state => state.targetTokenId === 0).length, 0);
});

test('a full enemy pool defers every remaining burst slot by one tick and pauses after sixty consecutive failures', () => {
  const { turret, plane, enemy, world } = aimedFixture('mg');
  let attack = 1;
  for (let tick = 0; tick <= 18; tick += 1) for (const request of enemy.step(tick, [turret], [plane], world)) enemy.fire(request, tick, () => attack++);
  const template = enemy.bullets[0];
  for (let id = enemy.bullets.length; id < ENEMY_PERFORMANCE.mg.poolCap; id += 1) enemy.bullets.push({ ...template, id: attack++, position: template.position.clone(), previous: template.previous.clone(), velocity: template.velocity.clone() });
  for (const request of enemy.step(24, [turret], [plane], world)) assert.equal(enemy.fire(request, 24, () => attack++), null);
  const state = enemy.states.get(turret.id)!;
  assert.equal(state.shotCount, 1); assert.equal(state.nextFireTick, 25);
  enemy.remove(enemy.bullets[0].id);
  const delayed = enemy.fire(enemy.step(25, [turret], [plane], world)[0], 25, () => attack++)!;
  assert.equal(delayed.bornTick, 25); assert.equal(state.nextFireTick, 31);
  for (let tick = 31; tick < 91; tick += 1) for (const request of enemy.step(tick, [turret], [plane], world)) assert.equal(enemy.fire(request, tick, () => attack++), null);
  assert.equal(state.shotCount, 2); assert.equal(state.nextFireTick, 91);
  assert.equal(state.poolFailureTicks, 60); assert.ok(enemy.anomaly?.includes('60tick'));
  assert.equal(enemy.step(91, [turret], [plane], world).length, 0);
  const scheduled = state.nextFireTick;
  enemy.clearAnomaly();
  assert.equal(enemy.anomaly, null); assert.equal(state.poolFailureTicks, 0); assert.equal(state.nextFireTick, scheduled);
});

test('wingmen assign at most two pilots to the final turret, release dead assignments, and keep flight updates external', () => {
  const ship = new Mothership(), ai = new WingmanAI(), world = new CollisionWorld(ship);
  const last = ship.turrets.find(turret => turret.layout.face === 'bottom')!;
  for (const turret of ship.turrets) if (turret !== last) ship.applyDamage(turret.id, turret.maxHpMilli);
  const planes = Array.from({ length: 4 }, (_, id) => createAircraftToken(OPERATION, id, id, 0, 'wingman', new Vector3(id * 40, 1000, 2000)));
  const before = planes.map(plane => plane.position.clone());
  ai.step(0, planes, ship, world);
  assert.equal([...ai.states.values()].filter(state => state.targetId === last.id).length, 2);
  assert.ok(planes.every((plane, index) => plane.position.equals(before[index])));
  ship.applyDamage(last.id, last.maxHpMilli);
  const intents = ai.step(1, planes, ship, world);
  assert.ok([...ai.states.values()].every(state => state.targetId === null));
  assert.ok([...intents.values()].every(intent => !intent.fire));
});

for (const face of ['top', 'bottom', 'left', 'right', 'front', 'rear'] as const) test(`a real finite-flight wingman reaches and destroys a last ${face} turret with ordinary scattered bullets`, () => {
  // A geometry/AI fixture, not a product clear: only this mount remains and
  // enemy shots are outside the purpose of this isolated reachability test.
  const ship = new Mothership(), world = new CollisionWorld(ship), ai = new WingmanAI();
  const target = ship.turrets.find(turret => turret.layout.face === face && turret.layout.kind === 'mg')!;
  for (const turret of ship.turrets) if (turret !== target) ship.applyDamage(turret.id, turret.maxHpMilli);
  const plane = createAircraftToken(OPERATION, 1, 1, 0, 'wingman', new Vector3(40, 1000, 2000));
  const weapons = new AircraftWeapons(OPERATION);
  let attackId = 0, fired = 0, hit = 0, fireWasOccluded = false;
  for (let tick = 1; tick <= 36000 && target.hpMilli > 0; tick += 1) {
    const intent = ai.step(tick, [plane], ship, world).get(plane.tokenId)!;
    advanceAmmunition(plane, tick);
    plane.previous.copy(plane.position);
    const requests = weapons.plan(plane, tick, intent.fire);
    updateAircraftMotion(plane, intent.turn, intent.climb, 1 / 60, intent.preferredSpeed ?? 110);
    assert.ok(plane.position.distanceTo(plane.previous) <= MAX_SPEED / 60 + 1e-8, 'no teleport');
    assert.equal(world.sweep(plane.previous, plane.position, { radius: AIRCRAFT_RADIUS, aircraft: false }), null, 'finite turn avoids the hull and mounts');
    if (intent.fire && !world.lineOfSight(plane.previous, target.layout.aimPoint, target.id)) fireWasOccluded = true;
    for (const request of requests) fired += weapons.fire(request, tick, () => ++attackId).length;
    weapons.expire(tick);
    for (const bullet of [...weapons.bullets]) {
      bullet.previous.copy(bullet.position);
      const end = bullet.position.clone().addScaledVector(bullet.velocity, 1 / 60);
      const contact = world.sweep(bullet.position, end, { aircraft: false });
      const distance = bullet.position.distanceTo(end);
      if (contact) {
        bullet.distance += distance * contact.time;
        if (contact.kind === 'turret' && contact.id === target.id) {
          const resolution = ship.applyDamage(target.id, friendlyDamageMilli('wingman', bullet.kind as 'mg' | 'cannon', bullet.distance), { attackId: bullet.id, tick });
          if (resolution.actual > 0) hit += 1;
        }
        weapons.remove(bullet.id);
      } else { bullet.distance += distance; bullet.position.copy(end); }
    }
  }
  assert.equal(target.hpMilli, 0, `mount=${target.id}; fired=${fired}; hit=${hit}; phase=${ai.states.get(1)?.phase}`);
  assert.ok(fired > 0 && hit > 0); assert.equal(fireWasOccluded, false);
});
