#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const baseUrl = (process.env.VISUAL_BASE_URL || 'http://127.0.0.1:4177').replace(/\/$/, '');
const outputDir = path.resolve(process.env.VISUAL_OUTPUT_DIR || 'docs/evidence/acceptance/visual');
const viewport = { width: 1366, height: 768 };
const fixtureHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Visual acceptance fixture</title>
<style>html,body,#scene{margin:0;width:100%;height:100%;overflow:hidden;background:#1c3345}body{font:14px sans-serif}#activate-audio{position:fixed;z-index:10;top:4px;left:4px}</style></head>
<body><main id="scene" aria-label="Visual acceptance fixture"></main><button id="activate-audio" type="button" hidden>Run synthesized audio diagnostics</button>
<script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import { FlightScene } from '/src/scene.ts';
import { FlightAudio } from '/src/audio.ts';
import { FlightSession } from '/src/game-state.ts';
import { createMothershipLayout } from '/src/mothership-layout.ts';

const scene = new FlightScene(document.querySelector('#scene'), () => {});
const audio = new FlightAudio();
let session = null;
const layout = createMothershipLayout();
const normalCameraOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.19);

function freshSession() {
  const next = new FlightSession();
  const operationId = next.prepare('normal');
  if (operationId === null || !next.begin(operationId)) throw new Error('Could not prepare a production FlightSession.');
  session = next;
  return next;
}

