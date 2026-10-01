# UsiaTech Engineering roadmap

Improvement plan for the `usiatech-engineering` plugin, drawn from a 2026-09-28 comparison of v0.4.1 against 15 public plugin repos (mattpocock/skills, obra/superpowers, Anthropic plugins, trailofbits/skills, addyosmani/agent-skills, github/spec-kit, BMAD, oh-my-claudecode, GSD and others).

The governance model (every plan traces to a requirement, the CI gate reads its rules from the base branch, every guard decision is logged) was already ahead of the others. The gaps were earlier in the process: clarifying requirements, test-first discipline, debugging, review depth and testing the plugin itself.

Plan references use these IDs (e.g. "Improvement roadmap step 3: B1, B2").

## Steps

| Step | Theme | Items | Status |
|---|---|---|---|
| 1 | Hardening | A1–A5, A11, A12 | Shipped v0.5.0 (plan-file scope fix in v0.5.1) |
| 2 | Test-first and review depth | B4, B5, B7, B8, A8, A9 | Shipped v0.6.0 (PR #4) |
| 3 | Front of the process: clarify → spec → tickets → plan → approve | B1, B2, B3, A10 | Shipped v0.7.0 (PR #6) |
| 4 | Security and supply chain | B9, B10 | Shipped v0.8.0 (B10 #10, B9 #11) |
| 4.1 | Hardening follow-ups | #13 CI kit items, #16 staleness | Shipped v0.8.1 |
| 4.2 | Test honesty: fake-pass checks and mutation testing | A6, B26 | Spec approved ([spec](specs/2026-09-30-fake-pass-and-mutation-test.md), [ADR 0002](adr/0002-fake-pass-checks-fail-the-gate.md) accepted); target v0.9.0 |
| 4.3 | Guard enforcement gaps | remaining #13 items | Queued after 4.2 |
| 5 | Delivery and operations | B11–B19 | Not started; B12 (handoff) first, after 4.3 |
| 6 | Plugin health | B20–B25 | Not started |

Order agreed 2026-09-30 (Francis): 4.2, then 4.3, then step 5 starting with B12.

Not yet assigned to a step: A7 (deferred from step 2), B6, B27 and B28.

## A. Improvements to existing components

| # | Item | Status |
|---|---|---|
| A1 | Tests for the guard hook and CI scripts: a table of commands and paths with the expected allow/ask/deny result, run in CI | Done (step 1) |
| A2 | Guard built a shell command from a file path; use `execFileSync` with an argument array | Done (step 1) |
| A3 | A malformed `engineering.json` silently fell back to defaults; surface it | Done (step 1) |
| A4 | Template `baseBranch` didn't match the team's branch standard; pick one or detect it | Done (step 1) |
| A5 | README version table missing rows and out of order | Done (step 1) |
| A6 | `verify` rejects fake passes (`.skip`/`.only`, placeholder TODOs, empty tests) and reports which plan acceptance criteria were shown to pass | Step 4.2. AC reporting shipped with A10; fake-pass checks specced in [2026-09-30 spec](specs/2026-09-30-fake-pass-and-mutation-test.md) (R1–R11) |
| A7 | Excuse tables (common reasons to skip a step, with rebuttals) in `verify`, `release` and `approve-plan` | Deferred |
| A8 | Confidence scoring (0–100, drop under ~80) for reviewer findings | Done (step 2) |
| A9 | Two-stage review in `release`: "matches the plan" then "is the code good" | Done (step 2) |
| A10 | `approve-plan` stores measurable acceptance criteria and a task list so `verify` and `governance-reviewer` can check each one | Done (step 3) |
| A11 | Record every guard fail-open in `governance-log.jsonl`; `governance-reviewer` counts them | Done (step 1) |
| A12 | One shared rule module read by the hook, the reviewer and the CI checks | Done (step 1) |

## B. New features

### High value, fits the governance model

| # | Feature | Inspired by | Status |
|---|---|---|---|
| B1 | `clarify` / grill skill: one question at a time until requirements are clear, then feeds `approve-plan` (produces a requirement reference when none exists) | mattpocock `grill-me`, spec-kit `clarify`, OMC `deep-interview` | Done (step 3) |
| B2 | `to-spec` + `to-tickets`: conversation → spec → small tickets that list their blockers, filed as GitHub issues (gives `requirementRefPattern` real IDs) | mattpocock, spec-kit `tasks`, BMAD stories | Done (step 3) |
| B3 | `analyze` consistency check: spec ↔ plan ↔ tasks ↔ ADRs before approval | spec-kit `analyze`, trailofbits `spec-to-code-compliance` | Done (step 3) |
| B4 | `tdd` skill with red → green → refactor checkpoints | superpowers, mattpocock, addyosmani | Done (step 2) |
| B5 | `debug` skill: reproduce → localize → reduce → fix → guard test | superpowers `systematic-debugging`, mattpocock `diagnosing-bugs` | Done (step 2) |
| B6 | Over-engineering reviewer: V0–V3 severity, deletion and new-hire tests | bencium vanity-engineering-review | Unassigned |
| B7 | `silent-failure-reviewer` agent | Anthropic pr-review-toolkit | Done (step 2) |
| B8 | `security-reviewer` agent plus a secret guard on edited content | Anthropic `security-guidance`, trailofbits `insecure-defaults` | Done (step 2) |
| B9 | Supply-chain check on dependency changes: advisories, abandoned packages, typosquatting | trailofbits `supply-chain-risk-auditor` | Done (step 4, #11) |
| B10 | CI workflow audit of `.github/workflows` for AI-action injection and `pull_request_target` misuse | trailofbits `agentic-actions-auditor`, ECC AgentShield | Done (step 4, #10) |

### Delivery and operations (step 5)

| # | Feature | Inspired by |
|---|---|---|
| B11 | Git worktree per approved plan, plus a `finish-branch` skill (merge/PR/keep/discard) | superpowers |
| B12 | `handoff`: write `.claude/plans/active.state.md` (progress, next step) so work resumes after compaction | mattpocock `handoff`, GSD STATE.md |
| B13 | `adr` skill to create and supersede ADRs | addyosmani, Anthropic `architecture` |
| B14 | `deploy-checklist` / `rollback` / `incident-response` tied to the `release` tag format | Anthropic engineering, addyosmani |
| B15 | `resolve-merge-conflicts`, hunk by hunk, checked against the plan | mattpocock |
| B16 | `git-cleanup` that proves a branch was merged before deleting it | trailofbits |
| B17 | `second-opinion` from another model for BLOCK/FLAG disputes | trailofbits, OMC `ccg` |
| B18 | `review-walkthrough`: ordered, annotated tour of the diff for the PR | trailofbits |
| B19 | `tech-debt` register: accepted FLAGs logged as dated entries with kill criteria | Anthropic, bencium |

### Plugin health (step 6)

| # | Feature | Inspired by |
|---|---|---|
| B20 | Skill evals: scripted scenarios checking each skill fires and follows its steps; build on the native `claude plugin eval` rather than a custom harness | superpowers evals, wshobson `plugin-eval`, `skill-creator`, `claude plugin eval` |
| B21 | `ask-usiatech` router skill that picks the right skill | mattpocock `ask-matt`, addyosmani |
| B22 | `diagnose-session`: explain from the governance log why the guard or a skill did or didn't fire | superpowers `diagnosing-superpowers` |
| B23 | Governance log report: deny/ask counts, most-overridden rules, plans closed vs abandoned | ECC reports |
| B24 | Learning loop: suggest `governance.md` rules from repeated asks and denials | ECC continuous-learning, `hookify` |
| B25 | Reference checklists (definition of done, security, accessibility, performance) loaded on demand | addyosmani, wshobson |

### Test and review quality (unassigned)

Found in a 2026-09-30 comparison with the installed engineering plugins. None is on another step yet.

| # | Feature | Inspired by |
|---|---|---|
| B26 | `mutation-test` skill: break each fix point on purpose and confirm a test fails, with a report per mutation (the B9/B10 fix sets did this by hand). Step 4.2; specced in [2026-09-30 spec](specs/2026-09-30-fake-pass-and-mutation-test.md) (R12–R17) | trailofbits `mutation-testing` |
| B27 | Finding verification: before a low-confidence reviewer finding is fixed or deferred, try to reproduce it and mark it confirmed or false positive | trailofbits `fp-check`, `variant-analysis` |
| B28 | `test-coverage-reviewer` agent: checks that the tests in a diff cover the new behaviour and edge cases, not just that they pass | Anthropic pr-review-toolkit `pr-test-analyzer` |
