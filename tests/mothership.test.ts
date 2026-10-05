import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { CollisionWorld, boundsOfBox, sweepSphereAircraft, sweepSphereBox, type CollisionHit } from '../src/collision-world';
import { Mothership } from '../src/mothership';
import {
  AIRCRAFT_RADIUS, FACE_NAMES, TURRET_TOTAL_HP_MILLI, createMothershipLayout, turretBoxes, turretDirection, turretMuzzle,
  type BoxSpec, type MothershipLayout,
} from '../src/mothership-layout';

const box = (center = new Vector3(), halfSize = new Vector3(1, 1, 1), rotation = new Quaternion()): BoxSpec => ({
  id: 'synthetic-box', kind: 'hull', center, halfSize, rotation,
});

test('canonical layout has fixed100 unique IDs, six-face20/80 distribution and24,000HP', () => {
  const layout = createMothershipLayout();
  assert.deepEqual(layout.center.toArray(), [0, 1000, 0]);
  assert.equal(layout.turrets.length, 100); assert.equal(new Set(layout.turrets.map(turret => turret.id)).size, 100);
  assert.equal(layout.turrets.filter(turret => turret.kind === 'main').length, 20);
  assert.equal(layout.turrets.filter(turret => turret.kind === 'mg').length, 80);
  assert.equal(layout.turrets.reduce((hp, turret) => hp + turret.maxHpMilli, 0), TURRET_TOTAL_HP_MILLI);
  const expected = { top: [4, 16], bottom: [4, 16], left: [4, 16], right: [4, 16], front: [2, 8], rear: [2, 8] };
  for (const face of FACE_NAMES) {
    assert.deepEqual(['main', 'mg'].map(kind => layout.turrets.filter(turret => turret.face === face && turret.kind === kind).length), expected[face]);
  }
  const hullBounds = layout.hullParts.filter(part => part.kind === 'hull').map(boundsOfBox);
  assert.equal(Math.min(...hullBounds.map(part => part.min.x)), -300); assert.equal(Math.max(...hullBounds.map(part => part.max.x)), 300);
  assert.equal(Math.min(...hullBounds.map(part => part.min.y)), 880); assert.equal(Math.max(...hullBounds.map(part => part.max.y)), 1120);
  assert.equal(Math.min(...hullBounds.map(part => part.min.z)), -600); assert.equal(Math.max(...hullBounds.map(part => part.max.z)), 600);
  for (const turret of layout.turrets) {
    assert.ok(turret.position.clone().sub(layout.center).equals(turret.localPosition));
    assert.ok(Math.abs(turret.normal.length() - 1) < 1e-12); assert.ok(Math.abs(turret.tangent.length() - 1) < 1e-12); assert.ok(Math.abs(turret.right.length() - 1) < 1e-12);
    assert.ok(Math.abs(turret.normal.dot(turret.tangent)) < 1e-12); assert.ok(Math.abs(turret.normal.dot(turret.right)) < 1e-12);
    assert.ok(Math.abs(turret.tangent.dot(turret.right)) < 1e-12);
    assert.equal(turret.yawMin, -75 * Math.PI / 180); assert.equal(turret.yawMax, 75 * Math.PI / 180);
    assert.equal(turret.pitchMin, 5 * Math.PI / 180); assert.equal(turret.pitchMax, 85 * Math.PI / 180);
    assert.ok(turretDirection(turret, 0, turret.pitchMin).dot(turret.normal) > 0);
  }
});

