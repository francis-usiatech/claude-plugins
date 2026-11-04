# Plan: ESP-144 plugin share without fixing work

## Goal
Make `usage.cjs` leave fixing work in the `release` window out of plugin share, as Francis decided on 2026-11-03, and restate both measured weeks in `baseline.md`, so the ESP-144 AC6 re-measure prints the agreed number.

## Requirement references
- ESP-144 AC5 (decision: fixing work is not plugin overhead), AC6 (the re-measure this formula serves), AC8 (the split)
- ESP-117 comment 11215 (the recorded decision)
- `docs/audits/2026-10-24-usage-audit/baseline.md`, "Scripts updated" section

## Pre-plan checklist
- (a) New validation rules and format checks: n/a: no new validation or format check; this changes one sum and one printed label. Searched for readers of the label: "plugin share" appears only in `usage.cjs`, `audit-scripts.test.mjs` and `baseline.md` under `docs` and `plugins`.
- (b) Database or infrastructure mechanisms the design relies on: n/a: no database or infrastructure. `releaseSplit.fixing + releaseSplit.overhead` equals `win.release` because both are added on the same `activeSkill === 'release'` path (`usage.cjs:56-57`).
- (c) Docs and ADRs touched: `docs/audits/2026-10-24-usage-audit/baseline.md` (found by searching `docs` and `plugins` for "plugin share"). `docs/adr/` holds three ADRs, none on this work. No docs reviewer is configured, since `planning.preflightReviewers` isn't set.

## Acceptance criteria
- AC1: `usage.cjs` computes plugin share as `release` overhead + `verify` window + reviewers + forks, and prints it as `plugin share (release overhead + verify + reviewers + forks):`. The fixture test "should print a plugin share..." asserts `30.0% $30.00` on the $100 fixture, where fixing work is $20 (it was `50.0% $50.00`). The `release window: fixing work ..., overhead ...` line is unchanged.
  - Evidence: Test "should print a plugin share of release overhead, verify, reviewers and forks" passed in this gate run and asserts `30.0% $30.00`; the diff shows the label and sum in `usage.cjs`; the `release window:` line format is unchanged. (shown, 2026-11-04T01:36Z)
- AC2: On the real weeks, the printed plugin share is within 0.1 points of the printed old share minus the printed fixing share: 2026-10-17 to 2026-10-24 heiit 29.0%, waypointcareer 15.6%, both 25.1%; 2026-10-26 to 2026-11-02 heiit 24.3%, waypointcareer 19.1%, both 22.6%.
  - Evidence: Superseded by AC4's rule. Caller's run before the AC4 fix printed heiit 29.0/24.2, waypointcareer 15.6/19.1, both 25.1/22.6, each within 0.1 of old share minus fixing share (2026-11-03; caller-supplied, not re-run here). (shown, 2026-11-04T01:36Z)
- AC4: A `release`-window `Edit` or `Write` under `.claude/projects` or `.claude/session-data` counts as overhead, asserted by the test "should count writes to memory and session files as overhead". `usage.cjs` prints this definition, and `baseline.md` and ESP-117 comment 11215 give the shares under it. AC2's figures are then superseded by the printed shares, which the fix may raise by about 0.2 points.
  - Evidence: Test "should count writes to memory and session files as overhead" passed in this gate run; the diff shows the printed definition; caller's run printed heiit 29.2/24.4, waypointcareer 15.8/19.1, both 25.3/22.8, matching `baseline.md` and the corrected ESP-117 comment 11215 (2026-11-03; run and comment caller-supplied, `baseline.md` read here). (shown, 2026-11-04T01:36Z)
- AC3: `baseline.md` has a new section, dated, that states the formula change and its reason (Francis's decision), gives both weeks' shares as printed by the updated script and the shares before the change, states the combined drop moving from 3.9 to about 2.5 points, and states that the split is an estimate that errs both ways. Line 12's pointer sends later comparisons to the new section. It holds shares only, no dollars.
  - Evidence: Diff of `baseline.md` adds "Plugin share without fixing work (ESP-144, run 2026-11-03)" with the change, Francis's decision, before and after shares for both weeks, the drop from 3.9 to 2.5 points and the split erring both ways; line 12's pointer is updated; the section has no dollar figures. (shown, 2026-11-04T01:36Z)

## Tasks
- [x] T1: Change the fixture test's expected label and share first and see it fail (covers AC1; ESP-144)
- [x] T2: Change `pluginShare` and its label in `usage.cjs` (covers AC1; ESP-144)
- [x] T3: Run the updated script on both weeks and compare to AC2's figures (covers AC2; ESP-144)
- [x] T4: Update `baseline.md` (covers AC3; ESP-144)
- [x] T5: Add the failing test, extend `RELEASE_FLOW_PATH` and the printed definition, and correct ESP-117 comment 11215 (covers AC4; ESP-144)

## Files
- `docs/audits/2026-10-24-usage-audit/usage.cjs`
- `docs/audits/2026-10-24-usage-audit/audit-scripts.test.mjs`
- `docs/audits/2026-10-24-usage-audit/baseline.md`

## Commands and actions
- Read-only reads of `~/.claude/projects/*` transcripts for T3.
- Branch `feature/esp144-share-formula` from `develop`.
- Jira: move ESP-144 to In Progress (transition 21). At release, leave ESP-144 off the confirmed Released keys, so it stays open for AC1, AC5's 15% decision, AC6 and AC7.
- Jira: correct ESP-117 comment 11215 (T5).

## Out of scope
- The 15% decision, the AC6 re-measure and AC1's real-transcript check.
- Other changes to the fixing-work definition, or `window.cjs`.
- Rewriting earlier `baseline.md` sections or their tables; they stay as the record of what was measured then.
- Jira comments restating the numbers beyond correcting ESP-117 comment 11215 and a merge note.
- Version bump and the README Versioning row: these happen in the develop to main release PR.
- The other nits from PR #162, and the fork first-call context question.

## Approved
- By: Francis · Date: 2026-11-03
- Route: small (cites ESP-144, 3 files, no new skill, module, service or public interface)

## Change log
- 2026-11-03: Francis decided fixing work leaves plugin share and said to plan the formula change.
- 2026-11-03: `/code-review high` found memory and session writes counted as fixing (0.17% and 0.16% of total). Francis approved widening scope to exclude them: AC4 and T5 added, no files added.
- 2026-11-03: Stage 1 FLAG, Francis accepted: a guard-logged recursive delete in a `wfdiag` scratchpad folder (2026-11-04T00:32:39Z, likely the `verify` fork, not proven since the logged command is cut off) and the `bash-probe.mjs` and `bash-quote-probe.mjs` scratchpad files were diagnostics outside this plan, with no repo effect.
- 2026-11-03: The first `silent-failure-reviewer` spawn was denied by the auto-mode classifier. Francis approved a retry.

## Final status
- Shipped. Branch: `feature/esp144-share-formula`.
- AC1, AC3, AC4: shown, with evidence above. AC2: shown, then superseded by AC4's rule as the plan states.
- Deviations: scope widened for AC4 and T5, and scratchpad diagnostics accepted, both in the Change log.
- ESP-144 stays open for AC1's transcript check, AC5's 15% decision, AC6 and AC7.
