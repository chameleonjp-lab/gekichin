# 戦闘実装の来歴・素材台帳

記録日: 2026-10-05 UTC
対象: `chameleonjp-lab/gekichin` / `feat/gekichin-combat-completion`  
原要件: `e9212a73a7b36c33dff7e88d3a7308be6cdcea35` (`docs/REQUIREMENTS.md`, blob `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`); 承認済みappendを含むworking-tree blob `c072b57dbdef3a48ac7e5717890e2bb4ed2baeb3`
操縦・共通コード参照: Kaisen `3d751051dc6212482a129e8da596ddd349b2f9f5`

この台帳は、ゲキチン側の実装ソースと固定参照の関係を記録する。上の既存表にあるゲキチンSHA-256値はPR4 merge前のcombat source5db候補の履歴値で、現在のPR5統合sourceのhashは末尾の別表に記す。各manifestのartifactはそれぞれが記録したsource snapshotに結び付く。Kaisen側は固定コミットにおけるGit blob SHA-1を記す。検証用スクリーンショットや入力ログは製品素材ではない。

PR5統合hash表はsource freeze時点の `src/` 30ファイルの内容hashである。これはコミットIDではなく、後続のPR文書・CI checkにはGitHub上で別途結び付ける。PR4 leverの旧契約・検査票・parity JSONはPR4/P1-era記録であり、下表の現在hashや統合結果の証明ではない。

## 固定参照から保持・適応したコード

| ゲキチンのファイル | 固定KaisenファイルとGit blob SHA-1 | ゲキチンSHA-256 | 扱い |
| --- | --- | --- | --- |
| `src/aircraft.ts` | `src/aircraft.ts` · `e4e3009464bb8c4ae473b7cfc46d010198c27149` | `1a9c18f93e5a48869882b2aa2946cdeb352dc4a8acd76b4fd9beade8ded621d5` | 固定版と同一。コードで生成する機体モデルと補助テクスチャ。外部画像は読み込まない。 |
| `src/flight.ts` | `src/flight.ts` · `3019be9650863c11cc1c57f7bb7e09ab815c9c07` | `288f6d8b52aca7d6c4f68fce8f71262373e6a4ee6c7fadfe8cb91df187f529ce` | 操縦式を適応。ローカル型と固定ルールへ接続し、飛行・ループ・速度制御を保持。 |
| `src/flight-view.ts` | `src/flight-view.ts` · `87f83928a00092338391442ec2d7e87e3b4e33da` | `b8a5790501503799b1cc43e634d5ac3b6545fcaba477db970b61a5d2fbb3eb32` | カメラ式・射影補助を適応し、ゲキチン側型へ接続。 |
| `src/flight-assist.ts` | `src/flight-assist.ts` · `799efdfb97c3b9ba435e8eaf4080f65b74326773` | `efebdbf59bf40b715d6e33f4bbdea60bdfe4e9d2ffaee0f1b37e2887ec9ac413` | 有限の補助式を適応。砲台の露出判定と本作の `FlightAssistTarget` を使う。 |
| `src/input.ts` | `src/input.ts` · `0edbd1c5f9f07a2d1088539e188bab0329ab53f0` | `f7a3860926fd76bc0684405ff43177c327e21163f9f7dd375e879d197eae579a` | 本作の9操作と入力所有へ適応。爆弾・魚雷のボタンおよび入力を除去。 |
| `src/keyboard-settings.ts` | `src/keyboard-settings.ts` · `eb143ac27b3f65b66912d10b89ec17d0efc581b2` | `f38ee882c88f6b169377e98c788de2cdf413905840f791ce6ef9109cef0088cc` | 本作の保存キーと9操作へ適応。爆弾・魚雷の割当を含めない。 |
| `src/control-settings.ts` | `src/control-settings.ts` · `5208c4da8ebe014552cae855d84c2574ab152292` | `e16bfd064914aa76f1327862ad5f8900958c23a706b5eded65c84fae737328c4` | 保存キー、1/4ボタン構成、ドラフト・取消し・保存UIを本作向けに適応。Kaisen固定版に記録されたFaitofuraito設定由来の経緯は限定範囲として保持し、Faitofuraitoの一般ライセンスとは扱わない。 |
| `src/control-settings.css` | `src/control-settings.css` · `1235392f369ac27ef3056852512319fe6994300b` | `fd060ea182464b36629372e995e8a551a32602a9a529e3bf10fd148f687ccf20` | Kaisen固定版の規則を維持し、出典コメントを追加。 |
| `src/dialog-focus.ts` | `src/dialog-focus.ts` · `5d10d15cb0b9d3de31871af98a7801d638a5055b` | `86d631a4d618558e1ca671004c12ccc1fbdfe75516e6c5d04f962acd2c5e1996` | モーダル焦点制御の同一コピー。 |
| `public/third-party-notices.txt` | `public/third-party-notices.txt` · `805bf99e222a8c6433f78eb06f407224accb120c` | `97de7ac302052bcea7f20e5ae89635c10e049614f56409288d554d63fceb614f` | Three.jsのNOTICEを保持。これは元作品全体のライセンスを示さない。 |

