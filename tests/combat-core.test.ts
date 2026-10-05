import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { AircraftWeapons, advanceAmmunition, friendlyDamageMilli } from '../src/aircraft-weapons';
import { Fleet, createAircraftToken } from '../src/fleet';
import { FlightSession, movingSphereContact } from '../src/game-state';
import { turretDirection } from '../src/mothership-layout';
import { ScoreLedger, bestKey, isBetterBest, readBest, saveBest, scoreComponents, validCombatReport } from '../src/scoring';
import type { AircraftToken, CombatReport, Projectile, ScoreTotals } from '../src/combat-types';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };
const spawn = (slot: number) => new Vector3(slot * 40, 1000, 2000);
function spendReserve(fleet: Fleet, keep: number, ledger?: ScoreLedger): number {
  let tick = 0;
  while (fleet.counts.reserve > keep) {
    const plane = fleet.active.find(plane => plane.owner === 'wingman')!;
    const lost = fleet.lose(plane.tokenId, tick)!;
    ledger?.recordLoss(lost.tokenId, lost.owner);
    fleet.postTick(tick, spawn);
    tick += 180;
    fleet.postTick(tick, spawn);
  }
  return tick;
}
function totalFixture(overrides: Partial<ScoreTotals> = {}): ScoreTotals {
  return { K: 100, damageMilli: 24_000_000, P: 1, W: 2, N: 1000, Hmain: 200, Hmg: 300,
    playerKills: 60, wingmanKills: 40, playerDamageMilli: 10_000_000, wingmanDamageMilli: 14_000_000,
    mainKills: 20, mgKills: 80, ...overrides };
}
function victory(overrides: Partial<ScoreTotals> = {}, tick = 18_000): CombatReport {
  const ledger = new ScoreLedger(); Object.assign(ledger.totals, totalFixture(overrides));
  return ledger.report(1, 'easy', 0x474b0001, tick, 'victory');
}

