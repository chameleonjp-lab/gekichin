# 戦闘実装の最終検査記録

更新日: 2026-10-05 UTC  
対象: `chameleonjp-lab/gekichin`  
作業ブランチ: `feat/gekichin-combat-completion`  
提出: [Draft PR #5](https://github.com/chameleonjp-lab/gekichin/pull/5)

固定計画P2–P6の実装候補とP7の自動検査を記録する。実PC・iPhone 17 Pro/Safariの性能、実機タッチ、人間の試遊と聴感は未実施であり、P7/P8の全面受入は未完了。詳細な受入番号別の判定は [COMPLETION_ACCEPTANCE.md](./COMPLETION_ACCEPTANCE.md)、出典と素材の境界は [COMBAT_PROVENANCE.md](./COMBAT_PROVENANCE.md) を参照する。

## 固定基準と検査対象

起点はPR #3採用後のmain `98119b5ae6604ad5975024b0e523b78eef369662`。戦闘実装は `01804b95078317bb0129d0750b6a7f73184cee6f`、中断結果の即時表示修正を含む最終製品ソースは `5db76f68b53c846ae4e4aec4754f78e108107a37`、treeは `63d4bc7cb8ee52e3389b6cd720f6288fcacc5db1`。両commitを同一SHAで作業ブランチへ保存した。検査原票を追加する後続commitは、この製品ソースとの違いを記録する。

固定要件commitは `e9212a73a7b36c33dff7e88d3a7308be6cdcea35`、要件blobは `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`。README blob `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0`、計画blob `11dec1af2004ec3d71357d9eae029e324c6fdf3c` は不変。ルール版 `gekichin-combat-v1`、60Hz、標準seed `1196097537` を用いた。他作品のファイルは変更していない。

## 実行結果

| 検査 | 結果 | 原票と条件 |
| --- | --- | --- |
| 単体・統合境界 | 成功、76/76、27.906秒 | [unit.log](./evidence/acceptance/unit.log)。有限残機・生成順・射線・実損傷・採点・保存・敵AI・六面経路・帰還矢印・停止・固定FPSなど |
| 型・製品build | 成功 | [build.log](./evidence/acceptance/build.log)。Viteの単一chunk容量警告は残る |
| 通常入力のEasy全撃破 | 成功、54,329tick | [easy-run.log](./evidence/acceptance/easy-run.log)、[入力列](./evidence/acceptance/easy-inputs.json.gz) |
| 通常入力のNormal全撃破 | 成功、54,329tick | [normal-run.log](./evidence/acceptance/normal-run.log)、[入力列](./evidence/acceptance/normal-inputs.json.gz) |
| 製品DOMの短い操作・10再出撃・中断表示 | 成功、Chromium 4/4、1.1分 | [combat-abort-final.log](./evidence/acceptance/browser/combat-abort-final.log)。最後のcaseはclockを止めたまま中断し、次の描画を待たず今回の凍結成績が表示されることを検査。公的なブラウザclockと250ms描画fixtureを使用し、論理は60Hzのまま |
| 海面損失・3秒復帰・保持入力解除 | 成功、Chromium専用case 1/1 | [normal-sea-loss-respawn.manifest.json](./evidence/acceptance/browser/normal-respawn/normal-sea-loss-respawn.manifest.json)。NormalのArrowDown/Spaceを保持し、実際の海面接触から180tick後にownershipが更新された80HP・288/96弾の機体へ復帰。保持キーを離さずさらに500ms進めてもpitch 0・射撃待機。敵弾損失と区別する |
| 通常Session入力の敵弾損失・復帰 | 成功、被弾4533tick→復帰4713tick | [ordinary-enemy-recovery/probe.json](./evidence/acceptance/ordinary-enemy-recovery/probe.json) と [入力列](./evidence/acceptance/ordinary-enemy-recovery/inputs.json.gz)。標準Normal開始から通常FlightInputだけの900m周回。敵実弾による実損傷80HP、3秒復帰、ownership 0→1→2、80HP・288/96弾、P1/W0。内部状態注入なし。DOM経路と区別する |
| 製品DOMの敵弾損失・復帰・旧操作解除 | 成功、20.807秒の専用driver実行 | [normal-enemy-respawn.manifest.json](./evidence/acceptance/ordinary-enemy-recovery/dom/normal-enemy-respawn.manifest.json)。NormalのStart・普通のpointer/Space入力で被弾後の喪失と復帰を確認。1秒間隔のHUD観測は喪失4560tick→復帰4740tick（観測差180tick）、4800tickでも保持中の旧入力は適用されずyaw/pitch 0・射撃待機・80HP・288/96弾。これは観測tickであり、engineの正確な発生tick4533/4713とは区別する |
| 100基・8機の15分合成負荷 | 成功、54,000tick | [core/manifest.json](./evidence/acceptance/core/manifest.json)。静止姿勢・接触なしの合成fixtureで、通常クリア/実機性能の証拠には用いない |
| 六面・損傷・撃沈の描画 | 成功、14画像 | [visual/manifest.json](./evidence/acceptance/visual/manifest.json)。初期姿勢/損傷を与える描画専用fixture |
| 上・下・側面×主砲/機銃の六組回避 | 成功、Node1/1・browser1/1 | [evasion/README.md](./evidence/acceptance/evasion/README.md)、[72.160秒の録画](./evidence/acceptance/evasion/evasion-six-cases-normal-camera.webm)。通常カメラの実砲口/予告線と全18画像を独立確認。baselineは実弾被弾、予告の翌tickから通常入力で回避した側は全件無損傷。初期状態fixtureと通常全撃破を分ける |
| 全入力の30/60/120Hz再生 | 成功、両mode×3周期の6件 | [replay/README.md](./evidence/acceptance/replay/README.md)。各54,329入力、最終snapshot・全event列・原report・HP・全ID・残機・発射数・終端freezeを照合し、各modeで3周期完全一致 |
| 製品DOMの全撃破・撃沈・結果・10再出撃 | 成功、両modeとも54,329tick | [browser-product/acceptance-manifest.json](./evidence/acceptance/browser-product/acceptance-manifest.json)、[product-run.json](./evidence/acceptance/browser-product/product-run.json)、[録画](./evidence/acceptance/browser-product/full-product-run.webm)。Start・通常pointer/keyboard入力のみ、全100ID・HP0・敵実弾・生成失敗0を確認 |
| 全画面の5viewport×文字倍率2条件 | 成功、10戦闘＋60画面 | [ui/manifest.json](./evidence/acceptance/ui/manifest.json)。home/guide/両設定/戦闘/停止/結果。44px以上・scroll到達・Tab/Esc/focus/名前、外国作品の実保存key6個不変、HAR3件の同一origin静的GETを確認 |
| 製品ソースcommitのCI | 成功、単体76/76、browser28/28、build成功 | [5db76f6のPR CI](https://github.com/chameleonjp-lab/gekichin/actions/runs/37265544385)、[push CI](https://github.com/chameleonjp-lab/gekichin/actions/runs/37265539764)。Chromium21・WebKit UI6・native visibility1。証拠・追加caseを含む提出headのSHAとCI結果は[PR #5](https://github.com/chameleonjp-lab/gekichin/pull/5)の本文とChecksに結びつける |

全撃破の両engine実行は各905.483秒の能動時間、全100個の一意ID・六面・20主砲/80機銃・24,000HPを確認した。僚機が全100基を破壊し、自機破壊0、僚機損失40、自機損失0、味方10機残、敵発射20,530、弾生成失敗0。内部HP・位置・残機の書換え、敵停止、無敵化を使っていない。自機の照準成功や人間による試遊の証拠としては扱わない。

ローカルの `unit.log` は中断結果表示の修正前に取得したengine検査で、この修正はengineソースを変更していない。修正後の `5db76f6` ではCIが76件を再実行して成功した。後続の検査fixture・browser caseの追加は提出headのCIで再検査する。

合成15分負荷では100基のHPと8機の固定姿勢を保つ介入を明記した。主砲4/機銃12の合法な攻撃枠と自機＋僚機射撃を毎tick検査し、味方弾最大160、敵主砲弾最大6、敵機銃弾最大134、弾生成失敗0。描画ありの資源推移は別の製品DOM検査で記録する。

初期のブラウザ失敗ログは削除せず残した。ソフトウェアWebGLの同時実行による2秒gap停止と、テストdriverが止めたclockを十分進めなかった問題を区別し、製品の停止規則を弱めず最終4/4を再検査した。中断結果の古い表示と、検査runnerのチェックポイント変数名も修正し、先行する未完走映像/ログを合格記録から区別した。

製品DOMの全作戦は、read-only HUDから普通のドラッグ入力を作り、NormalだけSpaceを保持した。能動時間は両mode905.483秒、画面表示905.48秒、得点120,443、全100撃破は僚機、自機損失0/僚機損失40、全100砲台のHPは0。Easyは自機発射6/命中0、Normalは19,510/命中0で、自機の照準成功の検査には用いない。最終2基は後面の主砲で、98/100時の六面残数画像と破壊ID履歴を照合した。広い周回中に自機の標的lockはなく、下面への直接自機接近をこの映像から主張しない。

ブラウザclockを1,000msずつ進め、描画1回につき60個の論理tickを逐次実行した。2秒gap規則を変更しておらず、実機FPSの検査ではない。Easyは凍結後1,000msでSkip、Normalは5,000msで自動結果となり、時刻・得点・best内容を維持した。初期化後のgeometry71/texture4/program17、canvas1、listener登録138、AudioContext1/voice16を全10再出撃で保持。DOMは結果の12成分node生成で295→307となり、その後は307で一定。heapはGCに伴って上下し、Easy13.50–62.79MB、Normal10.15–42.59MB、末尾12.79MBで単調増加は見られなかった。観測pool最大は味方弾100、敵主砲6、敵機銃87、粒子616、破片16、残骸100、active voice16。毎tick上限の別検査は合成負荷原票にある。

## 環境と追試

Node.js 24.19.0/npm 11.9.0、lockfile固定のTypeScript/Three.js/Vite、Chromium 149.0.7827.55のクラウド仮想環境で実行した。[environment.json](./evidence/acceptance/environment.json) に物理機材の未提供と測定条件を記録した。SwiftShader、操作自動化、公的なPlaywright clockは実PC/iPhoneの速度・タッチ・聴感の代用にはならない。WebKit UIとnative visibilityはCIで確認する。

```sh
npm ci
npm test
npm run build
npx playwright install --with-deps chromium webkit
xvfb-run -a npm run test:browser
node --import tsx scripts/mission-runner.ts --mode easy --record /tmp/easy-inputs.json.gz
node --import tsx scripts/mission-runner.ts --mode normal --record /tmp/normal-inputs.json.gz
node --import tsx scripts/core-load-runner.ts
```

入力再生・画像・UI・回避映像・製品DOM長時間runnerの条件とコマンドは各manifest/READMEに記録する。ローカルブラウザ配置を変えた場合は `PLAYWRIGHT_BROWSERS_PATH` を指定する。製品ソースを書き換えたら関係する検査と証拠を再取得する。

## 残る受入

実PCとiPhone 17 Pro/Safariで、固定manifestに従う30秒ウォームアップ＋180秒性能測定、実機タッチ/safe-area/アドレスバー変化、音出力、人間による全周戦の試遊を行う必要がある。機材または実測結果がないため、この部分は阻害として残す。最終責任者による受入と、mainへのマージ/配備/公開は本作業では実行していない。
