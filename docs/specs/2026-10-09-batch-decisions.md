# Spec: Batch decisions (one question per milestone; PR-body nits need no decision)

Status: approved · Date: 2026-10-09 · Author: Francis

## Problem
Agents using this plugin stop for the user's decision too often. The WaypointCareer session review of 2026-10-05 counted 144 guard prompts in one week, 63% of them no-risk. It also found reviewers were 60% of subagent cost and the gate was re-run several times per PR. Part of that is how decisions are asked: today `approve-plan` (pre-flight FLAGs) and `release` (stage-1 FLAGs, stage-2 nits, the mutation-test suggestion) don't say how to bundle open decisions, so they come one at a time. They also don't say whether nits already listed in the PR need a decision. Tracked as Jira ESP-12 (epic ESP-8, R5).

## Goals
- At each milestone, the user answers one batched question that lists every open decision with a recommended default.
- Nits listed in the PR body don't need a decision.
- A repo can bring back the old behaviour for each of these separately.

## Non-goals
- Batching at `tdd`, `verify` or `clarify` checkpoints.
- Scoped verify runs while iterating (ESP-10) and one review round per PR (ESP-11).
- Any change to guard decisions (allow / ask / deny) or to the CI governance checks.
- Changing how blocking findings (BLOCK, FAIL, Critical/High) are handled: they must still be fixed, not decided.

## Requirements
- R1: `approve-plan` tells Claude to collect every open pre-flight decision (governance FLAGs and scope questions) into one question. Each item has a recommended default.
- R2: `release` tells Claude to collect open decisions into one question after stage 2 (stage-1 FLAGs, stage-2 non-blocking findings, the mutation-test suggestion), each with a recommended default. When stage 1 returns a FLAG, Claude still stops before stage 2 and asks about all stage-1 items in one batched question.
- R3: FLAG decisions made through a batched question are still recorded in the plan's change log.
- R4: `release` states that nits listed in the PR body need no decision from the user.
- R5: New key `decisions.batch` in `.claude/engineering.json`, a boolean, default `true`. When `false`, the skills tell Claude to ask about each decision on its own, as before.
- R6: New key `decisions.nitsNeedDecision` in `.claude/engineering.json`, a boolean, default `false`. When `true`, the skills tell Claude to ask the user about each nit.
- R7: The guard's config check (`sanitizeConfig`) reports a non-object `decisions`, or a non-boolean `decisions.batch` or `decisions.nitsNeedDecision`, as a config problem and drops the bad value, as it does for other keys. A missing key is not a problem.
- R8: The plugin README and `templates/engineering.json` document both keys and their defaults.

## Acceptance criteria
- AC1 (R1): `skills/approve-plan/SKILL.md` contains the batching instruction for pre-flight decisions, with a recommended default per item, and says it is skipped when `decisions.batch` is `false`.
- AC2 (R2): `skills/release/SKILL.md` contains: (a) stop after stage 1 only on a FLAG, asking about all stage-1 items in one question; (b) otherwise one batched question after stage 2 covering FLAGs, non-blocking findings and the mutation-test suggestion, each with a recommended default.
- AC3 (R3): `skills/release/SKILL.md` and `skills/approve-plan/SKILL.md` still require FLAG decisions to be recorded in the plan's change log.
- AC4 (R4, R6): `skills/release/SKILL.md` says nits listed in the PR need no decision unless `decisions.nitsNeedDecision` is `true`.
- AC5 (R5, R6): A plugin structure or skill test checks that both skill files mention `decisions.batch`, and that `release` mentions `decisions.nitsNeedDecision`. `npm test` passes.
- AC6 (R7): Tests in `tests/` show `sanitizeConfig` (seen through `evaluate`, like the existing `planEdits` tests) reporting a config problem for `decisions: "x"`, `decisions.batch: "yes"` and `decisions.nitsNeedDecision: 1`, and none for a missing `decisions` or for valid booleans. `npm test` passes.
- AC7 (R8): `plugins/usiatech-engineering/README.md`'s configuration table has a `decisions` row naming both keys and their defaults, and `templates/engineering.json` contains `"decisions": {"batch": true, "nitsNeedDecision": false}`. Both `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.

## Constraints & decisions
- Francis decided (2026-10-09, Jira ESP-12 comment): both behaviours are on by default, and each has its own opt-out key.
- Francis decided (2026-10-09): the milestones are pre-flight and release only; the stage-1 FLAG stop stays.
- A bad `decisions` value goes through the guard's existing config-problem path. That path makes the guard ask on more actions until the config is fixed. This is the existing behaviour for every key and is accepted here.
- The CI governance check doesn't read these keys and ignores keys it doesn't read, so `templates/github/scripts/` doesn't change and repos have nothing to re-copy.
- The new public config keys are additive and default to the new behaviour. No ADR needed; the README Versioning row records them.

## Open questions
- Key names and shape: answered, `decisions.batch` and `decisions.nitsNeedDecision` (R5, R6).
- 2026-10-10 clarification (pre-flight finding): R7/AC6 originally said "config loader" / `loadConfig`; key-shape checks live in `sanitizeConfig`, so the wording now names it. `loadConfig`'s contract is unchanged.
- Does the CI config check need to validate the keys? Answered: no (see Constraints).
- Should batching also cover tdd/verify/clarify? Answered: no (Non-goals).

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
Filed as Jira sub-tasks of ESP-12:
- ESP-32 · Validate decisions keys in guard config loader · Covers: R7, AC6 · Blocked by: none
- ESP-33 · Batch decisions in approve-plan and release skills · Covers: R1–R6, AC1–AC5 · Blocked by: ESP-32
- ESP-34 · Document decisions keys in README and template · Covers: R8, AC7 · Blocked by: ESP-32
