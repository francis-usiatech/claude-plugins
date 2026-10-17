# Plan: Pre-flight reviewers alongside governance-reviewer (ESP-67)

## Goal
Let a repo list extra agents in `planning.preflightReviewers` that `approve-plan` runs on the draft plan in parallel with `governance-reviewer`, with their findings merged into the one batched pre-flight decision, and have the guard report a badly shaped key as an advisory config problem.

## Requirement references
- docs/specs/2026-10-16-delivery-speedup.md (Status: approved) · R9, R10, R11, R12, R19 (the `planning.preflightReviewers` part) · AC8, AC9, AC14 (README part for this item), AC15
- ESP-67 (sub-task of ESP-63; blocks ESP-66)

## Acceptance criteria
- AC1 (spec AC8, R9, R12): Guard tests in `tests/governance-policy.test.mjs` pass: a missing `planning`, an empty list, and a valid `planning.preflightReviewers` (entries with and without `when`) give no config problem; a non-object `planning`, a non-array `preflightReviewers`, an entry with no non-empty string `agent`, and an entry with a bad `when` (not a non-empty list, or a prefix with a backslash, leading `/` or `./`, a `..` segment, a control character or surrounding spaces) each give exactly one advisory problem, no escalating problem, and `evaluate` returns no ask. Warned once: with the warn-once marker, the first call reports the problem as a warning (one `warn` log entry) and an unchanged repeat reports none. Entries are objects `{ "agent": "<name>", "when": ["<prefix>", …] }`; a string entry is a bad shape.
  - Evidence: tests/governance-policy.test.mjs › "evaluate: planning.preflightReviewers (ESP-67…)": 16/16 pass (valid config, bad shapes each 1 advisory/0 escalating/no ask, control-character case now mid-string "src/x/", drop-only-bad-entry, warn-once); mutation-test 10/10 CAUGHT; full run 1268 pass/0 fail (shown, 2026-10-17T04:45Z)
