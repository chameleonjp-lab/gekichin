import './style.css';
import './control-settings.css';
import { FlightControls, type FlightControlButtons } from './input';
import { ControlSettings } from './control-settings';
import { ControlInputPresentation, KeyboardSettings, isKeyboardEditingTarget } from './keyboard-settings';
import { containDialogTabFocus } from './dialog-focus';
import { FlightSession, FixedStepper } from './game-state';
import { FlightScene } from './scene';
import { FlightAudio } from './audio';
import { FIXED_HZ } from './rules';
import type { GameMode, PauseReason } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="scene" class="scene"></div>
  <div id="flight-surface" class="flight-surface" aria-hidden="true"></div>
  <main id="home" class="overlay">
    <section class="panel home-panel" aria-labelledby="game-title">
      <p class="eyebrow">ゼロ：シリーズ</p>
      <h1 id="game-title">ゲキチン</h1>
      <p class="tagline">巨艦を、全周から。</p>
      <p class="prototype-badge">P1 · 飛行操作プロトタイプ</p>
      <p class="objective">目標は超大型母艦の<strong>砲台100基を全破壊</strong>。味方50機は自機込みの総残機、同時出撃は8機。残機があれば復帰します。</p>
      <p class="scope-note">現在は飛行・操作設定・停止を確認できます。母艦は仮外形で、砲台戦・僚機・銃撃・勝敗・得点は準備中です。</p>
      <fieldset class="mode-picker">
        <legend>操縦モード</legend>
        <label><input type="radio" name="mode" value="easy" checked /><span><b>Easy</b><small>巡航・シンプル操作</small></span></label>
        <label><input type="radio" name="mode" value="normal" /><span><b>Normal</b><small>手動の加速・減速</small></span></label>
      </fieldset>
      <p id="home-key-guide" class="key-guide"></p>
      <p class="touch-guide">タッチ／マウス：触れた位置からドラッグして操縦</p>
      <button id="start" class="primary" type="button">飛行を確認する <span aria-hidden="true">→</span></button>
      <div class="utility-grid">
        <button id="home-controls" data-settings type="button">操作設定</button>
        <button id="home-guide" data-guide type="button">遊び方</button>
        <button data-sound type="button" aria-pressed="false">音 OFF</button>
      </div>
      <p id="render-note" class="render-note" data-graphics-status role="status" hidden></p>
    </section>
  </main>
  <section id="preparing" class="overlay" aria-labelledby="preparing-title" hidden>
    <div class="panel compact-panel"><p class="eyebrow">FLIGHT CHECK</p><h2 id="preparing-title">飛行を準備しています</h2><p>準備時間は確認時計に含めません。</p><button id="cancel-preparing" type="button">ホームへ戻る</button></div>
  </section>
  <section id="hud" class="hud" aria-label="飛行情報" hidden>
    <div class="hud-top">
      <div class="flight-label"><b>飛行確認</b><span id="hud-mode">EASY</span></div>
      <div class="hud-utility"><button data-sound type="button" aria-pressed="false">音 OFF</button><button id="pause" type="button" aria-label="一時停止">Ⅱ</button></div>
    </div>
    <div class="metrics">
      <div><small>飛行時間</small><output id="elapsed">0.00 s</output></div>
      <div><small>速度</small><output id="speed">110 m/s</output></div>
      <div><small>高度</small><output id="altitude">1,000 m</output></div>
    </div>
    <div class="aim-circle" aria-hidden="true"><i></i></div>
    <p class="flight-scope">母艦は仮外形 · 砲台戦は準備中</p>
    <p id="fire-status" class="fire-status" hidden>射撃入力：OFF（発射未実装）</p>
    <button id="fire" data-flight-control="fire" type="button" aria-pressed="false"><b>射撃</b><small>入力確認</small></button>
    <button id="loop" data-flight-control="loop" type="button" aria-pressed="false" aria-disabled="false"><b>宙返り</b><small id="loop-status">L</small></button>
    <div id="throttle" class="throttle-lever" data-flight-control="throttle" role="slider" tabindex="0" aria-label="速度レバー" aria-describedby="throttle-help" aria-orientation="vertical" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="保持（速度を維持）">
          <span class="throttle-up">加速</span><span class="throttle-center">保持</span><span class="throttle-down">減速</span><i class="throttle-handle" aria-hidden="true"></i>
        </div>
        <p id="throttle-layout-note" class="throttle-layout-note" role="status" hidden>速度レバーの配置が重なっています。画面を回転するか、操作設定で位置や大きさを調整してください。</p>
        <span id="throttle-help" class="visually-hidden">上で加速、下で減速。離すと中央に戻り、調整した速度を保持します。フォーカス中は矢印キーで調整できます。</span>
  </section>
  <section id="paused" class="overlay" aria-labelledby="pause-title" hidden>
    <div class="panel compact-panel">
      <p class="eyebrow">PAUSED</p><h2 id="pause-title">停止中</h2>
      <p id="pause-reason">飛行と確認時計を停止しています。</p>
      <button id="resume" class="primary" type="button">飛行を再開する</button>
      <div class="utility-grid"><button id="pause-controls" data-settings type="button">操作設定</button><button data-guide type="button">遊び方</button><button data-sound type="button" aria-pressed="false">音 OFF</button></div>
      <button id="finish" class="secondary" type="button">飛行確認を終了する</button>
      <button id="pause-home" class="text-button" type="button">ホームへ戻る</button>
    </div>
  </section>
  <section id="result" class="overlay" aria-labelledby="result-title" hidden>
    <div class="panel compact-panel">
      <p class="eyebrow">FLIGHT REPORT</p><h2 id="result-title">飛行確認を終了</h2>
      <p class="graphics-status" data-graphics-status role="status" hidden></p>
      <p class="prototype-badge">中断 · 飛行プロトタイプ</p>
      <p class="result-time"><output id="result-time">0.00</output><span>秒</span></p>
      <p id="result-mode"></p>
      <p class="scope-note">戦闘結果ではありません。撃沈判定・勝敗・得点・記録保存は準備中です。</p>
      <button id="restart" class="primary" type="button">もう一度飛行する</button>
      <div class="utility-grid"><button id="result-controls" data-settings type="button">操作設定</button><button data-guide type="button">遊び方</button><button data-sound type="button" aria-pressed="false">音 OFF</button></div>
      <button id="result-home" class="secondary" type="button">ホームへ戻る</button>
    </div>
  </section>
  <dialog id="guide" aria-labelledby="guide-title">
    <header class="settings-header"><div><p class="eyebrow">FLIGHT GUIDE</p><h2 id="guide-title">遊び方</h2></div><button id="guide-close" class="settings-close" type="button" aria-label="遊び方を閉じる">×</button></header>
    <div class="guide-content">
      <p class="graphics-status" data-graphics-status role="status" hidden></p>
      <p class="prototype-badge">現在はP1の飛行確認段階です</p>
      <h3>作戦の目標</h3><p>超大型母艦の主砲20基・大型機銃80基、合計100基を全破壊します。味方50機は自機を含み、同時出撃は8機。残機があれば復帰します。</p>
      <h3>飛行の操作</h3><p>画面のどこからでも、触れた位置を基準にドラッグできます。右へドラッグで右旋回、上へドラッグで上昇。離すと操縦入力を解除します。</p><p id="guide-keys"></p>
      <p>Easyは巡航速度、宙返りボタン1つ。Normalは射撃・宙返りボタンと速度レバー。上で加速、下で減速、離すと中央に戻り速度を保持します。宙返り中に新しく操縦すると中止できます。</p>
      <h3>現在確認できること</h3><p>機体の飛行、カメラ、操縦モード、操作設定、停止・再開。Normalの射撃は入力表示のみで、弾は発射されません。母艦には衝突・砲台・HPがありません。照準補助と自動射撃は砲台・遮蔽の実装後に接続します。</p>
      <h3>設定と停止</h3><p>設定は保存後に適用されます。「変更を破棄」やEscで編集を取り消せます。設定や説明を閉じても飛行は停止したままです。音は初期OFF、ONで飛行中のプロペラ音を確認できます。</p>
    </div>
    <footer><button id="guide-done" class="primary" type="button">閉じる</button></footer>
  </dialog>`;

const element = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
const session = new FlightSession();
const stepper = new FixedStepper();
const keyboard = new KeyboardSettings();
const inputPresentation = new ControlInputPresentation();
const audio = new FlightAudio();
const abort = new AbortController();
const buttons: FlightControlButtons = {
  fire: element('#fire'), loop: element('#loop'), throttle: element('#throttle'),
};
const guide = element<HTMLDialogElement>('#guide');
const controls = new FlightControls(element('#flight-surface'), buttons,
  () => session.phase === 'playing' && !guide.open && !settings.isOpen, keyboard);
const settings = new ControlSettings(buttons, keyboard, inputPresentation);
let scene: FlightScene | null = null;
let graphicsAvailable = false;
let animation = 0;
let lastShownTick = -1;
let lastFire = false;
let guideReturnFocus: HTMLElement | null = null;
let pendingPreparation: number | null = null;

const reasonText: Record<PauseReason, string> = {
  manual: '飛行と確認時計を停止しています。',
  settings: '操作設定のため停止しています。再開はボタンから行ってください。',
  guide: '遊び方を開くため停止しています。再開はボタンから行ってください。',
  hidden: '画面が非表示になったため停止しました。明示的に再開してください。',
  focus: 'フォーカスが外れたため停止しました。明示的に再開してください。',
  gap: '処理が2秒以上停止したため飛行を止めました。明示的に再開してください。',
  webgl: '3D描画が停止しました。描画が復旧した後、明示的に再開してください。',
};

function selectedMode(): GameMode { return element<HTMLInputElement>('input[name="mode"]:checked').value as GameMode; }

function renderUi(focus = false): void {
  app.dataset.phase = session.phase;
  app.dataset.mode = session.mode;
  for (const phase of ['home', 'preparing', 'paused', 'result']) element(`#${phase}`).hidden = session.phase !== phase;
  const playing = session.phase === 'playing';
  element('#hud').hidden = !playing;
  element('#flight-surface').hidden = !playing;
  for (const name of ['fire', 'throttle'] as const) buttons[name]!.hidden = session.mode !== 'normal';
  element('#fire-status').hidden = session.mode !== 'normal';
  element('#hud-mode').textContent = session.mode.toUpperCase();
  element('#home-key-guide').textContent = keyboard.describe(selectedMode());
  element('#guide-keys').textContent = keyboard.describe(session.phase === 'home' ? selectedMode() : session.mode);
  element<HTMLButtonElement>('#start').disabled = !graphicsAvailable;
  element<HTMLButtonElement>('#restart').disabled = !graphicsAvailable;
  element<HTMLButtonElement>('#resume').disabled = !graphicsAvailable;
  if (session.pauseReason) element('#pause-reason').textContent = session.pauseReason === 'webgl' && graphicsAvailable
    ? '3D描画が復旧しました。「飛行を再開する」で再開できます。' : reasonText[session.pauseReason];
  if (session.report) {
    element('#result-time').textContent = (session.report.endTick / FIXED_HZ).toFixed(2);
    element('#result-mode').textContent = `${session.report.mode === 'easy' ? 'Easy' : 'Normal'} · 飛行確認のみ`;
  }
  audio.setActive(playing);
  if (focus) {
    const target = { home: '#start', preparing: '#cancel-preparing', playing: '#flight-surface', paused: '#resume', result: '#restart' }[session.phase];
    if (playing) (document.activeElement as HTMLElement | null)?.blur();
    else element(target).focus({ preventScroll: true });
  }
}

