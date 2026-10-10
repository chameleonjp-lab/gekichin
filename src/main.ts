import './style.css';
import { boundaryDirectionLabel } from './boundary-guidance';
import './control-settings.css';
import './common-shell.css';
import { FlightControls, type FlightControlButtons } from './input';
import { ControlSettings } from './control-settings';
import { ControlInputPresentation, KeyboardSettings, isKeyboardEditingTarget } from './keyboard-settings';
import { containDialogTabFocus } from './dialog-focus';
import { FlightSession, FixedStepper } from './game-state';
import { FlightScene } from './scene';
import { FlightAudio, type CombatSound } from './audio';
import { FIXED_HZ } from './rules';
import { readBest, saveBest } from './scoring';
import type { CombatEvent, CombatReport } from './combat-types';
import type { GameMode, PauseReason } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="scene" class="scene"></div>
  <div id="flight-surface" class="flight-surface" aria-hidden="true"></div>
  <main id="home" class="overlay home-screen" aria-labelledby="game-title">
    <div class="brand-line"><span class="brand-mark" aria-hidden="true">G</span><span>ゼロ：シリーズ / 全周攻略</span></div>
    <div class="home-copy">
      <p class="eyebrow">巨艦を、全周から。</p>
      <h1 id="game-title">ゲキチン</h1>
      <p class="intro">目標は超大型母艦一隻。<br /><strong>砲台100基を全破壊</strong>して、撃沈する。</p>
      <p class="scope-note">主砲の予告を避け、僚機と六面へ回り込む。機銃と機関砲で装甲上の砲台を撃ち抜こう。</p>
    </div>
    <section class="briefing" aria-label="出撃準備">
      <div class="mission-data">
        <div><span>母艦の砲台</span><strong>100<small>基</small></strong><em>主砲20・機銃80</em></div>
        <div><span>味方総残機</span><strong>50<small>機</small></strong><em>自機を含む</em></div>
        <div><span>同時出撃</span><strong>8<small>機</small></strong><em>残機があれば復帰</em></div>
      </div>
      <fieldset class="mode-picker">
        <legend>操作モード</legend>
        <label><input type="radio" name="mode" value="easy" checked /><span><b>イージー</b><small>巡航・照準内の自動射撃</small></span></label>
        <label><input type="radio" name="mode" value="normal" /><span><b>ノーマル</b><small>手動射撃・加速・減速</small></span></label>
      </fieldset>
      <button id="start" class="primary" type="button">出撃する <span aria-hidden="true">→</span></button>
      <p class="touch-guide">タッチ／マウス：触れた位置からドラッグして操縦</p>
      <p id="home-key-guide" class="key-guide"></p>
      <div class="home-actions">
        <button id="home-guide" data-guide class="secondary" type="button">ルールと操作方法</button>
        <button id="home-controls" data-settings class="text-button" type="button">操作設定</button>
      </div>
      <p id="best-record" class="best-record">端末内ベスト：未記録</p>
      <p id="render-note" class="render-note" data-graphics-status role="status" hidden></p>
    </section>
    <footer class="home-footer"><span>GEKICHIN / 巨艦攻略</span><button id="home-sound" data-sound class="text-button" type="button" aria-pressed="false" aria-label="音をオンにする">音をオンにする</button></footer>
  </main>
  <section id="preparing" class="overlay" aria-labelledby="preparing-title" hidden>
    <div class="panel compact-panel"><p class="eyebrow">PREPARING</p><h2 id="preparing-title">出撃を準備しています</h2><p>準備時間は作戦タイムに含めません。</p><button id="cancel-preparing" type="button">ホームへ戻る</button></div>
  </section>
  <section id="hud" class="hud" aria-label="戦闘情報" hidden>
    <div class="hud-top">
      <div class="flight-label"><b>ゲキチン</b><span id="hud-mode">イージー</span></div>
      <div class="hud-utility"><button data-sound type="button" aria-pressed="false" aria-label="音をオンにする">音 OFF</button><button id="pause" type="button" aria-label="一時停止">Ⅱ</button></div>
    </div>
    <div class="metrics">
      <div><small>作戦時間</small><output id="elapsed">0.00 s</output></div>
      <div><small>速度</small><output id="speed">396 km/h</output></div>
      <div><small>高度</small><output id="altitude">1,000 m</output></div>
    </div>
    <details id="combat-panel" class="combat-panel" open>
      <summary>戦況</summary>
      <div class="combat-metrics" tabindex="0" role="region" aria-label="戦況一覧">
      <div><small>暫定スコア</small><output id="score">0</output></div>
      <div><small>破壊 / 100</small><output id="destroyed">0 / 100</output></div>
      <div><small>主砲残 / 20</small><output id="main-left">20 / 20</output></div>
      <div><small>機銃残 / 80</small><output id="mg-left">80 / 80</output></div>
      <div><small>味方残機・自機込み</small><output id="fleet-left">50</output></div>
      <div><small>出撃 / 予備＋予約</small><output id="fleet-active">8 / 42</output></div>
      <div><small>自機 HP</small><output id="player-hp">80 / 80</output></div>
      <div><small>MG / 機関砲</small><output id="ammunition">288 / 96</output></div>
      <div><small>装填</small><output id="reload">準備OK</output></div>
      <div><small>砲台命中 H/N</small><output id="accuracy">—</output></div>
      <div><small>主砲命中 / 機銃命中</small><output id="hit-breakdown">0 / 0</output></div>
      </div>
    </details>
    <p id="target-status" class="target-status">標的：照準内なし</p>
    <p id="boundary-status" class="boundary-status" hidden></p>
    <p id="respawn-status" class="respawn-status" hidden></p>
    <div id="face-guide" class="face-guide" aria-label="六面の残存砲台"></div>
    <p id="combat-notice" class="combat-notice" role="status" aria-live="polite"></p>
    <div class="aim-circle" aria-hidden="true"><i></i></div>

    <p id="fire-status" class="fire-status" hidden>射撃：待機</p>
    <button id="fire" data-flight-control="fire" type="button" aria-pressed="false"><b>射撃</b><small>MG・機関砲</small></button>
    <button id="loop" data-flight-control="loop" type="button" aria-pressed="false" aria-disabled="false"><b>宙返り</b><small id="loop-status">L</small></button>
    <div id="throttle" class="throttle-lever" data-flight-control="throttle" role="slider" tabindex="0" aria-label="速度レバー" aria-describedby="throttle-help" aria-orientation="vertical" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="保持（速度を維持）">
      <span class="throttle-up">加速</span><span class="throttle-center">保持</span><span class="throttle-down">減速</span><i class="throttle-handle" aria-hidden="true"></i>
    </div>
    <p id="throttle-layout-note" class="throttle-layout-note" role="status" hidden>速度レバーの配置が重なっています。画面を回転するか、操作設定で位置や大きさを調整してください。</p>
    <span id="throttle-help" class="visually-hidden">上で加速、下で減速。離すと中央に戻り、調整した速度を保持します。フォーカス中は矢印キーで調整できます。</span>
  </section>
  <section id="paused" class="overlay" aria-labelledby="pause-title" hidden>
    <div class="panel compact-panel">
      <p class="eyebrow">PAUSED</p><h2 id="pause-title">一時停止</h2>
      <p id="pause-reason">戦闘・装填・復帰・作戦時計を停止しています。</p>
      <button id="resume" class="primary" type="button">飛行を再開</button>
      <button id="finish" class="secondary" type="button">作戦を中断する</button>
      <button id="pause-home" class="text-button" type="button">ホームへ戻る</button>
      <div class="shell-support">
        <button data-guide class="secondary" type="button">ルールと操作方法</button>
        <button id="pause-controls" data-settings class="secondary" type="button">操作設定</button>
        <button data-sound class="text-button" type="button" aria-pressed="false" aria-label="音をオンにする">音 OFF</button>
      </div>
    </div>
  </section>
  <section id="sinking" class="overlay sinking-overlay" aria-labelledby="sinking-title" hidden>
    <div class="panel compact-panel"><p class="eyebrow">MOTHERSHIP DESTROYED</p><h2 id="sinking-title">全100基、撃沈確定</h2><p>タイムと成績は確定済みです。</p><button id="skip-sinking" class="primary" type="button">演出をスキップして結果へ</button></div>
  </section>
  <section id="result" class="overlay" aria-labelledby="result-title" hidden>
    <div class="panel result-panel">
      <p class="eyebrow">MISSION REPORT</p><h2 id="result-title">作戦結果</h2>
      <p class="graphics-status" data-graphics-status role="status" hidden></p>
      <p id="result-outcome" class="mission-badge">中断</p>
      <div class="result-headline"><p class="result-time"><output id="result-time">0.00</output><span>秒</span></p><p class="result-score"><small>最終スコア</small><output id="result-score">0</output></p></div>
      <p id="result-mode"></p>
      <section class="score-breakdown" aria-labelledby="result-breakdown-title"><h3 id="result-breakdown-title">スコアの内訳</h3><dl id="result-components" class="result-components"></dl></section>
      <p id="result-details" class="result-details"></p>
      <p id="result-best" class="best-record"></p>
      <p id="save-status" class="save-status" role="status"></p>
      <button id="restart" class="primary" type="button">もう一度出撃</button>
      <button id="result-home" class="secondary" type="button">ホームへ戻る</button>
      <button id="result-controls" data-settings class="text-button" type="button">操作設定</button>
      <div class="shell-support"><button data-guide class="secondary" type="button">ルールと操作方法</button><button data-sound class="text-button" type="button" aria-pressed="false" aria-label="音をオンにする">音 OFF</button></div>
    </div>
  </section>
  <dialog id="guide" aria-labelledby="guide-title">
    <header class="settings-header"><div><p class="eyebrow">RULES &amp; CONTROLS</p><h2 id="guide-title">ルールと操作方法</h2></div><button id="guide-close" class="settings-close" type="button" aria-label="説明を閉じる">×</button></header>
    <div class="guide-content" tabindex="0" role="region" aria-label="ルールと操作方法の本文">
      <p class="graphics-status" data-graphics-status role="status" hidden></p>

      <h3>作戦の目標</h3><p>超大型母艦の主砲20基・大型機銃80基、合計100基を全破壊します。味方50機は自機を含み、同時出撃は8機。残機があれば復帰します。</p>
      <h3>飛行の操作</h3><p>画面のどこからでも、触れた位置を基準にドラッグできます。右へドラッグで右旋回、上へドラッグで上昇。離すと操縦入力を解除します。</p><p id="guide-keys"></p>
      <p>イージーは巡航速度で、遮蔽されない砲台が照準内へ入ると自動射撃。宙返りボタン1つです。ノーマルは射撃・宙返りボタンと速度レバー。上で加速、下で減速、離すと中央に戻り速度を保持します。宙返り中に新しく操縦すると中止できます。</p>
      <h3>攻略と補給</h3><p>母艦の上・下・左右・前後に砲台があります。船体の反対側へは射撃できません。六面の残数を見ながら外周を回り込みましょう。主砲は1秒、大型機銃は0.3秒の固定照準予告があり、旋回や宙返りで射線から離脱できます。予告は音OFFでも見えます。</p>
      <p>自機と僚機のHPは80。MG288発・機関砲96発が両方空になると6秒で全装填します。補給回数に制限はありません。ノーマルの自機弾は味方にも当たります。イージーと僚機弾は味方を損傷させませんが、接触で弾は止まります。</p>
      <h3>残機と復帰</h3><p>50機は自機込みの総残機です。同時出撃は8機。機体を失うと予備から3秒後に復帰し、待機中も戦闘は続きます。予備がなくても生存僚機がいれば、3秒後にその機体の状態を引き継ぎます。味方残機0で敗北です。</p>
      <p>戦場は母艦中心から水平4,000m・高度50〜2,500m。境界外が能動時間10秒続くと1機を失い、領域内へ戻ると猶予は解除されます。母艦・海への衝突は即損失です。</p>
      <h3>成績</h3><p>破壊1,000点/基、編隊の実損傷2点/HP、勝利時の時間点50,000/(1＋秒/300)。自機損失2,000点、僚機損失500点、砲台命中率の低下20,000×(1−H/N)を減点します。未射撃の命中率は未定義で率減点0。とどめと損傷の自機／僚機内訳を表示し、端末内ベストは勝利だけ、モード別に記録します。</p>
      <h3>設定と停止</h3><p>設定は保存後に適用されます。「変更を破棄」やEscで編集を取り消せます。設定や説明を閉じても戦闘は停止したままです。音は初期OFF。ONで方向と距離のある合成音が鳴ります。低モーション設定は装飾だけを弱めます。</p>
    </div>
    <footer><button id="guide-done" class="primary" type="button">元の画面へ戻る</button></footer>
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
  () => session.phase === 'playing' && !!session.fleet.player && !guide.open && !settings.isOpen
    && !(app.dataset.compactHud === 'true' && element<HTMLDetailsElement>('#combat-panel').open), keyboard);
