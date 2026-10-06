import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { StaticAssets } from './network-policy';

export const observerAppend = '\nimport { installPauseSafetyObserver } from "../browser-tests/pause-safety-observer";\ninstallPauseSafetyObserver(session, controls);\n';

/** A separate, in-memory test bundle. The production build and src/ stay untouched. */
export async function buildPauseSafetyAssets(root = process.cwd()): Promise<StaticAssets> {
  // Load the installed build tool, not its optional CSS-plugin type graph.
  // Treat its output as unknown and validate every byte container below.
  const viteURL = pathToFileURL(createRequire(import.meta.url).resolve('vite')).href;
  const { build } = await import(viteURL) as { build(options: Record<string, unknown>): Promise<unknown> };
  let observedEntries = 0;
  const built = await build({
    root, configFile: false, base: './', publicDir: false, logLevel: 'warn',
    build: { write: false, minify: false, sourcemap: false },
    plugins: [{ name: 'test-only-read-only-pause-observer', enforce: 'pre',
      transform(source: string, id: string) {
        if (id !== resolve(root, 'src/main.ts')) return;
        observedEntries += 1;
        // Append only: no replacement of frame, pause, resume, input, or physics.
        return { code: source + observerAppend, map: null };
      },
    }],
  });
  if (observedEntries !== 1) throw new Error(`Expected one unchanged main entry, observed ${observedEntries}`);
  const assets: StaticAssets = new Map();
  for (const result of Array.isArray(built) ? built : [built]) {
    if (!result || typeof result !== 'object' || !('output' in result) || !Array.isArray(result.output)) throw new Error('Expected a non-writing static build');
    for (const output of result.output) {
      if (!output || typeof output !== 'object' || typeof output.fileName !== 'string') throw new Error('Invalid build asset');
      const extension = output.fileName.match(/\.(html|js|css)$/)?.[1];
      if (!extension) throw new Error(`Unexpected test asset: ${output.fileName}`);
      const bytes: unknown = output.type === 'chunk' ? output.code : output.type === 'asset' ? output.source : null;
      if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) throw new Error(`Invalid static bytes: ${output.fileName}`);
      const body = Buffer.from(bytes);
      assets.set(`/${output.fileName}`, {
        resourceType: extension === 'html' ? 'document' : extension === 'js' ? 'script' : 'stylesheet',
        contentType: extension === 'html' ? 'text/html' : extension === 'js' ? 'text/javascript' : 'text/css', body,
      });
    }
  }
  const index = assets.get('/index.html');
  if (!index) throw new Error('The observed bundle has no index document');
  assets.set('/', index);
  return assets;
}