function pause(reason: PauseReason): void {
  controls.clear(); stepper.reset();
  if (session.phase === 'paused' && reason === 'webgl') {
    session.pauseReason = reason; renderUi(); return;
  }
  if (session.pause(reason)) renderUi(true);
}

function start(mode: GameMode): void {
  if (!graphicsAvailable || document.hidden) return;
  const operationId = session.prepare(mode);
  if (operationId === null) return;
  controls.clear(); controls.setMode(mode); settings.setActiveMode(mode); stepper.reset(); lastShownTick = -1; lastFire = false;
  renderUi(true);
  // Preparation is visible for one rendered frame; its clock is never active.
  pendingPreparation = requestAnimationFrame(() => {
    pendingPreparation = requestAnimationFrame(() => {
      pendingPreparation = null;
      if (!graphicsAvailable || document.hidden || !document.hasFocus()) { goHome(); return; }
      if (session.begin(operationId)) { stepper.reset(); renderUi(true); }
    });
  });
}

function goHome(): void {
  if (pendingPreparation !== null) cancelAnimationFrame(pendingPreparation);
  pendingPreparation = null;
  controls.clear(); stepper.reset(); session.home(); lastShownTick = -1; lastFire = false;
  for (const radio of app.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.checked = radio.value === session.mode;
  renderUi(true);
}

function openSettings(button: HTMLElement): void {
  if (session.phase === 'playing') pause('settings');
  controls.clear();
  const allowBoth = session.phase === 'home' || session.phase === 'result';
  settings.open(button, session.phase === 'home' ? selectedMode() : session.mode, allowBoth);
}

function openGuide(button: HTMLElement): void {
  if (session.phase === 'playing') pause('guide');
  controls.clear(); guideReturnFocus = button;
  renderUi(); guide.showModal(); element('#guide-close').focus();
}

try {
  scene = new FlightScene(element('#scene'), available => {
    graphicsAvailable = available;
    if (!available) pause('webgl');
    for (const note of app.querySelectorAll<HTMLElement>('[data-graphics-status]')) {
      note.hidden = available; note.textContent = '3D描画が停止しました。描画の復旧まで飛行を開始・再開できません。';
    }
    renderUi();
  });
  graphicsAvailable = true;
} catch {
  for (const note of app.querySelectorAll<HTMLElement>('[data-graphics-status]')) {
    note.hidden = false;
    note.textContent = 'この環境では3D描画を開始できません。操作設定と遊び方は確認できます。';
  }
}

const opts = { signal: abort.signal };
element('#start').addEventListener('click', () => start(selectedMode()), opts);
element('#restart').addEventListener('click', () => start(session.mode), opts);
element('#cancel-preparing').addEventListener('click', goHome, opts);
element('#pause').addEventListener('click', () => pause('manual'), opts);
element('#resume').addEventListener('click', () => {
  if (!graphicsAvailable || document.hidden || settings.isOpen || guide.open) return;
  controls.clear(); stepper.reset();
  if (session.resume()) renderUi(true);
}, opts);
element('#finish').addEventListener('click', () => {
  controls.clear(); stepper.reset(); if (session.finish('aborted')) renderUi(true);
}, opts);
for (const selector of ['#pause-home', '#result-home']) element(selector).addEventListener('click', goHome, opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-settings]')) button.addEventListener('click', () => openSettings(button), opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-guide]')) button.addEventListener('click', () => openGuide(button), opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-sound]')) button.addEventListener('click', async () => {
  await audio.toggle();
  for (const item of app.querySelectorAll<HTMLElement>('[data-sound]')) {
    item.textContent = audio.isEnabled ? '音 ON' : '音 OFF'; item.setAttribute('aria-pressed', String(audio.isEnabled));
  }
}, opts);
for (const radio of app.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.addEventListener('change', () => {
  if (session.phase === 'home') { session.mode = selectedMode(); controls.setMode(session.mode); settings.setActiveMode(session.mode); renderUi(); }
}, opts);
for (const selector of ['#guide-close', '#guide-done']) element(selector).addEventListener('click', () => guide.close(), opts);
guide.addEventListener('keydown', event => containDialogTabFocus(guide, event), opts);
guide.addEventListener('close', () => {
  const target = guideReturnFocus; guideReturnFocus = null;
  if (target?.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
}, opts);
keyboard.subscribe(() => renderUi());
window.addEventListener('keydown', event => {
  // Home/result native Enter activation must never be stolen by a custom pause binding.
  if (event.defaultPrevented || settings.isOpen || guide.open || isKeyboardEditingTarget(event.target)
    || !keyboard.matchesPause(event) || !['playing', 'paused'].includes(session.phase)) return;
  if (event.code === 'Enter' && event.target instanceof HTMLElement && event.target.closest('button, a')) return;
  event.preventDefault();
  if (session.phase === 'playing') pause('manual');
  else if (graphicsAvailable && !document.hidden) { controls.clear(); stepper.reset(); session.resume(); renderUi(true); }
}, opts);
window.addEventListener('blur', () => pause('focus'), opts);
window.addEventListener('pagehide', () => pause('hidden'), opts);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); }, opts);

