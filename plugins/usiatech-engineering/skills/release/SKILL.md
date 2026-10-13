---
name: release
description: Commits, opens a PR, merges and tags following GitFlow-lite with scoped staging, the verification gate, conventional commits and branch cleanup. Use when the user says "commit", "open a PR", "release", "merge to main", "tag" or "deploy".
---

# Release

Settings come from `.claude/engineering.json` → `git`. Defaults:
- base `develop`, release branch `main`
- tag `DDMMMYYYY-XX`
- conventional commits, one commit per PR

Repo `AGENTS.md` rules win on conflict.

## 1. Commit (feature branch off the base branch)
1. Confirm the current branch is a feature branch off the base branch. Never commit on the release branch.
2. Run `git status`. Stage **only** files that belong to the approved change (`git add <paths>`). Never use `git add -A` / `git add .`.
   - List any untracked or unrelated files and ask what to do with them.
   - Never stage `.env*` (except `.env.example`), credentials or scratch output.
3. Run the `verify` skill. Stop if the gate fails.
4. Review in two stages, using the agents in `reviewers`:
   - **Stage 1 (scope and requirements):** run `governance-reviewer` on its own first, unless the "In parallel" rule below applies. A `BLOCK` stops here. A `FLAG` needs the user's explicit decision, recorded in the plan's change log, before stage 2: ask about all stage-1 items in one question. Don't spend stage 2 on work that may be thrown away. With no `FLAG`, go straight to stage 2.
   - **Stage 2 (code quality):** run the other reviewers in parallel (default `convention-reviewer`, `silent-failure-reviewer`, `security-reviewer`; repos may add their own, e.g. `security-tenancy-auditor`). Also run `workflow-reviewer` when the diff touches `.github/workflows/`, and `supply-chain-reviewer` when it touches a `package.json`, `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`. Resolve every blocking finding before committing. List nits in the PR.
   - **In parallel:** when the diff touches 5 files or fewer and every changed file is in the plan's **Files** list, run stage 1 and stage 2 at the same time; otherwise stage 1 runs first. In parallel, a `BLOCK` still stops the commit and a `FLAG` still needs the user's explicit decision, recorded in the plan's change log.
   - **Docs-only diff:** a diff is docs-only when every changed file is Markdown (`.md`), and none is a `CLAUDE.md` or `AGENTS.md` at any depth, is the `governance.rulesFile`, is under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth or matches one of the guard's ask paths (the defaults plus `governance.askPaths`). Those files are instructions or rules, so they count as code. On a docs-only diff, skip `silent-failure-reviewer` and `security-reviewer` and say so in the PR, and run `convention-reviewer` on the `sonnet` model and say that in the PR too. `governance-reviewer` and any repo-specific reviewer still run as usual.
   - **One round per PR:** each PR gets one full review round: one full `governance-reviewer` pass and one full stage-2 pass. For a fix made after that round, whether it fixes a blocking finding or one the user decided on, run one reviewer, `governance-reviewer`, on the fix diff only, and give it the open findings as one checklist. Say in the PR that the fix had a governance-only re-review. If `reviewers` doesn't include `governance-reviewer`, run the reviewer that raised the finding instead. Run a full round again only when the fix adds a file outside the plan's **Files** list, or touches a file matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs` or `*guard*.mjs`, any file that is not Markdown under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth (hook, gate and CI code), a file under `.github/workflows/`, a `package.json` or lockfile, or one of the guard's ask paths (the defaults plus `governance.askPaths`).
   - When the diff touches files matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs` or `*guard*.mjs` (any folder), or the repo's `governance.askPaths`, suggest running the `mutation-test` skill on the changed fix points and report its survivors in the PR. It's a suggestion, not a gate: the user decides.
   - Reviewers only report findings with confidence 80 or above. Check a low-confidence note yourself before acting on it.
   - If `reviewers` doesn't include `governance-reviewer`, say in the PR that stage 1 was skipped.
   - **Decisions:** after stage 2, put every open decision (non-blocking findings, the `mutation-test` suggestion, any stage-1 item still open) into one question, with a recommended default for each. Blocking findings are never batched as decisions: fix them. Nits listed in the PR need no decision unless `decisions.nitsNeedDecision` is `true` in `.claude/engineering.json`. When `decisions.batch` is `false`, ask about each decision on its own instead.
5. Close and archive the plan with the `approve-plan` skill. This is the last step before the commit, after the review round and any fix re-review, so the reviewers still read `.claude/plans/active.md`. Stage the archived file so it goes into the same commit as the work. The commit and PR follow at once, so record the final status as shipped and tick the commit and PR tasks; if the commit or PR then fails, correct the archive before retrying.
6. Commit once, in conventional format: `type(scope): summary` (≤ 72 chars), with a body giving the why, references (intent §, ADR, issue) and migration notes.

## 2. Pull request into the base branch
- Include: summary, motivation, references, test evidence (the gate table), screenshots for UI, migration/rollback notes, and whether the user guide was updated.
- If the change is user-visible and the guide wasn't updated, run the `user-guide-update` skill first.

## 3. Release (only when the user asks)
1. Confirm CI is green on the base branch. Merge base → release branch.
2. Tag with the configured format. For `DDMMMYYYY-XX`, use the date in upper-case (e.g. `12JAN2027`) plus a two-digit sequence for that day. Check `git tag -l` to pick the next number.
3. Push the branch and tag. Follow the repo's deploy runbook: migrations as a separate step before switching; smoke-test staging, then production; check the status page and health endpoints.

## 4. Clean up
- The plan is already archived in the work's PR (section 1, step 5). Don't open a PR just to update it: add a detail that was not known before the merge (PR number, tag, Jira status) in a later PR only if it's needed.
- After the branch has merged through base and release, delete it **locally and on the remote** (`git branch -d`, `git push origin --delete`).
- Never force-push, rewrite published history or delete unmerged branches without explicit approval.
