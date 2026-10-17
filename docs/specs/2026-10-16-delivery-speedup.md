# Spec: Delivery speed-up (verified status, per-ticket type, pre-plan checklist, pre-flight reviewers, standing decisions, verify --iterate)

Status: approved · Date: 2026-10-16 · Author: Francis

## Problem
The HEILens retrospective of 2026-10-16 (HEIL-84) found that the HEIL-2 bundles lost time in five places:
- Design findings (callers missed by a new validation rule, a database mechanism that didn't work, docs left out) were first found at the pre-commit review, after the code was written.
- Jira tickets were moved to In Testing by hand, because the tracker has no event between `started` and `merged`.
- `to-tickets` could file only one issue type under one parent, while HEIL files Stories under their own Epic, and Bugs and Tasks beside them.
- Routine FLAGs that the team had already decided the same way before, including pre-flight wording fixes (ESP-46), each needed a fresh decision round.
- While building, every check ran the whole gate, including slow Testcontainers suites, because `verify` has no partial mode (ESP-10).

HEIL-84 fixes what it can in HEILens's own instructions. This spec covers the plugin side, tracked as Jira ESP-63 with sub-tasks ESP-64..69. ESP-70 (scoping the guard's database-drop deny) is a separate spec.

## Goals
- Design checks that HEILens ran at commit time run before the plan is approved.
- A ticket moves to its "verified" status (HEIL: In Testing) when the work is shown done, without a manual move.
- A FLAG that matches a decision the repo has already recorded doesn't need another decision round.
- Building can re-run only the affected suites, while the done gate stays the full gate, run once.

## Non-goals
- ESP-70 (the database-drop deny). It gets its own spec, ADR note and mutation test.
- Any change to the CI governance checks or the `governance-approved` label: CI still needs the label for a FLAG, settled or not.
- ESP-10's rule that a review fix touching only tests, docs or copy re-runs only the related suites. That would weaken the done gate.
- Standing decisions that can settle a BLOCK or an Important finding.
- Moving tickets back when a later gate run fails.

## Requirements
### P1 – `verified` status event (ESP-64)
- R1: The Jira tracker has a fourth event, `verified`, which `tickets.jira.statuses` can map to a status name and which config validation accepts like the other events.
- R2: When the `verify` skill reports the full gate passed and every acceptance criterion in the active plan has its evidence shown, it moves the Jira keys named in the plan's tasks to the `verified` status. It skips this when there is no config, the tracker isn't Jira, or `statuses` has no `verified`. It follows the `started` failure rules: each failed key is reported, the others still move, nothing is retried silently and nothing is undone. A gate pass with any AC not shown, and any `--iterate` run (R16), moves nothing.

### P2 – per-ticket issue type and parent (ESP-65)
- R3: A ticket entry in a spec's Tickets list may name its own issue type and its own parent key. A ticket that names neither uses `tickets.jira.issueType` and `tickets.jira.parent`, as today. The GitHub tracker ignores both fields.
- R4: `jira-tracker.mjs create` accepts an issue type option alongside the existing `--parent`. An empty type is a usage error (exit 2) and a bad parent key stays a usage error, both before any request is sent.
- R5: `to-tickets` validates every ticket's type and parent before it creates the first issue, and reports every bad entry in one message instead of failing part-way.

### P3 – pre-plan checklist (ESP-66)
- R6: Before drafting a plan, `approve-plan` answers a checklist and records the answers in a new "Pre-plan checklist" section of the plan:
  - (a) for any new validation rule or format check, the callers and test fixtures that were searched;
  - (b) for any database or infrastructure mechanism the design relies on, the throwaway spike that proved it, or why none is needed;
  - (c) the docs and ADRs the work touches. If a docs reviewer is configured in `planning.preflightReviewers` (R9), its pre-flight output answers this; otherwise Claude lists them from a search.
  Each item can be answered `n/a: <reason>`.
- R7: `templates/plan.md` has the "Pre-plan checklist" section with the three items.
- R8: In pre-flight mode, `governance-reviewer` reports a FLAG when the plan has no "Pre-plan checklist" section, or when an item is empty or a bare `n/a` with no reason. Commit-mode reviews don't check it, so plans approved before this change aren't affected.

