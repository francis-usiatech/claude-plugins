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
4. Launch every agent in `reviewers` on the diff (default: `governance-reviewer`, then `convention-reviewer`; repos may add, e.g., `security-tenancy-auditor`).
   - A governance `BLOCK` stops the commit.
   - A `FLAG` needs the user's explicit decision, recorded in the plan's change log.
   - Resolve blocking findings from any reviewer first.
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
