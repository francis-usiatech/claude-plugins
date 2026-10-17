# Plan: Pre-plan checklist in approve-plan (ESP-66)

## Goal
Make `approve-plan` answer a three-item pre-plan checklist (validation callers and fixtures, infra spikes, docs and ADRs) and record it in a new plan section, and have the `governance-reviewer` pre-flight FLAG a plan whose checklist is missing, empty or a bare `n/a`.

## Requirement references
- docs/specs/2026-10-16-delivery-speedup.md (Status: approved) · R6, R7, R8, R19 (the pre-plan checklist part) · AC6, AC7, AC14 (README part for this item), AC15
- ESP-66 (sub-task of ESP-63; was blocked by ESP-67, merged in PR #113)

## Pre-plan checklist
- (a) Validation rules and format checks: no new code rule; R8 is a reviewer instruction. Searched what parses plan sections: `governance-policy.mjs` `planSections`/`scopeView` keeps unknown headings as scope text (a new section is fine; editing it after approval prompts like any scope change), `verify` reads only Acceptance criteria and Evidence, and `plugin-structure.test.mjs` asserts the template section order (still holds with the new section after Requirement references). Guard plan fixtures in `governance-policy.test.mjs` don't need the section, since the guard doesn't check it.
- (b) Database or infrastructure mechanisms: n/a: prose and structure tests only, no database or infrastructure.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (approve-plan row, 0.18.0 Versioning row). The spec is unchanged. No ADR touched (0001 network lookups, 0002 fake-pass, 0003 Jira). This repo configures no `planning.preflightReviewers`, so the list comes from a search.

## Acceptance criteria
- AC1 (spec AC6, R6, R7): `templates/plan.md` has a `## Pre-plan checklist` section between `## Requirement references` and `## Acceptance criteria`, with items (a) validation callers and fixtures, (b) database or infrastructure spike, (c) docs and ADRs, and says each may be `n/a: <reason>`. A test in `tests/plugin-structure.test.mjs` asserts the heading, its position and the three items.
  - Evidence: tests/plugin-structure.test.mjs › "pre-plan checklist (ESP-66…)" AC1 tests (section position; items (a)–(c) and `n/a: <reason>`) red before T2, green after; repo gate PASS at 2026-10-17T06:00:57Z (shown, 2026-10-17T06:01Z)
- AC2 (spec AC6, R6): `skills/approve-plan/SKILL.md` Record step tells Claude to fill the checklist before drafting the rest of the plan, describes (a)–(c), allows `n/a: <reason>` (a bare `n/a` isn't enough), and says (c) is listed from a search before pre-flight, with a docs reviewer's findings (a `planning.preflightReviewers` agent whose description says it reviews docs) added after it runs; the pre-flight report names which reviewer counted as the docs reviewer; paths in (c) don't widen scope; and step 3 doesn't write `active.md` while an item is empty, a placeholder or a bare `n/a` (2026-10-17 change log). Structure tests assert each part.
  - Evidence: tests/plugin-structure.test.mjs › "pre-plan checklist (ESP-66…)" 6 AC2 tests (before drafting; (a)–(c); `n/a: <reason>` vs bare `n/a`; (c) from a search before pre-flight plus docs reviewer findings; (c) does not widen scope; step-3 guard) red before the fix, green after; repo gate PASS at 2026-10-17T06:00:57Z (shown, 2026-10-17T06:01Z)
- AC3 (spec AC7, R8): `agents/governance-reviewer.md` says a pre-flight review returns at least `FLAG` when the plan has no "Pre-plan checklist" section, when an item is missing, empty or still the template placeholder, or when an item is a bare `n/a` with no reason; and that change (commit-mode) reviews don't check it. Structure tests assert each part.
  - Evidence: governance-reviewer.md check 10 (appended; checks 1–9 unchanged); tests/plugin-structure.test.mjs › "pre-plan checklist (ESP-66…)" 3 AC3 tests red before T4, green after; repo gate PASS at 2026-10-17T06:00:57Z (shown, 2026-10-17T06:01Z)
- AC4 (spec AC14, R19 part): `plugins/usiatech-engineering/README.md` mentions the pre-plan checklist in the `approve-plan` row and in the 0.18.0 Versioning row. A structure test asserts both.
  - Evidence: README.md:13 approve-plan row and the 0.18.0 Versioning row; tests/plugin-structure.test.mjs › AC4 test red before T5, green after; repo gate PASS at 2026-10-17T06:00:57Z (shown, 2026-10-17T06:01Z)
- AC5 (spec AC15): `node plugins/usiatech-engineering/skills/verify/gate.mjs` (repo runner) prints `Gate: PASS`.
  - Evidence: `node plugins/usiatech-engineering/skills/verify/gate.mjs` (repo runner, working tree) → Gate: PASS, exit 0 at 2026-10-17T06:00:57Z (tests 1284: 1281 pass, 0 fail; both validates and fake-pass exit 0) (shown, 2026-10-17T06:01Z)

## Tasks
- [x] T1: Write failing structure tests for the template section, the approve-plan text, the reviewer check and the README mentions (covers AC1, AC2, AC3, AC4; ESP-66)
- [x] T2: Add the `## Pre-plan checklist` section to `templates/plan.md` (covers AC1; ESP-66)
- [x] T3: Add the checklist step to the approve-plan Record step (covers AC2; ESP-66)
- [x] T4: Add the pre-flight checklist check to governance-reviewer, pre-flight only (covers AC3; ESP-66)
- [x] T5: Update the README approve-plan row and the 0.18.0 Versioning row (covers AC4; ESP-66)
- [x] T6: Run the repo gate (covers AC5; ESP-66)
- [x] T7: Close the plan into `.claude/plans/archive/` in the release commit (approve-plan Close step; ESP-66)

## Files
- `plugins/usiatech-engineering/templates/plan.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `.claude/plans/archive/2026-10-16-esp66-preplan-checklist.md`

## Commands and actions
- None beyond the standard gate. No version bump in this PR (done in the release PR per the release rule).

## Out of scope
- Any guard (`governance-policy.mjs`) or CI check of the checklist; it's a reviewer check only.
- A separate docs-agent config key (spec decision: P3(c) reuses the P4 reviewers).
- Back-filling the checklist into archived plans; commit-mode reviews don't check it.
- ESP-72 guard nits, ESP-65, ESP-68, ESP-69, ESP-70.

## Approved
- By: Francis · Date: 2026-10-16
- Route: large (spec-driven work that changes a public template and the reviewer contract). clarify → to-spec → to-tickets are already done: spec approved 2026-10-16, ticket ESP-66.

## Change log
- 2026-10-16: Plan drafted from ESP-66.
- 2026-10-16: Pre-flight PASS (no findings ≥80). Took notes 1–2: added T7 (Close) for the archive file, and a README assertion in T1 for AC4. Note 3: AC3's "missing item / template placeholder" read as part of R8's "empty". Note 4: the new reviewer check is appended, not inserted before check 7, so existing structure tests stay unchanged.
- 2026-10-16: Francis approved, choosing the named docs reviewer for (c): a `planning.preflightReviewers` agent whose description says it reviews docs answers (c) from its pre-flight output; otherwise Claude searches.
- 2026-10-17: Release review round: governance PASS, convention PASS (nits), security PASS (nit), silent-failure FLAG ((c) filled after pre-flight, so never reviewed). Francis decided to fix all in this PR: (c) is listed from a search before pre-flight and a docs reviewer's findings are added after; the pre-flight report names which reviewer counted as the docs reviewer; paths in (c) don't widen scope; step 3 doesn't write active.md while an item is empty, a placeholder or a bare `n/a`; test fixes (heading-exists guard, "plan ACn / spec ACm" labels); README Upgrade note says the checklist needs no opt-in. No new files; AC2 wording follows. Fix gets a governance-only re-review.
- 2026-10-17: Closed. Status: shipped.

## Final status
- Status: shipped · Branch: `feature/esp66-preplan-checklist`
- AC1: shown (2026-10-17T06:01Z)
- AC2: shown (2026-10-17T06:01Z)
- AC3: shown (2026-10-17T06:01Z)
- AC4: shown (2026-10-17T06:01Z)
- AC5: shown (2026-10-17T06:01Z; repo gate PASS at 2026-10-17T06:00:57Z)
- Reviews: stage 1 and stage 2 ran in parallel (5 files, all in Files). Governance PASS, convention PASS (nits), security PASS (nit), silent-failure FLAG ((c) filled after pre-flight). Francis decided to fix all in this PR; the fix had a governance-only re-review: PASS, all 6 items resolved.
- Mutation test: not suggested (no *rules*/*checks*/*policy*/*guard*.mjs touched).
- Deviations: none in scope. AC2 wording changed after review by decision (2026-10-17 change log). The plan was put in place with a Bash copy, so its first write is not in the governance log (scope matched the approved draft).
