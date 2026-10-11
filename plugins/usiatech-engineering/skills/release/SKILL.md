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
   - **Stage 1 (scope and requirements):** run `governance-reviewer` on its own first. A `BLOCK` stops here. A `FLAG` needs the user's explicit decision, recorded in the plan's change log, before stage 2: ask about all stage-1 items in one question. Don't spend stage 2 on work that may be thrown away. With no `FLAG`, go straight to stage 2.
   - **Stage 2 (code quality):** run the other reviewers in parallel (default `convention-reviewer`, `silent-failure-reviewer`, `security-reviewer`; repos may add their own, e.g. `security-tenancy-auditor`). Also run `workflow-reviewer` when the diff touches `.github/workflows/`, and `supply-chain-reviewer` when it touches a `package.json`, `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`. Resolve every blocking finding before committing. List nits in the PR.
   - When the diff touches files matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs` or `*guard*.mjs` (any folder), or the repo's `governance.askPaths`, suggest running the `mutation-test` skill on the changed fix points and report its survivors in the PR. It's a suggestion, not a gate: the user decides.
   - Reviewers only report findings with confidence 80 or above. Check a low-confidence note yourself before acting on it.
   - If `reviewers` doesn't include `governance-reviewer`, say in the PR that stage 1 was skipped.
   - **Decisions:** after stage 2, put every open decision (non-blocking findings, the `mutation-test` suggestion, any stage-1 item still open) into one question, with a recommended default for each. Blocking findings are never batched as decisions: fix them. Nits listed in the PR need no decision unless `decisions.nitsNeedDecision` is `true` in `.claude/engineering.json`. When `decisions.batch` is `false`, ask about each decision on its own instead.
5. Commit once, in conventional format: `type(scope): summary` (≤ 72 chars), with a body giving the why, references (intent §, ADR, issue) and migration notes.

## 2. Pull request into the base branch
- Include: summary, motivation, references, test evidence (the gate table), screenshots for UI, migration/rollback notes, and whether the user guide was updated.
- If the change is user-visible and the guide wasn't updated, run the `user-guide-update` skill first.

## 3. Release (only when the user asks)
1. Confirm CI is green on the base branch. Merge base → release branch.
2. Tag with the configured format. For `DDMMMYYYY-XX`, use the date in upper-case (e.g. `12JAN2027`) plus a two-digit sequence for that day. Check `git tag -l` to pick the next number.
3. Push the branch and tag. Follow the repo's deploy runbook: migrations as a separate step before switching; smoke-test staging, then production; check the status page and health endpoints.

## 4. Clean up
- Close the plan with the `approve-plan` skill (archive `.claude/plans/active.md` with the final status and PR/commit reference).
- After the branch has merged through base and release, delete it **locally and on the remote** (`git branch -d`, `git push origin --delete`).
- Never force-push, rewrite published history or delete unmerged branches without explicit approval.
