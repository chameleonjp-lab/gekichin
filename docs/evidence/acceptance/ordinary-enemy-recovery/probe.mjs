import { Vector3 } from 'three';
import { FlightSession } from '../../../../src/game-state.ts';
import { clamp, normalizeAngle } from '../../../../src/flight.ts';
import { INITIAL_SEED, PLAYER_MAX_PITCH, RULES_VERSION } from '../../../../src/rules.ts';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const files = ['src/aircraft-weapons.ts', 'src/combat-types.ts', 'src/collision-world.ts', 'src/fleet.ts', 'src/flight.ts',
  'src/flight-assist.ts', 'src/flight-view.ts', 'src/game-state.ts', 'src/mothership-layout.ts', 'src/mothership.ts',
  'src/rules.ts', 'src/scoring.ts', 'src/turret-combat.ts', 'src/types.ts', 'src/wingman-ai.ts',
  'docs/evidence/acceptance/ordinary-enemy-recovery/probe.mjs'];
const sourceHashes = Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const neutral = { turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false,
  steeringRevision: 0, viewAspect: 393 / 852 };
const session = new FlightSession(), operation = session.prepare('normal', INITIAL_SEED);
if (operation === null || !session.begin(operation)) throw new Error('Standard operation failed');
const initial = { position: session.player.position.toArray(), hpMilli: session.fleet.player.hpMilli,
  ammunition: { ...session.fleet.player.ammunition }, fleet: session.fleet.counts };
let input = neutral, sequence = 0, loss = null, respawn = null, oldHp = 80000, oldToken = 0;
const hits = [], drops = [], controlRows = [], inputRows = [];
const started = performance.now(), cpuStarted = process.cpuUsage();
for (let k = 0; k < 7200 && session.phase === 'playing'; k += 1) {
  if (k % 60 === 0) {
    const player = session.fleet.player;
    if (!player) input = neutral;
    else {
      const angle = Math.atan2(player.position.x, player.position.z) + .24;
      const direction = new Vector3(Math.sin(angle) * 900, 1000, Math.cos(angle) * 900).sub(player.position);
      const yaw = Math.atan2(-direction.x, -direction.z);
      const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
      input = { ...neutral, turn: clamp(-normalizeAngle(yaw - player.yaw) / .82, -1, 1),
        climb: clamp(pitch / PLAYER_MAX_PITCH, -1, 1), fire: true };
    }
    controlRows.push({ firstTick: k + 1, input: { ...input } });
  }
  inputRows.push({ ...input });
  session.step(input);
  const player = session.fleet.player;
  if (player && player.tokenId === oldToken && player.hpMilli < oldHp)
    drops.push({ tick: session.tick, tokenId: player.tokenId, from: oldHp, to: player.hpMilli });
  if (player) { oldHp = player.hpMilli; oldToken = player.tokenId; }
  for (const event of session.events) if (event.sequence > sequence) {
    sequence = event.sequence;
    if (event.kind === 'hit' && event.owner === 'enemy' && event.tokenId === 0 && (event.damageMilli ?? 0) > 0)
      hits.push({ ...event, point: event.point?.toArray() });
    if (event.kind === 'aircraft-lost' && event.owner === 'player' && loss === null)
      loss = { ...event, point: event.point?.toArray(), ownershipRevision: session.fleet.ownershipRevision,
        fleet: session.fleet.counts, pending: session.fleet.reservations.map(reservation => ({ ...reservation })) };
    if (event.kind === 'respawn' && event.owner === 'player' && loss !== null)
      respawn = { ...event, point: event.point?.toArray(), hpMilli: session.fleet.player?.hpMilli,
        ammunition: { ...session.fleet.player?.ammunition }, ownershipRevision: session.fleet.ownershipRevision };
  }
  if (session.tick % 600 === 0) console.log(JSON.stringify({ type: 'probe-progress', tick: session.tick,
    hpMilli: session.fleet.player?.hpMilli ?? 0, playerLosses: session.fleet.playerLosses }));
  if (respawn) break;
}
const totalEnemyDamage = hits.reduce((sum, hit) => sum + hit.damageMilli, 0);
const positive = Boolean(loss && respawn && totalEnemyDamage >= 80000 && respawn.tick - loss.tick === 180);
const cpu = process.cpuUsage(cpuStarted);
for (const [path, hash] of Object.entries(sourceHashes)) {
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw new Error(`Source changed: ${path}`);
}
const result = { type: 'ordinary-enemy-recovery-probe', timestamp: new Date().toISOString(), status: positive ? 'positive' : 'negative',
  classification: 'standard Normal start; controller-generated FlightInput; no pose/HP/state fixture; not DOM or human-play evidence',
  rulesVersion: RULES_VERSION, seed: session.seed, tickCap: 7200, initial,
  controller: { radius: 900, altitude: 1000, nextAngleRadians: .24, turnDivisor: .82, updateEveryTicks: 60,
    firstInputTick: 1, fire: 'held while player active', climb: 0, loop: false, accelerate: false, brake: false,
    targetThrustSpeed: 110, viewAspect: 393 / 852 },
  command: 'node --import tsx docs/evidence/acceptance/ordinary-enemy-recovery/probe.mjs',
  sourceHashes, sourceStable: true, phase: session.phase, tick: session.tick, activeSeconds: session.tick / 60,
  cpuSeconds: (cpu.user + cpu.system) / 1e6, wallSeconds: (performance.now() - started) / 1000,
  hits, drops, totalEnemyDamage, loss, respawn, respawnDelay: respawn && loss ? respawn.tick - loss.tick : null,
  player: session.fleet.player ? { tokenId: session.fleet.player.tokenId, hpMilli: session.fleet.player.hpMilli,
    position: session.fleet.player.position.toArray(), ammunition: { ...session.fleet.player.ammunition } } : null,
  ownershipRevision: session.fleet.ownershipRevision, fleet: session.fleet.counts,
  enemyPoolFailures: session.enemyCombat.poolFailures, abnormal: session.abnormalReason, controlRows };
writeFileSync(new URL('probe.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
writeFileSync(new URL('inputs.json.gz', import.meta.url), gzipSync(JSON.stringify({ seed: session.seed, mode: 'normal', inputRows })));
console.log(JSON.stringify({ ...result, sourceHashes: undefined, controlRows: undefined }));
