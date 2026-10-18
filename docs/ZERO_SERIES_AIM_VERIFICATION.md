# ゼロシリーズ 操作・標的・照準の検証記録

対象 `gekichin`、開始main `cd9431c53d64543c0d49e562dea9ea03d22a609c`、作業branch `codex/zero-series-aim-camera-20261012`。ユーザーの2026-10-11修正依頼と「8件ともPRまで」の再開指示に基づく。mainへの変更・merge・Ready化・公開は行わずDraft PRまで。

## 差分と回帰

FlightSessionの実母艦候補を同IDで補助/発射。有効collision cameraと沈没poseを論理worldから共通純関数で算出。Normal銃口前方local(0,0,-504.5)のCSS照準を修正。

共通A/B円内優先・候補順・20cm距離逆転・保持余裕境界0.015±誤差・微小操縦所有・逆方向入力・死亡/画面外/消失・再生成世代・slew解除・同tick射撃再検証を追加した。具体的な適用範囲とHUD役割差は[共通契約](ZERO_SERIES_AIM_CONTRACT.md)参照。0.015は新設計でユーザー指定の測定値ではない。

29-file移行guardの元hash一覧を保持。許可された8sourceの旧/new SHA256をsource-deltas.jsonへ記録し、残21fileは従来の一致を要求。pauseはworld freezeを保ち、新しい補助状態の解除だけを明示。

## 実行結果

| 層 | コマンド/証拠 | 結果・限界 |
| --- | --- | --- |
| 単体 | `npm test` | **142 pass / 0 fail / 0 skip、終了0**。最新の製品sourceとtestを検査。 |
| 型/製品build | `npm run build` | 終了0。TypeScript noEmitとVite製品bundle。既存chunk-size警告あり。 |
| 関連browser | `PLAYWRIGHT_BROWSERS_PATH=<browser-cache> npm run test:browser` | 5 pass（指定UI suite、日本語font）。 |
| Normal実進行 | `node --import tsx docs/evidence/aim-camera/verify-normal-fire.mts` | 同seed20261011、3操縦条件×12tickのfire on/off、位置/姿勢/速度/名目camera一致。自機発射8対0、36tick組。製品公開simulation APIを実行。 |
| 製品画面 | 5viewport×DPR1/2×Normal/Easy=20画像 | Chromium 153.0.8010.0 / SwiftShader、実buildと通常DOM操作。fixture注入なし。日本語fontあり、page error 0。回転/負荷で保護停止のlast frameが含まれ、20枚すべての連続飛行は主張しない。 |
| 入力所有 | 追加EventTarget検査＋上記関連browser | 模擬EventTargetと実DOM経路を実iPhoneから区別。 |
| WebKit/iPhone | 未実行 | 公式browser取得が不正archiveで失敗し、WebKit binary/実端末なし。申告症状は未確認・未解決。 |
| 描画FPS/実機 | 未実行 | 固定60Hz論理を維持。実描画30/60/120Hzの比較合格やhardware性能を主張しない。 |

実行したsource/test/scriptのSHA256・log hash・記録日時、20viewportのDOM測定/画像hashは[evidence.json](evidence/aim-camera/evidence.json)。Normal対照の実行scriptと[result](evidence/aim-camera/normal-fire-result.json)も保存した。PR本文に接続先から返った最終head SHAと、ローカルindex treeとの一致を記す。自己参照を避け、evidence.json自体のhashは同JSONへ入れない。公式Playwright 1.61.1想定Chromiumとは異なるfallback binaryであるため、標準browser取得の成功とは扱わない。repositoryの依存・CI・fontを追加変更していない。

## 失敗・画像確認・残件

Normal固定照準は母艦上の機体射線投影と数値検査を比較。画像だけでbank/衝突cameraの全条件合格や操作感を主張しない。

最初のbrowser取得/実行には環境起因の不正archive・SwiftShader準備timeoutがあった。ウチオトセの初回はasset接続resetで1失敗し、同sourceの再実行で合格。ファンタジアの旧font横protected 200%配置は変更前mainでも失敗し、実測fixtureを追加して製品layoutを修正。日本語fontの縦respawnで追加失敗を見つけ、旧fontも守る15000回probe＋残予算fallbackで修正し、最新469単体と指定8browserを再検査。失敗をskipやbudget縮小/寸法縮小で隠していない。これらは各作品へ同じ失敗を帰属させる説明ではなく、シリーズ共通の検証環境と個別是正の記録。