// Initial-state fixtures below are isolated in Node tests and are never exposed
// as a browser/debug API or cited as a normal-input victory.
test('initial eight plus forty-two and simultaneous deaths conserve fifty distinct tokens', () => {
  const fleet = new Fleet(17);
  assert.deepEqual(fleet.counts, { active: 8, reserved: 0, reserve: 42, lost: 0, remaining: 50, playerLosses: 0, wingmanLosses: 0 });
  for (const plane of fleet.active) assert.ok(fleet.lose(plane.tokenId, 10));
  assert.equal(fleet.lose(0, 10), null);
  fleet.postTick(10, spawn);
  assert.deepEqual(fleet.counts, { active: 0, reserved: 8, reserve: 34, lost: 8, remaining: 42, playerLosses: 1, wingmanLosses: 7 });
  fleet.postTick(189, spawn); assert.equal(fleet.active.length, 0);
  const result = fleet.postTick(190, spawn);
  assert.equal(result.transitions.length, 8);
  assert.deepEqual(fleet.active.map(plane => plane.tokenId), [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(fleet.player?.tokenId, 8);
  assert.ok(fleet.active.every(plane => plane.hpMilli === 80_000 && plane.ammunition.mg === 288 && plane.ammunition.cannon === 96 && plane.generation === 1));
  assert.equal(fleet.matches(0, 0, 17), false);
  assert.equal(fleet.matches(8, 1, 16), false);
  fleet.assertInvariants();
});

test('the only reserve goes to the player even if the player loss is recorded last', () => {
  const fleet = new Fleet(1); const tick = spendReserve(fleet, 1);
  const player = fleet.player!;
  for (const plane of fleet.active.filter(plane => plane !== player)) fleet.lose(plane.tokenId, tick);
  fleet.lose(player.tokenId, tick); fleet.postTick(tick, spawn);
  assert.equal(fleet.counts.active, 0); assert.equal(fleet.counts.reserved, 1); assert.equal(fleet.counts.reserve, 0);
  assert.equal(fleet.counts.lost, 49); assert.equal(fleet.reservations[0].owner, 'player');
  fleet.postTick(tick + 180, spawn);
  assert.equal(fleet.player?.tokenId, 49); assert.equal(fleet.counts.remaining, 1);
});

test('handoff at exactly180ticks keeps HP, position, magazines and reload clocks', () => {
  const fleet = new Fleet(3); const tick = spendReserve(fleet, 0);
  const player = fleet.player!; fleet.lose(player.tokenId, tick); fleet.postTick(tick, spawn);
  const inheritor = fleet.active[0];
  inheritor.hpMilli = 31_337; inheritor.ammunition.mg = 16; inheritor.ammunition.cannon = 0;
  inheritor.ammunition.reloadUntilTick = tick + 800;
  const before = { position: inheritor.position.toArray(), hp: inheritor.hpMilli, ammo: { ...inheritor.ammunition } };
  fleet.postTick(tick + 179, spawn); assert.equal(fleet.player, null);
  const transition = fleet.postTick(tick + 180, spawn);
  assert.equal(transition.transitions[0].kind, 'handoff'); assert.equal(fleet.player, inheritor);
  assert.deepEqual({ position: inheritor.position.toArray(), hp: inheritor.hpMilli, ammo: { ...inheritor.ammunition } }, before);
  assert.equal(fleet.counts.playerLosses, 1); assert.equal(fleet.counts.wingmanLosses, 42);
  for (const plane of fleet.active.filter(plane => plane !== inheritor)) fleet.lose(plane.tokenId, tick + 181);
  assert.equal(fleet.counts.remaining, 1); assert.equal(fleet.player, inheritor);
});

test('Q-only survivors recheck handoff after their first deployment rather than losing the mission', () => {
  const fleet = new Fleet(1); const tick = spendReserve(fleet, 1);
  const wingman = fleet.active.find(plane => plane.owner === 'wingman')!;
  fleet.lose(wingman.tokenId, tick); fleet.postTick(tick, spawn);
  for (const plane of fleet.active) fleet.lose(plane.tokenId, tick + 1);
  fleet.postTick(tick + 1, spawn);
  assert.equal(fleet.counts.remaining, 1); assert.equal(fleet.counts.active, 0); assert.equal(fleet.counts.reserved, 1);
  fleet.postTick(tick + 180, spawn); assert.equal(fleet.counts.active, 1); assert.equal(fleet.player, null);
  fleet.postTick(tick + 181, spawn); assert.equal(fleet.player?.tokenId, 49); assert.equal(fleet.counts.lost, 49);
});

test('a blocked reservation consumes no extra token and reports exactlyfive seconds of continuous failure', () => {
  const fleet = new Fleet(1); fleet.lose(0, 0); fleet.postTick(0, spawn);
  for (let tick = 180; tick < 479; tick += 1) assert.equal(fleet.postTick(tick, () => null).anomaly, null);
  assert.match(fleet.postTick(479, () => null).anomaly!, /5秒/);
  assert.equal(fleet.counts.reserved, 1); assert.equal(fleet.counts.reserve, 41); assert.equal(fleet.counts.lost, 1);
  fleet.postTick(480, spawn); assert.equal(fleet.player?.tokenId, 8);
});

test('player and wingman barrels use exact5/15 and17/57tick intervals', () => {
  const weapons = new AircraftWeapons(1); let id = 0;
  const player = createAircraftToken(1, 0, 0, 0, 'player', spawn(0));
  const wingman = createAircraftToken(1, 1, 1, 0, 'wingman', spawn(1));
  const counts = { playerMG: 0, playerCannon: 0, wingmanMG: 0, wingmanCannon: 0 };
  for (let tick = 1; tick <= 61; tick += 1) {
    weapons.expire(tick);
    for (const plane of [player, wingman]) for (const request of weapons.plan(plane, tick, true)) {
      const shots = weapons.fire(request, tick, () => ++id);
      const key = `${plane.owner}${request.kind === 'mg' ? 'MG' : 'Cannon'}` as keyof typeof counts;
      counts[key] += shots.length;
    }
  }
  assert.deepEqual(counts, { playerMG: 26, playerCannon: 10, wingmanMG: 8, wingmanCannon: 4 });
  assert.equal(player.ammunition.mg, 262); assert.equal(player.ammunition.cannon, 86);
  assert.equal(wingman.ammunition.mg, 280); assert.equal(wingman.ammunition.cannon, 92);
});

test('both empty initiates common360tick reload and no empty shot changes ammunition or N', () => {
  const weapons = new AircraftWeapons(2); let id = 0;
  const plane = createAircraftToken(2, 0, 0, 0, 'player', spawn(0));
  plane.ammunition.mg = 2; plane.ammunition.cannon = 2;
  const requests = weapons.plan(plane, 7, true);
  weapons.fire(requests[0], 7, () => ++id); assert.equal(plane.ammunition.reloadUntilTick, null);
  weapons.fire(requests[1], 7, () => ++id); assert.equal(plane.ammunition.reloadUntilTick, 367);
  assert.equal(weapons.plan(plane, 8, true).length, 0);
  advanceAmmunition(plane, 366); assert.equal(plane.ammunition.mg, 0);
  advanceAmmunition(plane, 367); assert.equal(plane.ammunition.mg, 288); assert.equal(plane.ammunition.cannon, 96);
  assert.equal(plane.ammunition.reloadUntilTick, null);
  const ai = createAircraftToken(2, 1, 1, 0, 'wingman', spawn(1));
  ai.ammunition.mg = 0; ai.ammunition.cannon = 2;
  weapons.fire(weapons.plan(ai, 9, true)[0], 9, () => ++id);
  assert.equal(ai.ammunition.reloadUntilTick, 369); advanceAmmunition(ai, 369); assert.equal(ai.ammunition.mg, 288);
});

test('atomic volleys preserve64 player slots and saturation does not consume ammunition or IDs', () => {
  const weapons = new AircraftWeapons(1); let id = 0;
  const wingman = createAircraftToken(1, 1, 1, 0, 'wingman', spawn(1));
  for (let volley = 0; volley < 96; volley += 1) {
    wingman.ammunition.mgReadyTick = 0;
    assert.equal(weapons.fire(weapons.plan(wingman, 1, true).find(request => request.kind === 'mg')!, 1, () => ++id).length, 2);
  }
  const before = { ...wingman.ammunition }, beforeId = id;
  wingman.ammunition.mgReadyTick = 0; before.mgReadyTick = 0;
  assert.equal(weapons.fire(weapons.plan(wingman, 1, true)[0], 1, () => ++id).length, 0);
  assert.deepEqual(wingman.ammunition, before); assert.equal(id, beforeId); assert.equal(weapons.bullets.length, 192);
  const player = createAircraftToken(1, 0, 0, 0, 'player', spawn(0));
  for (let volley = 0; volley < 32; volley += 1) {
    player.ammunition.mgReadyTick = 0;
    assert.equal(weapons.fire(weapons.plan(player, 1, true)[0], 1, () => ++id).length, 2);
  }
  assert.equal(weapons.bullets.length, 256);
  weapons.remove(weapons.bullets[0].id); // One free slot cannot become one barrel.
  player.ammunition.mgReadyTick = 0;
  const ammo = player.ammunition.mg, next = id;
  assert.equal(weapons.fire(weapons.plan(player, 1, true)[0], 1, () => ++id).length, 0);
  assert.equal(player.ammunition.mg, ammo); assert.equal(id, next); assert.equal(weapons.bullets.length, 255);
});

test('all source distances use far-side200/500/800 boundaries with integer mHP', () => {
  for (const [distance, expected] of [[199.999, 4000], [200, 3000], [499.999, 3000], [500, 2000], [799.999, 2000], [800, 1000]]) {
    assert.equal(friendlyDamageMilli('player', 'mg', distance), expected);
  }
  assert.equal(friendlyDamageMilli('player', 'cannon', 200), 18000);
  assert.equal(friendlyDamageMilli('player', 'cannon', 500), 16000);
  assert.equal(friendlyDamageMilli('player', 'cannon', 800), 14000);
  assert.equal(friendlyDamageMilli('wingman', 'mg', 800), 600);
  assert.equal(friendlyDamageMilli('wingman', 'cannon', 800), 6720);
});

test('shot affiliation survives death/handoff and the90tick half-open lifetime is exact', () => {
  const weapons = new AircraftWeapons(1); let id = 0;
  const plane = createAircraftToken(1, 1, 1, 0, 'wingman', spawn(1));
  const shots = weapons.fire(weapons.plan(plane, 3, true)[0], 3, () => ++id);
  plane.owner = 'player'; plane.hpMilli = 0;
  assert.ok(shots.every(shot => shot.owner === 'wingman' && shot.shooterGeneration === 0));
  assert.equal(shots[0].velocity.length(), 930);
  weapons.expire(92); assert.equal(weapons.bullets.length, 2);
  weapons.expire(93); assert.equal(weapons.bullets.length, 0);
});

test('normal launch is the tick-start physical nose despite simultaneous turning and acceleration', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  session.step({ ...neutral, turn: 1, accelerate: true, fire: true });
  const own = session.weapons.bullets.filter(bullet => bullet.owner === 'player');
  assert.equal(own.length, 4); assert.equal(session.score.totals.N, 4);
  assert.deepEqual(own[0].previous.toArray(), [-.3, 1000.52, 1995.75]);
  assert.deepEqual(own[0].velocity.toArray(), [0, 0, -930]);
  assert.ok(session.player.yaw < 0 && session.controller.playerTargetSpeed > 110);
  assert.notEqual(session.player.speed, 110);
});

test('moving-sphere sweep resolves crossing trajectories within one tick', () => {
  assert.equal(movingSphereContact(new Vector3(-10, 0, 0), new Vector3(10, 0, 0), new Vector3(0, -10, 0), new Vector3(0, 10, 0), 0), .5);
  assert.equal(movingSphereContact(new Vector3(-10, 0, 0), new Vector3(10, 0, 0), new Vector3(0, 20, 0), new Vector3(0, 30, 0), 5), null);
});

test('160000-point example floors only once, preserves negatives and distinguishes N0', () => {
  const components = scoreComponents(totalFixture(), 18000, true);
  assert.deepEqual(components, { destruction: 100000, damage: 48000, time: 25000, playerLoss: 2000, wingmanLoss: 1000, accuracyLoss: 10000, total: 160000, accuracy: .5 });
  assert.equal(scoreComponents(totalFixture({ K: 0, damageMilli: 0, P: 1, W: 0, N: 1, Hmain: 0, Hmg: 0 }), 600, false).total, -22000);
  assert.equal(scoreComponents(totalFixture({ N: 0, Hmain: 0, Hmg: 0 }), 600, false).accuracy, null);
  assert.equal(scoreComponents(totalFixture({ N: 0, Hmain: 0, Hmg: 0 }), 600, false).accuracyLoss, 0);
  assert.ok(scoreComponents(totalFixture(), 18001, true).time < components.time);
  assert.equal(scoreComponents(totalFixture(), 18000, false).time, 0);
  assert.equal(scoreComponents(totalFixture({ P: 0, W: 0, N: 3, Hmain: 1, Hmg: 0 }), 18000, true).total, 159666);
});

test('overkill, duplicate events and wingman final blows retain actual damage and one hit', () => {
  const ledger = new ScoreLedger();
  ledger.recordShot(1, 'player'); ledger.recordDamage(1, 'player', 'main', 8, 599000, false);
  ledger.recordShot(2, 'wingman'); ledger.recordDamage(2, 'wingman', 'main', 8, 1000, true);
  ledger.recordDamage(2, 'wingman', 'main', 8, 1000, true);
  ledger.recordShot(3, 'player'); ledger.recordDamage(3, 'player', 'main', 8, 0, false);
  ledger.recordLoss(0, 'player'); ledger.recordLoss(0, 'player');
  assert.equal(ledger.totals.K, 1); assert.equal(ledger.totals.damageMilli, 600000);
  assert.equal(ledger.totals.playerDamageMilli, 599000); assert.equal(ledger.totals.wingmanKills, 1);
  assert.equal(ledger.totals.N, 2); assert.equal(ledger.totals.Hmain, 1); assert.equal(ledger.totals.P, 1);
  ledger.retireAttackIds(4); ledger.recordDamage(1, 'player', 'main', 9, 5000, true); ledger.recordShot(1, 'player');
  assert.equal(ledger.totals.damageMilli, 600000); assert.equal(ledger.totals.N, 2); assert.equal(ledger.retainedHitIds, 0);
  ledger.assertInvariants();
});

test('best records are victory-only, mode/version-separated, tied records retain the earlier record', () => {
  const values = new Map<string, string>([['kaisen-best-v1', 'untouched']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const report = victory(); assert.equal(validCombatReport(report), true);
  assert.equal(saveBest(report, storage).saved, true); assert.deepEqual(readBest('easy', storage), report);
  assert.equal(readBest('normal', storage), null); assert.equal(values.get('kaisen-best-v1'), 'untouched');
  assert.equal(saveBest(report, storage).saved, false); assert.equal(isBetterBest(report, report), false);
  const loss = new ScoreLedger().report(2, 'easy', 1, 10, 'aborted');
  assert.equal(saveBest(loss, storage).saved, false); assert.deepEqual(readBest('easy', storage), report);
  const faster = victory({}, 17999); assert.equal(saveBest(faster, storage).saved, true);
});

test('corrupt or future best formats and failed writes never damage an existing record', () => {
  const report = victory();
  let value = '{broken'; let writes = 0;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { writes += 1; value = next; } };
  assert.equal(readBest('easy', storage), null); assert.equal(saveBest(report, storage).saved, true);
  value = JSON.stringify({ version: 9, record: { future: true } }); const future = value; writes = 0;
  assert.equal(saveBest(report, storage).error, 'future-version'); assert.equal(writes, 0); assert.equal(value, future);
  value = JSON.stringify({ version: 1, record: report });
  const failing = { getItem: storage.getItem, setItem: () => { throw new Error('quota'); } };
  assert.equal(saveBest(victory({}, 17999), failing).error, 'write-failed'); assert.deepEqual(readBest('easy', failing), report);
  const partialFailure = { getItem: storage.getItem, setItem: (_key: string, next: string) => { value = next; throw new Error('failure after write'); } };
  assert.equal(saveBest(victory({}, 17999), partialFailure).error, 'write-failed'); assert.deepEqual(readBest('easy', partialFailure), report);
  assert.ok(bestKey('easy').startsWith('gekichin-best-')); assert.equal(validCombatReport({ ...report, N: -1 }), false);
});

function clearToOneTurret(session: FlightSession): number {
  const last = session.mothership.turrets.find(turret => turret.layout.kind === 'main')!;
  let attackId = 1;
  for (const turret of session.mothership.turrets) {
    const amount = turret.hpMilli - (turret === last ? 1000 : 0);
    const result = session.mothership.applyDamage(turret.layout.id, amount, { attackId: `fixture-${attackId}`, tick: 0 });
    session.score.recordDamage(attackId++, 'wingman', turret.layout.kind, turret.layout.id, result.actual, result.killed);
  }
  return last.layout.id;
}
function fixtureBullet(session: FlightSession, id: number, faction: 'friendly' | 'enemy', position: Vector3, damage: number): Projectile {
  return { id, operationId: session.operationId, faction, kind: 'mg', shooterId: faction === 'friendly' ? session.fleet.player!.tokenId : 99,
    shooterGeneration: 0, owner: faction === 'friendly' ? 'player' : 'enemy', position: position.clone(), previous: position.clone(),
    velocity: new Vector3(0, 0, -930), bornTick: 0, expiresTick: 90, distance: 0, baseDamageMilli: damage };
}

test('same-tick final turret and final ally losses produce mutual defeat before any respawn', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const fleet = new Fleet(session.operationId); const deathTick = spendReserve(fleet, 0, session.score);
  for (const plane of fleet.active.filter(plane => plane.owner === 'wingman')) {
    fleet.lose(plane.tokenId, deathTick); session.score.recordLoss(plane.tokenId, 'wingman');
  }
  session.fleet = fleet; session.fleet.player!.hpMilli = 1200;
  const lastId = clearToOneTurret(session);
  const hit = fixtureBullet(session, 10000, 'friendly', session.mothership.byId(lastId)!.layout.aimPoint, 4000);
  const incoming = fixtureBullet(session, 10001, 'enemy', session.fleet.player!.position, 1200);
  (session.weapons.bullets as Projectile[]).push(hit); session.enemyCombat.bullets.push(incoming); session.score.recordShot(10000, 'player');
  session.step(neutral);
  assert.equal(session.phase, 'result'); assert.equal(session.report?.outcome, 'mutual'); assert.equal(session.report?.endTick, 1);
  assert.equal(session.report?.K, 100); assert.equal(session.report?.damageMilli, 24_000_000); assert.equal(session.report?.components.time, 0);
  assert.equal(session.fleet.counts.remaining, 0); assert.equal(session.fleet.counts.reserved, 0);
  const frozen = JSON.stringify(session.report); session.step({ ...neutral, fire: true }); assert.equal(JSON.stringify(session.report), frozen);
});

test('victory freezes flying bullets, unhit shots stay in N, and every result component is immutable', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const lastId = clearToOneTurret(session);
  const hit = fixtureBullet(session, 10000, 'friendly', session.mothership.byId(lastId)!.layout.aimPoint, 4000);
  const far = fixtureBullet(session, 10001, 'friendly', new Vector3(2000, 1000, 2000), 4000);
  (session.weapons.bullets as Projectile[]).push(hit, far); session.score.recordShot(10000, 'player'); session.score.recordShot(10001, 'player');
  session.step(neutral);
  assert.equal(session.report?.outcome, 'victory'); assert.equal(session.report?.N, 2); assert.equal(session.report?.Hmain, 1);
  assert.equal(session.report?.components.accuracy, .5); assert.ok(Object.isFrozen(session.report)); assert.ok(Object.isFrozen(session.report?.components));
  const position = far.position.clone(); const report = session.report;
  session.step(neutral); assert.ok(far.position.equals(position)); assert.equal(session.report, report);
  assert.equal(session.mothership.applyDamage(lastId, 1).actual, 0);
});

