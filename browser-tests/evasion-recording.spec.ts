import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const SOURCE_SNAPSHOT_FILES = [
  'docs/REQUIREMENTS.md', 'docs/IMPLEMENTATION_PLAN.md',
  'src/rules.ts', 'src/flight.ts', 'src/flight-view.ts', 'src/game-state.ts',
  'src/turret-combat.ts', 'src/collision-world.ts', 'src/mothership.ts', 'src/mothership-layout.ts', 'src/scene.ts',
  'tests/evasion-fixture.ts', 'tests/evasion.test.ts',
  'browser-tests/evasion-recorder.html', 'browser-tests/evasion-recorder.ts', 'browser-tests/evasion-recording.spec.ts',
] as const;

async function sourceSnapshot(): Promise<Record<string, string>> {
  const entries = await Promise.all(SOURCE_SNAPSHOT_FILES.map(async file => [file,
    createHash('sha256').update(await readFile(resolve(file))).digest('hex')] as const));
  return Object.fromEntries(entries);
}

test('A12/R45 records six paired real-projectile evasion cases through the normal FlightScene camera', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const evidenceDir = resolve('docs/evidence/acceptance/evasion');
  const outputDir = info.outputDir;
  await mkdir(evidenceDir, { recursive: true });
  const sourceAtStart = await sourceSnapshot();
  const baseUrl = process.env.GEKICHIN_FIXTURE_BASE_URL ?? (info.project.use.baseURL as string | undefined) ?? 'http://127.0.0.1:4177';
  const context = await browser.newContext({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    recordVideo: { dir: outputDir, size: { width: 960, height: 540 } },
  });
  const page = await context.newPage();
  const video = page.video();
  expect(video).not.toBeNull();
  const pageErrors: string[] = [];
  const frameNames: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('__saveEvasionFrame', async (label: string) => {
    const safeLabel = label.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const fileName = safeLabel + '-normal-camera.png';
    await page.screenshot({ path: info.outputPath(fileName), animations: 'disabled' });
    frameNames.push(fileName);
  });

  try {
    await page.goto(baseUrl + '/browser-tests/evasion-recorder.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.capture === 'complete' || document.body.dataset.capture === 'failed', null, { timeout: 165_000 });
    const captureStatus = await page.locator('body').getAttribute('data-capture');
    if (captureStatus !== 'complete') {
      const error = await page.evaluate(() => (window as Window & { __evasionBrowserError?: string }).__evasionBrowserError ?? 'unknown recorder error');
      throw new Error(error);
    }
    const result = await page.evaluate(() => (window as Window & { __evasionBrowserResult?: unknown }).__evasionBrowserResult);
    expect(result).toBeTruthy();
    const typedResult = result as {
      title: string;
      capture: { renderPath: string; tickDriver: string; browser: string; excludedFromNormalClear: true };
      performanceConstants: { main: { shots: number }; mg: { shots: number } };
      pairs: Array<{
        scenario: { face: string; kind: 'main' | 'mg' };
        baseline: { fixture: unknown; outcome: { warningStartedTick: number | null; warningProjection: { emitterVisible: boolean; fixedAimVisible: boolean } | null; shotTicks: number[]; distinctHitAttackIds: number[]; playerDamageMilli: number; endTick: number; activeIncomingBulletsAtEnd: number } };
        evasion: { fixture: unknown; outcome: { warningStartedTick: number | null; warningProjection: { emitterVisible: boolean; fixedAimVisible: boolean } | null; shotTicks: number[]; distinctHitAttackIds: number[]; playerDamageMilli: number; firstEvasiveInputTick: number | null; endTick: number; activeIncomingBulletsAtEnd: number } };
      }>;
    };
    expect(typedResult.pairs).toHaveLength(6);
    for (const pair of typedResult.pairs) {
      expect(pair.evasion.fixture).toEqual(pair.baseline.fixture);
      expect(pair.evasion.outcome.warningStartedTick).toBe(pair.baseline.outcome.warningStartedTick);
      expect(pair.evasion.outcome.shotTicks).toEqual(pair.baseline.outcome.shotTicks);
      expect(pair.evasion.outcome.warningStartedTick).not.toBeNull();
      expect(pair.baseline.outcome.distinctHitAttackIds.length).toBeGreaterThan(0);
      expect(pair.evasion.outcome.distinctHitAttackIds).toEqual([]);
      expect(pair.evasion.outcome.playerDamageMilli).toBe(0);
      expect(pair.evasion.outcome.firstEvasiveInputTick).toBe(pair.evasion.outcome.warningStartedTick! + 1);
      expect(pair.baseline.outcome.activeIncomingBulletsAtEnd).toBe(0);
      expect(pair.evasion.outcome.activeIncomingBulletsAtEnd).toBe(0);
      expect(pair.baseline.outcome.warningProjection).toEqual({ emitterVisible: true, fixedAimVisible: true });
      expect(pair.evasion.outcome.warningProjection).toEqual({ emitterVisible: true, fixedAimVisible: true });
      expect(pair.baseline.outcome.endTick).toBe(pair.evasion.outcome.endTick);
      expect(pair.baseline.outcome.shotTicks).toHaveLength(pair.scenario.kind === 'main' ? typedResult.performanceConstants.main.shots : typedResult.performanceConstants.mg.shots);
    }
    expect(frameNames).toHaveLength(18);
    expect(pageErrors).toEqual([]);
    expect(await sourceSnapshot()).toEqual(sourceAtStart);

    const recordPath = resolve(evidenceDir, 'evasion-six-cases-normal-camera.webm');
    const resultPath = resolve(evidenceDir, 'evasion-browser-trials.json.gz');
    const framesPath = resolve(evidenceDir, 'browser-frames');
    await page.screenshot({ path: info.outputPath('evasion-six-cases-final-frame.png'), animations: 'disabled' });
    await context.close();
    const videoSource = await video!.path();
    await copyFile(videoSource, recordPath);
    const browserEvidence = {
      ...typedResult,
      source: {
        requirements: 'R40–R45 / A10–A12', implementationPlan: 'P4 / P7',
        sha256ByFile: sourceAtStart,
      },
      frameFiles: frameNames,
      recording: 'evasion-six-cases-normal-camera.webm',
      fixtureSeparation: 'test-only pre-tick setup; explicitly excluded from the ordinary 100-mount clear acceptance gate',
      visualCapture: 'production FlightScene normal camera; all six warning checkpoints were verified to project the actual emitter and fixed aim through the normal camera; the panel is test-only context',
    };
    await writeFile(resultPath, gzipSync(JSON.stringify(browserEvidence, null, 2) + '\n'));
    await mkdir(framesPath, { recursive: true });
    for (const fileName of frameNames) await copyFile(info.outputPath(fileName), resolve(framesPath, fileName));
    await copyFile(info.outputPath('evasion-six-cases-final-frame.png'), resolve(evidenceDir, 'evasion-six-cases-final-frame.png'));
  } finally {
    if (context.pages().length > 0) await context.close();
  }
});