test('every turret has a350m ordinary-flight approach with aircraft radius+10m clearance and first-contact firing access', () => {
  const ship = new Mothership(), world = new CollisionWorld(ship);
  for (const turret of ship.turrets) {
    const [start, end] = turret.layout.attackApproach;
    assert.ok(start.distanceTo(end) >= 300, turret.layout.label);
    const direction = end.clone().sub(start).normalize();
    assert.ok(Math.abs(Math.asin(direction.y)) <= 30 * Math.PI / 180 + 1e-12, `${turret.layout.label} vertical steering`);
    assert.equal(world.sweep(start, end, { radius: AIRCRAFT_RADIUS + 10, aircraft: false }), null, `${turret.layout.label} flight corridor`);
    const contact = world.sweep(end, turret.layout.aimPoint, { aircraft: false });
    assert.equal(contact?.kind, 'turret', `${turret.layout.label} first contact`); assert.equal(contact?.id, turret.id, turret.layout.label);
    assert.equal(world.lineOfSight(end, turret.layout.aimPoint, turret.id), true);
  }
});

test('spawn and return corridor candidates satisfy all real muzzle range margins and30m separation', () => {
  const layout = createMothershipLayout(), world = new CollisionWorld(layout);
  assert.deepEqual(layout.spawnCandidates[0].toArray(), [0, 1000, 2000]);
  for (const point of layout.spawnCandidates) {
    assert.equal(world.sweep(point, point, { radius: AIRCRAFT_RADIUS, aircraft: false }), null);
    for (const turret of layout.turrets) for (const side of [-1, 1] as const) {
      assert.ok(point.distanceTo(turretMuzzle(turret, 0, Math.PI / 4, side)) >= (turret.kind === 'main' ? 1300 : 800), turret.label);
    }
  }
  for (let a = 0; a < layout.spawnCandidates.length; a += 1) for (let b = a + 1; b < layout.spawnCandidates.length; b += 1) {
    assert.ok(layout.spawnCandidates[a].distanceTo(layout.spawnCandidates[b]) >= 30);
  }
});

test('the exterior network connects above/below/front/rear and sides without hull shortcuts', () => {
  const layout = createMothershipLayout(), world = new CollisionWorld(layout);
  const reached = new Set([0]), pending = [0];
  while (pending.length) {
    const current = pending.shift()!;
    for (let other = 0; other < layout.outerWaypoints.length; other += 1) {
      const a = layout.outerWaypoints[current], b = layout.outerWaypoints[other];
      // Edges of the exterior shell, never a diagonal through the ship.
      const matchingAxes = Number(a.x === b.x) + Number(a.y === b.y) + Number(a.z === b.z);
      if (reached.has(other) || matchingAxes < 2) continue;
      assert.equal(world.sweep(a, b, { radius: AIRCRAFT_RADIUS + 10, aircraft: false }), null);
      reached.add(other); pending.push(other);
    }
  }
  assert.equal(reached.size, layout.outerWaypoints.length);
  for (const turret of layout.turrets) {
    assert.ok(layout.outerWaypoints.some(point => world.sweep(point, turret.outwardWaypoint, { radius: AIRCRAFT_RADIUS + 10, aircraft: false }) === null), turret.label);
    assert.equal(world.sweep(turret.outwardWaypoint, turret.attackApproach[0], { radius: AIRCRAFT_RADIUS + 10, aircraft: false }), null, turret.label);
  }
});

test('shared first-contact geometry blocks opposite faces but keeps visible armor gaps open', () => {
  const ship = new Mothership(), world = new CollisionWorld(ship);
  for (const turret of ship.turrets) {
    const opposite = turret.layout.aimPoint.clone().addScaledVector(turret.layout.normal, -1800);
    assert.equal(world.lineOfSight(opposite, turret.layout.aimPoint, turret.id), false, turret.layout.label);
  }
  assert.equal(world.sweep(new Vector3(260, 1000, 2000), new Vector3(260, 1000, 500), { radius: AIRCRAFT_RADIUS, aircraft: false }), null);
  const crossing = world.sweep(new Vector3(260, 1000, 500), new Vector3(260, 1000, 0), { aircraft: false });
  assert.equal(crossing?.partId, 'right-armor'); assert.equal(crossing?.point.z, 460);
});

