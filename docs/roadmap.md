# UsiaTech Engineering roadmap

Improvement plan for the `usiatech-engineering` plugin, drawn from a 2026-09-28 comparison of v0.4.1 against 15 public plugin repos (mattpocock/skills, obra/superpowers, Anthropic plugins, trailofbits/skills, addyosmani/agent-skills, github/spec-kit, BMAD, oh-my-claudecode, GSD and others).

The governance model (every plan traces to a requirement, the CI gate reads its rules from the base branch, every guard decision is logged) was already ahead of the others. The gaps were earlier in the process: clarifying requirements, test-first discipline, debugging, review depth and testing the plugin itself.

Plan references use these IDs (e.g. "Improvement roadmap step 3: B1, B2").

Work is tracked in Jira project **ESP** (Engineering Skills Plugin) since 2026-10-05; earlier items have GitHub issue numbers. Status as of **2026-11-02**, plugin **v0.19.3**. A version with diagrams is in `roadmap.html` (open it from a local clone; GitHub shows HTML as source); what the plugin does today is in [capabilities.md](capabilities.md).

## Steps

| Step | Theme | Items | Status |
|---|---|---|---|
| 1 | Hardening | A1–A5, A11, A12 | Shipped v0.5.0 (plan-file scope fix in v0.5.1) |
| 2 | Test-first and review depth | B4, B5, B7, B8, A8, A9 | Shipped v0.6.0 (PR #4) |
| 3 | Front of the process: clarify → spec → tickets → plan → approve | B1, B2, B3, A10 | Shipped v0.7.0 (PR #6) |
| 4 | Security and supply chain | B9, B10 | Shipped v0.8.0 (B10 #10, B9 #11) |
| 4.1 | Hardening follow-ups | #13 CI kit items, #16 staleness | Shipped v0.8.1 |
| 4.2 | Test honesty: fake-pass checks and mutation testing | A6, B26 | Shipped v0.9.0 (A6 #20/#21, B26 #22; [spec](specs/2026-09-30-fake-pass-and-mutation-test.md), [ADR 0002](adr/0002-fake-pass-checks-fail-the-gate.md)) |
| 4.3 | Guard enforcement gaps | remaining #13 items (epic ESP-2) | Shipped v0.10.0 (#43–#47; [spec](specs/2026-10-02-workflow-checks-hardening.md)); ESP-2 Released, 3 follow-up tasks open |
| 4.4 | Plan edits and config validation | ESP-21, ESP-22, ESP-12, ESP-35 | Shipped v0.10.1–v0.13.0 ([plan edits spec](specs/2026-10-09-plan-edits-all.md), [batch decisions spec](specs/2026-10-09-batch-decisions.md), [per-key config spec](specs/2026-10-10-per-key-config-validation.md)) |
| 4.5 | Session efficiency, plugin side | epic ESP-8 (R1–R7) | Partly shipped: gate runner and step timeout v0.14.0–v0.15.0 (ESP-44, ESP-52); 10 tasks open |
| 4.6 | Jira as the ticket tracker | ESP-27 (ESP-28–31, ESP-62) | Shipped v0.16.0–v0.16.1 ([spec](specs/2026-10-09-jira-ticket-tracker.md), [ADR 0003](adr/0003-jira-ticket-tracker.md)) |
| 4.7 | Delivery speed-up | ESP-63 (P1–P4: ESP-64, ESP-67, ESP-71, ESP-72) | In progress: verified status v0.17.0, pre-flight reviewers v0.18.0–v0.18.1 ([spec](specs/2026-10-16-delivery-speedup.md)) |
| 4.8 | Audit fixes | ESP-76, ESP-105–115, ESP-124, ESP-125 | Mostly shipped v0.18.2–v0.19.3 ([2026-10-17 audit](audits/2026-10-17-ponytail-audit.md), [2026-10-19 re-audit](audits/2026-10-19-ponytail-audit.md)); ESP-105 (remaining re-audit findings) still open |
| 4.9 | Plugin usage reduction | epic ESP-117 (ESP-118–123) | In progress: P1 tickets shipped v0.19.0; re-measure against the under-15% target pending ([baseline](audits/2026-10-24-usage-audit/baseline.md)) |
| 5 | Delivery and operations | B13–B19 | Not started; B11 and B12 moved into step 7 (ESP-85, ESP-83). B15 and B16 stay here with no ticket yet |
| 6 | Plugin health | B20–B25 | Not started; B23 overlaps step 8 retro (ESP-138) |
| 7 | Parallel agent orchestration | epic ESP-80 (ESP-81–100), B11, B12 | Not started; spec pending (ESP-91) |
| 8 | Ideas adopted from gstack | epics ESP-126–129, B29–B32 | Not started; filed 2026-11-02 from a review of garrytan/gstack v1.93.7 |

Order agreed 2026-09-30 (Francis): 4.2, then 4.3, then step 5 starting with B12. B12 is now ESP-83 under step 7.

Not yet assigned to a step: A7 (deferred from step 2), B6, B27 and B28.

## Epics

Every epic in Jira project ESP, with its open child count on 2026-11-02.

| Epic | Theme | Step | Status | Open children |
|---|---|---|---|---|
| [ESP-2](https://usiatech.atlassian.net/browse/ESP-2) | Workflow checks hardening (follow-up after B10) | 4.3 | Released | 3 tasks (ESP-14, ESP-17, ESP-18) |
| [ESP-8](https://usiatech.atlassian.net/browse/ESP-8) | Agent session efficiency (R1–R7), plugin side | 4.5 | To Do (partly shipped) | 10 tasks (ESP-10, ESP-36, ESP-37, ESP-46, ESP-53–56, ESP-58, ESP-60) |
| [ESP-80](https://usiatech.atlassian.net/browse/ESP-80) | Parallel agent orchestration: unattended runner, worktree streams, shared progress, governed merge | 7 | To Do | 20 (ESP-81–100) |
| [ESP-117](https://usiatech.atlassian.net/browse/ESP-117) | Plugin usage reduction: plugin share of Claude Code usage from ~27% to under 15% | 4.9 | In Progress | re-measure only |
| [ESP-126](https://usiatech.atlassian.net/browse/ESP-126) | Security audit skill: whole-codebase threat model and evidence-graded findings | 8 (B29) | To Do | 4 stories (ESP-130–133) |
| [ESP-127](https://usiatech.atlassian.net/browse/ESP-127) | Design review skill: graded visual QA of live pages with an AI-slop score | 8 (B30) | To Do | 3 stories (ESP-134–136) |
| [ESP-128](https://usiatech.atlassian.net/browse/ESP-128) | Retro skill: weekly engineering and governance retrospective | 8 (B31) | To Do | 4 stories (ESP-137–140) |
| [ESP-129](https://usiatech.atlassian.net/browse/ESP-129) | Product challenge before planning: premise check, alternatives and scope mode | 8 (B32) | To Do | 3 stories (ESP-141–143) |

### Step 7: parallel agent orchestration (ESP-80)

Two layers, from a 2026-10-18 comparison with rune-kit's `team` skill. Governance stays on throughout: the runner never bypasses the guard, the verify gate, the reviewers or the governance log, and never runs with `--dangerously-skip-permissions`.

| Layer | Tickets |
|---|---|
| Spikes | ESP-81 guard, plan and gate inside an `isolation: "worktree"` subagent; ESP-92 headless session mechanics; ESP-82 (bug) guard behaviour in git worktrees |
| Inside a feature | ESP-83 handoff state file (B12); ESP-84 `orchestrate` skill, streams with disjoint file ownership; ESP-85 a worktree per stream (B11); ESP-86 role and model per stream; ESP-88 merge and reconcile with a gate on the merged result |
| Runner (outside the session) | ESP-93 CLI and config; ESP-94 one parent agent per Epic; ESP-95 session lifecycle and usage-limit waits; ESP-96 CPU and memory admission; ESP-97 kill switch and daily cap; ESP-98 metrics and diff capture; ESP-99 decision gates (auto or ask); ESP-100 agent summary document |
| Progress and dashboard | ESP-87 machine-level SQLite store; ESP-90 Postgres / Supabase adapter; ESP-89 runner dashboard |
| Docs | ESP-91 this roadmap entry and the step's spec |

### Step 8: ideas adopted from gstack (ESP-126–129)

From a 2026-11-02 review of [garrytan/gstack](https://github.com/garrytan/gstack). gstack itself is not installed or adopted; only these four ideas are, rebuilt to fit the governance model. In every epic: no automatic fixes or commits (findings go through `approve-plan`), no bundled browser or binaries, no telemetry, and the skill text stays inside the ESP-117 budget.

| # | Epic | Stories |
|---|---|---|
| B29 | ESP-126 `security-audit` (from `/cso`) | ESP-130 application model and attack-surface census; ESP-131 scoped phases (code, infra, supply chain, OWASP, agent skills) with `--diff` and `--paths`; ESP-132 evidence rubric, independent challenge, sibling sweep; ESP-133 complete / partial / not-assessed report, findings filed as tickets, `--recheck` |
| B30 | ESP-127 `design-review` (from `/design-review`) | ESP-134 10-category checklist audit of live pages with the user's browser tools; ESP-135 A–F grades, Design Score and AI Slop Score; ESP-136 baseline, regression compare and diff-aware mode |
| B31 | ESP-128 `retro` (from `/retro`) | ESP-137 one-script git metrics; ESP-138 governance and delivery metrics from the log, archived plans and Jira; ESP-139 deferred-debt ledger; ESP-140 history, trends and cross-repo mode |
| B32 | ESP-129 product challenge (from `/office-hours`, `/plan-ceo-review`) | ESP-141 premise check in `clarify`; ESP-142 alternatives with effort in `to-spec`; ESP-143 scope mode recommended by rule in `approve-plan` |

## Unassigned backlog

Open ESP tasks with no parent epic on 2026-11-02.

| Key | Item |
|---|---|
| ESP-1 | B9 supply-chain checks: follow-up hardening |
| ESP-15 | CI `test.yml`: `persist-credentials: false` and a concurrency group |
| ESP-16 | Mutation runner: follow-up review nits from PR #39 |
| ESP-19 | After-Bash workflow check: coverage gap (details in Jira) |
| ESP-20 | After-Bash workflow check: coverage gap (details in Jira) |
| ESP-23 | Release: bump the semver version on every release from commit types |
| ESP-57 | Fake-pass check: a run-time `t.skip()` is not reported as a skipped test |
| ESP-59 | Mutation runner: reject a `timeoutMs` above 2147483647 |
| ESP-63 | Delivery speed-up (in progress, step 4.7) |
| ESP-104 | Jira tracker: choose connector or API in config |
| ESP-105 | Fix the 2026-10-19 re-audit findings |
| ESP-112 | Jira tracker: move tickets to In Progress when work is picked up, not only at plan approval |
| ESP-114 | UI design options: present 2–3 options before finalizing a screen layout (pairs with ESP-127) |
| ESP-116 | Jira tracker: move tickets through every workflow stage as the work reaches it |

## A. Improvements to existing components

| # | Item | Status |
|---|---|---|
| A1 | Tests for the guard hook and CI scripts: a table of commands and paths with the expected allow/ask/deny result, run in CI | Done (step 1) |
| A2 | Guard built a shell command from a file path; use `execFileSync` with an argument array | Done (step 1) |
| A3 | A malformed `engineering.json` silently fell back to defaults; surface it | Done (step 1) |
| A4 | Template `baseBranch` didn't match the team's branch standard; pick one or detect it | Done (step 1) |
| A5 | README version table missing rows and out of order | Done (step 1) |
| A6 | `verify` rejects fake passes (`.skip`/`.only`, placeholder TODOs, empty tests) and reports which plan acceptance criteria were shown to pass | Done (step 4.2, #20/#21). AC reporting shipped with A10; fake-pass checks per [2026-09-30 spec](specs/2026-09-30-fake-pass-and-mutation-test.md) (R1–R11) |
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
| B26 | `mutation-test` skill: break each fix point on purpose and confirm a test fails, with a report per mutation (the B9/B10 fix sets did this by hand). Done (step 4.2, #22) per [2026-09-30 spec](specs/2026-09-30-fake-pass-and-mutation-test.md) (R12–R17) | trailofbits `mutation-testing` |
| B27 | Finding verification: before a low-confidence reviewer finding is fixed or deferred, try to reproduce it and mark it confirmed or false positive | trailofbits `fp-check`, `variant-analysis` |
| B28 | `test-coverage-reviewer` agent: checks that the tests in a diff cover the new behaviour and edge cases, not just that they pass | Anthropic pr-review-toolkit `pr-test-analyzer` |

### Ideas adopted from gstack (step 8)

Found in a 2026-11-02 review of garrytan/gstack v1.93.7. Each is an epic in Jira; details are under "Step 8" above.

| # | Feature | Inspired by | Jira |
|---|---|---|---|
| B29 | `security-audit` skill: whole-codebase application model, attack-surface census, scoped phases, evidence rubric with an independent challenge, honest coverage status | gstack `/cso` | ESP-126 |
| B30 | `design-review` skill: 10-category visual audit of live pages, A–F grades, AI Slop Score, baseline and regression compare | gstack `/design-review` | ESP-127 |
| B31 | `retro` skill: weekly git, governance and delivery metrics, deferred-debt ledger, trends and cross-repo mode (covers B23 and part of B19) | gstack `/retro` | ESP-128 |
| B32 | Product challenge in `clarify`, `to-spec` and `approve-plan`: premise check, alternatives with effort, scope mode by rule | gstack `/office-hours`, `/plan-ceo-review` | ESP-129 |