### P4 – pre-flight reviewers (ESP-67)
- R9: `.claude/engineering.json` accepts `planning.preflightReviewers`: a list of entries, each an agent name with an optional `when` list of path prefixes, using the same prefix rules as `verifyConditional.when`.
- R10: In the pre-flight step, `approve-plan` runs each listed reviewer on the draft plan in design mode, in parallel with `governance-reviewer`. A reviewer with a `when` list runs only when one of its prefixes matches a path in the plan's Files section; one without `when` always runs.
- R11: The BLOCKs and FLAGs from all pre-flight reviewers are combined into the one batched pre-flight decision, each labelled with the reviewer that raised it. A BLOCK from any reviewer must be fixed before approval, as with `governance-reviewer`. A reviewer that fails or isn't installed is reported by name and doesn't count as a pass.
- R12: The guard's config validation checks `planning` and `planning.preflightReviewers`. Problems are advisory under the ESP-35 rule, because the guard doesn't read the key.

### P5 – standing decisions (ESP-68, absorbs ESP-46)
- R13: `governance-reviewer` reads a "Standing decisions" section (entries SD-1, SD-2, …, each a short rule with an owner and a date) from the governance rules file (`governance.rulesFile`, default `.claude/governance.md`). It honours at most 10 entries. Any entries beyond that are ignored, and the review output says so.
- R14: A FLAG that matches a standing decision is reported as "FLAG, settled by SD-n" and needs no user decision. `approve-plan` and `release` record each settled FLAG in the plan's Change log with its SD number, and leave it out of the batched decision. A standing decision never settles a BLOCK, an Important finding, a must-never or needs-approval rule, a guard error or missing AC evidence. This list is fixed in the agent and can't be changed by repo config.
- R15: `templates/governance.md` has a "Standing decisions" section whose SD-1 is the wording-only rule from ESP-46: a pre-flight fix that only makes wording more precise (no new file, AC, task, command or action) is applied with one dated Change log line and shown with the plan, without a separate decision.

### P6 – verify --iterate (ESP-69, absorbs ESP-10 in part)
- R16: `verify --iterate` runs only the test suites mapped to the changed files, in the foreground, using a configurable map from path prefixes to commands. A changed file with no mapping is listed as not covered. A run with nothing to run says so and exits with success.
- R17: An `--iterate` run never counts as the done gate. It writes no AC evidence, makes no Jira move, and its report and final line say it is partial (it never prints `Gate: PASS`).
- R18: The `verify` and `release` skills say to run the full gate once per PR, after the last code change and before the commit, and to use `--iterate` while building.

### Docs and repo opt-in
- R19: The plugin README documents the `verified` event, the per-ticket type and parent fields, the pre-plan checklist, `planning.preflightReviewers`, standing decisions and `--iterate`, and the Versioning row records the change.
- R20: This repo opts in: `.claude/engineering.json` maps `verified` to "In Testing", and `.claude/governance.md` has SD-1.

## Acceptance criteria
- AC1 (R1): `jira-tracker.mjs check` accepts `statuses.verified: "In Testing"`, and still rejects an unknown event name. One test each.
- AC2 (R2): The `verify` skill text says when it moves keys to `verified` (gate PASS and all ACs shown), when it skips, and the failure rules. A test of the transition path shows `jira-tracker.mjs transition --event verified` moves the issue to the mapped status, and returns `transitioned: false` with a reason and sends no transition when `verified` isn't mapped.
- AC3 (R2): In this repo, a `verify` run whose gate passes with all ACs shown moves this spec's ticket to In Testing. The Jira status is checked after the run.
- AC4 (R3, R5): The `to-tickets` skill and `templates/spec.md` describe the per-ticket type and parent fields with the config fallback, and `to-tickets` says to validate every entry before the first create.
- AC5 (R4): Tests show `create` sends the given issue type, falls back to the config type when none is given, exits 2 on an empty type and on a bad parent key, and sends no request in either error case.
- AC6 (R6, R7): `templates/plan.md` has the "Pre-plan checklist" section with items (a)–(c). The `approve-plan` skill tells Claude to fill it before drafting and allows `n/a: <reason>`.
- AC7 (R8): `governance-reviewer.md` says a pre-flight review FLAGs a missing section, an empty item and a bare `n/a`, and that commit-mode reviews don't check it.
- AC8 (R9, R12): Guard tests: a valid `planning.preflightReviewers` gives no config problem. A non-object `planning`, a non-array list, an entry with no agent name and a bad `when` prefix each give an advisory problem (warned once, no ask).
- AC9 (R10, R11): The `approve-plan` skill describes the parallel run, the Files-section `when` matching, the merged and labelled decision, the BLOCK rule and the failed-reviewer report.
- AC10 (R13, R14): `governance-reviewer.md` describes the Standing decisions section, the 10-entry cap and its note, the "FLAG, settled by SD-n" report and the fixed never-settles list. `approve-plan` and `release` say to log settled FLAGs in the Change log and leave them out of the decision.
- AC11 (R15): `templates/governance.md` has the Standing decisions section with SD-1 as worded in R15.
- AC12 (R16, R17): Gate tests: with a map entry for a changed path, `--iterate` runs only the mapped command. An unmapped changed file is listed as not covered. A run with nothing mapped exits 0 and says so. The output never contains `Gate: PASS` and says the run is partial. A bad map is a config error (exit 2).
- AC13 (R17, R18): The `verify` skill says an `--iterate` run writes no evidence and makes no Jira move. `verify` and `release` state the one-full-gate rule.
- AC14 (R19, R20): The README covers each item in R19 and has a Versioning row. This repo's `.claude/engineering.json` maps `verified`, and `.claude/governance.md` has SD-1.
- AC15 (all): The gate (`node plugins/usiatech-engineering/skills/verify/gate.mjs`) prints `Gate: PASS`, with `npm test` at 0 failures, the fake-pass check at 0 and both `claude plugin validate` runs at exit 0.

