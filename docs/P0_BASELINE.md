# P0 基準・移行台帳

記録日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
実装ブランチ: `feat/gekichin-p0-p1`

この台帳は固定参照、移行範囲、出典、測定前の性能条件を記録する。コードの移行分類は、同梱したファイルを固定元のblobと比較して更新する。元作の過去の検査結果は本作の実装・性能・権利の検査結果に代用しない。

## 基準リビジョン

| 対象 | 固定値 | 確認 |
| --- | --- | --- |
| 実装開始時の Gekichin main/head | `4da953187ce15cbea50a6aa29fbc8ccd2f454faf` | 作業ブランチの起点 |
| P0/P1コード候補 | `e432dd6e3921f2f19564091a931ea1dd05e19d8a` | P1 local unit/build/Chromiumの対象head。WebKit/ headed native・CIの結果は未取得 |
| 固定要件 commit | `e9212a73a7b36c33dff7e88d3a7308be6cdcea35` | `docs/REQUIREMENTS.md` の blob `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c` と一致 |
| 現行計画 | 作業起点 `4da9531` | `docs/IMPLEMENTATION_PLAN.md` の blob `11dec1af2004ec3d71357d9eae029e324c6fdf3c` |
| 既存 README | 作業起点 `4da9531` | blob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0`。実装開始時に同じ値を再確認 |
| Kaisen 固定参照 | `3d751051dc6212482a129e8da596ddd349b2f9f5` | 操縦・機体・入力・設定・カメラの候補元 |
| Faitofuraito 固定参照 | `c2b313d37875b93458032d98636fcf5b5d30a138` | 共通操作の適応境界を確認。今回この ref の製品コードは直接移行しない |
| Machimamore 固定参照 | `38534ef0788a9876e73e2f819ad1db5cc63c3858` | 計画が参照する設定・世界観資料。本作へコードや画像・モデルは移さない |

確認コマンドは `git hash-object README.md docs/REQUIREMENTS.md docs/IMPLEMENTATION_PLAN.md` と `git cat-file` による固定要件blob読戻し。要件・READMEの作業起点blobはいずれも計画記載値と一致した。P0/P1のローカル変更は Draft 文書PR時点の「文書のみ」制約を引き継がず、今回の作業ブランチへ加える。

## 再利用範囲と権利の根拠

Kaisen固定版の [`docs/PLAN.md`](https://github.com/chameleonjp-lab/kaisen/blob/3d751051dc6212482a129e8da596ddd349b2f9f5/docs/PLAN.md) §3（blob `264f98fb9ed2a6940729ca12e34cdcb6d09d8144`）は、元作に一般公開ライセンスがないこと、所有者からの再利用依頼を対象作品への複製根拠とすること、第三者への一般的利用許諾とは主張しないこと、Three.js等のNOTICEを保持することを記録している。本作では、利用者がこのGekichinリポジトリの計画に従って実装を開始するよう指示した範囲を、所有者によるGekichin向けの再利用指示として扱う。これはGekichin以外への許諾でも、Kaisen/Faitofuraito全体をMIT等で再ライセンスする根拠でもない。移行対象は下表に限定し、今後増やすコードごとに出典・差分・対象repoを追記する。

`src/control-settings.ts` のKaisen固定版には、Faitofuraito `025cad4930b487628675a0e20a88323aae0fac89` の設定コードを適応した旨のソースコメントがある（そのrefの同ファイルblob `516f99ce3896d4eff03ff4196050607b5f935987`）。さらにFaitofuraito固定版 [`docs/SHARED_CONTROLS_SYNC.md`](https://github.com/chameleonjp-lab/faitofuraito/blob/c2b313d37875b93458032d98636fcf5b5d30a138/docs/SHARED_CONTROLS_SYNC.md)（blob `84f68f52817cf7764cacb56a848171a764f2e907`）は、共通操作をKaisenの固定版に合わせる限定同期として記録している。移行台帳ではこの来歴を保持し、Faitofuraitoから一般ライセンスがあるとは推定しない。

| 物 | 基準・内容 | 扱い |
| --- | --- | --- |
| Kaisen由来のソース | 下記のファイル単位で追跡 | 本作向けの限定複製・適応。第三者の利用権を表明しない |
| Faitofuraito由来の設定コード | Kaisen固定版の `src/control-settings.ts` が参照する `faitofuraito@025cad...` の来歴 | Kaisen内での適応を経た範囲のみ。将来の同期版を追従しない |
| Three.js | `three@0.186.1`。Kaisen固定版 `public/third-party-notices.txt` のMIT表記を本作へ保持 | NOTICEを同梱。これを元作全体や全素材のライセンスと扱わない |
| npm依存 | `package-lock.json` の85パッケージにはMIT 64、MPL-2.0 12、Apache-2.0 6、BSD-3-Clause 2、ISC 1のライセンスmetadataがある | metadata集計であり全文NOTICEの確認ではない。配布前に依存ごとの条件と必要NOTICEを確認する |
| 画像・音・フォント | P1に外部取得素材なし。機体の補助テクスチャはコード生成。`audio.ts` はWeb Audio oscillatorでプロペラのpreview音を合成し、初期OFF。`docs/evidence/p1/*.png` は検査用captureで配布素材ではない | 元作の画像・音・フォントは複製しない。P6で本番音を作る際も合成音と実聴を区別 |
| 母艦・砲台モデル | `src/scene.ts` はP1の装飾placeholderのみ。砲台・HP・hitboxはない。製品用母艦・砲台はP2以降で手続き生成予定 | Machimamoreからモデルや画像をコピーしない。実装者・生成手法を記録 |
| Faitofuraitoの公開画像・ランキング資産・機能 | 固定refに存在 | 今回は移行しない。ランキング・ネットワーク・bomb/torpedo関連も不採用 |

## ファイル別の移行台帳

「固定元blob」はKaisen固定版のGit blob ID。「本作側blob」はP1候補commit `e432dd6e3921f2f19564091a931ea1dd05e19d8a` のファイルblobで、`git hash-object` の値と照合した。SHA-1 blob IDを使い、変更があれば新しい値へ更新する。

| Gekichinパス | 固定元 | 固定元blob | 区分 | 本作側blob |
| --- | --- | --- | --- | --- |
| `src/aircraft.ts` | Kaisen `3d751051` | `e4e3009464bb8c4ae473b7cfc46d010198c27149` | 同一コピー。Three.jsの手続き生成機体 | `e4e3009464bb8c4ae473b7cfc46d010198c27149` |
| `src/flight.ts` | Kaisen `3d751051` | `3019be9650863c11cc1c57f7bb7e09ab815c9c07` | 小変更。pitch参照を本作の暫定rulesへ接続し、出典コメントを追加 | `85c67b13f2536c47ab1482d517019385cbd4779d` |
| `src/flight-view.ts` | Kaisen `3d751051` | `87f83928a00092338391442ec2d7e87e3b4e33da` | カメラ式を移行。ローカル型への接続・出典コメント | `5e6df456cac0d12abf26b02ffd7b5874c9445b65` |
| `src/flight-assist.ts` | Kaisen `3d751051` | `799efdfb97c3b9ba435e8eaf4080f65b74326773` | 小変更。有限の操縦・射撃補助数式を移行し、標的を本作の `FlightAssistTarget` adapter へ置換 | `e4011df17ae2a13c506de27fa0c149d1a6ae44ae` |
| `src/dialog-focus.ts` | Kaisen `3d751051` | `5d10d15cb0b9d3de31871af98a7801d638a5055b` | 同一コピー。モーダル焦点制御 | `5d10d15cb0b9d3de31871af98a7801d638a5055b` |
| `src/keyboard-settings.ts` | Kaisen `3d751051` | `eb143ac27b3f65b66912d10b89ec17d0efc581b2` | 小変更。保存キーと9操作へ適応し、bomb/torpedo操作を除去 | `7becf7372a521322a850d497dfcd0d15abecf903` |
| `src/input.ts` | Kaisen `3d751051` | `0edbd1c5f9f07a2d1088539e188bab0329ab53f0` | 小変更。爆弾・魚雷ボタンと入力を除去 | `5223093b86113176ff902d105f97dddcdbf74f39` |
| `src/control-settings.ts` | Kaisen `3d751051` | `5208c4da8ebe014552cae855d84c2574ab152292` | 小変更。保存キー・ボタン構成・旧payload設定UIを本作向けに適応 | `b6251a56bd1f98a1036c7eb2512b3fb0503f522c` |
| `src/control-settings.css` | Kaisen `3d751051` | `1235392f369ac27ef3056852512319fe6994300b` | P1実装担当の分類は出典コメントのみ。CSS規則はKaisen固定版から維持 | `56baefe70f88fc951ecbc6a4a5b278c300459ade` |
| `public/third-party-notices.txt` | Kaisen `3d751051` | `805bf99e222a8c6433f78eb06f407224accb120c` | Three.js MIT NOTICEの同一コピー | `805bf99e222a8c6433f78eb06f407224accb120c` |

本作側blobはP1のローカル検査を終えた候補commitの値。commit treeと作業ファイルのblobを再照合した。

### 新規作成したP1コード・検査のblob

| Gekichinパス | 本作側blob | 分類 |
| --- | --- | --- |
| `src/rules.ts` | `36ad80418c575eaa027573ce93c85c72fbea3225` | 暫定飛行確認ルール・seed |
| `src/types.ts` | `20a326f1431d682a026b17f1ca815f0112bc5e14` | 本作の飛行状態型 |
| `src/game-state.ts` | `a95bea075553a6b1e04d0491bfef9404f8ff3f8c` | 60Hz飛行sessionとframe scheduler |
| `src/main.ts` | `14643a39d350395e8cfbaee85e8fd819a37a2304` | P1画面と遷移 |
| `src/scene.ts` | `963875bd42751b9d85f2190fb3562a4322f3dec0` | placeholder母艦と描画 |
| `src/style.css` | `ab2a2b36019117447c2be91c2dd540aec79df685` | 本作P1画面 |
| `src/audio.ts` | `8852e40ee74de68c222f2431ff6e9d039a6b8422` | 合成プロペラpreview、初期OFF |
| `tests/flight.test.ts` | `604efaa89bcf5c6ad0f1015c1ccf64fdc9e7d4c0` | 飛行、カメラ、seed、補助の単体検査 |
| `tests/p1-independent.test.ts` | `229fa6ed51c86eea27beb3de8a945836d4aba4d1` | 入力所有、設定保存、gapの単体検査 |
| `browser-tests/p1-independent.spec.ts` | `fcdf7e43d9b41503f8dad6627e17fe6dea7cd832` | Enter停止、gap、WebGL失敗 |
| `browser-tests/p1-independent-ui.spec.ts` | `149a8e424676bfa4178a3df8dc8b0cc90073488a` | 393×852のtouch settings配置 |
| `browser-tests/p1-flow.spec.ts` | `bd65fec3a5180502f3d189b35b2205cd113b4886` | 製品画面の飛行経路、WebGL loss、audio lifecycle |
| `browser-tests/p1-native-visibility.spec.ts` | `3726f8f479c11af64aba0b72e25fbfc3d3e55b2a` | headed Chromiumで実際の `document.hidden` 遷移を確認 |
| `browser-tests/p1-settings.spec.ts` | `61d59dd3f142e62cb7e32635a03fc88f4d359993` | 設定画面・入力経路 |
| `playwright.config.ts` | `75fa2ba8995c0e2f9504dee5de9a50e626ad7a55` | 16 headless Chromium、6 WebKit DOM、1 headed Chromium用project |
| `package.json` | `a5b925fa4fb87268492a8b9429cb37dfd3d44d10` | pinned scripts/runtime/dev dependencies |
| `package-lock.json` | `737f5003fa77fa7147bad2719a1ab1ce8cca05d8` | npm lockfile v3 |
| `.github/workflows/ci.yml` | `cd6b88b9e0baefab39cb5e6b0811df1c3ca326a4` | Node24、unit/build、Chromium/WebKit CI |
| `docs/evidence/p1/home-chromium-1366.png` | `37f0af0d6d4d733b5bc3114243e66658771bcd0d` | 1366×768 software-rendered screenshot |
| `docs/evidence/p1/flight-chromium-1366.png` | `6604d4e11d0e7787ca93f06d2eaf0073d0f46164` | 1366×768 software-rendered screenshot |
| `docs/evidence/p1/keyboard-chromium-393.png` | `43b6b6c38f54c86c5a261848cffcc656a1924a31` | 393×852 software-rendered screenshot |
| `docs/evidence/p1/touch-chromium-393.png` | `d1d41294f7c4551c399d4c98563f7c6662c4e1b5` | 393×852 software-rendered screenshot |
| `docs/evidence/p1/unit.log` | `18d6d49f558464a066402e2d50b08b7cc87b812d` | final local 12/12 unit result, no skipped tests |
| `docs/evidence/p1/build.log` | `64f3e34db6d21aef275786f320954787bce87ad5` | final local build output, 641.76 kB chunk warning |
| `docs/evidence/p1/chromium.log` | `df936cc0d5e9168426ca9e53b20b47a21f052418` | final local Chromium headless run, 16/16 pass |
| `docs/evidence/p1/chromium-results.json` | `5710b2310a5dbd589ac442e60f3ecd46af7b2f7c` | structured results for the same 16 tests |

P1は共通操縦の最小土台である。`flight-assist.ts` の有限補助数式は移行したが、P1の `FlightSession` が渡す標的一覧は空である。敵照準引寄せ・Easy自動射撃は、有効砲台・遮蔽データができるP2/P4まで動作しない。したがってP1だけではR30の支援全体もA07も受入済みにならない。

### P1のimport・素材依存境界

移行後の静的import graphは、Three.jsと本作ローカルの型・飛行・画面・入力・設定モジュールに限られる。`aircraft.ts` はThree.js、`flight.ts` はThree.jsと本作の `rules.ts/types.ts`、`flight-view.ts` はThree.jsと本作の型、`flight-assist.ts` はThree.jsと本作の飛行補助／rules／型を使う。入力と設定は `input.ts`、`keyboard-settings.ts`、`dialog-focus.ts` 間で閉じる。`game-state.ts`、`scene.ts`、`main.ts`、`audio.ts` はThree.jsと本作のP1モジュールだけを参照する。Kaisenの旧mission/simulation/AI/ammunition/scoring/naval/ordnance、Faitofuraitoのranking/API、bomb/torpedoコードはimportしていない。出典コードの内部依存をそのまま一括移植せず、必要な飛行・視点・補助計算だけを本作の型へ接続した。

## 依存と実行環境の基準

計画の初期案を次の固定値で開始する。npm lockfileも作成済みである。

| 項目 | 固定値 | 状態 |
| --- | --- | --- |
| Node.js / npm | `v24.19.0` / `11.9.0` | P1実行環境で確認 |
| Three.js | `0.186.1` | runtime依存。MIT NOTICE同梱 |
| TypeScript / Vite / tsx | `5.9.3` / `8.3.1` / `4.21.0` | lockfile固定 |
| Playwright / @types/three | `1.61.1` / `0.183.1` | lockfile固定 |
| lockfile | `package-lock.json`, lockfileVersion 3 | P1で作成。`npm ci` は成功（実装担当の実行記録） |
| CI | Ubuntu runner、Node 24、npm ci、unit/build、16 Chromium、6 WebKit DOM、1 headed Chromium | workflowは追加済み。初回CIは22/23。native fixture修正後の全23件は結果待ち |

ローカル `npm ci`、unit 12/12、TypeScript/Vite build、およびheadless Chromium 16/16（失敗0、skip0）は、P1候補commit `e432dd6e3921f2f19564091a931ea1dd05e19d8a` の内容で成功した。WebKit UI 6/6は初回CI成功。native visibilityは初回CI失敗を受けfixture修正し、ローカル仮想displayで成功。修正後CIは結果待ち。P1のホーム画面／飛行画面のChromium画像は `docs/evidence/p1/` にある。これは1366×768 CSS px、DPR1のソフトウェア描画スクリーンショットであり、性能測定ではない。PlaywrightがCI上で起動しても、それは実機iPhone SafariやGPU性能測定ではない。

## 性能測定manifest（測定前固定）

R82の受入値を測定前に固定する。次の実機欄は現環境で物理機材へアクセスできず未検証であり、模擬値で埋めない。

| 対象 | 事前固定条件 | 実機情報・結果 |
| --- | --- | --- |
| PC代表 | 1,366×768 CSS px、DPR 1、標準画質、30秒warm-up後180秒、8味方・100砲台・主砲4/機銃12の合法攻撃機会。P7の複数面入力を固定する | 実機CPU/GPU/RAM/OS/ブラウザが未選定。未測定・未検証。実機を選んだ後、計測前に型番等を追記する |
| モバイル代表 | iPhone 17 Pro / Safari候補、393×852 CSS px。実viewport/DPRを実機で記録し、描画DPR上限2を画質案とする。30秒warm-up後180秒 | 実機なし。iPhone 17 Pro/Safari・viewport・DPR・温度・p95等は未測定・未検証 |
| ブラウザ模擬 | Playwright Chromium/WebKit、テストviewport・browser build・headをCI成果物とともに記録 | 合成ブラウザ経路。実機GPU/熱/タッチ操作/聴感の結果として使わない。初回CI head `3efa0d6` でWebKit DOM 6/6成功。実機Safariは未検証 |

受入基準はPC p95 20ms以下、モバイルp95 33.3ms以下、中央値・最悪値・long task・環境情報の併記。最大負荷、seed、入力列、head、ブラウザbuild、viewport、画質、実機か模擬かを測定前に保存する。条件未充足や実機不在は「未検証」とし、合格判定を作らない。

## P0完了証拠と未実施

- 固定要件のblob・READMEの既存blob・計画のblobを照合済み。
- 公開固定参照とP1で採るファイル、非採用境界、Faitofuraito由来の設定コードの来歴を台帳化。
- Node/npm・依存版・lockfile・CI/browser種類を記録。commit `e432dd6` の `npm ci`、unit 12/12、build、Chromium 16/16は成功。初回CI WebKit 6/6とローカルheaded nativeは成功。修正後全23件CIは結果待ち。
- P0性能manifestの測定条件を固定した。実PC・iPhone 17 Proは利用できないため実測なし。
- 実装候補のblob一覧は上表へ記録し、P1の検査対象ファイルと一致を確認した。P0の合格を意味しない項目は、性能、iPhone試遊、WebKitローカル起動、聴感、素材の将来追加を含む。
