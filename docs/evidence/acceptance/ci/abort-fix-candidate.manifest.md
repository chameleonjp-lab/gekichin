# Abort fix candidate CI record

- Source commit: `5db76f68b53c846ae4e4aec4754f78e108107a37`
- Git tree: `63d4bc7cb8ee52e3389b6cd720f6288fcacc5db1`
- Pull request: #5, `feat/gekichin-combat-completion`
- PR run: [37265544385](https://github.com/chameleonjp-lab/gekichin/actions/runs/37265544385) — `verify` succeeded; [complete log](abort-fix-candidate.log)
- Push run: [37265539764](https://github.com/chameleonjp-lab/gekichin/actions/runs/37265539764) — `verify` succeeded

| Check | PR run | Push run |
| --- | --- | --- |
| `npm test` | 76 passed, 0 failed, 0 skipped | 76 passed, 0 failed, 0 skipped |
| `npm run build` | Passed (`tsc --noEmit` and Vite production build) | Passed (`tsc --noEmit` and Vite production build) |
| Browser | 28 passed, 0 failed, in 4.2 minutes | 28 passed, 0 failed, in 5.4 minutes |

Each browser run covered 21 Chromium, 6 WebKit UI, and 1 headed Chromium test. The new regression case passed: `abort replaces the previous result display before the next rendered frame` (`browser-tests/combat.spec.ts:132`).