function frame(now: number): void {
  stepper.frame(now, session.phase === 'playing', () => {
    const input = controls.sample(); input.viewAspect = app.clientWidth / Math.max(1, app.clientHeight);
    session.step(input); lastFire = input.fire;
  }, () => pause('gap'));
  if (session.tick !== lastShownTick) {
    lastShownTick = session.tick;
    element('#elapsed').textContent = `${(session.tick / FIXED_HZ).toFixed(2)} s`;
    element('#speed').textContent = `${session.player.speed.toFixed(0)} m/s`;
    element('#altitude').textContent = `${Math.round(session.player.position.y).toLocaleString('ja-JP')} m`;
    element('#fire-status').textContent = `射撃入力：${lastFire ? 'ON' : 'OFF'}（発射未実装）`;
    const loopBusy = session.player.loopProgress > 0 || session.player.loopCooldown > 0;
    buttons.loop.setAttribute('aria-disabled', String(loopBusy));
    element('#loop-status').textContent = session.player.loopProgress > 0 ? '実行中'
      : session.player.loopCooldown > 0 ? `${session.player.loopCooldown.toFixed(1)} s` : '準備OK';
    audio.update(session.player.speed);
  }
  scene?.render(session.player, session.mode, session.tick);
  animation = requestAnimationFrame(frame);
}

function dispose(): void {
  cancelAnimationFrame(animation);
  if (pendingPreparation !== null) cancelAnimationFrame(pendingPreparation);
  abort.abort(); controls.dispose(); settings.dispose(); inputPresentation.dispose(); audio.dispose(); scene?.dispose();
}

settings.setActiveMode(session.mode); controls.setMode(session.mode); renderUi();
animation = requestAnimationFrame(frame);
if (import.meta.hot) import.meta.hot.dispose(dispose);
