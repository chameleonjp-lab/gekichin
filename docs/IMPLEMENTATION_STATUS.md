# 実装状況

更新日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
作業ブランチ: `feat/gekichin-combat-completion`

固定計画のP2–P6を実装し、母艦100砲台・有限50機・実弾・敵砲台・僚機・採点・戦闘HUD・結果・端末内記録・撃沈表現・合成音を接続した。Easy/Normalとも、通常FlightInputの統合実行と、製品画面のStart・ドラッグ/キー入力によるブラウザ実行で100基全破壊に到達した。最終検査の原票と受入状態は [COMPLETION_VERIFICATION.md](./COMPLETION_VERIFICATION.md) と [COMPLETION_ACCEPTANCE.md](./COMPLETION_ACCEPTANCE.md) に記録する。提出は [Draft PR #5](https://github.com/chameleonjp-lab/gekichin/pull/5)。

実PCとiPhone 17 Pro/Safariの性能、人間による試遊と聴感は未実施である。ソフトウェア実装・自動検査と、これらの製品受入を区別する。実機を必要とするP7の残項目があるため、P7/P8全完了とは扱わない。

## 固定基準

P0/P1のPR [#3](https://github.com/chameleonjp-lab/gekichin/pull/3) は採用済みで、今回の起点はmain `98119b5ae6604ad5975024b0e523b78eef369662`。PRのマージ操作は本作業では行っていない。P1の履歴は [P0_BASELINE.md](./P0_BASELINE.md)、[P1_VERIFICATION.md](./P1_VERIFICATION.md) に保つ。

固定要件commitは `e9212a73a7b36c33dff7e88d3a7308be6cdcea35`、要件blobは `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`。README blob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0`、計画blob `11dec1af2004ec3d71357d9eae029e324c6fdf3c` も保持した。ルール版は `gekichin-combat-v1`、固定60Hz、標準seed `0x474b0001`。固定Kaisen/Faitofuraito参照は変更せず、他作品を編集していない。後続コードの出典・差分・素材境界は [COMBAT_PROVENANCE.md](./COMBAT_PROVENANCE.md) に追記する。

## 段階別の状態

| 段階 | 実施状況 | 確認と境界 |
| --- | --- | --- |
| P0 基準・実施条件 | 記録済み | 固定blob・出典・依存・測定条件を保持。実機欄は未検証 |
| P1 操縦と最小画面 | 既存実装を保持・戦闘へ接続 | 共有機体・操縦・画角・相対入力・両設定を維持。旧CIはP1履歴として保管 |
| P2 母艦と砲台配置 | 実装・幾何検査成功 | 六面100個の一意ID、20主砲/80機銃、24,000HP。全100基の進入区間・射線・初期回廊を検査。描画と衝突が共通形状を参照 |
| P3 有限残機・味方銃撃・得点 | 実装・境界検査成功 | 50トークン保存則、同時8、3秒復帰/引継ぎ、弾倉・装填・距離減衰・連続接触・過剰損傷切詰め・採点・結果凍結 |
| P4 敵砲台・僚機AI | 実装・統合検査成功 | 有限追尾・固定予告・4/12枠・1/3予約・遮蔽・再試行。僚機は外周の通常飛行と実弾で六面を攻撃。Easy/Normal全撃破の自動入力記録あり |
| P5 戦闘画面と記録 | 実装・ブラウザ検査成功 | 戦況・六面残数・HP/弾薬・復帰・境界案内・貢献/得点全成分・勝利のみのモード別best。両モード勝利と10再出撃、最終70画面を確認。中断結果は次の描画を待たず即時表示 |
| P6 表現 | 実装・画像/信号検査成功 | 同じ100基の可動砲座・損傷・低い残骸・予告・実弾・粒子・5秒撃沈。実戦Normalの5,000ms撃沈とEasyスキップで同じ凍結結果。合成音は初期OFF、1context/16voice。人の実出力評価は未実施 |
| P7 最終検証 | 自動検査を実施。実機項目は阻害 | 全撃破、境界、上・下・側面の六組回避、固定FPS再現、最大合法射撃負荷、資源/再出撃、UI・通信・出典を原票ごとに記録。PC/iPhone性能・人間試遊・聴感は機材未提供 |
| P8 最終候補 | Draftでレビュー提出。全面受入は未完了 | 実装候補・独立レビュー・CIを提出。実機受入未完了のまま公開/配備/マージしない |

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
