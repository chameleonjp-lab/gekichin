import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Request } from '@playwright/test';

type RequestMetadata = Pick<Request, 'url' | 'method' | 'resourceType'>;
export type StaticAsset = { resourceType: string; contentType: string; body: Buffer };
export type StaticAssets = Map<string, StaticAsset>;
export type BlockedRequest = { method: string; url: string; resourceType: string };

// Load the unchanged production build. Serving its exact bytes in this one
// context avoids Vite's development WebSocket and every HTTP redirect entirely.
// A missing build is an error, never an empty allowlist or a skipped assertion.
export function knownStaticAssets(root = process.cwd()): StaticAssets {
  const dist = resolve(root, 'dist');
  const index = { resourceType: 'document', contentType: 'text/html', body: readFileSync(resolve(dist, 'index.html')) };
  const assets: StaticAssets = new Map([['/', index], ['/index.html', index]]);
  for (const file of readdirSync(resolve(dist, 'assets'), { withFileTypes: true })) {
    if (!file.isFile()) continue;
    const extension = file.name.match(/\.(js|css)$/)?.[1];
    if (!extension) continue;
    assets.set(`/assets/${file.name}`, {
      resourceType: extension === 'js' ? 'script' : 'stylesheet',
      contentType: extension === 'js' ? 'text/javascript' : 'text/css',
      body: readFileSync(resolve(dist, 'assets', file.name)),
    });
  }
  return assets;
}

export function permitsStaticRequest(request: RequestMetadata, baseURL: string, assets: StaticAssets): boolean {
  if (request.method() !== 'GET') return false;
  let url: URL;
  try { url = new URL(request.url()); } catch { return false; }
  const base = new URL(baseURL);
  if (url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) return false;
  return assets.get(url.pathname)?.resourceType === request.resourceType();
}

export async function guardStaticTraffic(context: Pick<BrowserContext, 'route' | 'routeWebSocket'>, baseURL: string, assets = knownStaticAssets()) {
  const blocked: BlockedRequest[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    if (!permitsStaticRequest(request, baseURL, assets)) {
      blocked.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() });
      await route.abort('blockedbyclient');
      return;
    }
    const asset = assets.get(new URL(request.url()).pathname)!;
    // Never continue/fetch. Exact local bytes cannot redirect past this guard.
    await route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body });
  });
  await context.routeWebSocket('**/*', async socket => {
    blocked.push({ method: 'WEBSOCKET', url: socket.url(), resourceType: 'websocket' });
    // Never call connectToServer: the attempted socket remains local.
    await socket.close({ code: 1008, reason: 'Static assets only' });
  });
  return blocked;
}
