# P1 検証記録

更新: 2026-10-05 UTC  
作業ブランチ: `feat/gekichin-p0-p1`  
P1実装候補: `e432dd6` (`feat: start Gekichin flight and controls prototype`)  
固定要件: commit `e9212a73a7b36c33dff7e88d3a7308be6cdcea35` / `docs/REQUIREMENTS.md` blob `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`  
検証対象: P1 飛行・画面・操作設定のプロトタイプ。P1の最終受入はブラウザ一式とCIの終了後に確定する。

## 環境と実行状態

ローカルはNode `v24.19.0`、npm `11.9.0`、Vite `8.3.1`、Three.js `0.186.1`、Playwright `1.61.1`。Playwright Chromium `149` は `/workspace/.playwright-browsers` から起動し、ANGLE／SwiftShaderのソフトウェアWebGLを使った。WebKitは起動に必要なGTK／Grapheneなどのホストライブラリがないため、この環境では実行していない。

ローカルの `npm test` は2026-10-05 00:30 UTCに12/12成功、skip 0。`npm run build` はTypeScriptとVite buildが成功した。実行ログは [unit.log](evidence/p1/unit.log) と [build.log](evidence/p1/build.log)。生成JavaScriptは641.76 kB（gzip 166.89 kB）で、500 kBを超えるVite警告が残る。性能合格を示す結果ではない。

独立Playwright検査では、カスタム停止キーをEnterにした場合のホーム／結果ボタン、2.1秒のイベントループ停止後の明示再開、WebGL初期化失敗時の設定／説明表示と飛行開始拒否をChromiumで確認した。タッチ配置プレビューと他作品の保存キー保護も、393×852 CSS pxのChromium画面で確認した。初期の入力テストfixtureが全接触をprimaryとしていたため、入力コードが新しい同種primaryを受けて前の同種接触を正しく整理した場面を、fixture側が失敗として数えた。fixtureは実際のmulti-touchのprimary／secondaryへ直した。最初のブラウザ試行では、マウスクリックでキーボード編集を開いた状態をタッチプレビューとして検査していたことと、縮小プレビューへ44pxの実ボタン最小径を誤適用したことが原因で検査側の期待が失敗した。操作を実タップへ直し、プレビュー径を画面比率に応じた1:1縮小値と比較するよう修正した。また、viewport resize直後にキーを押すPlaywright操作が描画レイアウトの解除より早かったため、入力fixtureで2描画フレームを待つようにした。いずれも検査側の修正で、これらの失敗に対する製品コード変更はない。

2026-10-05 00:33 UTCの最終ローカルChromium一式は16/16成功、fail 0、skip 0。検査したソースとブラウザspecは後にcommit `e432dd6` として記録され、検査後の差分はこの証拠文書だけである。コマンドは `PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers npm run test:browser -- --project=chromium`。記録は [chromium.log](evidence/p1/chromium.log) と [chromium-results.json](evidence/p1/chromium-results.json)。この一式は通常飛行／停止／再出撃、入力所有と解除、Easy／Normalと10回再出撃、WebGL loss／restore、明示再開、visibilitychange fixture、AudioContext再利用、Enter所有、2.1秒gap、WebGL初期化失敗、設定保存／future version／multi-key rollback、タッチpreviewの縮尺と外部保存キー保持、画面寸法・200%文字を含む。

PR初回CI（head `3efa0d6`、[run 37248357323](https://github.com/chameleonjp-lab/gekichin/actions/runs/37248357323)）はunit/build成功、Chromium 16/16、WebKit UI 6/6成功、native visibility 1件失敗で合計22/23だった。原票は [ci-first-failed.log](evidence/p1/ci-first-failed.log)。Playwright標準接続のfocus emulationが非アクティブタブも可視扱いにしていたため、検査用の新しいChromium・一時profileへ公開API `connectOverCDP({noDefaults:true,isLocal:true})` で接続するfixtureへ修正した。製品コードの変更やhidden値の注入はない。

当初ローカルはXvfb不在だったが、Debian配布物を一時ディレクトリへ展開した仮想displayでheaded検査を実行した。Chromium `149.0.7827.55`、実viewport 1365×624 CSS px、DPR1。同一windowの別タブでnative `document.hidden=true`、停止と時計凍結、戻っても停止を保持、明示再開後の進行を確認した。原票は [native.log](evidence/p1/native.log) と [native-results.json](evidence/p1/native-results.json)。head `323c5b1` のPR CI run 37249688408は全23件成功。ただし同headのpush CI run 37249686323はassertion成功後のprofile削除でENOTEMPTYとなった。原票は [ci-cleanup-failed.log](evidence/p1/ci-cleanup-failed.log)。公開CDP Browser.closeによる正常終了と子プロセス終了待機、必要時の終了fallback、一時profile削除の最大10回・100ms線形backoff再試行（最大5.5秒）を追加した。最終fixtureはローカル5/5反復成功、型検査成功。原票は [native-cleanup-retry.log](evidence/p1/native-cleanup-retry.log) と [native-cleanup-retry-results.json](evidence/p1/native-cleanup-retry-results.json)。修正後CIは結果待ち。

## P1対象の結果

| 要件 | 検査範囲 | 現在の結果 |
| --- | --- | --- |
| R61 | blur、pointercancel、resize後に操縦／ボタン／キー入力が残らない。宙返り中の操縦割込みと遷移もP1フローで確認 | 単体12/12とChromium 16/16に解除・所有テストを含む |
| R62 | Easy 1ボタン／Normal 4ボタンの配置編集、スクロール可能な設定プレビュー、画面寸法と径の比例 | Chromium 16/16。393×852でpreview/scroller境界と縮尺を読み、指定画面寸法と200%文字は同じ全体検査で確認 |
| R63 | 9操作、Enterを停止へ割り当てた場合のホーム／結果ボタン所有、他作品キーを読み書きしない | 単体12/12、Chromium 16/16 |
| R64 | 保存途中失敗のrollback、future versionを上書きしない、ドラフトを明示保存するまで適用しない | 単体12/12、Chromium 16/16 |
| R73 | 2秒以上のgapで巨大dtを取り込まない。WebGL初期化失敗時に案内し安全に開始を止める。context loss復帰時は明示再開 | 単体12/12、Chromium 16/16。context loss／restore、描画初期化失敗、2.1秒gapを画面で検査 |
| R74 | 停止時計とフォーカス復帰、素早い再出撃／disposeで二重ループや残留資源を作らない | Chromium 16/16。停止／再出撃と10回反復、1 canvas／settings／audio資源、visibilitychangeの明示再開を確認。native tab-hiddenはローカルheaded検査成功、修正後CIは結果待ち |

この結果はP1プロトタイプの対象範囲だけを示す。Combat、100基の撃沈経路、勝敗、得点、性能、実機操作、iPhone Safari、聴感、全受入A07／A16／A17／A19／A21を通過したという意味ではない。

## 画面記録と実機境界

Chromium画面キャプチャは [home-chromium-1366.png](evidence/p1/home-chromium-1366.png)、[flight-chromium-1366.png](evidence/p1/flight-chromium-1366.png)、[keyboard-chromium-393.png](evidence/p1/keyboard-chromium-393.png)、[touch-chromium-393.png](evidence/p1/touch-chromium-393.png)。これらはソフトウェア描画を含む自動ブラウザ上の画像確認で、実GPU、性能、人間の操作感、タッチ実機、Safariを検査した証拠ではない。実PC／iPhone／Android端末の試遊、実機性能、実聴は未実施。

PR headのChromium／WebKit／headed検査結果とCI URLは、各実行完了後にこの記録および [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) へ追記する。