test('rounded-box sweeps catch tunnelling, reject inflated-box corner false positives and handle rotated boxes', () => {
  const collisionBox = box();
  const hit = sweepSphereBox(new Vector3(-100, 0, 0), new Vector3(100, 0, 0), 0, collisionBox);
  assert.ok(hit); assert.ok(Math.abs(hit.time - .495) < 1e-12); assert.deepEqual(hit.normal.toArray(), [-1, 0, 0]);
  assert.equal(sweepSphereBox(new Vector3(-3, 1.9, 1.9), new Vector3(3, 1.9, 1.9), 1, collisionBox), null);
  const tangent = sweepSphereBox(new Vector3(-3, 1.6, 1.8), new Vector3(3, 1.6, 1.8), 1, collisionBox);
  assert.ok(tangent); assert.ok(Math.abs(tangent.time - 1 / 3) < 1e-8);
  const rotated = box(new Vector3(), new Vector3(2, 1, .5), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4));
  const rotatedHit = sweepSphereBox(new Vector3(0, 0, -10), new Vector3(0, 0, 10), 0, rotated);
  assert.ok(rotatedHit); assert.ok(Math.abs(rotatedHit.time - (10 - Math.SQRT1_2) / 20) < 1e-10);
  assert.equal(sweepSphereBox(new Vector3(-1, 0, 0), new Vector3(-3, 0, 0), 0, collisionBox), null);
});

test('spatial grid returns the same nearest collision as all canonical parts, including changing barrels', () => {
  const ship = new Mothership(), world = new CollisionWorld(ship);
  for (const turret of ship.turrets) { turret.yaw = turret.layout.yawMax; turret.pitch = turret.layout.pitchMin; }
  const parts = [...ship.layout.hullParts, ...ship.turrets.flatMap(turret => [...turret.boxes])];
  let seed = 0x474b0201;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let ray = 0; ray < 150; ray += 1) {
    const from = new Vector3((random() - .5) * 3200, 200 + random() * 1600, (random() - .5) * 4000);
    const to = new Vector3((random() - .5) * 3200, 200 + random() * 1600, (random() - .5) * 4000);
    const radius = ray % 2 ? 0 : AIRCRAFT_RADIUS;
    const allHits = parts.map(part => sweepSphereBox(from, to, radius, part)).filter((hit): hit is CollisionHit => hit !== null)
      .sort((a, b) => Math.abs(a.time - b.time) <= 1e-9 ? a.partId.localeCompare(b.partId) : a.time - b.time);
    const broadHit = world.sweep(from, to, { radius, aircraft: false, sea: false });
    assert.equal(broadHit?.partId, allHits[0]?.partId, `seed474b0201 ray${ray}`);
    if (broadHit) assert.ok(Math.abs(broadHit.time - allHits[0].time) < 1e-10);
  }
});

test('camera casts use the same first contact, and moving aircraft / sea sweeps find real crossings', () => {
  const ship = new Mothership(), world = new CollisionWorld(ship);
  const from = new Vector3(0, 1000, 700), to = new Vector3(0, 1000, 500);
  const original = from.clone(), camera = world.cameraCast(from, to), ordinary = world.sweep(from, to, { radius: 1.5, aircraft: false });
  assert.equal(camera?.partId, ordinary?.partId); assert.equal(camera?.time, ordinary?.time); assert.ok(from.equals(original));
  const aircraft = { tokenId: 42, previous: new Vector3(0, 1000, -10), position: new Vector3(0, 1000, 10), radius: 1 };
  const crossing = sweepSphereAircraft(new Vector3(-10, 1000, 0), new Vector3(10, 1000, 0), 0, aircraft);
  assert.ok(crossing); assert.equal(crossing.tokenId, 42); assert.ok(Math.abs(crossing.time - (.5 - 1 / Math.sqrt(800))) < 1e-12);
  const sea = world.sweep(new Vector3(2000, 20, 2000), new Vector3(2000, -20, 2000), { radius: 5, aircraft: false });
  assert.equal(sea?.kind, 'sea'); assert.equal(sea?.time, .375); assert.equal(sea?.contactPoint.y, 0);
});