const settings = new ControlSettings(buttons, keyboard, inputPresentation);
let scene: FlightScene | null = null;
let graphicsAvailable = false;
let sceneReady = false;
let animation = 0;
let lastShownTick = -1;
let lastFire = false;
let guideReturnFocus: HTMLElement | null = null;
let pendingPreparation: number | null = null;
let lastOwnershipRevision = -1;
let lastEventSequence = 0;
let lastOperationId = -1;
let shownReport: CombatReport | null = null;
let sinkingElapsed = 0;
let sinking = false;
let lastFrameTime: number | null = null;
let noticeUntilTick = 0;
let compactHud = false;
let disposed = false;

const reasonText: Record<PauseReason, string> = {
  manual: '戦闘・装填・復帰・作戦時計を停止しています。',
  settings: '操作設定のため停止しています。再開はボタンから行ってください。',
  guide: 'ルールと操作方法を開くため停止しています。再開はボタンから行ってください。',
  hidden: '画面が非表示になったため停止しました。明示的に再開してください。',
  focus: 'フォーカスが外れたため停止しました。明示的に再開してください。',
  gap: '処理が2秒以上停止したため戦闘を止めました。明示的に再開してください。',
  webgl: '3D描画が停止しました。描画が復旧した後、明示的に再開してください。',
  abnormal: '安全な出撃または射撃を継続できないため停止しました。再開するか、作戦を中断してください。',
};

