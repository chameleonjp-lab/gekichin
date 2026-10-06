import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { guardStaticTraffic, permitsStaticRequest, type StaticAssets } from '../browser-tests/network-policy';

const baseURL = 'http://127.0.0.1:4177';
const asset = (resourceType: string, contentType: string, text: string) => ({resourceType, contentType, body: Buffer.from(text)});
const assets: StaticAssets = new Map([
  ['/', asset('document', 'text/html', '<html></html>')],
  ['/assets/index-fixed.js', asset('script', 'text/javascript', 'void(0);')],
  ['/assets/index-fixed.css', asset('stylesheet', 'text/css', 'body{}')],
]);
const metadata = (path: string, method = 'GET', type = 'fetch') => ({
  url: () => path.startsWith('/') ? baseURL + path : path,
  method: () => method,
  resourceType: () => type,
});

test('R84 accepts known static GET assets only, not same-origin APIs or writes', () => {
  for (const request of [metadata('/', 'GET', 'document'), metadata('/assets/index-fixed.js', 'GET', 'script'), metadata('/assets/index-fixed.css', 'GET', 'stylesheet')]) {
    assert.equal(permitsStaticRequest(request, baseURL, assets), true, request.url());
  }
  for (const request of [
    metadata('/telemetry', 'POST'), metadata('/api/session'),
    metadata('/src/ranking/submit', 'POST'), metadata('/src/ranking/resume', 'POST'),
    metadata('/assets/index-fixed.js', 'POST', 'script'), metadata('/assets/index-fixed.js', 'HEAD', 'script'),
    metadata('/assets/index-fixed.js'), metadata('/assets/unknown.js', 'GET', 'script'),
    metadata('/assets/index-fixed.js?telemetry=1', 'GET', 'script'),
    metadata('https://network-probe.invalid/assets/index-fixed.js', 'GET', 'script'),
    metadata('http://127.0.0.1:4178/assets/index-fixed.js', 'GET', 'script'),
    metadata('http://name:password@127.0.0.1:4177/assets/index-fixed.js', 'GET', 'script'),
    metadata('data:text/javascript,void(0)', 'GET', 'script'),
    metadata('ws://127.0.0.1:4177/', 'GET', 'websocket'), metadata('not a URL'),
  ]) assert.equal(permitsStaticRequest(request, baseURL, assets), false, `${request.method()} ${request.url()}`);
});

async function fixture() {
  let httpHandler: (route: any) => Promise<void>;
  let socketHandler: (socket: any) => Promise<void>;
  const context = {
    async route(pattern: string, handler: typeof httpHandler) { assert.equal(pattern, '**/*'); httpHandler = handler; },
    async routeWebSocket(pattern: string, handler: typeof socketHandler) { assert.equal(pattern, '**/*'); socketHandler = handler; },
  };
  const blocked = await guardStaticTraffic(context as any, baseURL, assets);
  return { blocked, http: (route: any) => httpHandler(route), websocket: (socket: any) => socketHandler(socket) };
}

test('forbidden request metadata aborts before any sending API can run', async () => {
  const f = await fixture();
  for (const request of [metadata('/telemetry', 'POST'), metadata('/api/session'), metadata('https://network-probe.invalid/collect', 'POST')]) {
    let aborted = false;
    await f.http({ request: () => request, abort: async (reason: string) => { assert.equal(reason, 'blockedbyclient'); aborted = true; },
      fetch: () => assert.fail('forbidden requests must never be sent'), continue: () => assert.fail('never continue'), fulfill: () => assert.fail('never fulfill a forbidden request') });
    assert.equal(aborted, true);
  }
  assert.equal(f.blocked.length, 3);
});

test('known assets use exact local bytes without HTTP or redirect-capable fetch/continue', async () => {
  const f = await fixture();
  for (const [path, expected] of assets) {
    let fulfilled = false;
    await f.http({ request: () => metadata(path, 'GET', expected.resourceType),
      fetch: () => assert.fail('no network or redirects'), continue: () => assert.fail('no network or redirects'), abort: () => assert.fail('known static bytes should load'),
      fulfill: async (options: unknown) => { assert.deepEqual(options, {status:200, contentType:expected.contentType, body:expected.body}); fulfilled = true; } });
    assert.equal(fulfilled, true);
  }
  assert.deepEqual(f.blocked, []);
});

test('WebSocket fixtures close locally and never connect to a server', async () => {
  const f = await fixture(); let closed = false;
  await f.websocket({ url: () => 'wss://network-probe.invalid/socket', close: async () => { closed = true; }, connectToServer: () => assert.fail('no WebSocket traffic') });
  assert.equal(closed, true); assert.equal(f.blocked.length, 1); assert.equal(f.blocked[0].method, 'WEBSOCKET');
});

test('R84 installs context guard before navigation and blocks service workers', () => {
  const spec = readFileSync('browser-tests/p1-flow.spec.ts', 'utf8');
  assert.match(spec, /serviceWorkers: 'block'/);
  assert.match(spec, /guardStaticTraffic\(context, baseURL!\)/);
  assert.match(spec, /expect\(blockedRequests,[^\n]*\)\.toEqual\(\[\]\)/);
  const abortedTest = spec.slice(spec.indexOf("test('an aborted combat"), spec.indexOf("test('an explicit visibilitychange"));
  assert.match(abortedTest, /await context\.close\(\)/);
  assert.ok(abortedTest.indexOf('await context.close()') < abortedTest.indexOf('expect(blockedRequests,'));
  assert.match(abortedTest, /await startWithControlledFrames\(page\)/);
  assert.ok(abortedTest.indexOf('guardStaticTraffic(') < abortedTest.indexOf('await startWithControlledFrames(page)'));
});
