# A12 / R45 evasion evidence

`evasion-trials.json.gz` and `evasion-browser-trials.json.gz` are gzip-compressed, deterministic inspection fixtures for the P4/P7 projectile-evasion check. Decompress either with `gzip -dc <file>`. Each baseline/evasion pair uses the same seed, player pose, target mount, and tick-zero state. One of the 100 real mounts remains active; the other 99 are damage-resolved only during fixture initialization. After tick zero, the tests send ordinary `FlightInput` through `FlightSession.step` and record production warning/tracking state, enemy projectiles, aircraft paths, and collision/damage events through the last projectile expiry.

This fixture is separate from the ordinary 100-mount clear. It does not establish the full mission victory path, human playability, or real-device performance. The firing solution, speed, warning period, MG cadence, and projectile lifetime are read from `ENEMY_PERFORMANCE`; no shot is removed or made harmless.

The browser fixture reuses one `FlightSession` through its normal `home()` / `prepare()` lifecycle, so the production `FlightScene` observes each operation's new ID and presents its events. The WebM duration is 72.16 seconds (ffprobe) and it is rendered by the production `FlightScene` using its normal flight camera. It includes paired no-input controls and evasion trials for upper, lower, and side faces, with warning, maneuver, and first-shot checkpoints plus sampled frames every 10 logical ticks during evasion. The camera is sampled rather than rendered once per solver tick to keep a headless software-WebGL recording bounded; every logical tick still runs through the production session and is retained in the JSON trace. The sample cadence is not FPS or real-time performance evidence.

The recording's small status panel is test-only and reads the active session's phase, warning tick, inputs, HP and projectile state. It is not the product HUD. To keep real warnings visible, the tick-zero fixture starts 90m down the selected mount's default barrel ray and 500m farther along its horizontal outward direction, with level 110m/s flight and the normal camera heading toward the emitter. This initial test-only pose is inside the standard operation bounds and has clear geometry; thereafter the test performs no state writes and uses ordinary `FlightInput`. The browser test checks that the emitter and fixed aim both project inside the normal camera at every warning checkpoint. The six warning PNGs visibly show the real mount and warning marker/line; the paired traces record actual shot paths, hit events and misses. The separate PNGs from an untouched normal-mode product start show one visible main-gun warning and the scene after an ordinary right-turn input. These software captures do not establish human playability or real-device performance.

The fixture is explicitly excluded from a normal 100-mount clear. It does not establish the full mission victory path. No invulnerability, projectile deletion, or post-tick pose/physics writes are used. Enemy speed, warning period, MG cadence, and projectile lifetime come from `ENEMY_PERFORMANCE`.

- `main-warning-normal-camera.png`: main-gun warning line and HUD notice from the normal product start.
- `main-warning-after-turn-normal-camera.png`: same normal run after a right-turn input; the bank and camera orientation have changed while the warning remains visible.
- `evasion-six-cases-normal-camera.webm`: six paired normal-camera browser scenarios with baseline and evasion paths.
- `browser-frames/`: 18 normal-camera PNG checkpoints (warning, maneuver, and first projectile for each evasion case).
- `evasion-browser-trials.json.gz`: full per-tick browser traces for all twelve trials plus outcomes, fixture pairs, and recording metadata.
- `evasion-trials.json.gz`: independent Node fixture traces for all six paired no-input/evasion cases.

Both trace files contain SHA-256 hashes for the relevant requirements, plan, solver, fixture, and recorder files. Each capture hashes them before the first trial and asserts that the files remain unchanged through capture.

Capture commands from the repository root:

```sh
GEKICHIN_EVASION_CAPTURE=1 node --import tsx --test tests/evasion.test.ts
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers npm run test:browser -- --project=chromium --grep='normal product camera shows'
PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright-browsers GEKICHIN_FIXTURE_BASE_URL=http://127.0.0.1:4179 npx playwright test browser-tests/evasion-recording.spec.ts --project=chromium --reporter=list
```