test('integer damage clamps overkill, damage stages have exact thresholds, attack IDs resolve once', () => {
  const ship = new Mothership(), main = ship.turrets.find(turret => turret.layout.kind === 'main')!;
  const half = ship.applyDamage(main.id, 300_000, { attackId: 1, tick: 10 });
  assert.equal(half.actual, 300_000); assert.equal(main.stage, 'damaged');
  assert.equal(ship.applyDamage(main.id, 1_000, { attackId: 1, tick: 11 }).actual, 0);
  assert.equal(ship.applyDamage(main.id + 1, 1_000, { attackId: 1, tick: 11 }).actual, 0);
  ship.applyDamage(main.id, 150_000, { attackId: 2, tick: 11 }); assert.equal(main.stage, 'critical');
  ship.applyDamage(main.id, 149_000, { attackId: 3, tick: 12 });
  const killed = ship.applyDamage(main.id, 20_000, { attackId: 4, tick: 13 });
  assert.equal(killed.actual, 1000); assert.equal(killed.killed, true); assert.equal(main.stage, 'destroyed');
  assert.deepEqual(killed.events.map(event => event.type), ['turret-damaged', 'turret-destroyed']);
  assert.equal(ship.applyDamage(main.id, 20_000, { attackId: 5, tick: 14 }).events.length, 0);
  assert.equal(ship.remaining, 99); assert.equal(ship.remainingMain, 19);
  const other = ship.turrets.find(turret => turret.hpMilli > 0)!;
  assert.equal(ship.applyDamage(other.id, .49).actual, 0); assert.equal(ship.applyDamage(other.id, .5).actual, 1);
  assert.equal(ship.applyDamage(other.id, -100).actual, 0); assert.equal(ship.applyDamage(other.id, Infinity).actual, 0);
});

test('destroyed turrets retain a low canonical wreck and final destruction time / freeze are stable', () => {
  const ship = new Mothership(), world = new CollisionWorld(ship);
  const top = ship.turrets[0];
  const oldHeight = Math.max(...top.boxes.map(part => boundsOfBox(part).max.y));
  ship.applyDamage(top.id, top.maxHpMilli, { attackId: 1, tick: 100 });
  assert.equal(top.boxes.length, 1); assert.equal(top.boxes[0].kind, 'wreck');
  assert.ok(boundsOfBox(top.boxes[0]).max.y < oldHeight); assert.equal(boundsOfBox(top.boxes[0]).max.y, 1124);
  const rayStart = top.layout.position.clone().addScaledVector(top.layout.normal, 80);
  const rayEnd = top.layout.position.clone().addScaledVector(top.layout.normal, -1);
  assert.equal(world.sweep(rayStart, rayEnd, { aircraft: false })?.id, top.id);
  for (const turret of ship.turrets.slice(1)) ship.applyDamage(turret.id, turret.maxHpMilli, { attackId: turret.id + 1, tick: 100 + turret.id });
  assert.equal(ship.remaining, 0); assert.equal(ship.totalHpMilli, 0); assert.equal(ship.lastDestroyedTick, 199);
  assert.equal(ship.destroyedIds.size, 100); assert.equal(ship.applyDamage(99, 100, { attackId: 500, tick: 500 }).killed, false);
  const fresh = new Mothership(); fresh.freeze(); assert.equal(fresh.applyDamage(0, 1000).actual, 0); assert.equal(fresh.totalHpMilli, 24_000_000);
});

test('retired numeric attack IDs remain rejected while retained de-dup state stays bounded by live IDs', () => {
  const ship = new Mothership();
  for (let id = 0; id < 2000; id += 1) {
    ship.applyDamage(0, 1, { attackId: id, tick: id });
    ship.retireAttackIds(Math.max(0, id - 31));
    assert.ok(ship.retainedAttackCount <= 32);
  }
  const hp = ship.byId(0)!.hpMilli;
  assert.equal(ship.applyDamage(0, 1000, { attackId: 0, tick: 3000 }).actual, 0);
  assert.equal(ship.byId(0)!.hpMilli, hp);
});
