# Source candidate CI record

- Source commit: `01804b95078317bb0129d0750b6a7f73184cee6f`
- Pull request: #5, `feat/gekichin-combat-completion`
- PR run: [GitHub Actions run 37264887934](https://github.com/chameleonjp-lab/gekichin/actions/runs/37264887934), `verify` succeeded; [complete log](source-candidate.log)
- Push run: [GitHub Actions run 37264857807](https://github.com/chameleonjp-lab/gekichin/actions/runs/37264857807), `verify` succeeded; [complete log](source-candidate-push.log)

## Checks

| Check | PR run | Push run |
| --- | --- | --- |
| `npm test` | 76 passed, 0 failed, 0 skipped | 76 passed, 0 failed, 0 skipped |
| `npm run build` | Passed (`tsc --noEmit` and Vite production build) | Passed (`tsc --noEmit` and Vite production build) |
| `xvfb-run -a npm run test:browser` | 27 passed, 0 failed, in 3.4 minutes | 27 passed, 0 failed, in 5.2 minutes |

Each browser run covered 20 Chromium tests, 6 WebKit UI tests, and 1 headed Chromium native-visibility test. The browser case lists are identical between runs. The later local evasion-recorder spec was not part of this source commit or run. Both builds emitted Vite's chunk-size advisory for the 737.01 kB minified JS bundle; both builds succeeded.

## Browser test names

1. `[chromium]` Easy combat clock, six-face HUD, pause and explicit resume follow product controls
2. `[chromium]` Normal keyboard firing consumes real ammunition and updates flight HUD, then pauses cleanly
3. `[chromium]` ten product restart cycles retain one bounded scene and stable WebGL resources
4. `[chromium]` normal product camera shows a main-gun warning and an ordinary turn
5. `[chromium]` Normal keyboard flight, loop interruption, pause, settings, report and reflight use one operation
6. `[chromium]` multi-touch cancel, lost capture, resize and compatibility click release held input
7. `[chromium]` Easy one button fits specified viewports and ten repeated starts never duplicate app resources
8. `[chromium]` WebGL loss while paused or editing gives guidance and restoration needs explicit resume
9. `[chromium]` an aborted combat report does not write a best record or make game API requests
10. `[chromium]` an explicit visibilitychange fixture stops flight and visible recovery never resumes it
11. `[chromium]` sound starts OFF, pauses with flight and reuses one audio context after replay
12. `[chromium]` touch preview controls fit their scroller and Gekichin settings leave other games storage untouched
13. `[chromium]` a pause binding on Enter leaves home and result button activation with native Enter
14. `[chromium]` an event-loop stall of at least two seconds freezes the flight until explicit resume
15. `[chromium]` when WebGL creation fails, settings and help remain available while flight stays disabled
16. `[chromium]` nine keyboard actions reject duplicate, reserved, modifier and IME input; draft and focus are transactional
17. `[chromium]` home editors offer both modes and persist touch size, opacity and placement only after save
18. `[chromium]` a multi-key save failure rolls back and only explicit session use changes active settings
19. `[chromium]` future-version values are never downgraded and failed drafts can be cancelled
20. `[chromium]` home, settings and guide stay reachable at all required viewports and 200 percent text
21. `[webkit-ui]` touch preview controls fit their scroller and Gekichin settings leave other games storage untouched
22. `[webkit-ui]` nine keyboard actions reject duplicate, reserved, modifier and IME input; draft and focus are transactional
23. `[webkit-ui]` home editors offer both modes and persist touch size, opacity and placement only after save
24. `[webkit-ui]` a multi-key save failure rolls back and only explicit session use changes active settings
25. `[webkit-ui]` future-version values are never downgraded and failed drafts can be cancelled
26. `[webkit-ui]` home, settings and guide stay reachable at all required viewports and 200 percent text
27. `[chromium-headed]` a native headed tab hides the flight, freezes its clock and requires explicit resume