function selectedMode(): GameMode { return element<HTMLInputElement>('input[name="mode"]:checked').value as GameMode; }

function renderUi(focus = false): void {
  app.dataset.phase = session.phase;
  app.dataset.mode = session.mode;
  app.dataset.presentation = sinking ? 'sinking' : session.phase;
  for (const phase of ['home', 'preparing', 'paused', 'result']) element(`#${phase}`).hidden = session.phase !== phase;
  element('#sinking').hidden = !sinking;
  if (sinking) element('#result').hidden = true;
  const playing = session.phase === 'playing';
  element('#hud').hidden = !playing;
  element('#flight-surface').hidden = !playing;
  for (const name of ['fire', 'throttle'] as const) buttons[name]!.hidden = session.mode !== 'normal';
  element('#fire-status').hidden = session.mode !== 'normal';
  element('#hud-mode').textContent = session.mode === 'easy' ? 'イージー' : 'ノーマル';
  element('#home-key-guide').textContent = keyboard.describe(selectedMode());
  element('#guide-keys').textContent = keyboard.describe(session.phase === 'home' ? selectedMode() : session.mode);
  element<HTMLButtonElement>('#start').disabled = !graphicsAvailable;
  element<HTMLButtonElement>('#restart').disabled = !graphicsAvailable;
  element<HTMLButtonElement>('#resume').disabled = !graphicsAvailable;
  if (session.pauseReason) element('#pause-reason').textContent = session.pauseReason === 'webgl' && graphicsAvailable
    ? '3D描画が復旧しました。「飛行を再開」で再開できます。' : session.pauseReason === 'abnormal' && session.abnormalReason ? session.abnormalReason : reasonText[session.pauseReason];
  if (session.report) {
    element('#result-time').textContent = (session.report.endTick / FIXED_HZ).toFixed(2);
    element('#result-mode').textContent = `${session.report.mode === 'easy' ? 'イージー' : 'ノーマル'} · 編隊の戦果`;
  }
  const best = readBest(session.phase === 'home' ? selectedMode() : session.mode);
  element('#best-record').textContent = best ? `端末内ベスト：${best.components.total.toLocaleString('ja-JP')}点 / ${(best.endTick / FIXED_HZ).toFixed(2)}秒` : '端末内ベスト：未記録';
  audio.setActive((playing || sinking) && !document.hidden);
  if (focus) {
    const target = sinking ? '#skip-sinking' : { home: '#start', preparing: '#cancel-preparing', playing: '#flight-surface', paused: '#resume', result: '#restart' }[session.phase];
    if (playing) (document.activeElement as HTMLElement | null)?.blur();
    else element(target).focus({ preventScroll: true });
  }
}