## ゲキチンで新規作成した実装

以下は本作の要件・状態・幾何・画面に基づいて作成したゲキチン側コードであり、Kaisenの完成済み戦闘システムや素材を取り込んだものではない。`src/aircraft-weapons.ts` の限られた数式上の出典は次節に分けて記録する。

| ゲキチンのファイル | ゲキチンSHA-256 | 内容と境界 |
| --- | --- | --- |
| `src/rules.ts` | `897ed57877f1986073e51efbfa96448409c89574959b6885b5e6924200f7e414` | 固定要件に沿う本作ルールと戦闘定数。 |
| `src/types.ts` | `69497c3fe6b9025b7399dbc9ab1db5f7b056507171cbd3aa8a7985ebaaef0f29` | ゲーム・入力・飛行状態の本作型。 |
| `src/game-state.ts` | `ab238ce83f8ab5eda287d47745e72162f99b984707f09cca60f151742ac2be79` | 固定60Hz状態更新、編隊・弾・砲台・採点の戦闘接続、停止と終端。 |
| `src/fleet.ts` | `de29a3e7e875def5a69a569803e2cb35d151c27c7a87054a69f5d9a576d9ca90` | 有限50機、出撃枠、復帰予約、損失・操作引継ぎ。 |
| `src/mothership-layout.ts` | `8ea6c7f0d34587ccfd51d028d2c96e4004d5d0c22055eb54c30f3887c6393937` | 六面100砲台、船体部品、砲口、接近位置と外周経路の正本データ。 |
| `src/mothership.ts` | `10eb613bce21c94115abe3665bb44d677059b8293e97f4307adae2b813a71466` | 砲台HP・損傷段階・一回限りの破壊イベント。 |
| `src/collision-world.ts` | `7ae49cac6c5a7d818c078d445f77f3053677d3e8bd2a659a5d383c786f7de519` | 砲台・船体・機体の共通遮蔽、sweep衝突、空間候補検索。 |
| `src/combat-types.ts` | `24f46be13ddb2a8e9dc3ec4a8b0b16f22cb530f140794bbc71c1925b09c98bd0` | 作戦ID・世代・射手所有・弾・戦闘イベント・結果の型。 |
| `src/turret-combat.ts` | `fd9cf7163da2bb89bd3a755d35220f0720e33eb2b1bc5def7ed2b416c56a2e71` | 主砲・機銃の追尾、予告、有限弾、予約枠、装填と取消し。 |
| `src/wingman-ai.ts` | `06f7f12d1cc7772b448aec5cb60af1c13901a6b678c8220d3591eff9be78c55f` | 砲台担当、接近・攻撃・離脱、有限旋回と外周経路を使う僚機AI。 |
| `src/scoring.ts` | `95ee5ca3bac53b1e60b5c2cd804f35b7b7c91148851b5fcf99178c8aafd86494` | 確定イベントの採点、結果と勝利ベスト記録の検証・保存。 |
| `src/scene.ts` | `6dc42220163e8abfe10935994ddb316622dfa2b341ced773b3d7acd787552635` | Three.jsによる手続き生成の母艦・砲台・環境・弾・警告・撃沈演出。動的な砲台／撃沈表示はプール管理し、外部モデルや画像は使わない。 |
| `src/boundary-guidance.ts` | `7deac567a22cf2cf64693bb6777adf3e0491cc0d213ac6ecc53d9c5cfc7ebb21` | 飛行機首とワールド境界方向をもとに、yaw相対の帰還矢印を出す小さな純関数。画面左右の符号境界を分離して検査する。 |
| `src/main.ts` | `e18a2b41b3dbc0273928967450632da55fd72a4e39419d0b144d2cf56ecf9dd3` | DOM画面、ホーム／準備／戦闘／停止／結果、HUD、砲台HP状態の数値・文字ラベル、設定・入力・音・scene接続。中断時は最終reportを同期表示し、次フレームまで以前の結果表示が残る状態を防ぐ。 |
| `src/audio.ts` | `99057cd1e53413459802ada6d442a31de7feb8ee91008df540901b085d2731ab` | Web Audioで生成する効果音。外部録音・音声ファイルは使わず、人の聴感確認とは区別する。 |
| `src/style.css` | `c13420fc69d84f4881b24084503b796fff93ee944cfeda38149650aad0be536f` | 本作の画面とHUD用スタイル。外部フォント／画像を読み込まない。 |
| `src/aircraft-weapons.ts` | `9eb8965f32a3346b1eb24f7a31e83239c8082cf194f21ae476b5e783b72af30a` | ゲキチンの弾倉、発射間隔、有限プール、距離減衰、所有・命中処理。限定的な散布・銃口式の出典は下記。 |

