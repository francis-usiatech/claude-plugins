# Plan: ESP-12 batch decisions (one question per milestone; PR-body nits need no decision)

## Goal
At approve-plan pre-flight and at release review, Claude asks one batched question per milestone, with a recommended default for each item. Nits listed in the PR body need no decision. Each behaviour has its own opt-out key under `decisions` in `.claude/engineering.json`, and the guard's config check validates those keys.

## Requirement references
- Spec `docs/specs/2026-10-09-batch-decisions.md` (Status: approved), R1–R8, AC1–AC7
- Jira ESP-12 (epic ESP-8, R5); sub-tasks ESP-32, ESP-33, ESP-34

## Acceptance criteria
- AC1 (spec AC1, ESP-33): `skills/approve-plan/SKILL.md` tells Claude to batch pre-flight decisions (FLAGs and scope questions) into one question with a recommended default per item, and says to skip this when `decisions.batch` is `false`.
  - Evidence: approve-plan step 2 batching bullet; plugin-structure "(AC1)" test passes; npm test 1009/1009 (shown, 2026-10-10T18:12:37Z)
- AC2 (spec AC2, ESP-33): `skills/release/SKILL.md` says (a) stop after stage 1 only on a FLAG, asking about all stage-1 items in one question; (b) otherwise ask one batched question after stage 2 covering FLAGs, non-blocking findings and the mutation-test suggestion, each with a recommended default. Blocking findings (BLOCK, FAIL, Critical/High) stay out of the batched question and must be fixed.
  - Evidence: release stage-1 line and new **Decisions** bullet; plugin-structure "(AC2)" test passes (shown, 2026-10-10T18:12:37Z)
- AC3 (spec AC3, ESP-33): both skill files require FLAG decisions to be recorded in the plan's change log. This is new text for `approve-plan`; `release` already has it.
  - Evidence: approve-plan step 2 and release stage 1 both say the FLAG decision is recorded in the plan's change log; plugin-structure "(AC3)" passes (shown, 2026-10-10T18:12:37Z)
- AC4 (spec AC4, ESP-33): `skills/release/SKILL.md` says nits listed in the PR need no decision unless `decisions.nitsNeedDecision` is `true`.
  - Evidence: release **Decisions** bullet; plugin-structure "(AC4)" passes (shown, 2026-10-10T18:12:37Z)
- AC5 (spec AC5, ESP-33): `tests/plugin-structure.test.mjs` checks that both skill files mention `decisions.batch` and the change-log rule, and that `release` mentions `decisions.nitsNeedDecision`. `npm test` passes.
  - Evidence: describe "plugin structure: batch decisions (ESP-33…)" was red (4 fail, missing text) before the skill edits and green after (file 89/89); npm test 1009/1009 plus timing 1/1, exit 0 (shown, 2026-10-10T18:12:37Z)
- AC6 (spec AC6, ESP-32): tests in `tests/governance-policy.test.mjs` show `sanitizeConfig`, seen through `evaluate` like the existing `planEdits` tests, reporting a config problem and dropping the value for `decisions: "x"`, `decisions.batch: "yes"` and `decisions.nitsNeedDecision: 1`, and reporting none for a missing `decisions` or for valid booleans. Each test is red before the change and green after. `npm test` passes.
  - Evidence: describe "evaluate: decisions keys (ESP-32…)" was red (2 fail: decision undefined, expected 'ask') before the change and green after (file 263/263); npm test exit 0 (shown, 2026-10-10T18:12:37Z)
- AC7 (spec AC7, ESP-34): the plugin README's configuration table has a `decisions` row naming `batch` (default `true`) and `nitsNeedDecision` (default `false`). `templates/engineering.json` contains `"decisions": {"batch": true, "nitsNeedDecision": false}`. `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0.
  - Evidence: README config table `decisions` row; templates/engineering.json `"decisions": {"batch": true, "nitsNeedDecision": false}`; validate . exit 0; validate plugin exit 0; fake-pass exit 0 (shown, 2026-10-10T18:12:37Z)

## Tasks
- [x] T1: TDD `decisions` validation in `sanitizeConfig`: red tests through `evaluate` first, then the smallest change in `governance-policy.mjs` (covers AC6; ESP-32)
- [x] T2: TDD the skill-text structure test (red), then update the `approve-plan` SKILL.md text (batching, plus the new FLAG change-log rule) and the `release` SKILL.md text (covers AC1–AC5; ESP-33)
- [x] T3: Add the `decisions` row to the README config table and the key to `templates/engineering.json`; run both validates (covers AC7; ESP-34)
- [x] T4: Run `verify` (full gate) and fill in the evidence (covers AC1–AC7)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `docs/specs/2026-10-09-batch-decisions.md`

## Commands and actions
- None beyond the standard gate (`npm test`, fake-pass check, both `claude plugin validate`).

## Out of scope
- Batching at tdd, verify or clarify checkpoints; ESP-10 and ESP-11.
- Any change to guard allow/ask/deny decisions, the CI governance checks or `templates/github/scripts/`.
- Changing how blocking findings (BLOCK, FAIL, Critical/High) are handled: they must still be fixed, not batched as decisions.
- Changing `loadConfig`'s contract.
- Version bump, Versioning row and release (a separate release plan, by hand until ESP-23).
- Setting `decisions` in this repo's `.claude/engineering.json`, since the defaults already apply.

## Approved
- By: Francis · Date: 2026-10-10
- Route: large (adds a new public config interface, the `decisions` keys; clarify → to-spec → to-tickets done)

## Change log
- 2026-10-10: plan covers ESP-32, ESP-33 and ESP-34 in one PR (Francis).
- 2026-10-10: applied pre-flight FLAG findings 1–3 (Francis: "Apply all 3"). AC6 and T1 now name `sanitizeConfig` through `evaluate`, not `loadConfig` (spec R7/AC6 clarified to match). T2, AC3 and AC5 add the FLAG change-log rule to `approve-plan`. AC2 and Out of scope keep blocking findings out of the batch.
- 2026-10-10: closed and archived inside the 0.12.0 release PR instead of a separate close-plan PR, per ESP-39's intent; the release has no separate release plan (Francis: "Approve as written").

## Final status
- **Shipped** to develop: feature commit `7a62993`, PR #83 merged as `407f7c4` (2026-10-10). Released as 0.12.0 (minor, feat) under the version-bump rule: release PR #84 (`f4020ba`), promotion PR #85 (`6173c5d`), annotated tag `v0.12.0` on main. `claude plugin update` shows 0.12.0 at user scope. Jira ESP-12/32/33/34 → Released.
- AC1–AC5: shown (plugin-structure batch-decisions tests red-first, now green; file 89/89).
- AC6: shown (governance-policy decisions-key tests red-first, now green; file 263/263).
- AC7: shown (README `decisions` row, template key, both validates exit 0).
- Final gate on develop (2026-10-11T02:47:57Z): npm test 1009/1009 plus timing 1/1, fake-pass exit 0, both validates exit 0.
- CI on #83 showed 4× FAILURE with no logs, most likely the GitHub billing block (branch protection waits on it, ESP-40). Francis merged on the local gate.
- Reviews:
  - Stage 1 governance: PASS.
  - Stage 2: security PASS; silent-failure PASS with nits (two loose test regexes tightened); convention PASS with nits, listed in the PR body.
- Deviations: none in scope. The release is folded into this archive rather than a separate release plan (Change log).
