import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createUiOnlyMainPlugin, UI_ONLY_MAIN_ANCHORS, validateUiOnlyMainSource } from '../vite.ui.config';

const root = process.cwd();
const mainPath = resolve(root, 'src/main.ts');
const source = readFileSync(mainPath, 'utf8');

test('UI-only Vite adapter is pinned to the unchanged product entry and its render anchors', () => {
  validateUiOnlyMainSource(mainPath, source, root);
  for (const anchor of UI_ONLY_MAIN_ANCHORS) assert.equal(source.split(anchor).length - 1, 1, anchor);
  const plugin = createUiOnlyMainPlugin(root);
  assert.equal(plugin.apply, 'serve');
  const transform = plugin.transform as (source: string, id: string) => string | null;
  const transformed = transform(source, mainPath);
  assert.ok(transformed?.includes("from '/browser-tests/ui-only-state.ts'"));
  assert.ok(transformed?.includes('installUiOnlyState({'));
});

test('UI-only adapter rejects path, anchor, and byte-hash drift', () => {
  assert.throws(() => validateUiOnlyMainSource(resolve(root, 'other/main.ts'), source, root), /path mismatch/);
  assert.throws(() => validateUiOnlyMainSource(mainPath, source.replace(UI_ONLY_MAIN_ANCHORS[0], 'function changed(): void {'), root), /anchor mismatch/);
  assert.throws(() => validateUiOnlyMainSource(mainPath, source + '\n', root), /source hash mismatch/);
});

test('production Vite and npm build do not load the UI-only adapter', () => {
  const productionConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.doesNotMatch(productionConfig, /createUiOnlyMainPlugin|ui-only-state/);
  assert.doesNotMatch(source, /__gekichinUiOnly|installUiOnlyState/);
  assert.match(packageJson.scripts.build, /^tsc --noEmit && vite build$/);
  assert.doesNotMatch(packageJson.scripts.build, /vite\.ui\.config/);
});
