# UsiaTech Engineering (`usiatech-engineering`)

Shared engineering workflow **and governance** for UsiaTech repositories (WaypointCareer, HEI Impact Intelligence). Project rules stay in each repo's `AGENTS.md`. This plugin supplies the procedures, reviewers and guard that are the same everywhere.

## Components

| Type | Name | What it does |
|---|---|---|
| Skill | `verify` | Runs the repo's definition-of-done gate (from `.claude/engineering.json` or AGENTS.md) and reports PASS/FAIL |
| Skill | `release` | Scoped staging → verify → reviewers → one conventional commit → PR → merge → `DDMMMYYYY-XX` tag → branch cleanup |
| Skill | `user-guide-update` | Finds and updates affected user-guide pages and the changelog |
| Skill | `setup-engineering` | Creates `.claude/engineering.json` for a repo and checks the AGENTS.md/CLAUDE.md layout |
| Skill | `approve-plan` | Records the approved plan as the scope baseline (`.claude/plans/active.md`), updates it on approved scope changes, archives it when done |
| Agent | `governance-reviewer` | Read-only gate: traces every change to a requirement, flags out-of-plan work, ADR/rule violations and dangerous actions; verdict PASS/FLAG/BLOCK |
| Agent | `convention-reviewer` | Read-only review of a diff against the repo's root and folder AGENTS.md |
| Hook | Governance guard (PreToolUse on Bash + edits) | **Deny:** catastrophic or rule-breaking actions. **Ask:** risky commands, governance/CI/dependency files, edits outside the approved plan. **Log:** every decision to `.claude/governance-log.jsonl` |

## Per-repo configuration: `.claude/engineering.json`
Start from `templates/engineering.json` (or run the `setup-engineering` skill).

| Key | Purpose |
|---|---|
| `verify` | Commands always run by `verify`, in order |
| `verifyConditional` | Extra commands run only when changed files start with a `when` prefix |
| `git` | Base/release branch, tag format, commit style |
| `protectedPaths` | Globs the agent may never edit |
| `immutableWhenCommitted` | Globs editable only until committed (e.g. migrations) |
| `allowEnvExample` | Allow edits to `.env.example` (default `true`) |
| `userGuide` | Guide folder, changelog file, optional manifest |
| `reviewers` | Agents `release` runs before committing (default `governance-reviewer`, `convention-reviewer`; repo-specific ones allowed) |
| `governance` | `protectedBranches`, `askPaths`, `requirePlan`, extra `denyCommands` / `askCommands` (regex + reason), `rulesFile` |

## Governance model (layered)

| Layer | Mechanism | Effect |
|---|---|---|
| 1. Before work | `approve-plan` + `governance-reviewer` pre-flight | Plan must cite requirements. Scope is recorded. |
| 2. During work | Governance guard hook | Denies catastrophic actions. Asks on risky or out-of-plan actions. Logs everything. |
| 3. Before commit | `governance-reviewer` (+ `convention-reviewer`) in `release` | `BLOCK` stops the commit. `FLAG` needs the user's decision. |
| 4. Pull requests (CI) | `templates/github/` → `.github/` + repo `REVIEW.md` | Every PR runs these jobs (details below). `governance-gate` is the required check. |
| 5. After | Archived plans + `governance-log.jsonl` + PR verdict comments | Audit trail of scope and approvals |

**PR governance jobs:**
- `governance-checks` (deterministic):
  - requirement reference present in the PR description
  - branch flow (only `develop` or `hotfix/*` into `main`)
  - no `.env` files, no edits to committed immutable files
  - governance/CI/dependency changes need the `governance-approved` label
  - gitleaks secrets scan
- `verify-gate`: the same `.claude/engineering.json` gate as the local `verify` skill.
- `ai-governance-review`: Claude Code GitHub Action applies `REVIEW.md` + AGENTS.md + `governance.md` + intent/ADRs. It returns a structured PASS/FLAG/BLOCK verdict, posts inline comments, and keeps one verdict comment per commit.
- `governance-gate` (required check): fails on failed checks or verify, on BLOCK or ERROR, on FLAG without the label, or when there's no verdict for the head commit.

Scripts and rules are read from the **base branch** (`_gov/`), so a PR can't weaken its own gate. The PR description is passed to the reviewer as untrusted data. Fork PRs get no AI review (secrets are withheld), so they fail the gate until a maintainer re-opens them from a branch.

**Default guard rules**
- **Deny:**
  - `rm -rf` of root, home or the workspace
  - `curl … | sh`
  - `--no-verify`
  - `mkfs`/`dd` to devices
  - `DROP DATABASE`/`SCHEMA`
  - shutdown/reboot
  - `chmod -R 777`
  - editing `.env*`, protected paths or committed immutable files