実画像を開いて確認した：[Normal/Easy縦画面](evidence/aim-camera/portrait-comparison.jpg)、[5viewport DPR1](evidence/aim-camera/viewport-contact.jpg)、[DPR2](evidence/aim-camera/viewport-dpr2.jpg)、[停止/設定](evidence/aim-camera/pause-settings.jpg)。画像は実製品PNGから内容を変えず縮小/並置した閲覧用JPG。セーフエリア/200%文字拡大は各指定UI suiteの検査範囲に限り、通常製品20画像がその全受入を代用しない。描画画像はlayoutの確認用で、操作感・FPS性能・iPhoneの受入ではない。

独立した読取reviewで同ID実経路、実遮蔽、Normal camera/照準、入力所有、guardの許可差分を確認。ゲキチンは実scene.renderをGPUだけ省いた独立camera投影で5viewport/沈没0・2・4.9秒を検査し、誤差1e-8 CSS px未満。論理/自動検査の成立と人間の実機受入は分ける。

射撃時の上下ずれは次のように切り分ける。ボタンfireだけではこの短いNormal対照でpitch/camera差を再現しない。1指持替えは操縦release→climb=0→既存水平復帰が起きるのでfire起因と断定しない。Easy標的補助の不一致とゲキチンNormal固定照準/衝突cameraは別の確認済み経路として修正。センリョウの危険時自動上昇は射撃とは別の保護。実iPhone特有のpointer capture/イベント順序は引き続き未確認。

マージ前iPhone手順：(1)Normalで操縦指の微上下を維持し別指で射撃、射撃指のみ離す/移動。(2)操縦指を離して同じ指で射撃し、release時の水平復帰と比較。(3)Easyの円内A/画面端B・遮蔽・微入力で標的/発射を確認。(4)ゲキチン母艦近傍・bank/上昇、センリョウ安全高度/危険接近で照準/回避表示を見る。(5)回転→停止→設定Save/Cancel→明示再開、速度目標とfresh inputを確認。上下ずれが残れば作品/mode/iPhone・iOS/指操作/場面を記録。実機受入とmergeは利用者が行う。

## 2026-10-18 Easy pitch transition candidate

Base: `835e85e0573bfc149c33b4383231c80588c9ad4e`. Reference behavior:
Kaisen PR #20, `6e77bc85cf7f74430b759990184f7f1178a6766e`.

The Easy assist climb value is an absolute pitch command. Previously the
smoother began from zero on acquisition/switch, briefly requesting horizontal
attitude even when a higher target required further climbing. The new absolute
history starts from the current aircraft pitch only for neutral Easy input.
Explicit absolute/relative history prevents manual-input residuals from being
interpreted in the wrong units. Target loss, manual ownership, neutral aim and
clear/reset retain cancellation; crossing zero does not reinitialize history.

Regression: at the real turret fixture position `[-150,529,-1980]`, yaw PI,
pitch `0.05`, the requested pitch is `0.07387961385621118`, but the old first
session tick decreases pitch to `0.04822533777253114`. The regression asserts
that the actual session instead approaches the higher requested attitude.
Both acquisition signs, target switching, loss/reacquisition, manual release
and zero crossing are covered. Actual turn-only input with an omitted or false
ownership flag also verifies that absolute pitch history cannot leak into manual
control. The live origin is bounded to the legal [-1,1] command range. The 13 focused tests pass without skips after
three new regression tests failed on the unchanged baseline.

The tracking strength remains 0.25. Turret alive/exposed/occlusion filtering,
tick-start firing, ownership reset, Normal/manual controls and the no-target
level-return behavior are not changed. This candidate modifies only the two
flight files, this record, and the existing regression test file.

The full unit suite and build are checked separately. The existing historical
source-hash gate is intentionally retained: its `src/game-state.ts` pin needs
an additional authorized manifest update. The manifest is not changed by this
four-file candidate. Do not treat focused test success as a green full suite,
a submitted PR, publication, or iPhone acceptance. Browser and iPhone checks
for this candidate have not been run.

Final local results (2026-10-18 JST): focused 13/13 passed; aggregate 155/156
passed with no skips, solely the unchanged historical source-hash gate failing
on the authorized `src/game-state.ts` change. TypeScript and production build
passed (existing large-chunk warning retained). Twenty old/new actual-session
manual/no-target cases, 480 total ticks, matched on pose, speed, target, turret
health and projectile state. Independent review found no behavioral blocker.
The pending source pin is
`c22232c4455b0c03beeef16d8cfa3a94096a33cccfffca9588a695cdcf0606b1` →
`b5a9f0d217dc92143f916980a1ab5de95dc16f02bb9488c9cff5c270b7b06dbb`.
The old pin/history and the gate itself remain preserved pending manifest scope
approval. No PR, CI result, deployment or physical-device acceptance is claimed.

