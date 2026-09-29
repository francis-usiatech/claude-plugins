# Step 3: requirements flow (clarify → spec → tickets → plan → approve)

Status: draft · Date: 2026-09-28 · Author: Francis (design with Claude)
Roadmap: `docs/roadmap.md` step 3 — B1, B2, B3, A10 · Target release: v0.7.0

## Problem
Every plan must cite a requirement reference, but the plugin gives no help producing one. When work starts from a conversation rather than an existing intent doc or issue, the reference is invented or missing. Plans also record only scope (Files), not what "done" means, so `verify` proves commands exited 0 but not that the work met its goal, and nothing cross-checks a plan against the requirements it claims to implement.

## Goals
- Produce a requirement basis (spec + tickets) when none exists, without slowing down small changes.
- Record measurable acceptance criteria and a task list in every plan.
- Check each criterion at verify time and in governance review.
- Catch scope drift between spec, tickets, plan and ADRs before approval.

## Non-goals
- CI gating on acceptance criteria (the PR governance workflow is unchanged).
- A configurable small/large threshold in `engineering.json`.
- Fake-pass detection and excuse tables (A6, A7), the over-engineering reviewer (B6).
- Creating GitHub labels automatically.
- Any change to the guard hook's decisions.

## Requirements
- **R1 Routing.** `approve-plan` classifies work as **small** or **large** and says which rule decided it. Small = cites an existing requirement reference, ≤ 5 files, and adds no new skill, module or public interface. Anything else is large. The user can override ("treat as small/large"); the override is recorded in the plan's change log.
- **R2 Small route.** Records the plan directly, as today, plus acceptance criteria and tasks (R6).
- **R3 Large route.** Runs `clarify` → `to-spec` → `to-tickets` before recording the plan; the spec path and ticket IDs become the plan's requirement references.
- **R4 `clarify` skill (B1).** Asks one question at a time about purpose, users, constraints and success criteria. Ends with a short understanding note that separates what the user said from assumptions, and invites correction. Writes no files.
- **R5 `to-spec` skill (B2).** Writes `docs/specs/YYYY-MM-DD-<slug>.md` from `templates/spec.md`. Requirements are numbered R1…, acceptance criteria AC1… (each maps to ≥ 1 R). The spec can't be marked approved while an open question lacks either an answer or `deferred: <why>`.
- **R6 `to-tickets` skill (B2).** Splits the spec into small tickets, each naming the R/AC it covers and the tickets that block it.
  - With `gh` authenticated: show the ticket list, ask once, then file GitHub issues. Title `<spec-slug>: <ticket title>`; body has the spec path, covered R/AC, `Blocked by #NN` and done-when criteria. Apply a `spec:<slug>` label only if it already exists.
  - Without `gh`: write a `## Tickets` section (T1…) into the spec.
- **R7 Plan template (A10).** `templates/plan.md` gains `## Acceptance criteria` (AC1…, each with an `Evidence:` sub-line) and `## Tasks` (checklist, each naming the AC it covers and its ticket), plus a `Route: small|large` line under Approved. Every new plan has ≥ 1 AC. `approve-plan` rewrites unmeasurable criteria ("works well") with the user. On the large route, ACs are copied from the spec with their IDs.
- **R8 Backward compatibility.** Plans without an Acceptance criteria section remain valid; no AC findings or AC table are produced for them.
- **R9 `verify` criteria table.** After the gate commands pass, if the active plan has ACs, report `| AC | Criterion | Evidence | Status |`. Status is `shown` only for evidence produced in this session (named passing test, command output, observed result), else `not shown`. The gate verdict still depends only on the commands; unshown criteria add a warning: `Gate: PASS (N of M criteria not shown)`. Evidence lines are written back into the plan (the guard asks, by design).
- **R10 Pre-flight consistency check (B3).** In pre-flight mode, when the plan references a spec, `governance-reviewer` also checks: every spec R is covered by a ticket or task; every task traces to an R/AC; no plan File is unneeded by any task; no spec non-goal appears in the plan; nothing conflicts with an Accepted ADR. Findings use the existing table and confidence rules.
- **R11 Change-review AC check (A10).** `governance-reviewer` adds check 7: when the plan has ACs, flag any AC with no evidence or status `not shown`, and any unchecked task whose files changed.

## Acceptance criteria
- **AC1** (R4–R6): `skills/clarify`, `skills/to-spec`, `skills/to-tickets` exist with valid frontmatter and appear in the README components table — shown by `plugin-structure.test.mjs`.
- **AC2** (R5, R7): `templates/spec.md` has the Problem, Goals, Non-goals, Requirements, Acceptance criteria, Constraints & decisions, Open questions and Tickets headings; `templates/plan.md` has Acceptance criteria, Tasks and a Route line — shown by tests.
- **AC3** (R1–R3): `approve-plan` states the routing rule and names `clarify`, `to-spec` and `to-tickets` — shown by tests.
- **AC4** (R9): `verify` describes the criteria table and the `N of M criteria not shown` warning — shown by tests.
- **AC5** (R10, R11): `governance-reviewer` contains the pre-flight spec cross-check and check 7 — shown by tests.
- **AC6** (guard unchanged): with no plan, writing `docs/specs/x.md` is allowed; with `requirePlan: true` it asks — shown by a guard regression test.
- **AC7** (release): `npm test` passes; plugin and marketplace versions are 0.7.0; README has a 0.7.0 row with upgrade notes.

## Constraints & decisions
- Follows the existing one-skill-one-job pattern; each new skill ≈ 30–45 lines.
- B3 is a mode of `governance-reviewer`, not a new `analyze` skill, to reuse its plan reading and output format (approach A, chosen 2026-09-28).
- Reviewers stay read-only (enforced by `plugin-structure.test.mjs`).
- No CI script changes, so consuming repos don't re-copy `templates/github/scripts/`.
- `docs/roadmap.md` arrives with PR #5; merge that first, then rebase this branch before marking step 3 done in the roadmap.

## Files (expected)
- `plugins/usiatech-engineering/skills/{clarify,to-spec,to-tickets}/SKILL.md` (new)
- `plugins/usiatech-engineering/templates/spec.md` (new), `templates/plan.md`
- `plugins/usiatech-engineering/skills/{approve-plan,verify}/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/tests/{plugin-structure,governance-policy}.test.mjs`
- `plugins/usiatech-engineering/README.md`, `.claude-plugin/plugin.json`, `/.claude-plugin/marketplace.json`, `/README.md`, `docs/roadmap.md`

## Open questions
- None.
