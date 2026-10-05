# 実装状況

更新日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
作業ブランチ: `feat/gekichin-p0-p1`

ユーザー指示「計画書に従い実装開始」に基づき、P0の基準記録とP1の操縦プロトタイプを進めている。現時点の製品は戦闘ゲームではなく、飛行と画面・操作を確認するP1のプロトタイプである。P1範囲の自動検査は成功した。勝利経路・実機・性能の受入は未実施である。

## 固定基準と作業範囲

実装ブランチの起点は `4da953187ce15cbea50a6aa29fbc8ccd2f454faf`。初期P0/P1実装commitは `e432dd6e3921f2f19564091a931ea1dd05e19d8a`、最終コード・検査候補は `15fe3bba99d5a5964bdf9007048de315cc9f105a`。固定要件commitは `e9212a73a7b36c33dff7e88d3a7308be6cdcea35`、要件blobは `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`。既存 `README.md` のblob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0` を保った状態で始めた。P0の固定参照、ファイルごとの出典と差分、素材境界、性能manifestは [P0_BASELINE.md](./P0_BASELINE.md) に記録する。

## 段階別の状態

| 段階 | 状態 | 現在確認できる範囲 |
| --- | --- | --- |
| P0 基準・実施条件 | 記録済み | 要件/README/計画のblob、固定参照、移行分類、依存と実行環境、性能manifestを記録。実PCとiPhone 17 Proは利用できず、性能は未測定 |
| P1 操縦と最小画面 | 実装・自動検査成功。実機受入は未実施 | commit `e432dd6` の固定60Hz飛行、画面遷移、Easy/Normal、共通入力と設定、カメラ、停止と飛行プロトタイプ結果を実装。unit 12/12、build、headless Chromium 16/16は成功。初回CIでWebKit DOM 6/6成功。native visibilityはfixtureを修正しローカルheaded成功。修正後head `15fe3bb` の[CI](https://github.com/chameleonjp-lab/gekichin/actions/runs/37250362241)は全23件成功（fail/skip 0） |
| P2 母艦と砲台配置 | 未着手 | 製品用形状、100基、当たり判定、六面への攻撃経路は未実装 |
| P3 有限残機・味方銃撃・得点 | 未着手 | 50トークン、弾倉、損傷、採点、撃沈判定は未実装 |
| P4 敵砲台・僚機AI | 未着手 | 主砲/機銃の脅威、遮蔽、僚機攻撃経路は未実装 |
| P5 画面と結果の戦闘接続 | 未着手 | 実戦HUD・結果・保存は未実装 |
| P6 表現 | 未着手 | 母艦戦表現・戦闘音は未実装。P1の合成プロペラpreviewは限定的 |
| P7 最終検証 | 未着手 | 通常入力の100基撃沈、性能、15分/再出撃、実機検証は未実施 |
| P8 実装候補の提出 | 未着手 | P7を前提にした最終実装候補は未提出。今回準備するP0/P1段階Draft PRはP8完了や公開を意味しない |

P0の実機不在は未検証として固定した。模擬ブラウザ、スクリーンショット、OSのsoftware rendererをPC/iPhone実機の性能証拠へ読み替えない。

## P1プロトタイプの境界

- 暫定版は `gekichin-flight-p1-v1`、60Hz、seed `0x474b0001`。開始機は位置 `(0, 1000, 2000)` m、初速110m/s。値は飛行確認用であり、戦闘ルール採用値ではない。
- `home/preparing/playing/paused/result` はP1の飛行確認を管理する。resultは `flight-prototype` 型の中断／終了票で、撃沈結果・勝敗・スコア・best記録ではない。
- `scene.ts` の母艦は装飾用placeholder。砲台、HP、hitbox、衝突、攻撃可能経路はない。自機射撃操作は入力表示だけで弾を出さない。
- `flight-assist.ts` は固定Kaisen由来の有限補助数式を `FlightAssistTarget` adapter へ移した。P1から渡る標的一覧は空なのでターゲット補正・Easy自動射撃は動作しない。遮蔽adapter・有効標的はP2/P4で接続する。
- 敵、僚機、有限残機、爆発、砲台戦、損傷、得点、勝利経路はない。従って本プロトタイプで全滅条件、A01–A15、A19、A22–A24を通過したとは言わない。
- 音はWeb Audio oscillatorで生成する短いプロペラpreviewだけで、初期OFF。外部音源・フォント・画像は追加していない。P6の音響要件や聴感の合格ではない。

## 受入証拠と未確認

P1画面のChromium画像は `docs/evidence/p1/` に記録している。ホームと飛行画面は1366×768、キーボード／タッチ設定画面は393×852。いずれもCSS px相当、DPR1のsoftware-renderingを含むキャプチャで、ブラウザ内のWebGL画面も確認できる。画像はフレーム時間の測定、実GPU、タッチ実機、iPhone Safari、遊びやすさの評価ではない。

ローカル環境はNode `v24.19.0`、npm `11.9.0`。commit `e432dd6e3921f2f19564091a931ea1dd05e19d8a` の内容で `npm ci` 成功、`npm test` は12/12成功（skipなし）、`npm run build` 成功、headless Chromiumは16/16成功（失敗0、skip0、約2.6分）を [evidence](./evidence/p1/) に保存した。buildは641.76 kBのJavaScript chunkが500 kB警告を出したため、P7で実負荷を計測し原因を検討する。Playwright行列はheadless Chromium 16、WebKit DOM検査6、headed Chromiumのnative visibility検査1。WebKitはローカル必要ライブラリ不足だが初回CIで6/6成功。初回CIのnative検査はfocus emulationにより失敗し、公開API noDefaultsで接続するfixtureへ修正した。ローカル仮想displayのnative headed検査は成功。修正後head `15fe3bb` の[CI](https://github.com/chameleonjp-lab/gekichin/actions/runs/37250362241)は全23件成功（fail/skip 0）。GitHub Actions workflowはNode 24上でunit/buildとこのブラウザ行列を実行する。P1範囲の自動検査ゲートは成功。実PC/iPhoneの性能測定、Safari実機試遊、聴感、通常入力による勝利は未実施。

## ローカルで起動・確認する方法

リポジトリのルートで実行する。

```sh
npm ci
npm run dev -- --port 4177
```

ブラウザで `http://127.0.0.1:4177` を開く。起動中のサーバーを止めてから、P1範囲の検査には次を使う。

```sh
npm test
npm run build
npm run test:browser -- --project=chromium
```

`npm ci`、`npm test`、`npm run build`、`npm run test:browser -- --project=chromium` はP1候補で実行済み。Chromium16/16は成功し、unit/build/Chromiumの原票は [evidence/p1](./evidence/p1/) にある。Linuxで全ブラウザ行列を実行する場合はPlaywright browser/OS dependencyを導入した後、Xvfb下で実行する。

```sh
npx playwright install --with-deps chromium webkit
xvfb-run -a npm run test:browser
```

CI tested headは `15fe3bba99d5a5964bdf9007048de315cc9f105a`。[P1_VERIFICATION.md](P1_VERIFICATION.md) にCI URL・各projectの結果・初回失敗と修正を記録した。独立レビューで重大blockerなし。

## 次の段階

P1の自動検査結果と未実施の実機境界を保持し、次の実装はP2へ進む。P2では100基配置データ、遮蔽、経路、砲口位置をそろえてからP3へ渡す。今後のP2–P8はすべて未完了であり、先行段階の未検証を後段の推測で埋めない。
