# Plan: Step 3 review minors (v0.7.1)

## Goal
Close the deferred minor findings M1–M4 and M6–M9 from the PR #6 review in the approve-plan, verify and to-tickets skills, the governance-reviewer agent, the plan template and the structure tests, and release as v0.7.1.

## Requirement references
- PR #6 review, deferred minors M1–M4, M6–M9 (recorded in `.claude/plans/archive/2026-09-28-step-3-requirements-flow.md`, Final status)

## Acceptance criteria
- AC1 (M1): approve-plan says a route override changes the route only and a plan without a requirement reference is not recorded; a structure test pins it.
  - Evidence: test "should keep the requirement-reference rule when the user overrides the route (M1)" failed before the fix, passes now (shown, 2026-09-29T01:32Z)
- AC2 (M2): verify writes all evidence lines and task ticks in one edit; a structure test pins it.
  - Evidence: test "should write all evidence and task ticks in one edit (M2)" red → green (shown, 2026-09-29T01:32Z)
- AC3 (M3): verify stamps each evidence line with a UTC timestamp and rewrites every line each run; governance-reviewer check 7 flags `shown` evidence stamped before the newest modification of a changed file; the plan template shows the stamp; structure tests pin all three.
  - Evidence: test "should stamp evidence and flag stale evidence (M3)" red → green; asserts verify, templates/plan.md and governance-reviewer.md (shown, 2026-09-29T01:32Z)
- AC4 (M4): approve-plan accepts a spec as a reference only with `Status: approved`; a structure test pins it.
  - Evidence: test "should accept a spec as a reference only once approved (M4)" red → green (shown, 2026-09-29T01:32Z)
- AC5 (M6): approve-plan checks for an unfinished active plan before routing; a structure test pins the order.
  - Evidence: test "should check for an unfinished plan before routing (M6)" red → green (shown, 2026-09-29T01:32Z)
- AC6 (M7): to-tickets checks GitHub access before asking to confirm and looks up the label by exact name without the 30-label default; a structure test pins it.
  - Evidence: test "should check GitHub access before confirming and look labels up by exact name (M7)" red → green (shown, 2026-09-29T01:32Z)
- AC7 (M8): approve-plan description no longer contains "starting work that has no plan yet"; a structure test pins it.
  - Evidence: test "should not trigger approve-plan on any work without a plan (M8)" red → green (shown, 2026-09-29T01:32Z)
- AC8 (M9): the release-metadata test checks the version is semver instead of a literal; version is 0.7.1 in all four places.
  - Evidence: test "should keep plugin, marketplace and both README versions in step" passes with the semver assert at 0.7.1 (shown, 2026-09-29T01:32Z)
- AC9: `npm test` passes; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` pass.
  - Evidence: npm test 236/236 pass, exit 0; both validate commands exit 0 (shown, 2026-09-29T01:32Z)

## Tasks
- [x] T1: failing structure tests for AC1–AC8 (covers AC1–AC8)
- [x] T2: approve-plan fixes M1, M4, M6, M8 (covers AC1, AC4, AC5, AC7)
- [x] T3: verify fixes M2, M3 and plan template stamp (covers AC2, AC3)
- [x] T4: governance-reviewer check 7 staleness (covers AC3)
- [x] T5: to-tickets fix M7 (covers AC6)
- [x] T6: version bump to 0.7.1 and README rows, semver assert (covers AC8, AC9)

## Files
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/templates/plan.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `plugins/usiatech-engineering/README.md`
- `.claude-plugin/marketplace.json`
- `README.md`

## Commands and actions
- `npm test`, `claude plugin validate .`, `claude plugin validate plugins/usiatech-engineering`
- Push branch, PR into `main`, merge after CI green and user go-ahead, tag `v0.7.1`
- After merge: `claude plugin marketplace update usiatech` and `claude plugin update usiatech-engineering@usiatech`

## Out of scope
- Guard hook, CI scripts and governance-rules changes; A6/A7; B6
- Step-2 deferred minors

## Approved
- By: Francis · Date: 2026-09-28
- Route: small (override: 10 files, but the findings are already specified in the PR #6 review; clarify/to-spec/to-tickets would add nothing)

## Change log
- 2026-09-28: initial plan approved (M3 via timestamp + file mtime)
- 2026-09-28: pre-flight FLAG 1: T1 tests written after the user chose "Proceed" but before this file was recorded; kept as the first increment. FLAG 2: draft step-3 spec removed from requirement references.

## Final status
- Shipped: v0.7.1 via PR #8 (merge commit 2279899), 2026-09-28. CI 4/4 green; npm test 236/236.
- Acceptance criteria: AC1–AC9 all shown (evidence stamped 2026-09-29T01:32Z, re-stamped after the stage-2 test fix).
- Deviations: silent-failure-reviewer found the M6/M7 order asserts passed when a phrase was missing (`indexOf` = -1); fixed with an `assertBefore` helper, proven by a mutation check. Within the plan's Files list.
- Deferred nits: `gh label list --search` is substring-based (skill requires an exact-name check); mtime staleness can be fooled by tools that reset mtimes; evidence stamp example omits seconds.
