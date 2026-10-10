import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('src/main.ts');
const css = read('src/common-shell.css');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const between = (start: string, end: string) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `${start} boundary exists`);
  return source.slice(a, b);
};
// These hashes come from the unchanged de500c3e base, not candidate output.
test('common parity changes no main runtime beyond the seven explicit display substitutions', () => {
  let runtime = source.slice(source.indexOf('const element = '));
  const approved: [string, string][] = [
    ["element('#speed').textContent = `${Math.round(session.player.speed * 3.6)} km/h`;", "element('#speed').textContent = `${session.player.speed.toFixed(0)} m/s`;"],
    ["guide: 'ルールと操作方法を開くため停止", "guide: '遊び方を開くため停止"],
    ["element('#hud-mode').textContent = session.mode === 'easy' ? 'イージー' : 'ノーマル';", "element('#hud-mode').textContent = session.mode.toUpperCase();"],
    ['「飛行を再開」で再開', '「作戦を再開する」で再開'],
    ["session.report.mode === 'easy' ? 'イージー' : 'ノーマル'", "session.report.mode === 'easy' ? 'Easy' : 'Normal'"],
    ['「操作設定」と「ルールと操作方法」は確認できます。', '操作設定と遊び方は確認できます。'],
    ["    const actionLabel = audio.isEnabled ? '音をオフにする' : '音をオンにする';\n    item.textContent = item.id === 'home-sound' ? actionLabel : audio.isEnabled ? '音 ON' : '音 OFF';\n    item.setAttribute('aria-label', actionLabel); item.setAttribute('aria-pressed', String(audio.isEnabled));", "    item.textContent = audio.isEnabled ? '音 ON' : '音 OFF'; item.setAttribute('aria-pressed', String(audio.isEnabled));"],
  ];
  for (const [current, original] of approved) {
    assert.equal(runtime.split(current).length - 1, 1, current);
    runtime = runtime.replace(current, original);
  }
  assert.equal(hash(runtime), 'af420d1e1e31b43cfea2ddceb44517e5ed1fc4394da0d13c9ebbcd8a6e54f15f');
});

test('combat HUD structure, preparation and sinking remain the fixed-base templates', () => {
  const hud = between('  <section id="hud"', '  <section id="paused"')
    .replace('id="speed">396 km/h', 'id="speed">110 m/s')
    .replace('id="hud-mode">イージー', 'id="hud-mode">EASY')
    .replace(' aria-label="音をオンにする"', '');
  assert.equal(hash(hud), '9c3c14567d5ac7d89e4882777d966047e0029a9048e9459e44be60e2f8b2dc99');
  assert.equal(hash(between('  <section id="preparing"', '  <section id="hud"')), '68cb7342c7ed4c9fc378ace1dd6220337793c80e4d08833ce3161c55d581e5d4');
  assert.equal(hash(between('  <section id="sinking"', '  <section id="result"')), 'b0c27b71f0e407e64679fa8a3c13dd4492da79e9ad8871d09d15968331625bfa');
});

test('rules preserve all G-specific prose with only Easy/Normal translation', () => {
  const prose = between('      <h3>作戦の目標</h3>', '    <footer><button id="guide-done"')
    .replaceAll('イージー', 'Easy').replaceAll('ノーマル', 'Normal');
  assert.equal(hash(prose), 'f13ae56026b2e573cfc347833efe94d56b784801b7aadc9f8c794a7635d65c11');
  assert.match(source, /class="guide-content" tabindex="0" role="region" aria-label="ルールと操作方法の本文"/);
  assert.match(source, /aria-label="説明を閉じる"/);
  assert.match(source, /id="guide-done"[^>]*>元の画面へ戻る/);
});

test('home presents the K shell while retaining G mission and both mode values', () => {
  const home = between('  <main id="home"', '  <section id="preparing"');
  for (const text of ['brand-line', 'home-copy', 'briefing', 'mission-data', 'home-actions', 'home-footer', '超大型母艦一隻', '砲台100基を全破壊', '主砲20・機銃80', '味方総残機', '>50<', '自機を含む', '同時出撃', '>8<', '残機があれば復帰', '端末内ベスト']) assert.ok(home.includes(text), text);
  assert.match(home, /name="mode" value="easy" checked[^]*?<b>イージー<\/b>/);
  assert.match(home, /name="mode" value="normal"[^]*?<b>ノーマル<\/b>/);
  assert.ok(home.indexOf('id="start"') < home.indexOf('id="home-guide"'));
  assert.ok(home.indexOf('id="home-guide"') < home.indexOf('id="home-controls"'));
  assert.match(home, /id="home-sound"[^>]*aria-pressed="false"[^>]*>音をオンにする/);
});

