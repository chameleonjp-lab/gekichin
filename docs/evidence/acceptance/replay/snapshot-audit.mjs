import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = 'docs/evidence/acceptance/replay';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const hashFile = path => digest(readFileSync(path));
const original = read('docs/evidence/acceptance/mission-manifest.json');
const orchestration = read(`${folder}/orchestration.json`);
assert.deepEqual(orchestration.events.at(-1).exitCodes, { easy: 0, normal: 0 });
const manifests = ['easy', 'normal'].map(mode => read(`${folder}/${mode}-manifest.json`));
const summaries = [];
for (const manifest of manifests) {
  assert.deepEqual(manifest.rates, [30, 60, 120]);
  assert.equal(manifest.requirementsCommit, original.requirementsCommit);
  assert.equal(manifest.rulesVersion, original.ruleVersion);
  assert.ok(manifest.equalFinalSnapshots && manifest.equalFullEventStreams
    && manifest.allOriginalMissionChecksPassed && manifest.sourceAndAcceptedArtifactsStable);
  for (const [path, hash] of Object.entries(manifest.sourceHashes)) assert.equal(hashFile(path), hash, path);
  for (const [path, hash] of Object.entries(manifest.artifactHashes)) assert.equal(hashFile(path), hash, path);
  const originalRun = original.runs.find(run => run.mode === manifest.mode);
  assert.ok(originalRun);
  assert.equal(manifest.artifactHashes[resolve(`docs/evidence/acceptance/${manifest.mode}-inputs.json.gz`)], originalRun.inputsSHA256);
  assert.equal(manifest.artifactHashes[resolve(`docs/evidence/acceptance/${manifest.mode}-run.log`)], originalRun.logSHA256);
  for (const [path, hash] of Object.entries(original.sourceSHA256)) {
    if (path in manifest.sourceHashes) assert.equal(manifest.sourceHashes[path], hash, path);
  }
  const results = [30, 60, 120].map(hz => read(`${folder}/${manifest.mode}-${hz}hz.json`));
  for (const result of results) {
    assert.equal(digest(JSON.stringify(result.snapshot)), result.snapshotSha256, 'Saved snapshot bytes do not reproduce its digest');
    assert.deepEqual(result.snapshot, results[0].snapshot, 'Saved final states differ');
    assert.equal(result.snapshotSha256, results[0].snapshotSha256);
    assert.equal(result.eventStreamSha256, results[0].eventStreamSha256);
    assert.deepEqual(result.report, originalRun.report);
    assert.equal(result.finalTick, originalRun.endTick);
    assert.equal(result.seed, originalRun.seed);
    assert.equal(result.acceptedInputCount, originalRun.endTick);
    assert.equal(result.frameCount, Math.ceil(originalRun.endTick * result.hz / 60));
    assert.equal(result.schedulerCallbackCount, result.hz === 30 ? originalRun.endTick + 1 : originalRun.endTick);
    assert.equal(result.ignoredTerminalCallbacks, result.hz === 30 ? 1 : 0);
    assert.equal(result.gapCount, 0);
    assert.ok(Object.values(result.checks).every(value => value === true));
    const snapshot = result.snapshot;
    assert.deepEqual(snapshot.report, result.report);
    assert.equal(snapshot.mothership.totalHpMilli, 0);
    assert.equal(snapshot.mothership.remaining, 0);
    assert.equal(snapshot.mothership.turrets.length, 100);
    assert.ok(snapshot.mothership.turrets.every(turret => turret.hpMilli === 0));
    assert.deepEqual(snapshot.mothership.destroyedIds, Array.from({ length: 100 }, (_, id) => id));
    assert.equal(snapshot.mothership.destroyedTurrets.length, 100);
    assert.deepEqual(snapshot.fleet.counts, result.fleet);
    assert.deepEqual(snapshot.allocationFailures, { friendly: 0, enemy: 0 });
    const { snapshot: _snapshot, ...summary } = result;
    assert.deepEqual(summary, manifest.runs.find(run => run.hz === result.hz));
    summaries.push(summary);
  }
}
assert.deepEqual(manifests[0].sourceHashes, manifests[1].sourceHashes);
const artifacts = ['README.md', 'orchestration.json', 'snapshot-audit.mjs',
  ...['easy', 'normal'].flatMap(mode => [`${mode}-manifest.json`, `${mode}-replay.log`,
    ...[30, 60, 120].map(hz => `${mode}-${hz}hz.json`)])];
const report = {
  type: 'replay-saved-artifact-audit', timestamp: new Date().toISOString(), successfulReplays: summaries.length,
  modes: ['easy', 'normal'], rates: [30, 60, 120], seed: 1196097537, finalTick: 54329,
  savedSnapshotDigestRecomputed: true, savedSnapshotContentDeepEqualAcrossRates: true,
  fullEventStreamDigestsEqualAcrossRates: true, frameAndCallbackCountsExact: true,
  originalMissionReportAndHashesMatch: true, allSourceAndOriginalArtifactsStillStable: true,
};
const manifest = {
  type: 'full-mission-fps-invariance', timestamp: report.timestamp,
  requirementsCommit: original.requirementsCommit, requirementsBlob: original.requirementsBlob,
  rulesVersion: original.ruleVersion, baseHead: original.baseHead, logicHz: 60,
  classification: 'ordinary-recorded-flight-input-through-unmodified-fixed-stepper',
  environment: manifests[0].environment,
  commands: ['easy', 'normal'].map(mode => `node --import tsx scripts/mission-replay.ts --record docs/evidence/acceptance/${mode}-inputs.json.gz --result-log docs/evidence/acceptance/${mode}-run.log --output docs/evidence/acceptance/replay --hz 30,60,120 > docs/evidence/acceptance/replay/${mode}-replay.log 2>&1`),
  auditCommand: 'node docs/evidence/acceptance/replay/snapshot-audit.mjs > docs/evidence/acceptance/replay/snapshot-audit.log 2>&1',
  processExitCodes: { easy: 0, normal: 0 },
  originalMissionManifestSHA256: hashFile('docs/evidence/acceptance/mission-manifest.json'),
  sourceSHA256: manifests[0].sourceHashes,
  originalArtifactSHA256: Object.assign({}, ...manifests.map(item => item.artifactHashes)),
  replayArtifactSHA256: Object.fromEntries(artifacts.map(name => [`${folder}/${name}`, hashFile(`${folder}/${name}`)])),
  runs: summaries, audit: report,
  limitation: 'Synthetic render cadence verifies deterministic combat. It does not measure browser/device frame performance or replace the original mission input-path classification.',
};
writeFileSync(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(report));