function fitHud(): void {
  const largeText = parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24;
  const small = app.clientHeight <= 450 || largeText;
  const layoutChanged = app.dataset.compactHud !== String(small) || app.dataset.largeText !== String(largeText);
  if (small !== compactHud) {
    compactHud = small;
    element<HTMLDetailsElement>('#combat-panel').open = !small;
    if (!small) for (const button of Object.values(buttons)) button.inert = false;
  }
  app.dataset.compactHud = String(small);
  app.dataset.largeText = String(largeText);
  if (layoutChanged) { controls.clear(); settings.refresh(); }
}

function pause(reason: PauseReason): void {
  lastFrameTime = null;
  controls.clear(); stepper.reset();
  audio.setActive(false);
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
  sinking = false; sinkingElapsed = 0; shownReport = null; lastEventSequence = 0;
  lastOwnershipRevision = session.fleet.ownershipRevision;
  noticeUntilTick = 0; element('#combat-notice').textContent = '';
  renderUi(true);
  // Preparation is visible for one rendered frame; its clock is never active.
  void (scene?.ready ?? Promise.resolve()).then(() => {
    if (disposed || session.phase !== 'preparing' || session.operationId !== operationId) return;
    pendingPreparation = requestAnimationFrame(() => {
      pendingPreparation = requestAnimationFrame(() => {
        pendingPreparation = null;
        if (disposed) return;
        if (!graphicsAvailable || document.hidden || !document.hasFocus()) { goHome(); return; }
        if (session.begin(operationId)) { stepper.reset(); renderUi(true); }
      });
    });
  }).catch(() => {
    if (!disposed && session.phase === 'preparing' && session.operationId === operationId) goHome();
  });
}

