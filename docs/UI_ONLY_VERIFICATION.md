# UI-only検査記録

2026-10-08。対象は chameleonjp-lab/gekichin、基準は de500c3e0e077fe2bab636dc2a382a8796ea8b9e。この記録は今回のローカル作業だけを示す。COMMON_SHELL_VERIFICATION.md にあるG-04時点の数値は履歴として扱い、今回の実行結果へ読み替えない。

## この作業で変えた検査経路

- npm test と npm run build は通常入口のまま。
- npm run test:browser は playwright.ui.config.ts から5件のUI-only specだけを収集する。vite.ui.config.ts は正確な src/main.ts path、SHA-256、render anchorを検証し、検査用Vite server上だけで browser-tests/ui-only-state.ts を注入する。製品 src/main.ts にdebug API、URL state、HTML複製を追加していない。
- 通常UI specは直接設定した FlightSession fixture、停止したworld、実際の renderUi / updateHud / showReport と、製品の設定・ルールdialogを使う。自然プレイ、戦闘、自然勝敗、復帰周回、長時間負荷は起こさない。
- npm run test:browser:legacy は元の playwright.config.ts を使い、UI-only specを除く既存suiteを保つ。--list は64件を収集した。実行はしていない。scripts/capture-throttle-comparison.mjs は変更していない。
- 通常 .github/workflows/ci.yml はUI-only browser evidenceをartifactに保存する。旧全件suiteとbaseline checkout・二重 npm ci・same-tick compareは、手動 workflow_dispatch のbooleanを明示した別jobに分けた。.github/workflows/deploy-pages.yml は未変更・未起動で、旧比較が残る点を保留として記録する。

## 実行結果

| 項目 | 今回の結果 |
| --- | --- |
| npm ci | 成功。lockfileから35 packagesを導入。時間は個別計測なし |
| npm test | 成功。17/17 test-file workers、0 fail、0 skip。個別TAP caseは135/135成功、0 skip。tests/pages-deployment.test.tsを含む |
| npm run build | 成功。strict production typecheckとVite build。r2の3回のVite計測は0.317／0.367／0.362秒（最新0.362秒）。既存の752.55 kB JS chunk advisoryあり |
| 変更test/spec/config strict | 成功。13対象、TypeScript 5.9.3と既存の補助`@types/node` 24.19.1 typeRoots、診断0。依存追加なし |
| 全test/spec/config strict | 39対象中、基準と同じ既存診断6件のみ。G-04 strict baselineと行単位で一致し、新規診断0 |
| UI-only収集 | 成功。5件/1 spec file。--listのみ、画面実行0件 |
| 旧suite収集 | 成功。64件/12 spec files。--listのみ、画面実行0件 |
| browser server起動 | listen EPERM 127.0.0.1:4177。PlaywrightのwebServer起動が終了 |
| 撮影・画像目視 | 0枚・未実施。画面巡回と画像reviewの時間は未計測 |
| 実WebGL Canvas | 未確認。renderer起動やCanvas成功を示す証拠なし |
| same-tick比較 | 未実施。任意入口に残す |

browser serverのsocket制限を受け、localhost経路の迂回や同じbrowser起動の再試行はしない。UI-only specには393×852 / 852×393のcapture、320×568 / 568×320 / 1440×900と実computed 200%文字のgeometry・scroll・操作到達、設定失敗と今回だけ適用、配置衝突、Result保存失敗、WebGL不可案内captureの確認を定義したが、この環境では実行結果になっていない。各captureはその画面のfixture mode/phase/tickを記録し、実rendererが利用可能なら同じ固定状態を1回描画する。必要画面を短時間目標に合わせて省略していない。

setup / build / UI巡回capture / 画像reviewは別々に記録する。setup時間は未測定、r2の3回のbuild計測は0.317／0.367／0.362秒（最新0.362秒）、UI巡回captureと画像reviewは未実施のため、合計は未計測。約1分という画面確認目標の達成を主張しない。r1の記録にある0.348秒／0.318秒は前回実行値。

## 残る確認

初回のr1検査では`@types/node`が候補の依存に無く、追加strictを開始できなかった（TS2688）。r2では既存補助typeRootsの`@types/node` 24.19.1を読み取り専用で参照し、TypeScript 5.9.3で変更13対象と全39対象をnoEmit strict検査した。変更対象は診断0、全対象はG-04 baselineと同じ既存6診断のみ。`package.json`／lockへの依存追加はしていない。初回の全19path独立レビューで撮影状態の記録、Vite pluginのserver限定、Result/Home focus分岐などを反映し、今回の型修正は`browser-tests/ui-only.spec.ts`のResult画面IDをliteral unionで渡す1行に限る。

スクリーンショットの実取得・目視、focusとscrollの実ブラウザ確認、実Canvasの分類、画面確認時間は、browser serverを起動できる環境で必要。gameplayは本検査に含めず、プレイ確認は本人が行う。GitHub公開、Draft PR、merge、deployはこの候補では行っていない。