test('an integrated timezero turret destruction cancels its genuine due warning shot before allocation', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const lastId = clearToOneTurret(session), turret = session.mothership.byId(lastId)!;
  const plane = session.fleet.player!;
  plane.position.copy(turret.muzzle).addScaledVector(turretDirection(turret.layout, turret.yaw, turret.pitch), 500);
  plane.previous.copy(plane.position); plane.speed = 0;
  session.enemyCombat.step(0, session.mothership.turrets, session.fleet.active, session.world);
  assert.equal(session.enemyCombat.states.get(lastId)?.phase, 'warning');
  assert.equal(session.enemyCombat.states.get(lastId)?.nextFireTick, 60);
  const shot = fixtureBullet(session, 10000, 'friendly', turret.layout.aimPoint, 4000);
  (session.weapons.bullets as Projectile[]).push(shot); session.score.recordShot(10000, 'player'); session.tick = 59;
  session.step(neutral);
  assert.equal(session.report?.outcome, 'victory'); assert.equal(session.report?.endTick, 60);
  assert.equal(session.enemyCombat.bullets.length, 0);
  assert.equal(session.enemyCombat.states.get(lastId)?.phase, 'destroyed');
  assert.equal(session.events.some(event => event.kind === 'shot' && event.owner === 'enemy'), false);
});