function setPreTickPose(position, target) {
  if (!session) throw new Error('Create the FlightSession first.');
  const eye = new THREE.Vector3(position.x, position.y, position.z);
  const lookAt = new THREE.Vector3(target.x, target.y, target.z);
  const offset = eye.clone().sub(layout.center);
  if (Math.hypot(eye.x, eye.z) > 4000 || eye.y < 50 || eye.y > 2500) throw new Error('Visual pose falls outside the flight boundary.');
  if (session.world.sweep(eye, eye, { radius: 5, aircraft: false, sea: true })) throw new Error('Visual pose intersects authoritative collision geometry.');
  const direction = lookAt.clone().sub(eye).normalize();
  const up = Math.abs(direction.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const cameraMatrix = new THREE.Matrix4().lookAt(eye, lookAt, up);
  const cameraRotation = new THREE.Quaternion().setFromRotationMatrix(cameraMatrix);
  const plane = session.player;
  plane.position.copy(eye);
  plane.previous.copy(eye);
  plane.bank = 0;
  plane.pitch = 0;
  plane.yaw = 0;
  plane.quaternion.copy(cameraRotation).multiply(normalCameraOffset.clone().invert());
  return { position: eye.toArray(), target: lookAt.toArray(), distanceFromMothershipCenter: offset.length() };
}

function render(sinkingElapsedSeconds = 0) {
  if (!session) throw new Error('Create the FlightSession first.');
  scene.render(session.player, session.mode, session.tick, session, sinkingElapsedSeconds);
  const canvas = scene.canvas;
  return {
    tick: session.tick,
    phase: session.phase,
    operationId: session.operationId,
    remainingTurrets: session.mothership.remaining,
    warnings: session.enemyCombat.warnings.length,
    scene: scene.diagnostics,
    canvas: Object.fromEntries(Object.entries(canvas.dataset).filter(([key]) => key.startsWith('render'))),
    sinkElapsedSeconds: sinkingElapsedSeconds,
  };
}

function damageStage(turretId, remainingFraction) {
  const turret = session.mothership.byId(turretId);
  if (!turret) throw new Error('Unknown visual fixture turret.');
  const amount = turret.maxHpMilli - Math.round(turret.maxHpMilli * remainingFraction);
  if (amount > 0) session.mothership.applyDamage(turretId, amount, { attackId: 'visual-fixture-stage-' + remainingFraction, tick: session.tick });
}

function destroyAllForSinkView() {
  for (const turret of session.mothership.turrets) {
    session.mothership.applyDamage(turret.id, turret.maxHpMilli, { attackId: 'visual-fixture-sink-' + turret.id, tick: session.tick });
  }
}

function prepareFrame(request) {
  const current = freshSession();
  let pose = null;
  if (request.type === 'face') {
    pose = setPreTickPose(request.position, { x: 0, y: 1000, z: 0 });
  } else if (request.type === 'damage') {
    const turret = current.mothership.byId(request.turretId);
    const target = turret.layout.aimPoint;
    pose = setPreTickPose({ x: target.x + 120, y: target.y + 180, z: target.z + 100 },
      { x: target.x + 55, y: target.y, z: target.z });
    damageStage(request.turretId, request.remainingFraction);
  } else if (request.type === 'sink') {
    pose = setPreTickPose({ x: 0, y: 1600, z: 1350 }, { x: 0, y: 1000, z: 0 });
    destroyAllForSinkView();
  } else if (request.type === 'ordinary-flight') {
    for (let tick = 0; tick < request.steps; tick++) {
      current.step({ ...request.input, viewAspect: 1366 / 768 });
    }
  } else {
    throw new Error('Unknown visual fixture frame type: ' + request.type);
  }
  window.__sinkSeconds = request.sinkSeconds || 0;
  return { pose, fixtureType: request.type };
}

async function waitForAudioState(expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (audio.diagnostics.contextState === expected) return audio.diagnostics;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return audio.diagnostics;
}

document.querySelector('#activate-audio').addEventListener('click', async () => {
  // Match a live operation, where main.ts has already marked the scene active.
  audio.setActive(true);
  const enabled = await audio.toggle();
  if (enabled) {
    await waitForAudioState('running');
    audio.update(160);
    const listener = new THREE.Vector3(0, 0, 0), rotation = new THREE.Quaternion();
    const kinds = ['machinegun', 'cannon', 'enemy-machinegun', 'main-warning', 'metal-impact', 'turret-destroy', 'mothership-sink'];
    for (let index = 0; index < kinds.length; index++) {
      audio.playCombat(kinds[index], new THREE.Vector3(index * 20 - 60, 5, -80), listener, rotation);
    }
    // Occupy the complete fixed effects pool to verify the 15+propeller bound.
    for (let index = 0; index < 15; index++) {
      audio.playCombat('mothership-sink', new THREE.Vector3(index * 8, 0, -140), listener, rotation);
    }
  }
  window.__audioAfterEmission = audio.diagnostics;
  window.__audioActivated = true;
});

window.__visualFixture = {
  scene,
  audio,
  freshSession,
  setPreTickPose,
  prepareFrame,
  render,
  damageStage,
  destroyAllForSinkView,
  waitForAudioState,
  closeAudio() { audio.dispose(); return audio.diagnostics; },
  dispose() { audio.dispose(); scene.dispose(); },
};
window.__visualReady = false;
scene.ready.then(() => { window.__visualReady = true; })
  .catch(error => { window.__visualError = String(error && error.stack || error); });
</script></body></html>`;

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ] });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  await page.route('**/__visual_fixture*', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixtureHtml,
  }));

  try {
    await page.goto(baseUrl + '/__visual_fixture', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__visualReady || window.__visualError, { timeout: 120000 });
    const ready = await page.evaluate(() => ({ ready: window.__visualReady, error: window.__visualError || null }));
    if (!ready.ready) throw new Error('Scene shader preparation failed: ' + ready.error);

    const manifest = {
      captureType: 'procedural-scene visual fixture; not a normal clear or gameplay performance result',
      capturedAt: new Date().toISOString(),
      baseUrl,
      browser: 'Playwright Chromium with SwiftShader WebGL',
      viewport: { ...viewport, deviceScaleFactor: 1 },
      method: {
        sixFaces: 'Each face uses a flight-boundary-valid, collision-clear pre-tick player pose and FlightScene normal-mode camera. No simulation ticks are advanced in those frames.',
        damage: 'Healthy, damaged, critical, and wreck images use Mothership.applyDamage only to create bounded visual states. These are not score, victory, or ordinary-clear evidence.',
        sinking: 'All 100 turret states are synthetically destroyed for a render-only 0/2.5/5-second sink sweep at frozen tick 0. This is presentation evidence only.',
        ordinaryFlight: 'The extra flight frame uses the unmodified legal initial sortie and 60 calls to FlightSession.step with ordinary input; it does not modify player position after the first simulation tick and is not a clear claim.',
        audio: 'Start-off, one-context/fixed-voice-pool, synthesized cue activity, pause suspension, and disposal are measured from the read-only FlightAudio diagnostics getter. Synthetic signal checks do not establish human audibility.',
      },
      audio: {},
      frames: [],
      pageErrors,
    };

    async function capture(name, descriptor, request) {
      const setup = await page.evaluate(input => window.__visualFixture.prepareFrame(input), request);
      const rendered = await page.evaluate(() => window.__visualFixture.render(window.__sinkSeconds || 0));
      const filename = name + '.png';
      await page.screenshot({ path: path.join(outputDir, filename), animations: 'disabled' });
      manifest.frames.push({ name, file: filename, ...descriptor, ...setup, ...rendered });
      process.stdout.write('captured ' + filename + '\n');
    }

    const facePoses = [
      { name: 'face-top', face: 'top', position: { x: 0, y: 2180, z: 0 } },
      { name: 'face-bottom', face: 'bottom', position: { x: 0, y: 80, z: 0 } },
      { name: 'face-left', face: 'left', position: { x: -1700, y: 1000, z: 0 } },
      { name: 'face-right', face: 'right', position: { x: 1700, y: 1000, z: 0 } },
      { name: 'face-front', face: 'front', position: { x: 0, y: 1000, z: 2050 } },
      { name: 'face-rear', face: 'rear', position: { x: 0, y: 1000, z: -2050 } },
    ];
    for (const { name, face, position } of facePoses) {
      await capture(name, { category: 'six-face normal-camera view', face, tickPolicy: 'pre-tick pose fixture; tick remains 0' },
        { type: 'face', position });
    }

    const target = { id: 4, position: { x: -150, y: 1134, z: -240 } };
    const damageCases = [
      { name: 'damage-healthy', stage: 'healthy', remainingFraction: 1 },
      { name: 'damage-damaged', stage: 'damaged', remainingFraction: 0.4 },
      { name: 'damage-critical', stage: 'critical', remainingFraction: 0.2 },
      { name: 'damage-wreck', stage: 'destroyed / low wreck', remainingFraction: 0 },
    ];
    for (const { name, stage, remainingFraction } of damageCases) {
      await capture(name, { category: 'representative top main-turret damage stage', stage, turretId: target.id,
        tickPolicy: 'pre-tick pose fixture; direct fixture damage only; no combat-clear claim' },
        { type: 'damage', turretId: target.id, remainingFraction });
    }

    const sinkFrames = [0, 2.5, 5];
    for (const elapsed of sinkFrames) {
      await capture('sink-' + String(elapsed).replace('.', '_') + 's', { category: 'synthetic render-only sinking sweep',
        stage: 'all turret meshes destroyed', elapsedSeconds: elapsed,
        tickPolicy: 'simulation frozen at tick 0; direct fixture damage only' }, { type: 'sink', sinkSeconds: elapsed });
    }

    manifest.audio.initial = await page.evaluate(() => window.__visualFixture.audio.diagnostics);
    await capture('ordinary-flight-60ticks', { category: 'ordinary fixed-step flight frame', mode: 'normal',
      steps: 60, input: { turn: 0.12, climb: 0.04, fire: false, loop: false, accelerate: false, brake: false },
      tickPolicy: 'ordinary FlightSession.step only after valid initial sortie; not a combat-clear claim' },
      { type: 'ordinary-flight', steps: 60, input: { turn: 0.12, climb: 0.04, fire: false, loop: false, accelerate: false, brake: false } });

    await page.evaluate(() => { document.querySelector('#activate-audio').hidden = false; });
    await page.locator('#activate-audio').click();
    await page.waitForFunction(() => window.__audioActivated === true, { timeout: 10000 });
    manifest.audio.active = await page.evaluate(() => window.__audioAfterEmission);
    await page.evaluate(() => window.__visualFixture.audio.setActive(false));
    manifest.audio.paused = await page.evaluate(() => window.__visualFixture.waitForAudioState('suspended'));
    manifest.audio.disposed = await page.evaluate(() => window.__visualFixture.closeAudio());
    manifest.audio.cuesExercised = ['machinegun', 'cannon', 'enemy-machinegun', 'main-warning', 'metal-impact', 'turret-destroy', 'mothership-sink'];
    manifest.audio.syntheticSignalAcceptance = {
      oneContext: manifest.audio.active.contexts === 1,
      fixedVoicePool: manifest.audio.active.voices === 16 && manifest.audio.active.maxVoices === 16,
      noMoreThanSixteenActive: manifest.audio.active.activeVoices <= 16,
      effectsRemainWithinFifteen: manifest.audio.active.effectVoices <= 15,
      synthesizedCueWasActive: manifest.audio.active.effectVoices > 0,
      pauseSilenced: manifest.audio.paused.activeVoices === 0,
      disposedResources: manifest.audio.disposed.contexts === 0 && manifest.audio.disposed.voices === 0,
      humanAudibilityTested: false,
    };
    await page.evaluate(() => { document.querySelector('#activate-audio').hidden = true; });

    manifest.finalSceneDiagnostics = await page.evaluate(() => window.__visualFixture.scene.diagnostics);
    manifest.pageErrors = pageErrors;
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (pageErrors.length) throw new Error('Browser console/page errors: ' + pageErrors.join(' | '));
    if (!Object.values(manifest.audio.syntheticSignalAcceptance).slice(0, 7).every(Boolean)) {
      throw new Error('Audio synthetic signal/resource diagnostic did not satisfy the fixed resource bounds: ' + JSON.stringify(manifest.audio.syntheticSignalAcceptance));
    }
    process.stdout.write('manifest ' + path.join(outputDir, 'manifest.json') + '\n');
  } finally {
    await page.evaluate(() => window.__visualFixture?.dispose()).catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write((error && error.stack || String(error)) + '\n');
  process.exitCode = 1;
});