Optional-state schema follow-up (2026-10-18 JST): a new own-property regression
first failed because inactive assistance left an enumerable `assistClimbMode`
key with an undefined value. Clear, target-reset and inactive paths now delete
that optional key. The test covers initially inactive, target loss, target
switch followed by inactivity, and explicit clear, preserving original keys.
Focused tests now pass 14/14; full suite passes 156/157 with no skips and only
the same pending source-hash gate failure. TypeScript/build and 480 old/new
manual/no-target session ticks pass. Independent schema review passed. The
manifest and `src/game-state.ts` pin delta above remain unchanged; publication
is still pending the additional manifest authorization.

## 2026-10-18 publication repair candidate

The earlier four-file candidate and pending-manifest paragraphs above are
historical records. This follow-up includes the authorized manifest update and
repairs the publication comparison script, for eight changed paths in total.
The historical and previous-approved hashes remain intact; the immediately
preceding game-state approved hash and reason are retained in approval_history.
The new game-state SHA-256 was independently recomputed as
`b5a9f0d217dc92143f916980a1ab5de95dc16f02bb9488c9cff5c270b7b06dbb`.
The historical source gate itself is unchanged.

Deployment run [39055417020](https://github.com/chameleonjp-lab/gekichin/actions/runs/39055417020)
passed unit/build/UI checks but failed the preserved comparison when its elapsed
parser received `00:00.00` instead of legacy decimal seconds. The extracted
capture-time helper accepts both exact display formats and converts centiseconds
to the same 60 Hz logical tick. Only elapsed formatting is normalized for the
before/after comparison; raw HUD text remains in the captured evidence. All
other state fields, exact tick 12, bounded 16 ms steps, at-most-one-tick progress,
paused capture and unchanged-state checks are preserved.

Local verification on Node 24.19.0:
- Parser regressions: three failures with the old parser/comparison, then 4/4
  passed. Both formats round-trip every tick from 0 through 7,200; malformed
  formats and unsafe elapsed values are rejected. Non-time state differences
  and a different elapsed tick remain detectable.
- Full unit suite: 161/161 passed, zero failures/skips.
- TypeScript and production build passed. The existing large-chunk warning
  remains; the build used a separate output directory to preserve earlier files.
- Actual-session manual/no-target comparison: all 480 old/new ticks matched.
- Browser checks were attempted with the cloud's installed Chromium 154.0.8037.57,
  but the runner blocked Chromium's local socket before any application test.
  The supported elevated retry was also blocked by the execution environment.
  These attempts are not browser passes. Final-head CI results belong to the PR
  Checks; the full legacy comparison still requires its explicit workflow run.

This update does not claim physical iPhone acceptance, a merge, or publication.

### Speed-unit follow-up within the same eight paths

The comparison also spans an intentional HUD unit change: the fixed baseline
renders integer m/s and current main renders integer km/h. The prior parser-only
candidate would therefore reject equivalent `110 m/s` and `396 km/h` after the
time parser succeeded. The comparison now normalizes both elapsed formatting
and exact displayed speed quantities. Integer m/s is multiplied by 18 and integer
km/h by 5, giving common integer units of 1/18 m/s. No tolerance or extra rounding
is introduced: even an adjacent km/h is unequal, and `111 m/s` versus `400 km/h`
is deliberately rejected. Unknown, malformed and unsafe values fail. Raw HUD
evidence and the other five fields remain untouched.

Two new speed regressions failed before the follow-up and all six capture-helper
tests now pass. Full unit suite: 163/163, zero failures/skips. TypeScript/build
passed again with the existing bundle warning. An independent review found no
blocker and additionally checked 144,921 quantity pairs. Direct core-session
execution of both fixed baseline and candidate at Normal tick 12 gives physical
speed 110 m/s and altitude 1,000 m, with the expected old/current time and speed
displays; this is core evidence, not a browser screenshot result.

PR [#16](https://github.com/chameleonjp-lab/gekichin/pull/16) initial head
`443f4e9496fce9554ec7321437c426818932314d` passed its exact-head CI, including
161 unit tests, Chromium/WebKit camera-contract checks (one each), and 8 UI
checks. That head predates this speed follow-up. The explicit legacy-comparison
run at that earlier head is [39121631165](https://github.com/chameleonjp-lab/gekichin/actions/runs/39121631165).
Its result and the updated head's CI must be reported separately; neither an
older success nor a running check is final-head comparison evidence.
