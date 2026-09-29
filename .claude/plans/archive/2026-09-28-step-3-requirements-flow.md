# Plan: Step 3 — requirements flow (v0.7.0)

## Goal
Add `clarify`, `to-spec` and `to-tickets` skills, size-based routing plus acceptance criteria and tasks in `approve-plan`, an acceptance-criteria table in `verify`, and acceptance-criteria and spec-consistency checks in `governance-reviewer`.

## Requirement references
- Improvement roadmap step 3: B1, B2, B3, A10 (`docs/roadmap.md`, PR #5)
- Spec: `docs/superpowers/specs/2026-09-28-step-3-requirements-flow-design.md` (R1–R11, AC1–AC7)
- Implementation plan: `docs/superpowers/plans/2026-09-28-step-3-requirements-flow.md`

## Files
- `docs/superpowers/specs/2026-09-28-step-3-requirements-flow-design.md`
- `docs/superpowers/plans/2026-09-28-step-3-requirements-flow.md`
- `docs/roadmap.md`
- `plugins/usiatech-engineering/templates/plan.md`
- `plugins/usiatech-engineering/templates/spec.md`
- `plugins/usiatech-engineering/skills/clarify/SKILL.md`
- `plugins/usiatech-engineering/skills/to-spec/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `README.md`

## Commands and actions
- `git rebase origin/main` on this unpushed branch, only after PR #5 is merged (plan Task 9 Step 7)

## Out of scope
- CI gating on acceptance criteria; an `engineering.json` threshold setting
- A6/A7 (fake-pass detection, excuse tables), B6 (over-engineering reviewer)
- Creating GitHub labels; any change to the guard's allow/ask/deny decisions or CI scripts

## Approved
- By: Francis · Date: 2026-09-28

## Change log
- 2026-09-28: initial plan approved (native execution)

## Final status
- Shipped: v0.7.0 via PR #6 (merge commit 6d500a5), 2026-09-28. CI 4/4 green; npm test 229/229.
- Deviations: +1 fix commit after the whole-branch review (I1–I4, M5: spec in plan Files, one ticket or a listed set per plan, verify ticks tasks, filed issues listed in the spec, no pre-flight FLAG without an active plan). All within the plan's Files list. No rebase was needed: PR #5 touched only `docs/roadmap.md` and the step-2 archive, so both PRs merged cleanly as merge commits.
- Deferred minors: M1–M4, M6–M9 (see PR #6). M10 (roadmap update waits for #5) closed by this archive commit.
