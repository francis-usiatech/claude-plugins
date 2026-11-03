# UsiaTech Engineering capabilities

What the `usiatech-engineering` plugin does today (**v0.19.3**, 2026-11-02) and what is planned. Each planned capability links to its Jira epic in project ESP. A version with diagrams is in `capabilities.html` (open it from a local clone; GitHub shows HTML as source); the order of work is in [roadmap.md](roadmap.md). Full detail for every component, config key and rule is in the [plugin README](../plugins/usiatech-engineering/README.md).

## How the pieces fit

A request moves left to right. Every step leaves a record that the next one checks.

```
clarify → to-spec → to-tickets → approve-plan → (tdd | debug) → verify → release → release-steps
   │          │           │            │              │             │         │
   note    docs/specs   Jira/GitHub  plans/active.md  tests+code   gate run  PR, merge, tag,
                                     + pre-flight                  + ACs     Jira statuses
```

Small work (a cited requirement, 5 files or fewer, no new skill, module or public interface) goes straight to `approve-plan`. Everything else takes the large route through `clarify`, `to-spec` and `to-tickets` first.

## Governance layers

| Layer | When | Mechanism | Effect |
|---|---|---|---|
| 1 | Before work | `approve-plan` + `governance-reviewer` pre-flight (+ any `planning.preflightReviewers`) | The plan must cite a requirement. Scope, acceptance criteria and tasks are recorded. |
| 2 | During work | Governance guard hook (PreToolUse) and after-Bash workflow check (PostToolUse) | Denies catastrophic actions, asks on risky or out-of-plan actions, logs every decision. |
| 3 | Before commit | `release` review: stage 1 `governance-reviewer`, stage 2 the other reviewers in parallel | `BLOCK` stops the commit; `FLAG` needs the user's decision. |
| 4 | Pull request (CI) | `templates/github/` kit: `governance-checks`, `verify-gate`, `ai-governance-review`, `governance-gate` | Rules and scripts are read from the base branch, so a PR can't change the checks it is judged by. |
| 5 | After | Archived plans, `.claude/governance-log.jsonl`, PR verdict comments | Audit trail of scope and approvals. |

## Skills (12)

| Skill | Capability |
|---|---|
| `clarify` | Asks one question at a time until purpose, success, constraints and scope edges are clear, then writes back an understanding note for the user to correct. Writes no files. |
| `to-spec` | Writes the confirmed understanding to `docs/specs/YYYY-MM-DD-<slug>.md` with requirements R1…, measurable acceptance criteria AC1… and open questions. |
| `to-tickets` | Splits an approved spec into small tickets (covers R/AC, blocked by, done when) and files them in GitHub or Jira, linking blockers. |
| `approve-plan` | Routes work small or large, records the approved plan as `.claude/plans/active.md` after a governance pre-flight, handles scope changes, and archives the plan when the work ships. |
| `tdd` | Test-first cycles (red → green → refactor) with evidence for each cycle. |
| `debug` | Root cause before fix: reproduce → localize → reduce → approved fix via `tdd` → regression guard test. |
| `mutation-test` | Breaks each fix point on purpose with the shipped `mutation-runner.mjs` and reports surviving mutations as missing tests. On demand, never a gate. |
| `verify` | Runs the repo's gate through `gate.mjs` (steps, conditional steps, fake-pass check, per-step timeout) in a forked subagent, and checks each plan acceptance criterion against evidence. |
| `release` | Scoped staging, the verify gate, two-stage review, one conventional commit, PR, merge, `DDMMMYYYY-XX` tag and branch clean-up, following GitFlow-lite. |
| `release-steps` | The mechanical part of `release`, run in a forked subagent: commit, push, PR, merge, tag, Jira status moves, clean-up. Returns a short summary. |
| `setup-engineering` | Creates `.claude/engineering.json` for a repo, checks the AGENTS.md / CLAUDE.md layout, and installs the CI kit and ruleset after approval. |
| `user-guide-update` | Finds and updates the user-guide pages and changelog affected by a user-visible change. |

## Reviewer agents (6, all read-only)

| Agent | Capability |
|---|---|
| `governance-reviewer` | Traces every change to a requirement, flags out-of-plan work, ADR or rule violations and dangerous actions. PASS / FLAG / BLOCK. |
| `convention-reviewer` | Checks a diff against the repo's root and folder `AGENTS.md`. |
| `security-reviewer` | Injection, access control, input handling, secrets, SSRF and path traversal, crypto, dependencies and CI workflows in a diff. |
| `silent-failure-reviewer` | Swallowed errors, masking fallbacks, lost async errors, ignored exit codes and tests that can't fail. |
| `supply-chain-reviewer` | `package.json` and lockfile changes: typosquats, dependency confusion, advisories, install scripts, stale packages, lockfile drift, widened ranges. |
| `workflow-reviewer` | `.github/workflows/` changes: privileged triggers running PR code, script and prompt injection, exposed secrets, pinning, token permissions. |

Every reviewer scores finding confidence (reports 80+, lists 50–79 as low-confidence notes), writes its full report to the session scratchpad and replies in at most 30 lines.

## Hooks

