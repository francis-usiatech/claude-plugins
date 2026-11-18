# Plan: Usage band compact text step and centred segments

## Goal
Keep the usage band on one row in a normal-width VS Code panel by adding a third text step (caption size with compact captions) that is used only when the caption row does not fit, and centre the band's segments in its row on desktop and VS Code.

## Requirement references
- ESP-169 (Subtask under ESP-27): "Usage band: compact text step so the row fits narrow VS Code panels; centre the segments".
- User request (2026-11-17): VS Code screenshot with the band wrapping `$27.58 +$0.05` to a second row; "proceed with option 2" (compact text step) and "Center the contents".

## Pre-plan checklist
- (a) New validation rules and format checks: n/a: no validation rule or format check; the change adds a display-only compaction of the reset-time and context captions (`register.tsx` `resetText` / `gaugesOf` are the only producers; their callers are the desktop/VS Code and terminal branches of the AbovePrompt handler, and the fixtures are `USAGE` in `hooks/band.test.tsx`).
- (b) Database or infrastructure mechanisms the design relies on: the Box `justifyContent` prop of the engine's UI (a documented flex prop, mapped to CSS `justify-content` by the desktop and VS Code webviews like the other flex props the band already uses). No spike needed: a documented prop, checked in the browser-pane reproduction (AC4).
- (c) Docs and ADRs touched: `plugins/usiatech-usage-band/README.md` (the "desktop and VS Code draw one compact row" paragraph: add the compact step and the centred segments). No ADR covers the usage band (search of `docs/` for "usage band": none).

## Acceptance criteria
- AC1: When the row does not fit at caption size, the desktop/VS Code band uses caption size with compact captions: reset times drop a `:00` minute and the space before AM/PM (`10:00 PM` → `10PM`, `Sat 10:00 AM` → `Sat 10AM`; `10:30 PM` → `10:30PM`) and the context caption drops the window (`ctx 291k/1M` → `ctx 291k`). Wider rows keep the full captions. Test in `hooks/band.test.tsx`.
  - Evidence: band.test.tsx "below caption size the captions turn compact: shorter reset times, context without the window" and "compactTime drops a :00 minute and the space before AM/PM, and keeps 24-hour times" passed in claude plugin test plugins/usiatech-usage-band (12 pass, 0 fail) at this tree; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$
- AC2: The step choice counts each step's own text: footnote with full captions at a wide body, caption with full captions where it fits, compact caption below that. Test in `hooks/band.test.tsx`.
  - Evidence: band.test.tsx "the compact step is chosen only when the full captions do not fit at caption size" passed (12 pass, 0 fail) at this tree; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$
- AC3: On desktop and VS Code the segments' row Box has `justifyContent: 'center'`; the outer row stays `flexWrap: 'nowrap'` and the close button stays last. Test in `hooks/band.test.tsx`.
  - Evidence: band.test.tsx "the segments sit centred in the row on desktop and VS Code, with the close button last" passed (12 pass, 0 fail) at this tree; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$
- AC4: A browser-pane reproduction of the VS Code webview flex mapping (scratchpad HTML, stated as a reproduction) at ~680 px with the screenshot's values shows one row with centred segments and the × at the top right.
  - Evidence: not measured: the static reproduction page was opened in the browser pane, but the browser tools cannot act on a local file, so no row count was recorded; real check is reloading VS Code with 0.3.3; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (not shown, 2026-11-18T03:21Z)$
- AC5: `claude plugin test plugins/usiatech-usage-band` passes; `claude plugin validate plugins/usiatech-usage-band` and `claude plugin validate .` report no errors.
  - Evidence: claude plugin test plugins/usiatech-usage-band 12 pass 0 fail (exit 0); claude plugin validate plugins/usiatech-usage-band passed with warnings (exit 0); gate step validate marketplace (claude plugin validate .) PASS exit 0; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$
- AC7: On VS Code the close button renders no hover card (the webview maps no Box hover or position props, so it could never show); on the desktop the "Hide for this session" card stays. README Limits says so. Test in `hooks/band.test.tsx`.
  - Evidence: band.test.tsx "the close button has its hover tip on the desktop and none in VS Code, which draws no hover cards" passed (12 pass, 0 fail); README Limits line in the diff; Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$