test('a destruction during the warning releases its reservation and visual warning immediately without erasing older shots', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const lastId = clearToOneTurret(session), turret = session.mothership.byId(lastId)!;
  const plane = session.fleet.player!;
  plane.position.copy(turret.muzzle).addScaledVector(turretDirection(turret.layout, turret.yaw, turret.pitch), 500);
  plane.previous.copy(plane.position); plane.speed = 0;
  session.enemyCombat.step(0, session.mothership.turrets, session.fleet.active, session.world);
  assert.equal(session.enemyCombat.warnings.length, 1);
  const shot = fixtureBullet(session, 10000, 'friendly', turret.layout.aimPoint, 4000);
  const older = fixtureBullet(session, 10001, 'enemy', new Vector3(3000, 1500, 3000), 24000);
  older.kind = 'main'; older.shooterId = lastId; older.velocity.set(0, 0, -400); older.expiresTick = 240;
  (session.weapons.bullets as Projectile[]).push(shot); session.enemyCombat.bullets.push(older); session.score.recordShot(10000, 'player');
  session.step(neutral);
  assert.equal(session.enemyCombat.states.get(lastId)?.phase, 'destroyed');
  assert.equal(session.enemyCombat.states.get(lastId)?.targetTokenId, null);
  assert.equal(session.enemyCombat.warnings.length, 0);
  assert.ok(session.enemyCombat.bullets.some(bullet => bullet.id === older.id));
});

