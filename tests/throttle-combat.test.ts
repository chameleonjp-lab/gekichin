import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { CRUISE_SPEED, THROTTLE_ADJUST_RATE } from '../src/flight';
import { FlightSession } from '../src/game-state';
import { FIXED_DT, RESPAWN_TICKS } from '../src/rules';
import type { Projectile } from '../src/combat-types';
import type { FlightInput } from '../src/types';

const neutral: FlightInput = { turn: 0, climb: 0, fire: false, loop: false, throttle: 0 };
type Transition = 'respawn' | 'handoff';

// Node-only boundary fixtures. No private controller/input flags, AI mocks or
// product state setters are used; ownership changes occur in FlightSession.step.
function sessionFixture(transition: Transition): FlightSession {
  const session = new FlightSession();
  assert.equal(session.begin(session.prepare('normal')!), true);
  if (transition === 'handoff') {
    let tick = 0;
    const spawn = (slot: number) => session.mothership.layout.spawnCandidates[slot].clone();
    while (session.fleet.counts.reserve > 0) {
      const wingman = session.fleet.active.find(plane => plane.owner === 'wingman')!;
      const lost = session.fleet.lose(wingman.tokenId, tick)!;
      session.score.recordLoss(lost.tokenId, lost.owner);
      session.fleet.postTick(tick, spawn);
      tick += RESPAWN_TICKS;
      session.fleet.postTick(tick, spawn);
    }
    session.tick = tick;
  }
  // Four legal 24HP main-shell contacts remove the original 80HP player.
  const player = session.fleet.player!;
  for (let index = 0; index < 4; index += 1) {
    const position = player.position.clone();
    const bullet: Projectile = { id: 10000 + index, operationId: session.operationId,
      faction: 'enemy', kind: 'main', shooterId: index, shooterGeneration: 0, owner: 'enemy',
      position, previous: position.clone(), velocity: new Vector3(0, 0, -400),
      bornTick: session.tick, expiresTick: session.tick + 240, distance: 0, baseDamageMilli: 24000 };
    session.enemyCombat.bullets.push(bullet);
  }
  return session;
}

function waitForOwnership(session: FlightSession, transition: Transition, input: FlightInput): void {
  const deathTick = session.tick + 1;
  session.step(input);
  assert.equal(session.fleet.player, null);
  assert.equal(session.fleet.playerLosses, 1);
  assert.equal(session.events.find(event => event.kind === 'aircraft-lost' && event.owner === 'player')?.message, '被弾');
  for (let elapsed = 1; elapsed < RESPAWN_TICKS; elapsed += 1) session.step(input);
  assert.equal(session.tick, deathTick + RESPAWN_TICKS - 1);
  assert.equal(session.fleet.player, null, 'no ownership before the 180-tick boundary');
  session.step(input);
  assert.equal(session.tick, deathTick + RESPAWN_TICKS);
  assert.ok(session.fleet.player);
  assert.equal(session.events.find(event => event.kind === transition && event.owner === 'player')?.tick, session.tick);
  assert.equal(session.fleet.ownershipRevision, 2);
  assert.equal(session.phase, 'playing');
}

for (const transition of ['respawn', 'handoff'] as const) {
  for (const heldAxis of [.65, -.75]) {
    test(`${transition} clears held throttle ${heldAxis} for the first control tick and accepts the next fresh axis`, () => {
      const session = sessionFixture(transition);
      const reference = sessionFixture(transition);
      const held: FlightInput = { ...neutral, throttle: heldAxis,
        accelerate: heldAxis > 0, brake: heldAxis < 0 };
      waitForOwnership(session, transition, held);
      waitForOwnership(reference, transition, held);
      const player = session.fleet.player!;
      const referencePlayer = reference.fleet.player!;
      assert.notEqual(player.tokenId, 0);
      assert.equal(player.tokenId, referencePlayer.tokenId);
      if (transition === 'respawn') {
        assert.equal(player.hpMilli, 80000);
        assert.equal(player.ammunition.mg, 288);
        assert.equal(player.ammunition.cannon, 96);
      } else {
        assert.equal(session.fleet.counts.reserve, 0);
        assert.equal(session.fleet.counts.reserved, 0);
      }

      session.step(held);
      reference.step(neutral);
      assert.equal(session.controller.playerTargetSpeed, CRUISE_SPEED,
        'the first post-ownership tick holds trim instead of applying the old axis');
      assert.equal(player.speed, referencePlayer.speed,
        'stale throttle must not alter physical speed relative to neutral flight');
      assert.deepEqual(player.position.toArray(), referencePlayer.position.toArray());

      const freshAxis = -heldAxis;
      session.step({ ...neutral, throttle: freshAxis, steeringRevision: 1 });
      reference.step(neutral);
      const expectedTrim = CRUISE_SPEED + freshAxis * THROTTLE_ADJUST_RATE * FIXED_DT;
      assert.ok(Math.abs(session.controller.playerTargetSpeed - expectedTrim) < 1e-12,
        'the next fresh analog input changes trim at the normal adjustment rate');
      assert.ok((player.speed - referencePlayer.speed) * freshAxis > 0,
        'fresh throttle also reaches the actual aircraft motion');
      assert.equal(session.fleet.ownershipRevision, 2);
      assert.equal(session.fleet.player, player);
      assert.equal(session.fleet.playerLosses, 1);
    });
  }
}
