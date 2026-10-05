# Normal enemy damage and respawn through product controls

The accepted browser record is `normal-enemy-respawn.json`, with hashes in `normal-enemy-respawn.manifest.json` and the five screen captures beside them. It uses the built Chromium preview at `http://127.0.0.1:4177`, Normal mode, the default seed `1196097537`, and the public Playwright page clock. The fixture changes the rendered RAF cadence to one callback per virtual second; each callback still advances the ordinary 60 Hz fixed simulation. It is software-browser evidence, not a frame-rate or device-performance measurement.

The pilot reads only visible HUD text and read-only `#app` / `#hud` datasets. It starts through the Normal radio and Start button, keeps a trusted pointer drag over the flight surface and the product-bound Space key held through Playwright input, and follows a 900 m horizontal orbit at 1000 m altitude. It updates the standard pointer steering once per 60 ticks. It never writes position, HP, ammunition, enemy state, or ownership.

The browser HUD first showed damage at tick 720: HP fell from 80.0 to 76.4 while the aircraft was at 1000 m altitude and radius 918.71 m; enemy main and machine-gun bullet pools were both live. At the loss sample (tick 4560), the aircraft was still at 1000 m and radius 889.96 m, with two enemy main bullets and 79 enemy machine-gun bullets present. Ownership changed `0 → 1`, and the HUD showed `復帰待ち`. The next player sample was tick 4740, ownership `2`, HP `80.0 / 80`, ammunition `288 / 96`, and position `[0, 1000, 1950.5]`. After another virtual second, with the automated pointer and Space holds still active, yaw and pitch remained zero, firing remained `射撃：待機`, and HP/ammunition stayed full. There were no page errors.

These HUD observations are sampled once per virtual second, so their tick values are frame samples rather than the exact event ticks. The adjacent engine-only probe (`../probe.json`, input row archive `../inputs.json.gz`) independently records the same controller path's bullet-caused loss at tick 4533 and respawn at tick 4713, exactly 180 ticks apart. It is separate engine-only evidence and does not assign exact event timing or damage provenance to the browser snapshots.

## Harness attempts

The first attempt, preserved under [browser/normal-enemy-respawn](../../browser/normal-enemy-respawn/), did not advance combat: its final HUD still read `0.00 s`. A pending real RAF had not switched to the fake-clock timer cadence. It is excluded from the result. The first corrected product run completed the same loss and respawn path but reported `not-complete` because the runner stored `hp` / `ammo` while its final assertions read `playerHp` / `ammunition`. That run and its screenshots are preserved under `attempt-01-schema-mismatch/`; they are excluded from the accepted pass. The corrected runner uses consistent HUD row fields, and the hash-bound rerun above passed without production-source changes.

## Reproduction

The shared Node/npm/browser environment is recorded in [environment.json](../../environment.json). With the built preview running on port 4177, run from the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers GEKICHIN_ENEMY_RESPAWN_OUTPUT=/tmp/gekichin-enemy-recovery node scripts/normal-enemy-respawn-run.mjs
```