test('the last lifetime endpoint is excluded while the immediately earlier contact is valid', () => {
  for (const [offset, expectedDamage] of [[-.001, 4000], [0, 0], [.001, 0]]) {
    const session = new FlightSession(); session.begin(session.prepare('normal')!);
    const target = session.mothership.turrets.find(turret => turret.layout.kind === 'main' && turret.layout.face === 'front')!;
    const surface = session.world.sweep(target.layout.aimPoint.clone().addScaledVector(target.layout.normal, 100), target.layout.aimPoint, { aircraft: false })!.point;
    const origin = surface.clone().addScaledVector(target.layout.normal, 15.5 + offset);
    const shot = fixtureBullet(session, 10000, 'friendly', origin, 4000);
    shot.velocity.copy(target.layout.normal).multiplyScalar(-930); shot.bornTick = 1; shot.expiresTick = 91;
    (session.weapons.bullets as Projectile[]).push(shot); session.score.recordShot(10000, 'player'); session.tick = 89;
    session.step(neutral);
    assert.equal(target.maxHpMilli - target.hpMilli, expectedDamage, `endpoint offset ${offset}`);
    assert.equal(session.weapons.bullets.length, 0);
    assert.equal(session.score.totals.Hmain, Number(expectedDamage > 0));
  }
});

