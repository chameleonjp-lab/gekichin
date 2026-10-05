# PR5 conflict resolution and integration record

記録日: 2026-10-05 UTC
対象: `chameleonjp-lab/gekichin` / `feat/gekichin-combat-completion`
PR #5: [ready for review](https://github.com/chameleonjp-lab/gekichin/pull/5)。提出HEADと最終CI結果はPR本文／Checksに紐づける。

## Integration base and recorded history

PR5 combat source was built on PR3/P1 main `98119b5ae6604ad5975024b0e523b78eef369662`. Its frozen product source is `5db76f68b53c846ae4e4aec4754f78e108107a37`, tree `63d4bc7cb8ee52e3389b6cd720f6288fcacc5db1`; evidence was archived by `c0cf927fcf7dd75edae6fee539072e4b3498c86e`. The latest main base is `595feb719c9b65697ab319fa40a939d6ee1b356b`, which merges PR4's shared vertical speed lever.

Only `src/main.ts` and `src/style.css` had actual source conflicts. Resolution combined the combat start/pause/finish/result path, combat HUD and synchronous abort report display with the new speed lever and its presentation. It did not replace combat with the P1-only screen or remove the lever implementation. The PR4 lever adapter and settings modules, v2 contract, tests and input/storage behavior remain integrated. Normal retains fire and loop controls plus one vertical lever; Easy retains its cruise/loop behavior without adding the lever. Explicit save uses the new v2 settings keys while preserving old v1 raw settings.

The user-approved requirements append is present in the current working tree as blob `c072b57dbdef3a48ac7e5717890e2bb4ed2baeb3`. It updates only the R30/R61–R64 control and storage scope. The original requirements commit/blob (`e9212a73a7b36c33dff7e88d3a7308be6cdcea35` / `1ef91cb86cae2c7ff52f9f561f80ae4b6f18ad7c`) remains the source for the preceding body. README and implementation plan remain at blobs `9d0cfacf52833d90d39f02a9ab1c1c57dee30aa0` and `11dec1af2004ec3d71357d9eae029e324c6fdf3c`.

## What the conflict resolution preserves

- Combat implementation: finite fleet, six-face layout, enemy projectiles, wingman AI, scoring, mission results and combat presentation from the source5db candidate.
- Speed lever v2: Normal fire/loop/lever layout, Easy control restrictions, explicit save and separate v2 settings keys, v1 raw preservation, pointer/keyboard ownership and cancellation rules.
- Shared control settings: the settings editor and preview use the lever's rectangular geometry, placement, opacity and size, with collision handling for nearby control hit areas.
- Combat ownership remains in the combat `FlightSession` and product screen lifecycle; the lever only changes the acceleration/deceleration input delivered through the existing flight update.

The conflict merge did not change combat weapons, fleet totals, turret rules, scoring, or mission finish rules. Integration fixes discovered during review are tracked separately from conflict resolution.

## Evidence binding and pending integration checks

Evidence under `docs/evidence/acceptance/` is bound per its manifest, log, and capture record. Many final combat artifacts were captured against source5db, while some earlier records use an earlier combat candidate; evidence commit `c0cf927` archives the collection but does not make every artifact share one source snapshot. None of those older records proves the current PR4-integrated source. The old 30/60/120Hz replays and 70-screen matrix have not been regenerated; no new full-mission or 70-screen capture is planned for this conflict-only integration. The six paired evasion browser recorder was rerun on the integrated source (1/1); 21 fresh outputs (WebM, gzip trace and 19 PNGs) are configured for the PR5 CI evidence artifact, with source/test bindings in [`evasion-recorder-manifest.json`](./evidence/pr5-integration/evasion-recorder-manifest.json). The manifest’s artifact digests identify the fresh local capture; the CI rerun produces separate video and trace bytes bound to its own recorded source snapshot. The tracked 72-second source5db video and original 18 PNG checkpoints remain unchanged historical evidence.

The PR4 [`THROTTLE_LEVER_CONTRACT.md`](./THROTTLE_LEVER_CONTRACT.md), [`THROTTLE_LEVER_VERIFICATION.md`](./THROTTLE_LEVER_VERIFICATION.md) and [`throttle-lever-parity.json`](./throttle-lever-parity.json) are PR4/P1-era records. Their hashes and checks are historical context, not final hashes or test results for the integrated PR5 tree. The current per-file source inventory is recorded in [`COMBAT_PROVENANCE.md`](./COMBAT_PROVENANCE.md); it is a content inventory for the frozen worktree and will be bound to the submitted PR/checks externally.

The explicit `throttle: 0` core guard is included. A review found that at 200% text and a non-default lever position the saved lever overlapped a neighboring control. The placement path was corrected so the tagged live peer and detached preview/Save measurement share geometry; an adversarial actual-DOM regression exercises the custom 568×320 landscape case with dynamic font sizing and preview/Save parity. PR4's separate checks cover default control positions in portrait/landscape at 100%/200% text. The integrated-source suite passed 102/102 with no failures/skips, and production build passed. Local browser execution completed with 39 passes (Chromium plus headed native) and 18 WebKit cases unable to launch before test body because of missing host dependencies; skipped count is zero. Raw logs/results are under [`pr5-integration/`](./evidence/pr5-integration/). The matched public-flow comparison against archived c0 combat baseline passed four captures at tick 12 over 393×852 and 852×393 viewports. Compared DOM phase/mode/elapsed/speed/altitude/loop/fire fields matched exactly. The command receipt says exit 0; the comparison script emits no success text, so the empty raw stdout/stderr log is not treated as the result by itself. Receipts, conditions and screenshots are under [`pr5-integration/comparison/`](./evidence/pr5-integration/). This is not a comparison against `98119b5`. An earlier pre-fix capture attempt is excluded. Ubuntu CI provides the complete browser dependency environment; the submitted HEAD and final CI result are linked from the PR body/Checks.

The engine/browser records still do not establish real PC or iPhone 17 Pro/Safari performance, physical touch behavior, human playability or audible quality. P7/P8 and overall acceptance remain incomplete.
