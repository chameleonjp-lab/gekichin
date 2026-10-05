import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/prepare-pages.mjs');
const sha = 'a'.repeat(40);
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gekichin-pages-'));
  for (const path of ['dist/assets', 'public', 'node_modules/three', 'artifacts']) mkdirSync(join(root, path), { recursive: true });
  const notice = 'Three.js\nPermission is hereby granted\n';
  for (const path of ['dist/third-party-notices.txt', 'public/third-party-notices.txt', 'node_modules/three/LICENSE']) writeFileSync(join(root, path), notice);
  const content: Record<string, string> = {
    'index.html': '<title>ゲキチン</title><script src="./assets/app-123.js"></script><link href="./assets/app-123.css" rel="stylesheet">',
    'assets/app-123.js': 'console.log("game")',
    'assets/app-123.css': 'body { color: white; }',
    'third-party-notices.txt': notice,
  };
  for (const [path, data] of Object.entries(content)) writeFileSync(join(root, 'dist', path), data);
  
  return root;
}
function run(root: string, commit = sha) {
  return spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, BUILD_COMMIT: commit }, encoding: 'utf8' });
}
function rejects(change: (root: string) => void, expected: RegExp, commit = sha) {
  const root = fixture();
  change(root);
  const result = run(root, commit);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, expected);
}

test('Pages manifest binds the complete source SHA and every public file hash', () => {
  const root = fixture();
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(root, 'dist/deployment.json'), 'utf8'));
  assert.equal(manifest.repository, 'chameleonjp-lab/gekichin');
  assert.equal(manifest.commit, sha);
  assert.equal(manifest.files.length, 4);
  for (const entry of manifest.files) {
    const data = readFileSync(join(root, 'dist', entry.path));
    assert.equal(entry.sha256, digest(data));
    assert.equal(entry.bytes, data.length);
  }
  assert.notEqual(run(root).status, 0, 'A prior deployment manifest must not be silently replaced');
});
test('Pages preparation rejects an abbreviated or malformed source SHA', () => {
  for (const commit of ['', 'a'.repeat(7), 'g'.repeat(40), 'a'.repeat(41)]) rejects(() => {}, /full commit SHA/, commit);
});
test('Pages preparation rejects extra public files and directories', () => {
  rejects(root => writeFileSync(join(root, 'dist/.env'), 'secret'), /Unexpected public file/);
  rejects(root => writeFileSync(join(root, 'dist/assets/.hidden.js'), 'hidden'), /Unexpected public file/);
  rejects(root => mkdirSync(join(root, 'dist/private')), /Unexpected public directory/);
});
test('Pages preparation rejects symbolic links and hard links', () => {
  rejects(root => symlinkSync('../public/third-party-notices.txt', join(root, 'dist/linked.txt')), /symlinks/);
  rejects(root => linkSync(join(root, 'public/third-party-notices.txt'), join(root, 'dist/linked.txt')), /non-linked/);
});
test('Pages preparation rejects a changed NOTICE', () => {
  rejects(root => writeFileSync(join(root, 'dist/third-party-notices.txt'), 'changed'), /NOTICE differs/);
  rejects(root => writeFileSync(join(root, 'node_modules/three/LICENSE'), 'changed'), /license must be preserved/);
});
test('Pages preparation preserves the existing trailing blank line after the license', () => {
  const root = fixture();
  const notice = readFileSync(join(root, 'public/third-party-notices.txt'), 'utf8') + '\n';
  for (const path of ['public/third-party-notices.txt', 'dist/third-party-notices.txt']) writeFileSync(join(root, path), notice);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'dist/third-party-notices.txt'), 'utf8'), notice);
});
test('Pages preparation rejects external and root-relative assets', () => {
  for (const url of ['/assets/app-123.js', 'https://other.example/app.js', '//other.example/app.js']) {
    rejects(root => writeFileSync(join(root, 'dist/index.html'), `<title>ゲキチン</title><script src="${url}"></script>`), /External asset|Root-relative asset/);
  }
});
test('Pages preparation rejects missing entry assets and a wrong game title', () => {
  rejects(root => writeFileSync(join(root, 'dist/index.html'), '<title>ゲキチン</title><script src="./assets/missing.js"></script><link href="./assets/app-123.css">'), /Missing public asset/);
  rejects(root => writeFileSync(join(root, 'dist/index.html'), '<title>Wrong</title>'), /Unexpected game entry/);
});
test('Pages preparation rejects runtime debug hooks and source maps', () => {
  rejects(root => writeFileSync(join(root, 'dist/assets/app-123.js'), '__gekichinDebug = true'), /Forbidden integration/);
  rejects(root => writeFileSync(join(root, 'dist/assets/app-123.js'), '//# sourceMappingURL=app.js.map'), /Source map reference/);
});

test('Pages workflow stays manual, main-only, SHA-pinned and least privilege', () => {
  const workflow = readFileSync('.github/workflows/deploy-pages.yml', 'utf8').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(workflow, /continue-on-error:|^\s*<<:|[&*][A-Za-z_]/m, 'No failure bypasses or YAML aliases');
  const conditions = [...workflow.matchAll(/^\s*if: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(conditions, ["github.ref == 'refs/heads/main'", 'always()', "github.ref == 'refs/heads/main'"]);
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  (push|pull_request|workflow_run|schedule):/);
  assert.match(workflow, /\[\[ "\$EXPECTED_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /test "\$EXPECTED_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /enablement: false/);
  assert.match(workflow, /cancel-in-progress: false/);
  const pagesUpload = workflow.split(/uses: actions\/upload-pages-artifact@[0-9a-f]{40}\n/)[1]?.split(/\n      - /)[0];
  assert(pagesUpload, 'Missing Pages artifact upload');
  assert.match(pagesUpload, /^          path: dist$/m);
  const [build, deploy] = workflow.split('\n  deploy:\n');
  assert.match(build, /pages: read/);
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /needs: build/);
  assert.match(deploy, /pages: write\n      id-token: write/);
  for (const job of [build, deploy]) assert.match(job, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /name: github-pages/);
  const actions = [...workflow.matchAll(/uses: ([^\n]+)/g)].map(match => match[1]);
  assert(actions.length >= 6);
  for (const action of actions) assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/);
  for (const checkout of workflow.split(/- uses: actions\/checkout@[0-9a-f]{40}/).slice(1)) assert.match(checkout.split(/\n      - /)[0], /persist-credentials: false/);
  const runSteps = [...workflow.matchAll(/^\s*(?:- )?run: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(runSteps, ["|", "test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"", "npm ci --ignore-scripts --no-audit --no-fund", "npm test", "npm run build", "npx playwright install --with-deps chromium webkit", "xvfb-run -a npm run test:browser", "npm ci --ignore-scripts --no-audit --no-fund --prefix .throttle-baseline", "node scripts/capture-throttle-comparison.mjs .throttle-baseline", "node scripts/prepare-pages.mjs"]);
  assert.match(workflow, /ref: c0cf927fcf7dd75edae6fee539072e4b3498c86e/);
});