test('boundary grace uses600 active ticks, resets on return, and never teleports an aircraft', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const plane = session.fleet.player!; plane.position.set(4500, 1000, 2000); plane.outsideTicks = 598;
  session.step(neutral); assert.equal(plane.outsideTicks, 599); assert.equal(session.fleet.player, plane); assert.ok(plane.position.x > 4000);
  session.pause('manual'); const position = plane.position.clone();
  for (let tick = 0; tick < 60; tick += 1) session.step(neutral);
  assert.equal(plane.outsideTicks, 599); assert.ok(plane.position.equals(position));
  session.resume(); session.step(neutral); assert.equal(session.fleet.player, null); assert.equal(session.fleet.counts.lost, 1);
  const returned = new FlightSession(); returned.begin(returned.prepare('normal')!);
  returned.fleet.player!.outsideTicks = 599; returned.fleet.player!.position.set(3998, 1000, 0); returned.step(neutral);
  assert.equal(returned.fleet.player!.outsideTicks, 0); assert.ok(returned.boundary.warning); assert.equal(returned.boundary.outside, false);
});

test('a timezero hull/sea collision cancels the player shot and gives no turret damage', () => {
  for (const position of [new Vector3(0, 1000, 0), new Vector3(1000, 4, 1000)]) {
    const session = new FlightSession(); session.begin(session.prepare('normal')!);
    const plane = session.fleet.player!; plane.position.copy(position);
    session.step({ ...neutral, fire: true });
    assert.equal(session.fleet.player, null); assert.equal(session.score.totals.N, 0); assert.equal(session.score.totals.damageMilli, 0);
    assert.equal(plane.ammunition.mg, 288); assert.equal(session.mothership.totalHpMilli, 24_000_000); assert.equal(session.fleet.counts.reserved, 1);
  }
});

