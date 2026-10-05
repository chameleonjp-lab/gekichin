# 実装状況

更新日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
作業ブランチ: `feat/gekichin-p0-p1`

ユーザー指示「計画書に従い実装開始」に基づき、P0の基準記録とP1の操縦プロトタイプを進めている。現時点の製品は戦闘ゲームではなく、飛行と画面・操作を確認するP1のプロトタイプである。P1完了や勝利経路の受入を示す文書ではない。

## 固定基準と作業範囲

実装ブランチの起点は `4da953187ce15cbea50a6aa29fbc8ccd2f454faf`。固定要件commitは `e9212a73a7b36c33dff7e88d3a7308be6cdcea35`、要件blobは `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`。既存 `README.md` のblob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0` を保った状態で始めた。P0の固定参照、ファイルごとの出典と差分、素材境界、性能manifestは [P0_BASELINE.md](./P0_BASELINE.md) に記録する。

## 段階別の状態

| 段階 | 状態 | 現在確認できる範囲 |
| --- | --- | --- |
| P0 基準・実施条件 | 記録済み。実装treeの最終blob表はP1安定後に確定 | 要件/README/計画のblob、固定参照、移行分類、依存と実行環境、性能manifestを記録。実PCとiPhone 17 Proは利用できず、性能は未測定 |
| P1 操縦と最小画面 | 実装済み。最終受入は保留 | 固定60Hzの飛行、画面遷移、Easy/Normal、共通入力と設定、カメラ、停止と飛行プロトタイプ結果を実装。unit 12/12、build、headless Chromium 16/16は成功。WebKit DOM検査6件、headed Chromium native visibility 1件、最終CIは結果待ち |
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

ローカル環境はNode `v24.19.0`、npm `11.9.0`。最終P1候補では `npm ci` 成功、`npm test` は12/12成功（skipなし）、`npm run build` 成功、headless Chromiumは16/16成功（失敗0、skip0、約2.6分）を `docs/evidence/p1/` に保存した。buildは641.76 kBのJavaScript chunkが500 kB警告を出したため、P7で実負荷を計測し原因を検討する。Playwright行列はheadless Chromium 16、WebKit DOM検査6、headed Chromiumのnative visibility検査1。WebKitはローカル必要ライブラリ不足、headed ChromiumはローカルXvfb/display不足で起動できず、残る7件とCI結果待ち。GitHub Actions workflowはNode 24上でunit/buildとこのブラウザ行列を実行する。P1の最終受入はWebKit/ headed native/CI結果を確認するまで未完了。実PC/iPhoneの性能測定、Safari実機試遊、聴感、通常入力による勝利は未実施。

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

上記コマンドは最終P1候補で実行済み。Chromium16/16は成功。Linuxで全ブラウザ行列を実行する場合はPlaywright browser/OS dependencyを導入した後、Xvfb下で実行する。

```sh
npx playwright install --with-deps chromium webkit
xvfb-run -a npm run test:browser
```

WebKit UI検査とnative visibility検査は、CI URL・tested head・各projectの結果とともに最終記録へ追記する。

## 次の段階

P1では固定参照との最終差分、入力所有と解除、設定の保存/取消/失敗、停止・再開・gap、代表画面を確定し、そのP1範囲の関連検査を実行する。P1完了後にP2へ進む。P2では100基配置データ、遮蔽、経路、砲口位置をそろえてからP3へ渡す。今後のP2–P8はすべて未完了であり、先行段階の未検証を後段の推測で埋めない。
