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

## 2026-10-08 PR9後の画像レビュー追補

PR #9 のmerge後main `600585c89832c40f75d5fe967c7533b220fac0ac` を追補の基点とする。別担当が既存Actions artifact `11536348320` の重複を除く24 PNGを目視し、393×852のNormal長文通知が速度レバーの操作領域と射撃操作に重なる1件を報告した。これは画像レビュー結果の共有であり、この作業環境で画像を再取得・再目視した結果ではない。

修正は元の19 path内に限定する。`src/common-shell.css` で通常文字の通知だけを縦向き／横向きの操作領域間へ配置し、z-index、通知非表示、入力部品の無効化は使わない。`tests/common-shell.test.ts` はその単一selectorだけを許可し、他のHUD・操作CSSを変えない契約を維持する。`browser-tests/ui-only.spec.ts` は393×852と852×393の長文通知についてpause・fire・loop・throttle・compact HUD summaryとの8px以上の間隔を検証し、横向きcaptureも追加する。

WebGL不可画面は既存の初期captureを残し、`#render-note` へscrollした後の追加captureとviewport内assertionを加える。理由文が初期表示内にないことだけから到達不能とは結論しない。320×568、568×320、1440×900、200%文字は既存のgeometry検査条件を維持し、今回の画像として扱わない。

### ローカル追補検査

GitHub読取でmain `600585c89832c40f75d5fe967c7533b220fac0ac` を確認した。PR #9のmerge treeは `442088bdc719545c4d884cc603bea806b4ec823d`。保存済みr2 patchをde500c3上の完全checkoutへ適用した19 pathのroot treeも同じSHAになり、修正用checkoutはmerged mainと同じ全repo treeから始めている。CLI `git fetch` は作業環境proxyへの接続失敗だったため、GitHub読取結果とlocal tree照合で基点を確認した。

| 項目 | 追補の結果 |
| --- | --- |
| npm test | 成功。17/17 test-file workers、fail 0、skip 0。 |
| 詳細TAP | 成功。個別135/135 cases、fail 0、skip 0。17はfile worker数。 |
| npm run build | 成功。production typecheck / build pass。752.55 kB chunk advisoryは継続。 |
| 変更13対象 strict | TypeScript 5.9.3、既存補助`@types/node` 24.19.1で診断0。依存・lockfile変更なし。 |
| 全39対象 strict | G-04 baselineの6診断と完全一致。追加診断0。exit 2はbaseline診断による。 |
| UI-only収集 | 5件/1 file。`--list`のみ、実行0件。 |
| 旧browser収集 | 64件/12 files。`--list`のみ、実行0件。旧入口を保持。 |
| local browser / screenshot | 既知のlocalhost socket EPERMのため再試行せず未実行。capture 0枚、画像review 0枚。 |
| GitHub CI / 新artifact | PR #10の実行結果を後段に記録。 |
| 実WebGL Canvas | 未確認。 |

この追補ではportrait `notice-long`を非交差assertion付きで撮影し、landscape `notice-long`と`#render-note`へscrollしたWebGL不可画面のcaptureも追加する。GitHub CIの実行・artifact生成と新画像の目視結果は、local収集・画像reviewと分けて追記する。

### 独立review追記

別担当の独立reviewでは、長文通知の8px非交差検査が非表示要素をskipでき、横向きで対象操作部品が確認対象に入らない可能性を指摘した。通常HUDの通知検査に入る`#pause`、`#fire`、`#loop`、`#throttle`は、両viewportで先に表示assertionを通すよう変更した。`#combat-panel summary`だけは通常配置で非表示の場合があるため任意項目に残す。独立review担当が修正後のassertionを再確認し、指摘は解消、追加blockerなしと判定した。

assertion修正後も`npm test`は17/17 test files、fail 0、skip 0。production `npm run build`成功。変更13対象strictはTypeScript 5.9.3、現在この環境から参照できる既存補助`@types/node` 22.20.0で診断0。全39対象は既知のbaseline 6診断と完全一致し、追加診断0。r2時点での24.19.1補助型によるstrict記録は上記のとおり保存しているが、この追補の再実行ではその版の補助型rootを再取得できなかった。依存・lockfileは変更・追加していない。

追補後のbrowser収集はUI-only 5件/1 spec、旧suite 64件/12 spec。どちらも`--list`のみで画面実行0件。既知のlocalhost socket EPERMのためbrowserを再起動していない。ローカルcapture 0枚、画像目視0枚。CI結果は次項に記録する。

### PR #10 CI追記

Draft PR #10、head `d6cfe6505869b6f97391d24b3206790559688de8` のrun `37761058106` はsuccess。`npm ci`、`npm test`、production build、Chromium導入、UI-only browser test、artifact uploadの各stepが成功し、UI-onlyは5件pass（54.4秒）。手動専用の`legacy-flight-comparison` jobは今回skipされており、旧64件やsame-tick比較の実行成功とは扱わない。

artifactは`ui-only-browser-evidence`、ID `11541829036`、8,347,255 bytes。Actions runは`https://github.com/chameleonjp-lab/gekichin/actions/runs/37761058106`。GitHub artifact toolからfile referenceは得たが、このsandboxでその参照を開くsocket操作が`PermissionError: [Errno 1] Operation not permitted`となった。接続失敗後に再試行や別経路は使っていない。よってCI captureは生成済み、画像実体の目視は未確認のまま。通知の欠け・重なり、理由文captureの見え方、Canvas/WebGLの分類と画像確認時間は未確定であり、画像review完了とはしない。
