# ゲキチン 手動操縦・射線・表示の検査記録

2026-11-07 JST / 2026-11-06 UTC。ゼロシリーズ [共通計画 PR13](https://github.com/chameleonjp-lab/zero-series/pull/13) に基づく候補。カイセン K1–K3 の focused14/14 合格連絡後に着手した。本人のマージ・公開・iPhone受入は別段階であり未実施。

## 開始版と公開版

- 開始 main: `a44fc39d7bebb1409421993722bf9ba1f85de6e9`、開始時の作業変更なし。候補ブランチ `fix/manual-camera-aim-20261107`。
- 公開URL: https://chameleonjp-lab.github.io/gekichin/ 。取得した `deployment.json` は `102c23ff4af10f67edb099632cf2aeed358b6449`。その後のmain変更はREADMEだけで、開始mainからのbuildと公開4ファイルの全バイトが一致した。公開JS `assets/index-DknftEkI.js`、761109bytes、SHA256 `97221a6c39ab586274e0ef521e42c25b9c2fa1a1286bc9e1cf068ef8825019c7`。
- [公開ファイル照合原票](evidence/aim-assist-removal-20261107/p0-public-files.json)。これは取得済みプログラムの照合で、候補公開や古いタブの更新を意味しない。

## 修正前の再現

[P0数値原票](evidence/aim-assist-removal-20261107/p0-probe.json) / [標的と入力アダプター原票](evidence/aim-assist-removal-20261107/p0-extended.json)。seed73、操縦の比較高度1500。数値fixtureは製品の通常攻略やGPU性能の代用ではない。

| 条件 | Easy | Normal |
| --- | ---: | ---: |
| 開始100基の全件標的遮蔽照会 / tick | 100 | 100 |
| 20度上向き・中立の指を0.2秒保持した戻り | 9.386182度 | 9.386182度 |
| 120Hz相当で上昇.45を表示、初期を除く48表示の同一視線 | 24/48 | 24/48 |
| 背後の敵による要求旋回倍率 | 1.65 | 1.65 |
| 右105・前500の標的が中立時に要求するturn | .2132686100 | 0 |

Easyの通常弾は両MG銃口で約.821/.797度、両機関砲銃口で約.906/.705度、機首正面から曲がった。実入力アダプターのEventTarget検査では、402×874→402×820の高さだけの変化で、window/visualViewportの双方・両モードとも操縦pointer1が失われ、以後同じ指を動かしても入力0だった。OS・Safari実機ではなく、実ハンドラーとDOM寸法の代替を使った検査。

## 候補の動作と検査

- 操縦は両モードとも手入力のみ。敵に応じた倍率1、過去のturn/climb補正も操縦へ渡さない。Easyの巡航、自動射撃、Normalの保持射撃を維持。
- Easyの可否は発射時点で用いる固定tick開始姿勢・画面比・1500m以内・生存・照準円内・実遮蔽で判定し、その姿勢を両銃口へ保存する。プレイヤー通常弾は正面へ飛び、僚機の散布・敵射撃・弾数・装填・時間・採点・保存は従来の論理を使う。
- 100基の操縦専用遮蔽照会を廃止。視界と距離で絞った表示/射撃候補だけを照会する。初期状態の全体100回は10回の必要な表示/射撃照会になり、操縦側は0回。開いている詳細表示の照会は表示playerを使い、別集計する。AI/実弾/表示の照会と操縦の照会を同一視しない。
- 指の中立保持は機首角を保ち、解放後は滑らかに水平へ戻る。同じ幅の高さ変更は指と操作量を保ち、次の移動をリベースする。画面回転・不明な寸法・離脱・停止は解除し、OSによる1指の取消しは他の所有指を残す。
- 固定tick前後の位置・姿勢・bank・銃弾を描画専用に補間し、同じplayerをカメラとNormal照準へ渡す。Easyの円は従来の固定白色。開いている標的詳細は表示playerから選び直し、確定tickの射撃標的を使い回さない。開始・停止・再開・作戦変更・世代変更・操縦権交代では古い姿勢を混ぜない。
- 母艦の静的遮蔽、cameraCast半径1.5と外向き押出2.05、5秒の撃沈表示、得点/記録キー/配信設定を維持。

| 自動検査 | 実施結果 |
| --- | --- |
| `node --import tsx tests/aim-assist-removal.test.ts` | 7/7。両モードで敵なし/正面/円外/画面端/背後/交差/消失、小さい上下左右/斜め。全12tickの自機と有効カメラが一致。Easyの発射有無が変わっても操縦不変。両MG/機関砲の初速方向一致、20度保持、縦横の円判定、実船体に隠れた92番砲台への不発射。 |
| `node --import tsx tests/flight-presentation.test.ts` | 3/3。両モード0/48同一視線、30/60/120Hzの確定flight/弾/score/events一致、表示が論理を書き換えない。alpha0/.5/1で標的の進入・ID切替・退出が一致。停止/世代/作戦変更の旧姿勢除外。 |
| `node --import tsx tests/input-ownership-regression.test.ts` | 3/3。別指射撃/レバー保持、個別cancel、高さだけのwindow/visualViewport変更後の同じ指の継続と次の移動、画面回転解除。追補で同じ幅402の430→390・390→430、およびmainのcompact HUD境界460↔430を両モードで検査。 |
| `npm test` | network有効の実行で **171/171ケース成功、fail0/skip0（37.28秒）**（高さ境界の追補後）。初回候補は170/170（49.30秒）。個別ケースを含む全stdoutを保存。通常sandboxの旧実行は23ファイルとしか表示されないため最終ケース数の根拠に使わない。最初の候補実行で旧ソース固定と寸法不明resizeの3ファイルが失敗し、明示的な差分追記と不明寸法解除で修正した。 |
| `npm run build` | 最終固定ソースで型検査/build成功。既存の500kB超bundle警告あり。JS `index-DG4yMjkM.js`、SHA256 `7736e4c444257d426fec68e41ca0fedfc06d9bafb42e621abdac4a1b2591e272`（高さ境界の追補後）。 |
| 通常出撃ブラウザ、Chromium/WebKit camera-contract、UI-only | 共有実行機のブラウザ枠待ち。未実行。 |
| `node scripts/capture-throttle-comparison.mjs <c0cf927 baseline>` | baselineを隔離展開して依存導入済み。ブラウザ枠待ち、未実行。 |
| `BUILD_COMMIT=<候補commit> node scripts/prepare-pages.mjs` | 追補ソースcommit `f0d97230b9520c60ddf6223460c7942012edc8ac` のbuildで成功。外部連携・検査フック・source map・絶対asset・NOTICE・配信ファイル制限を検証。[追補manifest](evidence/aim-assist-removal-20261107/height-crossing-pages.json)。初回候補 `2e988692c9b63f293b2b8f259fc843429e884fdd` の[manifest](evidence/aim-assist-removal-20261107/candidate-pages.json)も保存。 |

新条件の [RED](evidence/aim-assist-removal-20261107/red-aim.log) / [input RED](evidence/aim-assist-removal-20261107/red-input.log) / [表示 RED](evidence/aim-assist-removal-20261107/red-presentation.log) / [表示標的 RED](evidence/aim-assist-removal-20261107/red-display-target.log) と [aim GREEN](evidence/aim-assist-removal-20261107/green-aim.log) / [表示 GREEN](evidence/aim-assist-removal-20261107/green-presentation.log) / [input GREEN](evidence/aim-assist-removal-20261107/green-input.log) を保存した。旧追尾・補正を期待した検査を新条件へ更新し、従来の来歴原票は書き換えず [今回の許可差分](evidence/aim-assist-removal-20261107/source-deltas.json) を追加した。UI-onlyのソースhashも実際のmainへ合わせ、検査専用アダプターを製品buildへ混入させない。

## 独立レビュー追補: 高さだけの変更が境界を越える場合

独立レビューの指摘を実コードで再現した。`input.ts` は幅不変でも縦横比が1を越えると回転と判定し、402×430→402×390でpointer1を失った。別の`main.ts` の `fitHud` はcompact HUDが変化する402×460→402×430でpointer7を失った。[追補RED](evidence/aim-assist-removal-20261107/red-height-crossing.log) はこの2件の失敗を保存している。

縦横比による解除を除き、inputの実際の幅変更・明示的なorientationchange・離脱/取消しの従来解除を維持した。mainのHUD再配置は設定レイアウトを再計算し、入力を解除しない。両モードの430↔390と460↔430で同じ指と操縦量を保ち、Normalの射撃/レバー所有も維持する。[追補GREEN](evidence/aim-assist-removal-20261107/green-height-crossing.log) 3/3、[全unit原票](evidence/aim-assist-removal-20261107/height-crossing-unit.log) 171/171、[build原票](evidence/aim-assist-removal-20261107/height-crossing-build.log) 成功。main検査は製品関数を抽出して実FlightControlsとDOM代替で実行し、ブラウザ/GPUや実機の成功としては扱わない。共有ブラウザ枠の保留中に追補し、追加ブラウザ実行はしていない。`BUILD_COMMIT=f0d97230b9520c60ddf6223460c7942012edc8ac node scripts/prepare-pages.mjs` も成功し、[追補原票](evidence/aim-assist-removal-20261107/height-crossing-pages.json)を保存した。

## 未実施と判定の境界

ブラウザ結果、実機iPhone17Pro/Safariの両モード縦402×874・横874×402・短い402×700、指操作感、表示間隔中央値/p95、本人のマージ後の正式ページ照合と古いタブ再読込は未実施。数値fixtureの0/48や照会数を実端末の滑らかさ/性能の測定値へ読み替えない。提出先は親担当が作成した [Draft PR #18](https://github.com/chameleonjp-lab/gekichin/pull/18)。追補の提出SHAとCI結果はPR Checksおよび提出原票を正本とし、ローカル検査と混同しない。main・マージ・公開はこの担当では実行しない。