## PR5統合source freezeのファイルhash

次表はPR4 speed-lever merge後、combat画面とのconflict解決と統合修正を反映した現在source freezeのSHA-256である。30ファイルすべてを列挙する。Kaisen由来と明記したファイルは固定blobを前段に記し、今回hashが異なるファイルは適応箇所も合わせて示す。

| 現行ファイル | SHA-256 | 来歴・役割 |
| --- | --- | --- |
| `src/aircraft-weapons.ts` | `9eb8965f32a3346b1eb24f7a31e83239c8082cf194f21ae476b5e783b72af30a` | 新規combat code。固定要件の弾倉・発射・命中に接続。Kaisen散布／銃口式は後段で限定記録。 |
| `src/aircraft.ts` | `1a9c18f93e5a48869882b2aa2946cdeb352dc4a8acd76b4fd9beade8ded621d5` | Kaisen固定blobと同一の手続き的機体・補助texture。 |
| `src/audio.ts` | `99057cd1e53413459802ada6d442a31de7feb8ee91008df540901b085d2731ab` | 新規Web Audio合成。外部音声assetなし。 |
| `src/boundary-guidance.ts` | `7deac567a22cf2cf64693bb6777adf3e0491cc0d213ac6ecc53d9c5cfc7ebb21` | 新規純関数。機首方向と境界から相対帰還矢印を計算。 |
| `src/collision-world.ts` | `7ae49cac6c5a7d818c078d445f77f3053677d3e8bd2a659a5d383c786f7de519` | 新規combat geometry。砲台／船体／機体遮蔽、sweep衝突、候補検索。 |
| `src/combat-types.ts` | `24f46be13ddb2a8e9dc3ec4a8b0b16f22cb530f140794bbc71c1925b09c98bd0` | 新規combatイベント・弾・所有・作戦型。 |
| `src/control-obstacles.ts` | `1717aefae64cd5b9b1d33a27c0cd3cccb4505cd4e07fc71b48c7e02c2f32abf2` | PR4 lever integration geometry helper. Tagged fire/loop peer geometry from detached HUD clone is shared across live placement, editor preview and Save, including pending control styles and dynamic sizing. |
| `src/control-settings.css` | `a1f847ead95f731cf1f4f127bd3de82581d4fe3aaebd0b388cf72ddf3f438618` | Kaisen fixed CSS rules adapted for Gekichin control editor and PR4 lever. Combat/fly input boundaries retained; placement styles work with shared obstacle measurements. |
| `src/control-settings.ts` | `005d66d0af205faf91c64c9aedfd72920bcb997b8867e9c90f8af297dc3f6726` | Kaisen-derived touch control settings UI adapted to Gekichin storage/modes; integrates lever v2, explicit Save/cancel, safe bounds and common tagged-peer geometry for live UI, preview and save. |
| `src/dialog-focus.ts` | `86d631a4d618558e1ca671004c12ccc1fbdfe75516e6c5d04f962acd2c5e1996` | Kaisen fixed blob exact copy; modal focus containment/restore. |
| `src/fleet.ts` | `de29a3e7e875def5a69a569803e2cb35d151c27c7a87054a69f5d9a576d9ca90` | New combat fleet accounting: 50 tokens, eight simultaneous slots, loss/re-entry ownership. |
| `src/flight-assist.ts` | `efebdbf59bf40b715d6e33f4bbdea60bdfe4e9d2ffaee0f1b37e2887ec9ac413` | Kaisen finite assist equations adapted to Gekichin target exposure and `FlightAssistTarget`. |
| `src/flight-view.ts` | `b8a5790501503799b1cc43e634d5ac3b6545fcaba477db970b61a5d2fbb3eb32` | Kaisen camera/projection helpers adapted to local types. |
| `src/flight.ts` | `41675b4e1f3bfecee95dad5b6ee2bebbd3930545ed35e6fa8260fca25a4b49b3` | Kaisen flight equations adapted to Gekichin rules; integrates explicit analog throttle commands with existing acceleration/brake behavior. |
| `src/game-state.ts` | `378bc600e3b32a598ef88d1ab93879eb7ba23524d130e9e17ab3338212cecd3e` | New fixed-60Hz combat state; validates/guards optional throttle command at core input boundary. |
| `src/input.ts` | `569455763b08fabb046145aa21ed473aa55de5ac4c481eb884b067263b925c7a` | Kaisen input ownership adapted to Gekichin's nine combat inputs; PR4 adds one owned throttle control and cleanup/neutral input semantics. |
| `src/keyboard-settings.ts` | `cdf9495e1e8e68c9c7c75a8210ab44a7dcb2b2c94c27506d4615fd3ee90c86f6` | Kaisen keyboard settings adapted to Gekichin's action map/storage; retains nine actions and excludes bomb/torpedo mapping. |
| `src/main.ts` | `9c679f77b16d482c613d6f87fca7109a796d60751605fa219f8a4fc703aa3106` | PR5 conflict-resolved screen owner: combat home/briefing/playing/pause/result, HUD, combat lifecycle plus PR4 speed-lever UI; no retained P1-only screen. |
| `src/mothership-layout.ts` | `8ea6c7f0d34587ccfd51d028d2c96e4004d5d0c22055eb54c30f3887c6393937` | New six-face/100 mount static layout, hit geometry, muzzle and route data. |
| `src/mothership.ts` | `10eb613bce21c94115abe3665bb44d677059b8293e97f4307adae2b813a71466` | New turret HP, damage stages, one-time destruction events. |
| `src/rules.ts` | `897ed57877f1986073e51efbfa96448409c89574959b6885b5e6924200f7e414` | New fixed `gekichin-combat-v1` values and combat limits. |
| `src/scene.ts` | `6dc42220163e8abfe10935994ddb316622dfa2b341ced773b3d7acd787552635` | New procedural Three.js carrier, mounts, projectiles, warning and sink scene. No external model/image assets. |
| `src/scoring.ts` | `95ee5ca3bac53b1e60b5c2cd804f35b7b7c91148851b5fcf99178c8aafd86494` | New confirmed-event scoring, report freeze and per-mode best validation. |
| `src/settings-storage.ts` | `dcc3d156e6872f3876624d285bb327c421073785afd6e00ada1f83a6f33cfb28` | PR4 new bounded v2 settings batch/journal and rollback; legacy v1 data is preserved/read without becoming a v2 write target. |
| `src/style.css` | `7b26f83f5bf1881ef53bd9e8b6268fc7fc23db71f0b3fef10362620b41748c55` | PR5 conflict-resolved combat presentation plus PR4 lever styling. No external fonts or images. |
| `src/throttle-control.ts` | `99b45ef5b506ee7a051f80152bf3ce1dcf7a5f521a7c446f6021e76a67163466` | PR4 adapter owns pointer/keyboard rate commands, cancellation and neutralization; feeds existing flight input. |
| `src/throttle-lever.ts` | `e83fe3c570581d16cb76e08ef9a039bbe9d4a50da6575366ac7e126bf3f30cf0` | PR4 shared v1 rate-lever equations and contract, finite clamp, deadzone, pointer mapping, command combination and legacy fallback. |
| `src/turret-combat.ts` | `fd9cf7163da2bb89bd3a755d35220f0720e33eb2b1bc5def7ed2b416c56a2e71` | New finite main/MG tracking, warning, fire, reservation and cooldown logic. |
| `src/types.ts` | `b950b23044ab0520c14cfbcbe7edf7e021652dcffdd5f455d1230e2b26015c1f` | New Gekichin state types and optional throttle field for flight input. |
| `src/wingman-ai.ts` | `06f7f12d1cc7772b448aec5cb60af1c13901a6b678c8220d3591eff9be78c55f` | New finite wingman target assignment, approach/attack/retreat and six-face route logic. |