test('Normal player bullets damage friendly aircraft; Easy and wingman shots stop at protected contact', () => {
  for (const [mode, owner, expected] of [['normal', 'player', 72000], ['easy', 'player', 80000], ['normal', 'wingman', 80000]] as const) {
    const session = new FlightSession(); session.begin(session.prepare(mode)!);
    const source = owner === 'player' ? session.fleet.player! : session.fleet.active[1];
    const target = owner === 'player' ? session.fleet.active[1] : session.fleet.player!;
    source.position.set(1000, 1000, 1000); source.previous.copy(source.position);
    target.position.set(1000, 1000, 980); target.previous.copy(target.position);
    let id = 10000;
    for (const shot of session.weapons.fire(session.weapons.plan(source, 1, true)[0], 1, () => ++id)) session.score.recordShot(shot.id, shot.owner as 'player' | 'wingman');
    session.step(neutral);
    assert.equal(target.hpMilli, expected, `${mode}/${owner}`);
    assert.equal(session.weapons.bullets.length, 0); assert.equal(session.score.totals.Hmain + session.score.totals.Hmg, 0);
    assert.equal(session.score.totals.N, owner === 'player' ? 2 : 0);
  }
});

test('main direct24HP never also deals splash to that plane, while colocated exposed allies receive12HP once', () => {
  const session = new FlightSession(); session.begin(session.prepare('normal')!);
  const player = session.fleet.player!, ally = session.fleet.active[1];
  player.position.set(1000, 1000, 1000); ally.position.copy(player.position);
  const shell = fixtureBullet(session, 10000, 'enemy', player.position, 24000); shell.kind = 'main'; shell.velocity.set(0, 0, -400); shell.expiresTick = 240;
  session.enemyCombat.bullets.push(shell); session.step(neutral);
  assert.equal(player.hpMilli, 56000); assert.equal(ally.hpMilli, 68000);
  assert.equal(session.mothership.totalHpMilli, 24_000_000); assert.equal(session.score.totals.damageMilli, 0);
  const splash = session.events.filter(event => event.attackId === 10000 && event.kind === 'hit' && event.tokenId === ally.tokenId);
  assert.equal(splash.length, 1); assert.equal(splash[0].damageMilli, 12000);
});

