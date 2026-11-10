# Plan: Jira testingStarted maps to "In Testing"


## Final status
- Status: shipped (closed 2026-11-10, in the same commit as the work)
- Branch: `chore/jira-testing-started`, PR into `develop`
- Acceptance criteria: AC1–AC3 all shown (full gate 2026-11-10T20:02:37Z, Gate: PASS).
- Release review: governance FLAG (the acknowledged pre-plan `error` only), convention, silent-failure and security PASS.
- Jira: no ticket moved; ESP-116 is already Released.
- Deviations: none.

## Goal
Make `verify` move ESP tickets to In Testing when the full gate starts, by mapping the `testingStarted` stage event in this repo's Jira config.

## Requirement references
- ESP-116 (stage events: `verify` fires `devComplete` and `testingStarted`)
- Decision by Francis, 2026-11-10 (ESP-150..153 release review): "move testingStarted to In Testing"

## Pre-plan checklist
- (a) n/a: no new validation rule; `statusProblems` and `transitionProblems` in `scripts/jira-tracker.mjs` already accept `testingStarted`, and nothing rejects two events with one status.
- (b) n/a: no database or infrastructure mechanism.
- (c) Docs and ADRs: none change. README "Events (ESP-116)" already documents `testingStarted`; ADR-0003 covers the tracker. Searched `testingStarted` in `docs/` and the plugin README.

## Acceptance criteria
- AC1: `.claude/engineering.json` → `tickets.jira.statuses.testingStarted` is "In Testing" and `transitions.testingStarted` is "31"; `node plugins/usiatech-engineering/scripts/jira-tracker.mjs check` reports no config problem.
  - Evidence: diff of `.claude/engineering.json` adds `"testingStarted": "In Testing"` and `"testingStarted": "31"`; `jira-tracker.mjs check` exit 0, output statuses.testingStarted "In Testing", transitions.testingStarted "31" (shown, 2026-11-10T20:02Z)
- AC2: `jira-tracker.mjs steps --event testingStarted --from "In Progress"` prints steps `["In Testing"]`, and `steps --event testingComplete --from "In Testing"` moves nothing (already at the status).
  - Evidence: rerun in gate session: `steps --event testingStarted --from "In Progress"` printed steps ["In Testing"]; `steps --event testingComplete --from "In Testing"` printed steps [] with reason "already at \"In Testing\", which is at or past \"In Testing\"" (shown, 2026-11-10T20:02Z)
- AC3: full `verify` gate passes.
  - Evidence: gate run 2026-11-10T20:02:37Z: tests, validate marketplace, validate plugin, fake-pass check all PASS; Gate: PASS (shown, 2026-11-10T20:02Z)

## Tasks
- [x] T1: add `testingStarted` to `tickets.jira.statuses` and `tickets.jira.transitions` (covers AC1, AC2; ESP-116)
- [x] T2: full gate (covers AC3)

## Files
- `.claude/engineering.json`

## Commands and actions
- none

## Out of scope
- `devComplete` stays unmapped (Ready to Test is not in this board's workflow).
- No plugin code or doc change.

## Approved
- By: Francis · Date: 2026-11-10
- Route: small (requirement reference ESP-116; 1 config file; no new skill, module or interface)
- Pre-flight: sonnet, full

## Change log
- 2026-11-10: release review: governance FLAG on the pre-plan after-Bash `error` at 2026-11-10T00:33:31Z only (the ESP-151 case, already acknowledged by Francis in the ESP-150..153 plan; fixed by PR #187); convention, silent-failure and security PASS. Nit for the PR: rename the legacy `verified` key to `testingComplete`.