- AC6: The usage-band version is 0.3.3 in `plugins/usiatech-usage-band/.claude-plugin/plugin.json` and in the usiatech-usage-band entry of the root `.claude-plugin/marketplace.json`.
  - Evidence: version 0.3.3 in plugins/usiatech-usage-band/.claude-plugin/plugin.json line 3 and in the usiatech-usage-band entry of .claude-plugin/marketplace.json (diff); Gate tree: 7662275bd335f0e1a5f4a5b52349f59497dde04f; Resume: reusing the steps that passed at tree 7662275bd335f0e1a5f4a5b52349f59497dde04f (shown, 2026-11-18T03:21Z)$

## Tasks
- [x] T1: Add the compact step to `FITS`, make `fitFor` measure each step's own texts, and compact the captions in `gaugesOf`/`resetText` (covers AC1, AC2; ESP-169)
- [x] T2: Centre the segments row with `justifyContent="center"` (covers AC3; ESP-169)
- [x] T3: Tests for AC1–AC3 in `band.test.tsx` (covers AC1, AC2, AC3; ESP-169)
- [x] T4: README note on the compact step and centred segments (covers AC1, AC3; ESP-169) (docs-only)
- [x] T5: Bump the usage band to 0.3.3 (covers AC6; ESP-169)
- [x] T7: Leave the hover card out on VS Code, README limit note, test (covers AC7; ESP-169)
- [x] T6: Browser reproduction and plugin test/validate (covers AC4, AC5; ESP-169)

## Files
- `plugins/usiatech-usage-band/hooks/register.tsx`
- `plugins/usiatech-usage-band/hooks/band.test.tsx`
- `plugins/usiatech-usage-band/.claude-plugin/plugin.json`
- `plugins/usiatech-usage-band/README.md`
- `.claude-plugin/marketplace.json`

## Commands and actions
- ESP-169 created in ESP under ESP-27; move it per the repo's Jira flow.
- `claude plugin test plugins/usiatech-usage-band`, `claude plugin validate plugins/usiatech-usage-band`, `claude plugin validate .` (AC5).
- A static reproduction page in the session scratchpad, opened in the browser pane (AC4); no server.

## Out of scope
- A true-centre spacer for the segments (code-review finding 5, accepted as is: the segments centre on the band minus the close button column, about 2 cells off).
- A font size below caption.
- The terminal band layout (centring and compaction apply to desktop and VS Code only).
- Bumping the marketplace's own release version and root README changelog (done by the release PR).

## Approved
- By: Francis · Date: 2026-11-17
- Route: small (cites ESP-169; 3 production-code files: `register.tsx`, `plugin.json`, `marketplace.json` (tests and README do not count), 3 ≤ 5; no new skill, module or public interface)
- Pre-flight: sonnet, full (governance-reviewer PASS)

## Change log
- 2026-11-17: drafted; "Center the contents" added to scope at the user's request before approval.
- 2026-11-17: pre-flight (governance-reviewer, sonnet, full): PASS. Low-confidence notes applied: test/validate commands and the scratchpad reproduction listed under Commands and actions; AC6 names the root marketplace.json path.
- 2026-11-17: approved by Francis (accept all, review page D1.1–D1.4); ESP-169 moved to In Progress.
- 2026-11-17: /code-review high: findings 1–4 fixed (compactTime unit test, invisible U+202F removed, gauges built once per render, spaced a. m. locales); finding 5 (centring offset by the close column) accepted as is by Francis.
- 2026-11-17: scope added at Francis's request ("the hover and the tooltip doesn't work in VS Code"): VS Code 2.1.326 webview maps no Box hover/position props and gives Button no title, so the hover card is left out on VS Code (AC7, T7); Francis chose "Drop it in VS Code". Governance FLAG 1 (gate does not run the usage-band suite) handled by passing claude plugin test/validate output to verify as AC evidence.
- 2026-11-18: release review round 2 (governance, convention, silent-failure, security): all PASS, nits only. Gate PASS on resume at tree 7662275b (first run failed only on the engineering plugin's timing perf test). AC4 not shown (browser tools cannot act on a local file); Francis accepted it unmeasured, to be checked in VS Code after the 0.3.3 update.

## Final status
- Status: shipped (branch `fix/usage-band-compact-step`, ESP-169).
- AC1, AC2, AC3, AC5, AC6, AC7: shown (gate 2026-11-18T03:21Z, tree 7662275b).
- AC4: not shown, accepted by Francis; check in VS Code after release.
- Deviations: AC7/T7 added after approval at the user's request; code-review finding 5 accepted as is.