test('main splash excludes the20m boundary and cannot cross a canonical turret shield', () => {
  for (const [distance, hp] of [[19.999, 79999], [20, 80000], [20.001, 80000]]) {
    const session = new FlightSession(); session.begin(session.prepare('normal')!);
    const player = session.fleet.player!; player.position.set(0, 1000, 600 + distance);
    const shell = fixtureBullet(session, 10000, 'enemy', new Vector3(0, 1000, 600), 24000);
    shell.kind = 'main'; shell.velocity.set(0, 0, -400); shell.expiresTick = 240;
    session.enemyCombat.bullets.push(shell); session.step(neutral);
    assert.equal(player.hpMilli, hp, `splash distance ${distance}`);
  }
  const shielded = new FlightSession(); shielded.begin(shielded.prepare('normal')!);
  const turret = shielded.mothership.turrets.find(turret => turret.layout.face === 'top' && turret.layout.kind === 'mg' && turret.layout.localPosition.z === 480 && turret.layout.localPosition.x === -150)!;
  const point = turret.layout.aimPoint.clone().add(new Vector3(-7, 4, 0));
  const player = shielded.fleet.player!; player.position.copy(point).add(new Vector3(19.1, 0, 0));
  assert.equal(shielded.world.sweep(player.position, player.position, { radius: 5, aircraft: false }), null);
  assert.equal(shielded.world.lineOfSight(point.clone().add(new Vector3(-.02, 0, 0)), player.position), false);
  const shell = fixtureBullet(shielded, 10000, 'enemy', point, 24000); shell.kind = 'main'; shell.velocity.set(400, 0, 0); shell.expiresTick = 240;
  shielded.enemyCombat.bullets.push(shell); shielded.step(neutral);
  assert.equal(player.hpMilli, 80000); assert.equal(turret.hpMilli, 150000);
});

test('synthetic15minute all-eight-guns fixture has no allocation failures and bounded live damage IDs', () => {
  const weapons = new AircraftWeapons(1), ledger = new ScoreLedger(); let id = 0, maxRetained = 0;
  const planes = Array.from({ length: 8 }, (_, slot) => createAircraftToken(1, slot, slot, 0, slot === 0 ? 'player' : 'wingman', spawn(slot)));
  for (let tick = 1; tick <= 54000; tick += 1) {
    weapons.expire(tick);
    for (const plane of planes) {
      advanceAmmunition(plane, tick);
      for (const request of weapons.plan(plane, tick, true)) for (const shot of weapons.fire(request, tick, () => ++id)) {
        const owner = shot.owner as 'player' | 'wingman'; ledger.recordShot(shot.id, owner);
        ledger.recordDamage(shot.id, owner, 'main', 0, 1, false);
      }
    }
    ledger.retireAttackIds(weapons.bullets.length ? Math.min(...weapons.bullets.map(shot => shot.id)) : id + 1);
    maxRetained = Math.max(maxRetained, ledger.retainedHitIds);
    if (tick % 1000 === 0) { weapons.assertInvariants(planes); ledger.assertInvariants(); }
  }
  assert.equal(weapons.allocationFailures, 0); assert.ok(weapons.maxObserved <= 160); assert.ok(maxRetained <= 160);
  assert.equal(ledger.totals.N, 19334); assert.equal(id, 67536);
  assert.equal(ledger.totals.damageMilli, 67536); assert.equal(ledger.totals.Hmain, 19334);
});
