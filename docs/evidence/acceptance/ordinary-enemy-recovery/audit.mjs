import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const directory = 'docs/evidence/acceptance/ordinary-enemy-recovery/';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = JSON.parse(readFileSync(directory + 'probe.json'));
const inputs = JSON.parse(gunzipSync(readFileSync(directory + 'inputs.json.gz')));
const mission = JSON.parse(readFileSync('docs/evidence/acceptance/mission-manifest.json'));
assert.equal(result.status, 'positive');
assert.equal(result.seed, 1196097537);
assert.equal(inputs.seed, result.seed);
assert.equal(inputs.mode, 'normal');
assert.equal(inputs.inputRows.length, result.tick);
assert.equal(result.controlRows.length, Math.ceil(result.tick / 60));
for (let k = 0; k < inputs.inputRows.length; k += 1) {
  const control = result.controlRows[Math.floor(k / 60)];
  assert.equal(control.firstTick, 1 + Math.floor(k / 60) * 60);
  assert.deepEqual(inputs.inputRows[k], control.input);
  assert.equal(inputs.inputRows[k].climb, 0);
  assert.equal(inputs.inputRows[k].loop, false);
  assert.equal(inputs.inputRows[k].accelerate, false);
  assert.equal(inputs.inputRows[k].brake, false);
}
assert.deepEqual(result.initial.position, [0, 1000, 2000]);
assert.equal(result.initial.hpMilli, 80000);
assert.equal(result.initial.ammunition.mg, 288);
assert.equal(result.initial.ammunition.cannon, 96);
assert.equal(result.hits.length, 48);
assert.equal(new Set(result.hits.map(hit => hit.attackId)).size, result.hits.length);
let remainingHp = result.initial.hpMilli;
for (const hit of result.hits) {
  assert.equal(hit.owner, 'enemy');
  assert.equal(hit.tokenId, 0);
  assert.ok(hit.damageMilli > 0 && hit.damageMilli <= hit.calculatedDamageMilli);
  assert.equal(hit.damageMilli, Math.min(remainingHp, hit.calculatedDamageMilli));
  remainingHp -= hit.damageMilli;
}
assert.equal(remainingHp, 0);
assert.equal(result.totalEnemyDamage, 80000);
assert.equal(result.loss.tick, 4533);
assert.equal(result.loss.tokenId, 0);
assert.equal(result.loss.message, '被弾');
assert.equal(result.loss.ownershipRevision, 1);
assert.equal(result.respawn.tick, 4713);
assert.equal(result.respawn.tokenId, 8);
assert.equal(result.respawn.hpMilli, 80000);
assert.equal(result.respawn.ammunition.mg, 288);
assert.equal(result.respawn.ammunition.cannon, 96);
assert.equal(result.respawn.ownershipRevision, 2);
assert.equal(result.respawnDelay, 180);
assert.equal(result.respawn.tick - result.loss.tick, 180);
assert.equal(result.phase, 'playing');
assert.deepEqual(result.fleet, { active: 8, reserved: 0, reserve: 41, lost: 1, remaining: 49,
  playerLosses: 1, wingmanLosses: 0 });
assert.equal(result.enemyPoolFailures, 0);
assert.equal(result.abnormal, null);
assert.equal(result.sourceStable, true);
let missionSourceCount = 0;
for (const [path, hash] of Object.entries(result.sourceHashes)) {
  assert.equal(sha(path), hash, path);
  if (path.startsWith('src/')) {
    assert.equal(hash, mission.sourceSHA256[path], path + ' frozen mission source');
    missionSourceCount += 1;
  }
}
assert.equal(missionSourceCount, 15);
const artifacts = ['probe.mjs', 'probe.log', 'probe.json', 'inputs.json.gz', 'README.md', 'audit.mjs'];
const manifest = { recordedAtUTC: new Date().toISOString(), result: 'pass',
  classification: result.classification, requirementsCommit: mission.requirementsCommit,
  requirementsBlob: mission.requirementsBlob, rulesVersion: result.rulesVersion,
  sourceSHA256: result.sourceHashes, frozenMissionSourcesMatched: missionSourceCount,
  artifactsSHA256: Object.fromEntries(artifacts.map(name => [name, sha(directory + name)])),
  command: 'node docs/evidence/acceptance/ordinary-enemy-recovery/audit.mjs',
  seed: result.seed, tick: result.tick, inputCount: inputs.inputRows.length,
  hitCount: result.hits.length, enemyDamageMilli: result.totalEnemyDamage,
  lossTick: result.loss.tick, respawnTick: result.respawn.tick, respawnDelay: result.respawnDelay,
  finalPlayer: result.player, finalFleet: result.fleet, enemyPoolFailures: result.enemyPoolFailures };
writeFileSync(directory + 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