- **Ask:**
  - force push; reset/clean/restore; branch deletion; history rewrite; `rm -r`
  - `DROP TABLE`/`TRUNCATE`/unfiltered `DELETE`; weakening RLS; DB reset
  - dependency adds; publish; ssh/scp/rsync/terraform/kubectl/ansible/firebase deploy/docker prune
  - reading `.env`; `sudo`; `chmod 777`
  - commits or merges on protected branches, and pushes to them
  - edits to `.claude/**`, AGENTS.md, CLAUDE.md, REVIEW.md, `.github/**`, `package.json`
  - edits outside the approved plan
  - any action while `.claude/engineering.json` is malformed or has an invalid command pattern (default deny rules still apply)

All default rules live in one module, `templates/github/scripts/governance-rules.mjs`. The guard hook imports the plugin's copy. `setup-engineering` copies it into `.github/scripts/` with the CI scripts, which read the repo's copy. The two match at install time. After upgrading the plugin, re-copy `templates/github/scripts/` or the PR checks keep the older rules.

Path checks ignore case on Windows and macOS (`.ENV` is treated as `.env`), and CI always ignores case. A config value of the wrong type (e.g. a string where a list is expected) is reported the same way as malformed JSON, and the defaults apply for that key.

The guard fails open on internal errors, so a bug can't lock a session. Each failure is logged as `"decision": "error"` in `governance-log.jsonl` and printed to stderr, and the reviewer reports these entries. `ask` depends on Claude Code's permission prompt: in a fully auto-approved session, rely on `deny` rules and the reviewer.

## Development
Tests use Node's built-in runner and have no dependencies. From the marketplace root run `npm test`. They cover the shared rules, the guard (as a function and as a hook subprocess), and each CI script against temporary git repos and a local GitHub API stub. `.github/workflows/test.yml` runs them on Ubuntu and Windows with Node 18 and 22.

## What stays in each repo
- `AGENTS.md` (canonical rules) + `CLAUDE.md` (`@AGENTS.md` + Claude-only notes) + folder `AGENTS.md` files.
- Project-specific skills and agents. Examples:
  - WaypointCareer: `add-ai-provider`, `change-subscription-tier`, `new-api-route`, `prisma-migration`
  - HEI: `new-api-endpoint`, `db-change`, `new-background-job`, `new-adr`, `security-tenancy-auditor`, `docs-sync`

## Requirements
Node ≥ 18 on the machine running Claude Code (used by the hook). Git.

## Versioning
Semver. Record changes below.

| Version | Change |
|---|---|
| 0.5.0 | Guard hardening: shared rules module (`governance-rules.mjs`) used by the guard and CI; guard logic split into `governance-policy.mjs`; git calls no longer go through a shell (guard, `governance-checks`, `run-verify`); a malformed `engineering.json` or invalid command pattern now asks instead of silently dropping repo rules; fail-open errors are logged and reported by `governance-reviewer`; the guard also asks on `REVIEW.md` and all of `.github/**` (matching CI); `governance-gate`/`post-verdict` set `process.exitCode` instead of calling `process.exit()`; `setup-engineering` detects `dev` vs `develop`; wrong-type config values are reported instead of crashing the guard; edits on another Windows drive ask; path checks ignore case on Windows/macOS and in CI; protected-branch names are escaped and matched as whole refspecs; CI honours `allowEnvExample`; the gate reports GitHub API errors; test suite and test workflow. **Upgrading repos:** re-copy `templates/github/scripts/` into `.github/scripts/` (the scripts now import `governance-rules.mjs`). |
| 0.4.1 | CI kit fixes: scripts read `engineering.json` from the base-branch copy; an empty verify list fails the gate; `GOVERNANCE_AI_REVIEW=off` opt-out; base-branch files extracted outside the workspace for `verify-gate` |
| 0.4.0 | Renamed from `nextascend-engineering` to `usiatech-engineering` (display name UsiaTech Engineering); no functional changes. Reinstall under the new name and uninstall the old one. |
| 0.3.0 | PR governance CI kit (`templates/github/`: workflow, 4 scripts, PR template, CODEOWNERS), `REVIEW.md` example; reviewer applies `REVIEW.md`; `setup-engineering` installs CI; `approvalLabel`/`requirementRefPattern` config |
| 0.2.0 | Governance: `approve-plan` skill, `governance-reviewer` agent, governance guard (replaces path guard; adds command rules, plan scope, governance log), `governance.md` + `plan.md` templates |
| 0.1.0 | Initial: verify, release, user-guide-update, setup-engineering, convention-reviewer, path guard |
