# 実装状況

更新日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
作業ブランチ: `feat/gekichin-combat-completion`

戦闘candidate source `5db76f68b53c846ae4e4aec4754f78e108107a37` はP2–P6を実装し、通常入力のEasy/Normal全100基破壊を記録した。証拠commit `c0cf927fcf7dd75edae6fee539072e4b3498c86e` は各manifestの記録とともに保管する。受入フォルダー内の全ファイルが同じsource hashとは限らず、多くの最終戦闘証拠はsource5dbに紐づくが、一部はそれ以前の候補で取得された。最新main `595feb719c9b65697ab319fa40a939d6ee1b356b` にPR4 speed leverを統合したPR5作業treeでは、実際のconflict `src/main.ts` / `src/style.css` を解決し、lever v2と戦闘画面を併存させた。PR5統合source 30ファイルのhashは今回のCIでも不変。unit 102/102・production build成功、ローカルChromium＋headed native 39件pass、WebKit retryは17 pass・1 skip・0 fail。push CI [37275240792](https://github.com/chameleonjp-lab/gekichin/actions/runs/37275240792) はunit/build成功、browser 55 pass・1 skip・1 fail。Easy viewport/restart testの5 viewport目（1366×768）のfresh loadからstartした際に約3.9秒かかり、tick 1で実時間2秒超gapを検出した製品pause guardが正しく停止させた。PR CI [37275243877](https://github.com/chameleonjp-lab/gekichin/actions/runs/37275243877) は56 pass・1 skip・0 fail、comparison成功と報告された。Easy viewport/resource test専用clock fixtureは単独1/1（32.6秒）で成功したが、このtest-fix commit準備時点では、変更を含むexact-head全CI再実行はpending。最終CI結果はPR本文／Checksを正本とする。archived c0 baselineとのmatched public-flow comparisonは異なる2 viewportの4 captureでtick 12まで一致した。旧evidenceはmerged sourceの検査結果ではない。原票と履歴の境界は [COMPLETION_VERIFICATION.md](./COMPLETION_VERIFICATION.md)、[COMPLETION_ACCEPTANCE.md](./COMPLETION_ACCEPTANCE.md)、[PR5_CONFLICT_RESOLUTION.md](./PR5_CONFLICT_RESOLUTION.md) に記録する。PR #5はready for review状態。提出HEADと最終CI結果はPR #5本文／Checksに紐づける。

実PCとiPhone 17 Pro/Safariの性能、人間による試遊と聴感は未実施である。ソフトウェア実装・自動検査と、これらの製品受入を区別する。実機を必要とするP7の残項目があるため、P7/P8全完了とは扱わない。

## 固定基準

P0/P1のPR [#3](https://github.com/chameleonjp-lab/gekichin/pull/3) は採用済み。combat候補の開始点はmain `98119b5ae6604ad5975024b0e523b78eef369662`、最新のPR5 integration baseはPR4 speed leverをmergeしたmain `595feb719c9b65697ab319fa40a939d6ee1b356b`。P1の履歴は [P0_BASELINE.md](./P0_BASELINE.md)、[P1_VERIFICATION.md](./P1_VERIFICATION.md) に保つ。

元要件commitは `e9212a73a7b36c33dff7e88d3a7308be6cdcea35`、元本文blobは `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`。利用者承認の速度レバー追記を含む現在の `docs/REQUIREMENTS.md` working-tree blobは `c072b57dbdef3a48ac7e5717890e2bb4ed2baeb3`。これはR30/R61–R64の操作・保存部分だけを追加する採用appendで、元本文の履歴は保持する。README blob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0` と計画blob `11dec1af2004ec3d71357d9eae029e324c6fdf3c` は変更なし。ルール版は `gekichin-combat-v1`、固定60Hz、標準seed `0x474b0001`。固定Kaisen/Faitofuraito参照は変更せず、他作品を編集していない。後続コードの出典・差分・素材境界は [COMBAT_PROVENANCE.md](./COMBAT_PROVENANCE.md) に追記する。

## 段階別の状態

| 段階 | 実施状況 | 確認と境界 |
| --- | --- | --- |
| P0 基準・実施条件 | 記録済み | 固定blob・出典・依存・測定条件を保持。実機欄は未検証 |
| P1 操縦と最小画面 | PR4の速度レバーv2をcombatへ統合。combined local checksを確認 | combatはR30/R61–R64に関わるレバー/UI/storageを保持する。tagged-peer geometry、Save/preview一致、c0 baselineとのpublic-flowを検査。旧P1 CIは基準履歴として保管し、提出headのWebKit/CIはPR Checksで確認 |
| P2 母艦と砲台配置 | combat candidateで実装・幾何検査成功 | 六面100個の一意ID、20主砲/80機銃、24,000HP。全100基の進入区間・射線・初期回廊を検査。描画と衝突が共通形状を参照。各原票のsourceはそれぞれのmanifestで確認し、統合sourceの最終CIへは別途結び付ける |
| P3 有限残機・味方銃撃・得点 | 5db候補で実装・境界検査成功 | 50トークン保存則、同時8、3秒復帰/引継ぎ、弾倉・装填・距離減衰・連続接触・過剰損傷切詰め・採点・結果凍結 |
| P4 敵砲台・僚機AI | 5db候補で実装・統合検査成功 | 有限追尾・固定予告・4/12枠・1/3予約・遮蔽・再試行。僚機は外周の通常飛行と実弾で六面を攻撃。Easy/Normal全撃破の記録はhistorical source proof |
| P5 戦闘画面と記録 | 5db候補で実装・ブラウザ検査成功 | 戦況・六面残数・HP/弾薬・復帰・境界案内・得点/記録。両mode勝利と10再出撃、70画面を確認。PR4 UI統合後の同じ記録は再取得していない |
| P6 表現 | 5db候補で実装・画像/信号検査成功 | 可動砲座・損傷・残骸・予告・実弾・粒子・5秒撃沈。人の実出力評価は未実施。PR4合流後の画像は旧source snapshot |
| P7 最終検証 | combat候補の記録を保持。統合sourceのCI確認中（このtest-fix commit準備時点） | 全撃破、回避、30/60/120Hz再生、合成負荷、UI/通信/出典の多くはsource5db以前の履歴証拠で、統合sourceへ読み替えない。push CIは単体/build成功だが、viewport/resource fixtureの次CIはこのtest-fix commit準備時点でpending。最終CIはPR本文／Checksを参照。PC/iPhone性能・人間試遊・聴感は未検証 |
| P8 最終候補 | PR #5はready for review。全面受入未完了 | 統合sourceのunit 102/102・build pass。push CIはbrowser 55 pass/1 skip/1 fail（失敗の原因と修正範囲はPR5記録）、PR CI 37275243877は56 pass/1 skip/0 fail・comparison成功と報告されたが、clock fixture更新後のCIはこのtest-fix commit準備時点でpending。最終結果はPR本文／Checksを参照。ローカルWebKit retryは17 pass/1 skip/0 fail。c0 baseline比較は4 capture / 2 viewport / tick 12で全観測状態一致。実機受入が残るため公開/配備の完了とは扱わない |

## PR5 integration status

PR4 merge-base `595feb719c9b65697ab319fa40a939d6ee1b356b` からのconflict resolutionでは、実際の衝突ファイル `src/main.ts` と `src/style.css` だけを統合し、combat画面とNormal lever v2操作・設定を両方残す。統合treeにはPR4の追加モジュールも含む。現在のper-file hash一覧はsource freeze後のtableに記録し、commit hashとは別に扱う。今回のPR4 user-approved addendumは戦闘ルール・敵AI・砲台数・採点を変更しない。

root担当のexplicit `throttle: 0` core guardとreview起因のshared placement correctionは反映済み。unit 102/102・production build pass、Chromium＋headed native browser 39件pass。WebKit retryはhost preflightを明示的にskipして実起動し、17 pass・1 skip・0 fail（live-flight WebGL testのみskip）。push CIはunit/build成功、browser 55 pass・1 skip・1 fail。唯一の失敗はEasy viewport/restart testの5番目・1366×768 fresh load/startで約3.9秒のrenderer gapが発生し、製品stall guardがtick 1でpauseした挙動で、製品guardの不具合ではない。layout/resource testだけを決定的clockに進める変更は単独1/1（32.6秒）で成功し、compileAsyncの準備中はRAFを進め、実時計stall・native visibility検査は維持。PR CI 37275243877は56 pass・1 skip・0 fail、comparison成功と報告されたが、このtest-fix commit準備時点では、変更を含むexact-head全CI再実行はpending。最終CI結果はPR本文／Checksを正本とする。原票は [pr5-integration](./evidence/pr5-integration/) に保存。isolated fixtureの [run.log](./evidence/pr5-integration/layout-followup/run.log) と [Playwright結果](./evidence/pr5-integration/layout-followup/browser-results.json)、hash bindingは [manifest](./evidence/pr5-integration/manifest.json) にある。c0 combat baselineとcurrent integrated sourceのmatched public-flow comparisonは4 capture、2 viewport、tick 12で完了し、比較対象のDOM表示・速度・高度・phase/mode等のstate fieldsはすべて一致した。手順・capture条件は [comparison/conditions.json](./evidence/pr5-integration/comparison/conditions.json) と [pr5-integration/manifest.json](./evidence/pr5-integration/manifest.json) にある。overlap修正前の同tick試行は最終比較に含めない。提出HEADと最終CI結果はPR #5本文／Checksに紐づける。検査境界、conflict file、source/evidence binding、未完了ownerは [PR5_CONFLICT_RESOLUTION.md](./PR5_CONFLICT_RESOLUTION.md) に記録する。

## 実装の責務

- `mothership-layout.ts`、`mothership.ts`、`collision-world.ts` が配置、HP、最近接の連続衝突と遮蔽を管理する。船体HPや画面外での論理省略はない。
- `fleet.ts`、`aircraft-weapons.ts`、`turret-combat.ts`、`wingman-ai.ts`、`game-state.ts` が有限機体、弾、固定tickの時系列、AI、終端を管理する。寿命末尾は半開区間、同時接触を発射要求より先に扱う。
- `scoring.ts` が実損傷・破壊・発射時所有の通算と凍結結果を管理する。表示値を正本へ戻さず、保存は本作キーだけを使う。
- `main.ts`、`scene.ts`、`audio.ts` は正本とイベントを表示・再生する。シェーダ準備と5秒撃沈は戦闘時計に含めない。停止/非表示/WebGL喪失/2秒gapの後は明示再開が必要。

## 通常入力の全撃破記録

標準seed `1196097537` のEasy/Normalは各54,329tick、能動905.483秒で勝利。100個の一意砲台ID、20/80、24,000HP、六面をすべて破壊した。敵20,530発、僚機損失40、自機損失0、味方10機残、戦闘弾生成失敗0。記録入力と実行ログは [evidence/acceptance](./evidence/acceptance/) にある。

これらは内部位置・HP・残機の注入、敵停止、無敵化を使わず、観測した状態から通常FlightInputを出した統合実行である。全撃破の所有は僚機100、自機0。自機命中の証拠、人間試遊、製品DOMの操縦、合成負荷fixtureと混同しない。境界fixtureは初期状態を作る検査であり、全撃破記録から除外した。

製品DOMの通常入力でも、Easy/Normal各54,329tickで100基全破壊を確認した。敵主砲/機銃は実弾を発射し、内部状態の書換えはない。自動操縦は標準の入力面をドラッグし、NormalはSpaceを保持する。全撃破は僚機で、自機有効命中0。1,000msの検査用描画clockごとに60論理tickを更新した記録で、人間の照準・実機FPSの合格とは区別する。全入力の30/60/120Hz再生は両モードの最終状態と全イベント列が完全一致した。

## ローカル実行

```sh
npm ci
npm run dev -- --port 4177
```

`http://127.0.0.1:4177` で開始できる。検査は次のとおり。

```sh
npm test
npm run build
npx playwright install --with-deps chromium webkit
xvfb-run -a npm run test:browser
node --import tsx scripts/mission-runner.ts --mode easy --record /tmp/easy-inputs.json.gz
node --import tsx scripts/mission-runner.ts --mode normal --record /tmp/normal-inputs.json.gz
node --import tsx scripts/core-load-runner.ts
```

最後の負荷runnerは機体姿勢固定・接触なしの性能専用合成fixtureで、通常クリアや実機性能の代用ではない。最終のコマンド・件数・head・CI・残項目は検査記録を参照する。
