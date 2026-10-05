# 記録入力の全作戦 FPS 再生

`scripts/mission-replay.ts` は、最終受入の Easy／Normal 入力 gzip を読み、同じ論理 tick の `FlightInput` を `FlightSession.step` へ渡す。初期化は通常の `prepare`／`begin`、時計は製品の `FixedStepper` を使う。機体・HP・弾薬・砲台・AI・得点の状態を直接変更しない。入力を再生成せず、読み込んだ各入力オブジェクトを凍結して使う。

描画時刻だけを30／60／120Hzの等間隔時刻として与え、戦闘は60Hz固定で進める。これは R80 の論理結果一致の検査であり、ブラウザーの実描画やPC／iPhoneのp95性能測定ではない。

原票に対して、勝利 `endTick`、mode／seed、確定 report の全項目、100基の破壊順・tick・面・担当、全砲台HP、有限編隊数、最終敵弾数、実発射数、弾生成失敗数を厳密に照合する。原票は `../{easy,normal}-inputs.json.gz` と `../{easy,normal}-run.log` の最終 `mission-result` を組にして扱い、両者の report／tick／破壊履歴一致を開始前に検査する。

各再生の最終公開状態を丸めずに保存する。状態には機体の座標・姿勢・HP・弾薬・世代、復帰予約、砲台HPと姿勢、残存弾、敵／僚機AI、得点、確定report、保持イベントを含む。キーを正規化したJSONのSHA-256を描画周期間で比較する。さらに、各論理tick後に全イベントをsequence順で読み、全作戦のイベント列SHA-256も比較する。原runnerが保存していない機体・弾・AIの詳細状態は、再生同士の比較であり、原runnerの詳細snapshotとの比較ではない。

30Hzでは勝利が1フレーム内の最初のtickで確定すると次のcallbackが残る。そのcallbackに追加入力を渡さず、勝利後の通常 `step` とinactive frameによって状態が変わらないことも確認する。

再現コマンドはリポジトリrootで実行する。各processの3周期は逐次実行される。

```sh
node --import tsx scripts/mission-replay.ts --record docs/evidence/acceptance/easy-inputs.json.gz --result-log docs/evidence/acceptance/easy-run.log --output docs/evidence/acceptance/replay --hz 30,60,120 > docs/evidence/acceptance/replay/easy-replay.log 2>&1
```

```sh
node --import tsx scripts/mission-replay.ts --record docs/evidence/acceptance/normal-inputs.json.gz --result-log docs/evidence/acceptance/normal-run.log --output docs/evidence/acceptance/replay --hz 30,60,120 > docs/evidence/acceptance/replay/normal-replay.log 2>&1
```

`{easy,normal}-replay.log` にコマンド引数・Node環境・進捗・結果・sourceと原票のSHA-256を保存する。`{mode}-{hz}hz.json` は詳細snapshotと照合結果、`{mode}-manifest.json` は全周期の一致結果である。終了時にsourceと原票のハッシュを再検査し、途中の変更があれば検証を失敗させる。

同時実行は2 processまでとした。ブラウザー実時間検証とのCPU競合を避けるため、開始後に既知2 processをSIGSTOPし、合図後にSIGCONTした。再開後はnice=10とし、ブラウザーのCPU schedulingを優先した。運用は `orchestration.json` に記録する。停止時間は `wallSeconds` に含まれ、合成描画時刻・受理入力・能動作戦時間を変えない。`wallSeconds` を端末性能の合否に使用しない。

## 確定結果

2026-10-05 UTC、Node v24.19.0／Linux x64で6再生すべて成功、modeごとのprocessもexit 0で終了した。各周期で54329入力を受理し、能動時間905.4833333333333秒、100基全破壊、最終砲台HP合計0、味方は出撃8・復帰待ち0・予備2・損失40・総残機10である。自機損失0、僚機損失40。砲台の破壊順・tick・面・担当を含む原票照合をすべて通過した。

| mode | 描画周期 | 終了tick | K / Damage milli | P / W | N / Hmain / Hmg | 得点 | 全イベント数 |
| --- | --- | ---: | --- | --- | --- | ---: | ---: |
| Easy | 30 / 60 / 120Hz | 54329 | 100 / 24000000 | 0 / 40 | 4 / 0 / 0 | 120443 | 44035 |
| Normal | 30 / 60 / 120Hz | 54329 | 100 / 24000000 | 0 / 40 | 19510 / 0 / 0 | 120443 | 63545 |

| mode | 3周期共通の最終snapshot SHA-256 | 3周期共通の全イベント列 SHA-256 |
| --- | --- | --- |
| Easy | `5a7e30364fc832d8e3b388eddde89a161514533c6ee18b6d9b6a39e7db7168dd` | `dd54cd493fbd5ec760dc5891572bdd4a4d85fd8b3282139291525ac281632567` |
| Normal | `70e3f1fca89c527fe1a40635a3716652306a74cdbc580f7aa9539cb41f0a835b` | `54c4c0d197afd2d13110bc4dad95aeb776529d15b01bf0ad7a5966d6793517a7` |

30Hzは27165 frame／54330 callback、60Hzは54329 frame／54329 callback、120Hzは108658 frame／54329 callbackで確定した。30Hzの最後の余剰callback 1回には入力を渡さず、全周期で受理入力数は54329に一致する。gap callbackは全周期0回。report本体と成分の凍結、および結果確定後の通常step／inactive frameによる状態不変を確認した。

両modeの開始時・終了時で戦闘依存source／runner／packageの19ハッシュとaccepted gzip／logハッシュを再検査し、一致した。元勝利記録の `../mission-manifest.json` と共通するsource16件も一致する。追加の保存内容監査は `snapshot-audit.log`、集約結果・コマンド・原票と成果物ハッシュは `manifest.json` に保存した。