function goHome(): void {
  if (pendingPreparation !== null) cancelAnimationFrame(pendingPreparation);
  pendingPreparation = null;
  controls.clear(); stepper.reset(); session.home(); lastShownTick = -1; lastFire = false;
  sinking = false; sinkingElapsed = 0; shownReport = null; lastEventSequence = 0;
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
    if (disposed) return;
    graphicsAvailable = available;
    if (!available) pause('webgl');
    for (const note of app.querySelectorAll<HTMLElement>('[data-graphics-status]')) {
      note.hidden = available; note.textContent = '3D描画が停止しました。描画の復旧まで作戦を開始・再開できません。';
    }
    renderUi();
  });
  graphicsAvailable = true;
  void scene.ready.then(() => {
    if (disposed) return;
    sceneReady = true; app.dataset.rendererReady = 'true';
  }).catch(() => {
    if (disposed) return;
    graphicsAvailable = false; app.dataset.rendererReady = 'false'; renderUi();
  });
} catch {
  for (const note of app.querySelectorAll<HTMLElement>('[data-graphics-status]')) {
    note.hidden = false;
    note.textContent = 'この環境では3D描画を開始できません。「操作設定」と「ルールと操作方法」は確認できます。';
  }
}

const opts = { signal: abort.signal };
const textScaleObserver = new MutationObserver(fitHud);
textScaleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
window.addEventListener('resize', fitHud, opts);
window.visualViewport?.addEventListener('resize', fitHud, opts);
element('#start').addEventListener('click', () => start(selectedMode()), opts);
element('#restart').addEventListener('click', () => start(session.mode), opts);
element('#cancel-preparing').addEventListener('click', goHome, opts);
element('#pause').addEventListener('click', () => pause('manual'), opts);
element('#combat-panel').addEventListener('keydown', event => {
  if (event instanceof KeyboardEvent && event.key === 'Escape' && compactHud) {
    element<HTMLDetailsElement>('#combat-panel').open = false;
    element<HTMLElement>('#combat-panel summary').focus();
    event.stopPropagation();
  }
}, opts);
element('#combat-panel').addEventListener('toggle', () => {
  const reading = compactHud && element<HTMLDetailsElement>('#combat-panel').open;
  if (reading) controls.clear();
  for (const button of Object.values(buttons)) button.inert = reading;
}, opts);
element('#resume').addEventListener('click', () => {
  if (!graphicsAvailable || document.hidden || settings.isOpen || guide.open) return;
  controls.clear(); stepper.reset();
  if (session.resume()) renderUi(true);
}, opts);
element('#finish').addEventListener('click', () => {
  if (session.finish('aborted') && session.report) showReport(session.report);
}, opts);
element('#skip-sinking').addEventListener('click', () => {
  sinking = false; sinkingElapsed = 5; renderUi(true);
}, opts);
for (const selector of ['#pause-home', '#result-home']) element(selector).addEventListener('click', goHome, opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-settings]')) button.addEventListener('click', () => openSettings(button), opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-guide]')) button.addEventListener('click', () => openGuide(button), opts);
for (const button of app.querySelectorAll<HTMLElement>('[data-sound]')) button.addEventListener('click', async () => {
  await audio.toggle();
  for (const item of app.querySelectorAll<HTMLElement>('[data-sound]')) {
    const actionLabel = audio.isEnabled ? '音をオフにする' : '音をオンにする';
    item.textContent = item.id === 'home-sound' ? actionLabel : audio.isEnabled ? '音 ON' : '音 OFF';
    item.setAttribute('aria-label', actionLabel); item.setAttribute('aria-pressed', String(audio.isEnabled));
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
document.addEventListener('visibilitychange', () => {
  lastFrameTime = null;
  if (document.hidden) pause('hidden');
}, opts);

const faceNames = { top: '上', bottom: '下', left: '左', right: '右', front: '前', rear: '後' } as const;
const stageNames = { healthy: '健全', damaged: '損傷', critical: '大破', destroyed: '破壊' } as const;
const faceEntries = Object.entries(faceNames) as [keyof typeof faceNames, string][];
for (const [face, label] of faceEntries) {
  const item = document.createElement('span'); item.dataset.face = face;
  const name = document.createTextNode(`${label} `), count = document.createElement('b');
  item.append(name, count); element('#face-guide').append(item);
}

function showReport(report: CombatReport): void {
  shownReport = report;
  sinking = report.outcome === 'victory'; sinkingElapsed = 0;
  const outcome = { victory: '勝利 · 全100基撃沈', defeat: '敗北 · 味方残機0', mutual: '相討ち · 敗北', aborted: '中断' }[report.outcome];
  element('#result-title').textContent = report.outcome === 'victory' ? '母艦撃沈' : '作戦結果';
  element('#result-outcome').textContent = outcome;
  element('#result-score').textContent = report.components.total.toLocaleString('ja-JP');
  const rows: [string, number][] = [
    ['砲台破壊点', report.components.destruction], ['実損傷点', report.components.damage],
    ['時間点（勝利時のみ）', report.components.time], ['自機損失点', -report.components.playerLoss],
    ['僚機損失点', -report.components.wingmanLoss], ['命中率減点', -report.components.accuracyLoss],
  ];
  const parts: HTMLElement[] = [];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = `${value < 0 ? '−' : '+'}${Math.abs(value).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`;
    parts.push(dt, dd);
  }
  element('#result-components').replaceChildren(...parts);
  const hits = report.Hmain + report.Hmg;
  element('#result-details').textContent = `破壊 ${report.K}/100（主砲${report.mainKills}/20・機銃${report.mgKills}/80）\n自機：破壊${report.playerKills}・実損傷${(report.playerDamageMilli / 1000).toFixed(3)}HP\n僚機：破壊${report.wingmanKills}・実損傷${(report.wingmanDamageMilli / 1000).toFixed(3)}HP\n損失：自機${report.P}・僚機${report.W} / 味方残機${50 - report.P - report.W}\n砲台命中 H/N：${hits}/${report.N}${report.N ? `（${(100 * hits / report.N).toFixed(1)}%）` : ' — 未射撃'}\n主砲への有効命中${report.Hmain}発・機銃への有効命中${report.Hmg}発`;
  const saved = saveBest(report);
  element('#result-best').textContent = saved.best ? `このモードの端末内ベスト：${saved.best.components.total.toLocaleString('ja-JP')}点 / ${(saved.best.endTick / FIXED_HZ).toFixed(2)}秒` : '勝利した作戦をモード別に端末内へ記録します。';
  element('#save-status').textContent = saved.error ? '端末内記録を保存できませんでした。今回の結果はこの画面で確認できます。' : saved.saved ? '端末内ベストを更新しました。' : '';
  controls.clear(); stepper.reset(); renderUi(true);
}

function combatSound(event: CombatEvent): CombatSound | null {
  if (event.kind === 'shot') return event.owner === 'enemy' ? event.weapon === 'main' ? 'cannon' : 'enemy-machinegun' : event.weapon === 'cannon' ? 'cannon' : 'machinegun';
  if (event.kind === 'warning' && event.weapon === 'main') return 'main-warning';
  if (event.kind === 'hit') return 'metal-impact';
  if (event.kind === 'turret-destroyed') return 'turret-destroy';
  if (event.kind === 'victory') return 'mothership-sink';
  return null;
}

function consumeEvents(): void {
  if (lastOperationId !== session.operationId) { lastEventSequence = 0; lastOperationId = session.operationId; }
  const unseen = session.events.filter(event => event.sequence > lastEventSequence);
  let destroyed = 0, lost = 0, mainWarnings = 0, message = '';
  for (const event of unseen) {
    lastEventSequence = Math.max(lastEventSequence, event.sequence);
    const sound = combatSound(event);
    if (sound) audio.playCombat(sound, event.point ?? session.player.position, session.player.position, session.player.quaternion);
    if (event.kind === 'turret-destroyed') destroyed += 1;
    if (event.kind === 'aircraft-lost') lost += 1;
    if (event.kind === 'warning' && event.weapon === 'main') mainWarnings += 1;
    if (event.kind === 'respawn' && event.owner === 'player') message = '自機が復帰しました。';
    else if (event.kind === 'respawn' && !message) message = '僚機が復帰しました。';
    if (event.kind === 'handoff') message = '生存僚機へ操作権を引き継ぎました。';
    if (event.kind === 'abnormal') message = event.message ?? '出撃または射撃を継続できないため停止しました。';
  }
  if (mainWarnings) message = `主砲予告 ${mainWarnings}基 · 射線から離脱`;
  else if (!message && lost) message = `味方 ${lost}機損失 · 残機${session.fleet.counts.remaining}`;
  else if (!message && destroyed) message = `砲台 ${destroyed}基破壊 · 残り${session.mothership.remaining}`;
  if (message) { element('#combat-notice').textContent = message; noticeUntilTick = session.tick + 180; }
  else if (session.tick > noticeUntilTick) element('#combat-notice').textContent = '';
}

function updateHud(): void {
  const fleet = session.fleet.counts, player = session.fleet.player;
  const totals = session.score.totals, components = session.score.components(session.tick);
  element('#elapsed').textContent = `${(session.tick / FIXED_HZ).toFixed(2)} s`;
  element('#speed').textContent = `${Math.round(session.player.speed * 3.6)} km/h`;
  element('#altitude').textContent = `${Math.round(session.player.position.y).toLocaleString('ja-JP')} m`;
  element('#score').textContent = components.total.toLocaleString('ja-JP');
  element('#destroyed').textContent = `${100 - session.mothership.remaining} / 100`;
  element('#main-left').textContent = `${session.mothership.remainingMain} / 20`;
  element('#mg-left').textContent = `${session.mothership.remainingMG} / 80`;
  element('#fleet-left').textContent = String(fleet.remaining);
  element('#fleet-active').textContent = `${fleet.active} / ${fleet.reserve + fleet.reserved}`;
  element('#player-hp').textContent = player ? `${(player.hpMilli / 1000).toFixed(1)} / 80` : '復帰待ち';
  element('#ammunition').textContent = player ? `${player.ammunition.mg} / ${player.ammunition.cannon}` : '— / —';
  element('#reload').textContent = player?.ammunition.reloadUntilTick !== null && player ? `${Math.max(0, player.ammunition.reloadUntilTick! - session.tick) / FIXED_HZ < .1 ? 'まもなく' : (Math.max(0, player.ammunition.reloadUntilTick! - session.tick) / FIXED_HZ).toFixed(1) + '秒'}` : '準備OK';
  element('#accuracy').textContent = totals.N ? `${(100 * (totals.Hmain + totals.Hmg) / totals.N).toFixed(1)}% (${totals.Hmain + totals.Hmg}/${totals.N})` : '— 未射撃';
  element('#hit-breakdown').textContent = `${totals.Hmain}発 / ${totals.Hmg}発`;
  const wait = session.fleet.wait;
  const priorityNotice = session.boundary.warning || (!player && !!wait);
  element('#combat-notice').hidden = priorityNotice;
  element('#target-status').hidden = app.dataset.largeText === 'true' && (priorityNotice || !!element('#combat-notice').textContent);
  element('#respawn-status').hidden = !!player || !wait;
  if (wait) element('#respawn-status').textContent = `${wait.kind === 'handoff' ? '僚機へ引継ぎ' : wait.kind === 'deployment' ? '出撃回廊の空きを待機' : '自機復帰'}${wait.untilTick === null ? '' : ` · ${Math.max(0, wait.untilTick - session.tick) / FIXED_HZ < .1 ? 'まもなく' : (Math.max(0, wait.untilTick - session.tick) / FIXED_HZ).toFixed(1) + '秒'}`}`;
  for (const [face] of faceEntries) {
    element(`#face-guide [data-face="${face}"] b`).textContent = String(session.mothership.turrets.filter(turret => turret.layout.face === face && turret.hpMilli > 0).length);
  }
  const target = session.target;
  element('#target-status').textContent = target ? `#${target.layout.id} ${target.layout.kind === 'main' ? '主砲' : '機銃'}・${faceNames[target.layout.face]}面・${stageNames[target.stage]}\n${(target.hpMilli / 1000).toFixed(1)}HP / ${Math.round(session.player.position.distanceTo(target.layout.aimPoint))}m` : '標的：可視砲台なし';
  element('#boundary-status').hidden = !session.boundary.warning;
  if (session.boundary.warning) {
    const direction = session.boundary.direction;
    const arrow = boundaryDirectionLabel(direction, session.player.yaw);
    element('#boundary-status').textContent = session.boundary.outside ? `${arrow} 帰還 · 戻らないと${Math.ceil(session.boundary.remainingTicks / FIXED_HZ)}秒で機体損失` : `${arrow} 帰還 · 境界まで${Math.max(0, Math.round(session.boundary.distance))}m`;
  }
  const hud = element('#hud');
  hud.dataset.position = session.player.position.toArray().map(value => value.toFixed(6)).join(',');
  hud.dataset.yaw = String(session.player.yaw); hud.dataset.pitch = String(session.player.pitch);
  app.dataset.tick = String(session.tick); app.dataset.ownership = String(session.fleet.ownershipRevision);
  app.dataset.operationId = String(session.operationId); app.dataset.seed = String(session.seed);
  app.dataset.remainingHpMilli = String(session.mothership.totalHpMilli);
  if (app.dataset.destroyedCount !== String(totals.K)) {
    app.dataset.destroyedCount = String(totals.K);
    app.dataset.destroyedTurretIds = [...session.mothership.destroyedIds].join(',');
  }
  app.dataset.friendlyBullets = String(session.weapons.bullets.length);
  app.dataset.enemyMainBullets = String(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'main').length);
  app.dataset.enemyMgBullets = String(session.enemyCombat.bullets.filter(bullet => bullet.kind === 'mg').length);
  app.dataset.friendlyPoolFailures = String(session.weapons.allocationFailures);
  app.dataset.enemyPoolFailures = String(session.enemyCombat.poolFailures);
  element('#fire-status').textContent = `射撃：${lastFire ? 'ON' : '待機'}`;
  element('#fire small').textContent = lastFire ? '射撃中' : 'MG・機関砲';
  const loopBusy = session.player.loopProgress > 0 || session.player.loopCooldown > 0;
  buttons.loop.setAttribute('aria-disabled', String(loopBusy));
  element('#loop-status').textContent = session.player.loopProgress > 0 ? '実行中' : session.player.loopCooldown > 0 ? `${session.player.loopCooldown.toFixed(1)} s` : '準備OK';
  audio.update(session.player.speed);
}

function frame(now: number): void {
  if (disposed) return;
  let frameSeconds = lastFrameTime === null ? 0 : Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  stepper.frame(now, session.phase === 'playing', () => {
    const input = controls.sample(); input.viewAspect = app.clientWidth / Math.max(1, app.clientHeight);
    session.step(input); lastFire = input.fire;
    if (session.fleet.ownershipRevision !== lastOwnershipRevision) {
      controls.clear(); lastOwnershipRevision = session.fleet.ownershipRevision;
    }
  }, () => pause('gap'));
  if (session.report && shownReport !== session.report) { showReport(session.report); frameSeconds = 0; }
  else if (app.dataset.phase !== session.phase) renderUi(true);
  if (sinking && !document.hidden && graphicsAvailable) {
    sinkingElapsed = Math.min(5, sinkingElapsed + frameSeconds);
    if (sinkingElapsed >= 5) { sinking = false; renderUi(true); }
  }
  consumeEvents();
  if (session.tick !== lastShownTick) {
    lastShownTick = session.tick;
    updateHud();
  }
  if (sceneReady) scene?.render(session.player, session.mode, session.tick, session, sinkingElapsed);
  for (const [name, value] of Object.entries(audio.diagnostics)) {
    const key = `audio${name[0].toUpperCase()}${name.slice(1)}`;
    if (app.dataset[key] !== String(value)) app.dataset[key] = String(value);
  }
  animation = requestAnimationFrame(frame);
}

function dispose(): void {
  disposed = true;
  cancelAnimationFrame(animation);
  if (pendingPreparation !== null) cancelAnimationFrame(pendingPreparation);
  textScaleObserver.disconnect();
  abort.abort(); controls.dispose(); settings.dispose(); inputPresentation.dispose(); audio.dispose(); scene?.dispose();
}

settings.setActiveMode(session.mode); controls.setMode(session.mode); fitHud(); renderUi();
animation = requestAnimationFrame(frame);
if (import.meta.hot) import.meta.hot.dispose(dispose);