The preserved notice file `public/third-party-notices.txt` has SHA-256 `97de7ac302052bcea7f20e5ae89635c10e049614f56409288d554d63fceb614f` and retains the Three.js notice.

## PR5統合sourceの検査binding

上表の `src/` 30ファイル内容hashはPR5の初回・後続CI runを通じて不変だった。push CI [37275240792](https://github.com/chameleonjp-lab/gekichin/actions/runs/37275240792) はunit 102/102とbuild成功、browser 55 pass・1 skip・1 fail。失敗したEasy viewport/restart fixtureは5番目の1366×768 fresh load/start時の約3.9秒renderer stallにより、製品stall guardがtick 1で正しくpauseしたもの。PR CI [37275243877](https://github.com/chameleonjp-lab/gekichin/actions/runs/37275243877) はunit/build成功、browser 56 pass・1 skip・0 fail、baseline comparison成功と報告された。Easy viewport/resource専用clock fixtureは単独1/1（32.6秒）で通過し、変更を含むexact-head全CIはこのtest-fix commit準備時点でpending。最終CI bindingはPR本文／Checksを正本とする。ローカルWebKit retryは実際にtest bodyを起動して17 pass・1 skip・0 fail（software WebGLが使えないlive-flight testをskip）。結果・trace・retry条件は [PR5_CONFLICT_RESOLUTION.md](./PR5_CONFLICT_RESOLUTION.md) と [`pr5-integration/`](./evidence/pr5-integration/) に記録する。単独layout fixture runは [run.log](./evidence/pr5-integration/layout-followup/run.log) と [manifest binding](./evidence/pr5-integration/manifest.json) にある。この追記はhash inventoryを変更せず、過去の異なるsource snapshotに結び付いたcombat artifactを統合sourceへ付け替えない。最終提出HEADとCI checkのbindingはPR本文／Checksを参照する。

## 武器式の限定的な由来

Gekichinの `src/aircraft-weapons.ts` に記す参照は、Kaisen固定版 `src/simulation.ts`（commit `3d751051dc6212482a129e8da596ddd349b2f9f5`、Git blob `537bf1e1fe0c5f73a1222d26e369ed6b6b312a3a`）の `fireAircraft` 内にある銃口オフセット、機体速度へ加えるMG/機関砲速度、および有限な僚機散布式である。Gekichin側は左右2発を原子的に確保し、固定ルールの弾倉・発射周期・ダメージ・寿命・弾プールと接続した。散布は元式の時刻・機体ID・左右側に基づく `sin`／`cos` の決定論的な式を僚機弾にのみ適用する。Easyの有限補正と通常の弾道計算は本作の型・砲台照準点へ接続する。

移したのはこれらの限定式である。Kaisenの全 `simulation.ts`、機銃／爆弾／魚雷の旧ゲーム機能、海戦・艦船・敵航空機・旧AI・旧採点・旧missionは取り込まず、static importもしない。Gekichinの僚機は有限弾倉・有限プール・ゲキチンの遮蔽と実衝突を通じて攻撃する。

## 依存と素材

`package.json` とlockfileは固定計画の版を保つ: Three.js `0.186.1`、TypeScript `5.9.3`、Vite `8.3.1`、tsx `4.21.0`、Playwright `1.61.1`、`@types/three` `0.183.1`。Three.jsのMIT NOTICEは `public/third-party-notices.txt` に同梱する。これらの記録は全依存のNOTICEや元作品ソース全体のライセンス判定を意味しない。

実行時に外部から取得する画像、3Dモデル、音声、フォントはない。機体・母艦・砲台・景観の幾何と一部テクスチャはコード生成し、音はWeb Audioで合成する。`public/third-party-notices.txt` が唯一の `public/` ファイルである。リポジトリ内の検査画像・入力列・ログは受入証拠で、製品へ配信する素材ではない。

Kaisen固定版の `docs/PLAN.md` §3が記録するのはKaisen本作向けの限定再利用根拠であり、一般公開ライセンスではない。今回のファイル単位の来歴も、Gekichin向け所有者指示の範囲を超える利用権を表明しない。詳細な固定refと既存移行台帳は [P0_BASELINE.md](./P0_BASELINE.md) を参照。