## Constraints & decisions
- Francis decided (2026-10-16, clarify):
  - Two specs: this one covers P1–P6, and P7 (ESP-70) follows separately.
  - ESP-68 absorbs ESP-46 and ESP-69 absorbs ESP-10. Both older tickets close when their absorbing ticket ships.
  - P1 moves tickets only when the gate passes and all ACs are shown.
  - P3(c) reuses the P4 reviewers and has no separate docs-agent key.
  - The P3 checklist applies to every new plan, with `n/a: <reason>` allowed.
  - P4 `when` matches the plan's Files section.
  - P5 ships ESP-46 as template SD-1, with a 10-entry cap and a fixed never-settles list.
  - P6 takes `--iterate` plus the one-full-gate rule, and leaves out ESP-10's tests-only exemption.
- ADR-0003 (Jira as an optional ticket tracker) applies to P1 and P2. The new event and fields follow its failure rules (loud, no retry, never undoes a step).
- The ESP-35 rule (spec `2026-10-10-per-key-config-validation.md`) classes the new `planning` problems as advisory.
- ADR-0002 (fake-pass checks fail the CI gate) is unaffected. `--iterate` is never the done gate, so it skips the fake-pass check.
- No new ADR is needed: each change is additive and opt-in, and is easy to reverse. Standing decisions narrow which FLAGs need a decision but never affect a BLOCK or CI. The README Versioning row records the change.

## Open questions
- When does P1 move tickets? Answered: gate PASS with all ACs shown (R2).
- Where does the P3(c) docs list come from? Answered: P4 reviewers, otherwise Claude (R6).
- Which plans need the checklist? Answered: all new plans, with `n/a: <reason>` (R6, R8).
- What does a P4 `when` match? Answered: the plan's Files section (R10).
- How do ESP-46 and the bound fit P5? Answered: template SD-1, a cap of 10 and a fixed never-settles list (R13–R15).
- How much of ESP-10 comes in with P6? Answered: `--iterate` plus the one-full-gate rule (R16–R18).

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
Already filed in Jira as sub-tasks of ESP-63 (created before this spec; mapped 2026-10-16):
- ESP-64 · Add the `verified` status event, moved by verify · Covers: R1, R2, R19, AC1, AC2, AC3, AC14, AC15 · Blocked by: none. Its plan (2026-10-16) deferred R20 to ESP-71, because the installed plugin rejects an unknown event until it is updated. AC3 was shown by moving ESP-64 through the Atlassian connector, not by a verify run.
- ESP-71 · Map `verified` to In Testing in this repo's config · Covers: R20 (`verified` mapping), AC14 (repo part) · Blocked by: ESP-64, plus the plugin update that ships `verified`
- ESP-65 · Allow per-ticket issue type and parent in to-tickets · Covers: R3, R4, R5, R19, AC4, AC5, AC14, AC15 · Blocked by: none
- ESP-67 · Run planning.preflightReviewers alongside the governance pre-flight · Covers: R9, R10, R11, R12, R19, AC8, AC9, AC14, AC15 · Blocked by: none
- ESP-66 · Add a pre-plan checklist to approve-plan · Covers: R6, R7, R8, R19, AC6, AC7, AC14, AC15 · Blocked by: ESP-67
- ESP-68 · Honour standing decisions in governance-reviewer (absorbs ESP-46) · Covers: R13, R14, R15, R19, R20 (SD-1), AC10, AC11, AC14, AC15 · Blocked by: none
- ESP-69 · Add verify --iterate and the one-full-gate rule (absorbs ESP-10) · Covers: R16, R17, R18, R19, AC12, AC13, AC14, AC15 · Blocked by: none
