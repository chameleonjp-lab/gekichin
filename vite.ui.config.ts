import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

export const UI_ONLY_MAIN_SOURCE_SHA256 = 'd95fe53844684bc5d6e299b53590c70a48494485b0d78e0afba40996d82e8b00';
export const UI_ONLY_MAIN_ANCHORS = [
  'function renderUi(focus = false): void {',
  'function showReport(report: CombatReport): void {',
  'function updateHud(): void {',
  'animation = requestAnimationFrame(frame);\nif (import.meta.hot) import.meta.hot.dispose(dispose);',
] as const;

const projectRoot = dirname(fileURLToPath(import.meta.url));
const mainPath = resolve(projectRoot, 'src/main.ts');

export function validateUiOnlyMainSource(id: string, source: string, root = projectRoot): void {
  const expectedPath = resolve(root, 'src/main.ts');
  const actualPath = resolve(id.split('?')[0].split('#')[0]);
  if (actualPath !== expectedPath) throw new Error(`UI-only adapter path mismatch: ${actualPath}`);
  for (const anchor of UI_ONLY_MAIN_ANCHORS) {
    if (source.split(anchor).length - 1 !== 1) throw new Error(`UI-only adapter anchor mismatch: ${anchor}`);
  }
  if (source.includes('__gekichinUiOnly') || source.includes('installUiOnlyState')) {
    throw new Error('UI-only adapter is already present in the product entry source');
  }
  const actualHash = createHash('sha256').update(source).digest('hex');
  if (actualHash !== UI_ONLY_MAIN_SOURCE_SHA256) {
    throw new Error(`UI-only adapter source hash mismatch: ${actualHash}`);
  }
}

export function createUiOnlyMainPlugin(root = projectRoot): Plugin {
  const expectedPath = resolve(root, 'src/main.ts');
  return {
    name: 'gekichin-ui-only-main-state-adapter',
    apply: 'serve',
    enforce: 'pre',
    configureServer() {
      const source = readFileSync(expectedPath, 'utf8');
      validateUiOnlyMainSource(expectedPath, source, root);
    },
    transform(source, id) {
      const actualPath = resolve(id.split('?')[0].split('#')[0]);
      if (actualPath !== expectedPath) {
        if (actualPath.endsWith(`${sep}src${sep}main.ts`)) {
          throw new Error(`UI-only adapter path mismatch: ${actualPath}`);
        }
        return null;
      }
      validateUiOnlyMainSource(actualPath, source, root);
      return `${source}\nimport { installUiOnlyState } from '/browser-tests/ui-only-state.ts';\ninstallUiOnlyState({\n  app, session, guide, settings, renderUi, updateHud, showReport, consumeEvents, fitHud,\n  stopWorld: () => { cancelAnimationFrame(animation); animation = 0; controls.clear(); stepper.reset(); audio.setActive(false); },\n  resetPresentation: () => { sinking = false; sinkingElapsed = 0; shownReport = null; noticeUntilTick = 0; lastEventSequence = 0; },\n  drawStaticFrame: async (sinkSeconds = 0) => {\n    if (!scene || !graphicsAvailable) return false;\n    try { await scene.ready; } catch { return false; }\n    sceneReady = true;\n    scene.render(session.player, session.mode, session.tick, session, sinkSeconds);\n    return true;\n  },\n  rendererStatus: () => ({\n    available: graphicsAvailable, ready: sceneReady,\n    canvas: !!app.querySelector('#flight-canvas'),\n  }),\n});`;
    },
  };
}

export default defineConfig({
  root: projectRoot,
  base: './',
  plugins: [createUiOnlyMainPlugin()],
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  build: { sourcemap: false },
});