test('pause and result keep all original operations and G result fields', () => {
  const paused = between('  <section id="paused"', '  <section id="sinking"');
  for (const text of ['一時停止', '飛行を再開', '作戦を中断する', 'ホームへ戻る', 'ルールと操作方法', '操作設定', 'data-sound']) assert.ok(paused.includes(text), text);
  assert.doesNotMatch(paused, /はじめから出撃/);
  const result = between('  <section id="result"', '  <dialog id="guide"');
  for (const id of ['result-title', 'result-outcome', 'result-time', 'result-score', 'result-mode', 'result-components', 'result-details', 'result-best', 'save-status', 'restart', 'result-home', 'result-controls']) assert.ok(result.includes(`id="${id}"`), id);
  assert.match(result, /id="restart"[^>]*>もう一度出撃/);
  assert.ok(result.indexOf('id="restart"') < result.indexOf('id="result-home"'));
  assert.ok(result.indexOf('id="result-home"') < result.indexOf('id="result-controls"'));
  assert.ok(result.includes('data-guide') && result.includes('data-sound'));
  assert.match(source, /session\.finish\('aborted'\) && session\.report\) showReport\(session\.report\)/);
});

test('shell CSS stays scoped, with only the combat notice moved clear of flight controls', () => {
  const text = css.replace(/\/\*[^]*?\*\//g, '');
  const noticeSelector = '#app:not([data-large-text="true"]) #hud #combat-notice';
  let rules = 0;
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    if (selector.startsWith('@')) { assert.match(selector, /^@media /); continue; }
    for (const part of selector.split(',')) {
      const normalized = part.trim().replace(/\s+/g, ' ');
      assert.ok(normalized === noticeSelector || /^#(?:home|paused|result|guide)(?:\s|[.:#]|$)/.test(normalized), normalized);
    }
    rules += 1;
  }
  assert.ok(rules > 20);
  assert.doesNotMatch(text, /:root|#scene|#flight|#combat-panel|#throttle|#fire(?![\w-])|#loop(?![\w-])|#pause(?![\w-])|#control-settings|@import|@font-face/);
  assert.match(text, /min-height: 44px/);
  assert.match(text, /orientation: landscape/);
  const noticeRules = [...text.matchAll(/#app:not\(\[data-large-text="true"\]\) #hud #combat-notice\s*\{([^}]*)\}/g)];
  assert.equal(noticeRules.length, 2);
  assert.match(noticeRules[0]?.[1] ?? '', /top:\s*40%;/);
  assert.match(noticeRules[1]?.[1] ?? '', /top:\s*30%;[\s\S]*left:\s*30\.5%;[\s\S]*width:\s*min\(45%, 520px\);[\s\S]*transform:\s*none/);
  assert.doesNotMatch(noticeRules.map(rule => rule[1]).join('\n'), /z-index|display\s*:|visibility\s*:/i);
});

test('all original template IDs remain unique and reachable by existing bindings', () => {
  const ids = [...source.slice(0, source.indexOf('const element = ')).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const required = ["scene", "flight-surface", "home", "game-title", "best-record", "home-key-guide", "start", "home-controls", "home-guide", "render-note", "preparing", "preparing-title", "cancel-preparing", "hud", "hud-mode", "pause", "elapsed", "speed", "altitude", "combat-panel", "score", "destroyed", "main-left", "mg-left", "fleet-left", "fleet-active", "player-hp", "ammunition", "reload", "accuracy", "hit-breakdown", "target-status", "boundary-status", "respawn-status", "face-guide", "combat-notice", "fire-status", "fire", "loop", "loop-status", "throttle", "throttle-layout-note", "throttle-help", "paused", "pause-title", "pause-reason", "resume", "pause-controls", "finish", "pause-home", "sinking", "sinking-title", "skip-sinking", "result", "result-title", "result-outcome", "result-time", "result-score", "result-mode", "result-components", "result-details", "result-best", "save-status", "restart", "result-controls", "result-home", "guide", "guide-title", "guide-close", "guide-keys", "guide-done"];
  for (const id of required) assert.ok(ids.includes(id), id);
});

test('all 29 other source files including root CSS, settings, scene and gameplay are fixed-base bytes', () => {
  const expected: Record<string, string> = {
    "src/aircraft-weapons.ts": "9eb8965f32a3346b1eb24f7a31e83239c8082cf194f21ae476b5e783b72af30a",
    "src/aircraft.ts": "1a9c18f93e5a48869882b2aa2946cdeb352dc4a8acd76b4fd9beade8ded621d5",
    "src/audio.ts": "99057cd1e53413459802ada6d442a31de7feb8ee91008df540901b085d2731ab",
    "src/boundary-guidance.ts": "7deac567a22cf2cf64693bb6777adf3e0491cc0d213ac6ecc53d9c5cfc7ebb21",
    "src/collision-world.ts": "7ae49cac6c5a7d818c078d445f77f3053677d3e8bd2a659a5d383c786f7de519",
    "src/combat-types.ts": "24f46be13ddb2a8e9dc3ec4a8b0b16f22cb530f140794bbc71c1925b09c98bd0",
    "src/control-obstacles.ts": "1717aefae64cd5b9b1d33a27c0cd3cccb4505cd4e07fc71b48c7e02c2f32abf2",
    "src/control-settings.css": "a1f847ead95f731cf1f4f127bd3de82581d4fe3aaebd0b388cf72ddf3f438618",
    "src/control-settings.ts": "005d66d0af205faf91c64c9aedfd72920bcb997b8867e9c90f8af297dc3f6726",
    "src/dialog-focus.ts": "86d631a4d618558e1ca671004c12ccc1fbdfe75516e6c5d04f962acd2c5e1996",
    "src/fleet.ts": "de29a3e7e875def5a69a569803e2cb35d151c27c7a87054a69f5d9a576d9ca90",
    "src/flight-assist.ts": "efebdbf59bf40b715d6e33f4bbdea60bdfe4e9d2ffaee0f1b37e2887ec9ac413",
    "src/flight-view.ts": "b8a5790501503799b1cc43e634d5ac3b6545fcaba477db970b61a5d2fbb3eb32",
    "src/flight.ts": "41675b4e1f3bfecee95dad5b6ee2bebbd3930545ed35e6fa8260fca25a4b49b3",
    "src/game-state.ts": "378bc600e3b32a598ef88d1ab93879eb7ba23524d130e9e17ab3338212cecd3e",
    "src/input.ts": "569455763b08fabb046145aa21ed473aa55de5ac4c481eb884b067263b925c7a",
    "src/keyboard-settings.ts": "cdf9495e1e8e68c9c7c75a8210ab44a7dcb2b2c94c27506d4615fd3ee90c86f6",
    "src/mothership-layout.ts": "8ea6c7f0d34587ccfd51d028d2c96e4004d5d0c22055eb54c30f3887c6393937",
    "src/mothership.ts": "10eb613bce21c94115abe3665bb44d677059b8293e97f4307adae2b813a71466",
    "src/rules.ts": "897ed57877f1986073e51efbfa96448409c89574959b6885b5e6924200f7e414",
    "src/scene.ts": "6dc42220163e8abfe10935994ddb316622dfa2b341ced773b3d7acd787552635",
    "src/scoring.ts": "95ee5ca3bac53b1e60b5c2cd804f35b7b7c91148851b5fcf99178c8aafd86494",
    "src/settings-storage.ts": "dcc3d156e6872f3876624d285bb327c421073785afd6e00ada1f83a6f33cfb28",
    "src/style.css": "7b26f83f5bf1881ef53bd9e8b6268fc7fc23db71f0b3fef10362620b41748c55",
    "src/throttle-control.ts": "99b45ef5b506ee7a051f80152bf3ce1dcf7a5f521a7c446f6021e76a67163466",
    "src/throttle-lever.ts": "e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0",
    "src/turret-combat.ts": "fd9cf7163da2bb89bd3a755d35220f0720e33eb2b1bc5def7ed2b416c56a2e71",
    "src/types.ts": "b950b23044ab0520c14cfbcbe7edf7e021652dcffdd5f455d1230e2b26015c1f",
    "src/wingman-ai.ts": "06f7f12d1cc7772b448aec5cb60af1c13901a6b678c8220d3591eff9be78c55f"
};
  for (const [path, expectedHash] of Object.entries(expected)) assert.equal(hash(read(path)), expectedHash, path);
});
