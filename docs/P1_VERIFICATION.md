# P1 検証記録

更新: 2026-10-05 UTC  
作業ブランチ: `feat/gekichin-p0-p1`  
固定要件: commit `e9212a73a7b36c33dff7e88d3a7308be6cdcea35` / `docs/REQUIREMENTS.md` blob `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`  
検証対象: P1 飛行・画面・操作設定のプロトタイプ。P1の最終受入はブラウザ一式とCIの終了後に確定する。

## 環境と実行状態

ローカルはNode `v24.19.0`、npm `11.9.0`、Vite `8.3.1`、Three.js `0.186.1`、Playwright `1.61.1`。Playwright Chromium `149` は `/workspace/.playwright-browsers` から起動し、ソフトウェアWebGLを使った。WebKitは起動に必要なGTK／Grapheneなどのホストライブラリがないため、この環境では実行していない。

ローカルの `npm test` は2026-10-05 00:30 UTCに12/12成功、skip 0。`npm run build` はTypeScriptとVite buildが成功した。実行ログは [unit.log](evidence/p1/unit.log) と [build.log](evidence/p1/build.log)。生成JavaScriptは641.76 kB（gzip 166.89 kB）で、500 kBを超えるVite警告が残る。性能合格を示す結果ではない。

独立Playwright検査では、カスタム停止キーをEnterにした場合のホーム／結果ボタン、2.1秒のイベントループ停止後の明示再開、WebGL初期化失敗時の設定／説明表示と飛行開始拒否をChromiumで確認した。タッチ配置プレビューと他作品の保存キー保護も、393×852 CSS pxのChromium画面で最終候補の全体検査に含めている。最初の試行では、マウスクリックでキーボード編集を開いた状態をタッチプレビューとして検査していたことと、縮小プレビューへ44pxの実ボタン最小径を誤適用したことが原因で、検査側の期待が失敗した。操作を実タップへ直し、プレビュー径を画面比率に応じた1:1縮小値と比較するよう修正した。製品コードはこの2件のために変更していない。

実装担当の最終Chromium一式はこの記録作成時点で16件中8件がpassしており、残りは実行中。Chromiumの完了結果、WebKit UI 6件、OSタブ非表示を含むheaded Chromium 1件、およびCIは未確定である。最終headと最終結果は、テスト完了後に追記する。

## P1対象の結果

| 要件 | 検査範囲 | 現在の結果 |
| --- | --- | --- |
| R61 | blur、pointercancel、resize後に操縦／ボタン／キー入力が残らない。宙返り中の操縦割込みと遷移もP1フローで確認 | 単体12/12に解除・所有テストを含む。Playwright最終一式は実行中 |
| R62 | Easy 1ボタン／Normal 4ボタンの配置編集、スクロール可能な設定プレビュー、画面寸法と径の比例 | 393×852 Chromiumの独立プレビュー検査を最終一式に含む。別寸法の画面検査はP1 UI suiteの完了待ち |
| R63 | 9操作、Enterを停止へ割り当てた場合のホーム／結果ボタン所有、他作品キーを読み書きしない | 単体とChromium独立検査を実行。最終全体結果待ち |
| R64 | 保存途中失敗のrollback、future versionを上書きしない、ドラフトを明示保存するまで適用しない | 単体12/12にrollback／future version no-writeを含む。設定の実画面検査はP1 UI suiteの完了待ち |
| R73 | 2秒以上のgapで巨大dtを取り込まない。WebGL初期化失敗時に案内し安全に開始を止める。context loss復帰時は明示再開 | 固定ステップ単体とChromium独立検査を実行。context loss中・復帰後の実画面検査はP1フロー一式の完了待ち |
| R74 | 停止時計とフォーカス復帰、素早い再出撃／disposeで二重ループや残留資源を作らない | 単体の操作所有とPlaywright統合検査は最終一式の完了待ち。OS非表示後の復帰はheaded CI検査待ち |

この結果はP1プロトタイプの対象範囲だけを示す。Combat、100基の撃沈経路、勝敗、得点、性能、実機操作、iPhone Safari、聴感、全受入A07／A16／A17／A19／A21を通過したという意味ではない。

## 画面記録と実機境界

Chromium画面キャプチャは [home-chromium-1366.png](evidence/p1/home-chromium-1366.png)、[flight-chromium-1366.png](evidence/p1/flight-chromium-1366.png)、[keyboard-chromium-393.png](evidence/p1/keyboard-chromium-393.png)、[touch-chromium-393.png](evidence/p1/touch-chromium-393.png)。これらはソフトウェア描画を含む自動ブラウザ上の画像確認で、実GPU、性能、人間の操作感、タッチ実機、Safariを検査した証拠ではない。実PC／iPhone／Android端末の試遊、実機性能、実聴は未実施。

PR headのChromium／WebKit／headed検査結果とCI URLは、各実行完了後にこの記録および [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) へ追記する。
