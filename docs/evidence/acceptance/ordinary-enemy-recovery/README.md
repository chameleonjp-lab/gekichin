# 通常入力による敵弾撃墜と復帰

Normal の標準開始状態から、実際の敵弾による HP 減少、撃墜、180 tick 後の復帰を確認した。seed は既定値 `1196097537`。初期位置・HP・弾薬・敵状態を変更せず、`prepare` / `begin` 後は通常の `FlightInput` を `FlightSession.step` に渡した。

| 観測 | tick | 結果 |
|---|---:|---|
| 初回敵弾命中 | 717 | HP 80 → 77.6 |
| 敵主砲の直撃 | 832 | HP 72.8 → 48.8 |
| 60 秒時点 | 3600 | HP 14、撃墜なし |
| 最後の命中・撃墜 | 4533 | 敵機銃66の実損傷0.8、HP 0、token 0を「被弾」で喪失 |
| 自機復帰 | 4713 | token 8、HP 80、機銃288発、機関砲96発 |

敵弾の実損傷は48回、合計 `80000 mHP`。撃墜は75.55秒、復帰は78.55秒で、差は180 tick（3秒）。所有権 revision は `0 → 1 → 2`。復帰時は `A8 / Q0 / R41 / D1`、自機喪失1、僚機喪失0。敵弾割当失敗0、異常停止なし。最初の復帰で観測を終了した。

入力は1秒ごと（tick 1, 61, 121, …の直前）に更新し、その間は同じ入力を保持する。現在位置から `atan2(x, z) + 0.24` の方向に半径900m、高度1000mの目標点を置き、目標 yaw との差に対して `turn = clamp(-normalizeAngle(targetYaw - yaw) / 0.82, -1, 1)` を与える。高度は変わらないため `climb=0`。射撃を保持し、宙返り・加速・減速は使わない。標準推力は110m/s、`viewAspect=393/852`。最初の turn は `0.22901055859777505`。自機不在時の次の入力更新から neutral を渡す。

```sh
node --import tsx docs/evidence/acceptance/ordinary-enemy-recovery/probe.mjs > docs/evidence/acceptance/ordinary-enemy-recovery/probe.log 2>&1
node docs/evidence/acceptance/ordinary-enemy-recovery/audit.mjs > docs/evidence/acceptance/ordinary-enemy-recovery/audit.log 2>&1
```

`probe.mjs` は120 active 秒を上限に同じ入力方法を継続する。`probe.log` は生の進捗・結果、`probe.json` は全命中・損傷・撃墜・復帰・入力更新・実行前のソース hash、`inputs.json.gz` は4713 tick 分の入力原票である。ソースは観測の前後で一致し、採用済みの full mission 記録と同じ15個のシミュレーションモジュールの hash を使っている。`audit.mjs` は保存原票と hash を軽量に再点検し、`manifest.json` を生成する。

この記録は無改変のゲームシミュレーションへ通常入力を渡した統合観測である。ブラウザーの実操作、実機性能、人間のプレイの証拠には含めない。同じ入力方法を使う製品 DOM 検証には、別のブラウザー記録を参照する。