| Hook | Capability |
|---|---|
| Governance guard (PreToolUse on Bash, PowerShell and edits) | **Deny:** recursive forced deletes of root, home or the workspace, `curl … \| sh`, `--no-verify`, device writes, `DROP DATABASE`, edits to `.env*`, protected or committed immutable files, content with private keys or provider tokens. **Ask:** risky commands, likely credentials, high-risk workflow or dependency content, governance / CI / dependency files, edits outside the plan. **Log:** every decision to `.claude/governance-log.jsonl`. |
| After-Bash workflow check (PostToolUse and PostToolUseFailure on Bash and PowerShell) | Runs the workflow content checks on every `.github/workflows/*.yml` a Bash or PowerShell command added or changed, shows high-risk findings at once and logs every finding. |

## Shared checks

| Check | Capability |
|---|---|
| Workflow rules (`wf-*`) | Privileged triggers running PR code, untrusted input in scripts and prompts, `secrets: inherit`, unpinned actions, widened permissions. Shared by the guard, the after-Bash check and CI. |
| Supply-chain rules (`sc-*`) | Advisories, abandoned packages, typosquats and install scripts on dependency changes. |
| Fake-pass rules (`fp-*`) | `.skip` / `.only`, placeholder TODOs and empty tests fail the gate ([ADR 0002](adr/0002-fake-pass-checks-fail-the-gate.md)). |
| Secret guard | Blocks edits whose content holds a private key or a provider API key. |

## CI kit (`templates/github/`)

`pr-governance.yml` with four jobs: `governance-checks` (requirement reference, branch flow, `.env` and immutable files, approval label, workflow and dependency checks, gitleaks), `verify-gate` (the same gate as `verify`), `ai-governance-review` (Claude Code action applying `REVIEW.md`, `AGENTS.md`, `governance.md` and ADRs, with no Bash and no PR-side settings) and `governance-gate` (the required check). Plus a PR template, CODEOWNERS and a ruleset that requires Code Owner review on `.github/**`.

## Integrations

| Integration | Capability |
|---|---|
| Jira tracker | `tickets.tracker: "jira"` makes `to-tickets` file Jira issues and moves them through `started → verified → merged → released` from `approve-plan`, `verify` and `release`, via the Atlassian MCP or `scripts/jira-tracker.mjs` ([ADR 0003](adr/0003-jira-ticket-tracker.md)). |
| GitHub | Default tracker: issues from `to-tickets`, PRs and merges through `gh`. |
| Session check | `scripts/session-check.mjs` warns about a stale plugin version and a large context before `approve-plan` and `release`. Advice only. |

## Configuration

Per repo in `.claude/engineering.json`. The CI gate and several skill settings read it from the base branch; the local guard reads the working copy. Keys: `verify`, `verifyConditional`, `git`, `protectedPaths`, `immutableWhenCommitted`, `allowEnvExample`, `userGuide`, `reviewers`, `reviewerModels`, `session`, `decisions`, `planning`, `governance`, `tickets`. Unknown keys are reported as config problems. See the [plugin README](../plugins/usiatech-engineering/README.md#per-repo-configuration-claudeengineeringjson).

## Planned capabilities

| Epic | Capability | Where it plugs in | Status |
|---|---|---|---|
| [ESP-8](https://usiatech.atlassian.net/browse/ESP-8) | Session efficiency: scoped checks while iterating, batched large-route approvals, gate runner reporting (`expectNoDiff`, coverage of conditional steps, process-tree warnings) | `verify`, `approve-plan`, `release`, `gate.mjs` | Partly shipped; 10 tasks open |
| [ESP-117](https://usiatech.atlassian.net/browse/ESP-117) | Plugin under 15% of session usage: forked `verify` and `release-steps`, cheaper reviewer models, shorter reports | All skills and reviewers | P1 shipped v0.19.0; re-measure pending |
| [ESP-80](https://usiatech.atlassian.net/browse/ESP-80) | Parallel agent orchestration: handoff state, worktree streams, governed merge, unattended runner with usage-limit waits, kill switch, progress store and dashboard | New `orchestrate` skill and runner CLI | Not started |
| [ESP-126](https://usiatech.atlassian.net/browse/ESP-126) | `security-audit`: whole-codebase application model and attack-surface census, scoped phases (`--code`, `--infra`, `--supply-chain`, `--owasp`, `--skills`, `--diff`, `--paths`), evidence rubric with an independent challenge and sibling sweep, complete / partial / not-assessed report, findings filed as tickets, `--recheck` | New skill; reuses `supply-chain-reviewer` and `workflow-reviewer` rules; files through `to-tickets` | Not started |
| [ESP-127](https://usiatech.atlassian.net/browse/ESP-127) | `design-review`: 10-category visual audit of live pages through claude-in-chrome or Playwright, A–F grades, Design Score and AI Slop Score, baseline and regression compare, diff-aware mode | New skill; fixes go through `approve-plan`; pairs with ESP-114 | Not started |
| [ESP-128](https://usiatech.atlassian.net/browse/ESP-128) | `retro`: weekly git metrics, governance and delivery metrics from the log, archived plans and Jira, deferred-debt ledger, history, trends and cross-repo mode | New read-only skill and metrics script | Not started |
| [ESP-129](https://usiatech.atlassian.net/browse/ESP-129) | Product challenge: premise check, 2–3 alternatives with effort, scope mode by rule (expand, selective, hold, reduce); the user always decides | `clarify`, `to-spec`, `approve-plan` (large route only) | Not started |
