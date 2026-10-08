# ゲキチン共通UIシェル候補

2026-10-07 UTC。G-04のHome・ルール・Pause・Resultの構成と日本語表示だけをカイセン基準へ合わせたローカル候補。画面実行・外観受入・公開の完了ではない。

## 固定した根拠

- G base commit: `de500c3e0e077fe2bab636dc2a382a8796ea8b9e`
- G base root tree: `c62b6d02b6c1a1778c5c49f43a794a94c70fd388`。`git/commits`の`tree.sha`から取得。recursive tree APIの先頭に返るcommit SHAとは区別
- K UI参照: `519fd0d50dfb2ce9a1145c0b58a1301b5c74d032` の [index.html](https://github.com/chameleonjp-lab/kaisen/blob/519fd0d50dfb2ce9a1145c0b58a1301b5c74d032/index.html)、[style.css](https://github.com/chameleonjp-lab/kaisen/blob/519fd0d50dfb2ce9a1145c0b58a1301b5c74d032/src/style.css)、[rules-guide.ts](https://github.com/chameleonjp-lab/kaisen/blob/519fd0d50dfb2ce9a1145c0b58a1301b5c74d032/src/rules-guide.ts)
- 適用要件: [G R60–R66/R71–R74](https://github.com/chameleonjp-lab/gekichin/blob/de500c3e0e077fe2bab636dc2a382a8796ea8b9e/docs/REQUIREMENTS.md)。旧4ボタン/v1記載より、同文書の承認済みレバー追記と現行v2契約を優先
- harness: `chameleonjp-lab/chameleonjp-browser-game-harness@2accbc6f062c6b7932777c61051df56a02302339`。core、ui-input、testing、security、gameplay、persistence、deliveryを今回の変更/保持境界へ適用。新しい運用機構は追加しない
- 読み取り表示コピーをbaselineにせず、必要な97ファイルを固定commitのGitHub base64正本から復元し、size/gitblob/SHA-256を検証。以前のAGENTS表示コピーとの差は末尾改行1個のみ

## 採用したUIとG固有の維持

Homeは全幅背景、ブランド行、見出し・目的説明、出撃準備、ルール→操作設定、footerの音切替というKの階層へ合わせた。desktopは左寄せ、短い横画面は2列、狭幅と拡大文字では内容を折り返し、縦スクロールを許す。レイアウトの成立は実ブラウザで未確認。

「操作モード」「イージー／ノーマル」「出撃する」「ルールと操作方法」「一時停止」「飛行を再開」「もう一度出撃」へ表記を合わせた。radio name/valueとGameMode、全既存DOM ID/event bindingは保持。Homeの音は次の操作、HUD/Pause/ResultはON/OFF状態とaria-labelによる次の操作を表示し、既存audio.toggleを使う。

G固有の母艦一隻・100基（主砲20/機銃80）・味方総残機50（自機込み）・同時8・残機による復帰・モード別の端末内ベストを保持。Pauseの「作戦を中断する」は従来どおり中断Resultを生成し、Kの「はじめから出撃」へ置換しない。Home、設定、説明、音の既存操作も残す。Resultは勝敗理由、時間、全6得点成分、20/80破壊内訳、損傷、自機／僚機損失、H/N、端末内bestと保存失敗表示を保持する。

新規CSSは `#home / #paused / #result / #guide` の内部だけ。root font/color、既存style.css、scene寸法、戦況HUDのdetails/scroll/情報階層/入力遮断、lever、settings transaction、tone/camera/aim/world/採点は変更しない。control-settings.ts/cssも無変更。K由来の5機、艦4隻、40秒増援、自機復活なし、爆弾／魚雷、ランキングは持ち込まない。FFの620px例外や他作品の候補にも触れない。

## 実行した検査

Node 24.19.0、Gの固定lockでnpm ci（ignore-scripts、audit/fundなし）。35 installed packagesの版がlockに一致。package.json/package-lock.json/workflow/Playwright設定は無変更。

| 検査 | 結果 | 証明する範囲 |
| --- | --- | --- |
| npm test | pass: 132/132、skip 0 | 既存124＋新規shell source contract 8。DOMの描画成功ではない |
| npm run build | pass | production sourceのstrict型検査＋Vite build。752.55kB JS chunk警告は残る |
| 変更したtest/spec 8ファイルの追加strict | pass | 新規2＋英語表示期待だけ更新した既存6。補助@types/node 24.19.1をtypeRoots指定、製品依存には追加しない |
| 全tests/browserの追加strict | fail: 既存6診断 | 別copyの固定baselineでも同じ6診断、ログbytes一致。今回の追加診断なし。全追加strict成功とはしない |
| Playwright test --list | pass: 64件収集 | Chromium/WebKit-ui/headedの現設定で収集できる。実行数は0 |
| 保持領域hash | pass | main runtimeは表示6箇所だけ正規化してbaseと一致。HUDは初期モード/音ariaだけ正規化。他src29ファイル、準備／撃沈template、Gルール本文（モード訳のみ）一致 |
| 異常検出probe | pass | 別copyの中断→敗北改変とroot CSS追加を、それぞれ意図したAssertionErrorで検出。通常node --import tsx経路で実行 |

全追加strictの既存診断は、throttle-lever.spec.tsの`/src`動的import 2件と旧作品名の型比較2件、combat-core.test.tsのtokenId、evasion.test.tsのundefined各1件。新規specのthis型不足1件は修正し、変更対象strictで再確認した。既存6件の修正をG-04へ混ぜない。

異常probeの初回tsx CLIはIPC socketのEPERMで起動失敗した。この2ログは異常検出成功に数えない。成功証拠はsocketを使用しない既存のnode --import tsx単体経路で取得した2つのAssertionErrorログに限定する。ブラウザやHTTP serverの起動・再試行・別経路への切替は行っていない。

検査ログ、source/changed-file manifest、復元patch、baselineとの保持証拠は候補に同梱する検証パッケージへ保存する。未取得の過去docs/evidence等は固定base treeの同じblobを継承し、この部分取得copyから削除したものとは扱わない。

## 実行していない受入

既知のbrowser socket EPERM制約により、今回のbrowser実行、同条件before/after画像、DOM位置・重なり・44px・実フォーカス・スクロール末尾・音聴感・実機検査は未実施。Playwright collection、静的CSS、buildでUI合格にしない。新規common-shell.spec.tsの4ケースは準備済みだが未実行。

実行可能な承認済み環境で次を確認する。

1. Easy/Normal各1回、Home→ルール→戻る→設定保存/破棄→出撃→Pause→ルール/設定→明示resume→中断Result→再出撃/Home。入力中立・停止時計・mode保持・focus復帰・best不変。新規specと既存pause/storage回帰を組み合わせる
2. 1440×900/DPR1、393×852/DPR3、852×393/DPR3、320×568/DPR2、568×320/DPR2 × 両モード × 通常/実computed文字200%。Home、Rules、設定両tab、Pause、Resultの末尾と主操作まで到達し、Tabと44pxを検査。ブラウザzoom200%は別条件
3. 同じviewport/DPR/fontのK/G before/after shellと、G戦闘HUD/scene/lever不変のguard画像を照合。Result fixture画像を自然勝敗とは区別する
4. 初期WebGL失敗でHome/設定/ルールが使え、開始できないこと。復旧後も明示再開。通常性能、自然勝敗、物理iPhone/公開の受入とは分離

リモートbranch/PR/CI/CloudTask、merge、課金、本番、配備・公開は未実施。適用AGENTSの標準担当（実装max）に対し、この実装workerは指示によりxhighで動作している制限を記録する。独立レビューは別担当の結果へ結び、自己点検を独立レビューと呼ばない。