- AC2 (R9): `gate.mjs` and the guard share one prefix rule: both import `isPathPrefix` from `templates/github/scripts/governance-rules.mjs` (the guard's shared helper module), and the existing gate tests still pass unchanged.
  - Evidence: gate.mjs:20 and governance-policy.mjs:16 import `isPathPrefix` from governance-rules.mjs; tests/gate.test.mjs unchanged (empty git diff) and passing in the full run (0 fail); reconfirmed by the repo gate at 2026-10-17T04:44:38Z after the mutation run restored the files (shown, 2026-10-17T04:46Z)
- AC3 (spec AC9, R10, R11): `skills/approve-plan/SKILL.md` pre-flight step says: (a) each listed reviewer runs on the draft in design mode in parallel with `governance-reviewer`; (b) an entry with `when` runs only when a prefix matches a path in the plan's Files section, one without `when` always runs; (c) BLOCKs and FLAGs from all reviewers go into the one batched decision, each labelled with the reviewer that raised it; (d) a BLOCK from any reviewer must be fixed; (e) a reviewer that fails or isn't installed is reported by name and doesn't count as a pass; (f) an invalid entry is skipped and named in the pre-flight report. `tests/plugin-structure.test.mjs` asserts each of (a)–(f).
  - Evidence: tests/plugin-structure.test.mjs › "pre-flight reviewers (ESP-67…)" (a)–(f): 6/6 pass in this gate run; reconfirmed by the repo gate at 2026-10-17T04:44:38Z after the mutation run restored the files (shown, 2026-10-17T04:46Z)
- AC4 (spec AC14, R19 part): `plugins/usiatech-engineering/README.md` documents `planning.preflightReviewers` in the config table, lists its problems under "Advisory" in "Config problems", and has a 0.18.0 Versioning row for the change (the version itself is bumped in the release PR).
  - Evidence: README.md:56 `planning` config row, README.md:210 advisory list item, README.md:316 0.18.0 Versioning row; reconfirmed by the repo gate at 2026-10-17T04:44:38Z after the mutation run restored the files (shown, 2026-10-17T04:46Z)
- AC5 (spec AC15): `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints `Gate: PASS`.
  - Evidence: `node plugins/usiatech-engineering/skills/verify/gate.mjs` (repo runner, working tree, after the test fix) → Gate: PASS, exit 0 at 2026-10-17T04:44:38Z (tests, both validates, fake-pass all exit 0) (shown, 2026-10-17T04:45Z)

## Tasks
- [x] T1: Write failing guard tests for `planning` / `planning.preflightReviewers` (covers AC1; ESP-67)
- [x] T2: Move `isPrefix` (as `isPathPrefix`, with its control-character helper) from `gate.mjs` into `templates/github/scripts/governance-rules.mjs`; import it in `gate.mjs` (covers AC2; ESP-67)
- [x] T3: Validate `planning` and `planning.preflightReviewers` in `sanitizeConfig` as advisory, dropping only the bad value or entry (covers AC1, AC2; ESP-67)
- [x] T4: Write failing structure tests, then update the approve-plan pre-flight step (covers AC3; ESP-67)
- [x] T5: Update the README: config table row, Advisory list, Versioning row (covers AC4; ESP-67)
- [x] T6: Run the gate (covers AC5; ESP-67)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `.claude/plans/archive/2026-10-16-esp67-preflight-reviewers.md`

## Commands and actions
- None beyond the standard gate. No version bump in this PR (done in the release PR per the release rule).

## Out of scope
- The pre-plan checklist (ESP-66, R6–R8), including its docs-reviewer hook into (c).
- Configuring `planning.preflightReviewers` in this repo or in HEILens.
- Changes to `governance-reviewer` or any other agent; a "design mode" prompt contract beyond what the skill text says.
- `templates/engineering.json` example.

## Approved
- By: Francis · Date: 2026-10-16
- Route: large (adds a new public config key and touches 7 files). clarify → to-spec → to-tickets are already done: spec approved 2026-10-16, ticket ESP-67.

## Change log
- 2026-10-16: Plan drafted from ESP-67.
- 2026-10-16: Pre-flight PASS; added the warned-once check to AC1. Francis decided: shared prefix rule in governance-rules.mjs (release will suggest mutation-test, since it matches *rules*.mjs); entries are objects only, an invalid one is skipped and reported; a 0.18.0 Versioning row in this PR.
- 2026-10-17: Release stage 1 FLAG (AC5 evidence came from the installed runner, not the repo runner) resolved by running the repo runner and re-stamping AC5; no scope change.
- 2026-10-17: Francis decided after stage 2 (all PASS): accept the stage-1 fix; fix the control-character test value in this PR (governance-only re-review); file a follow-up ESP sub-task for the agent-name control-character check and the ignored when:null / unknown keys; run mutation-test (10/10 CAUGHT).
- 2026-10-17: Closed. Status: shipped. Follow-up ESP-72 filed for the deferred guard nits.

## Final status
- Status: shipped · Branch: `feature/esp67-preflight-reviewers`
- AC1: shown (2026-10-17T04:45Z)
- AC2: shown (2026-10-17T04:46Z)
- AC3: shown (2026-10-17T04:46Z)
- AC4: shown (2026-10-17T04:46Z)
- AC5: shown (2026-10-17T04:45Z; repo gate PASS at 2026-10-17T04:44:38Z)
- Reviews: stage 1 governance FLAG (AC5 evidence from the installed runner), fixed and accepted by Francis; stage 2 convention, silent-failure and security all PASS (stage 1 ran first: 7 files). The post-round test fix had a governance-only re-review: all checklist items resolved, plus a stale-stamp FLAG cleared by re-stamping AC2–AC4.
- Mutation test: 10/10 CAUGHT on `isPathPrefix`, `hasControlChar` and `checkPlanning` (2 entries rewritten after NOT-FOUND on CRLF line-spanning finds).
- Deviations: none in scope. Guard nits (agent-name control characters, `when: null` and unknown keys) deferred to ESP-72 by decision. The Jira `verified` script step failed (`JIRA_EMAIL` is not set); ESP-67 was already In Testing via the connector.
