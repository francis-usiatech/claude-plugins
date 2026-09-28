---
name: setup-engineering
description: Sets up a repository for the usiatech-engineering plugin by creating .claude/engineering.json from the template and checking AGENTS.md/CLAUDE.md structure. Use when the user says "set up the engineering plugin", "configure verify for this repo" or when .claude/engineering.json is missing.
---

# Set up the plugin in a repo

1. Read `${CLAUDE_PLUGIN_ROOT}/templates/engineering.json`.
2. Inspect the repo:
   - package manager and scripts (`package.json`)
   - `AGENTS.md` "Definition of done", git workflow and generated/immutable paths
   - user guide location
   - integration branch: run `git ls-remote --heads origin dev develop`. Use whichever exists for `git.baseBranch`. If both or neither exist, ask the user; don't assume the template's `develop`.
   - release branch: run `git ls-remote --heads origin main master` (or `git remote show origin` for the default branch). Use whichever exists for `git.releaseBranch`. If both or neither exist, ask the user; don't assume `main`.
3. Draft `.claude/engineering.json` with the repo's real commands, paths and branches. Show it and write it after approval.
4. Governance:
   - Copy `${CLAUDE_PLUGIN_ROOT}/templates/governance.md` to `.claude/governance.md` and ask the user for repo-specific rules. Leave sections empty rather than invent rules.
   - Add `.claude/plans/active.md` and `.claude/governance-log.jsonl` to `.gitignore`. Archived plans stay committed.
   - Confirm `reviewers` includes `governance-reviewer`.
5. **PR governance (CI):**
   - Copy `${CLAUDE_PLUGIN_ROOT}/templates/github/` into `.github/` (workflow, scripts, PR template, CODEOWNERS). Copy the whole `scripts/` folder: the scripts import `governance-rules.mjs`.
   - In `.github/workflows/pr-governance.yml`, set `on.pull_request.branches` to `[<git.baseBranch>, <git.releaseBranch>]`.
   - Draft a short repo `REVIEW.md` (see `templates/REVIEW.example-hei.md`).
   - Tell the user the manual steps: add the `ANTHROPIC_API_KEY` secret, install the Claude GitHub App, create the `governance-approved` label, and make `governance-gate` a required status check on the base and release branches.
   - **Upgrading an existing install:** re-copy `templates/github/scripts/` so `.github/scripts/` has the same files as the plugin version, and show the diff for approval.
   - Commit the workflow directly to the base branch first (bootstrap), so later PRs are judged by base-branch rules.
6. Check the instruction layout and report gaps. Don't rewrite files without approval.
   - `AGENTS.md` is canonical.
   - `CLAUDE.md` imports it with `@AGENTS.md` and holds only Claude-specific notes.
   - There's no duplicated copy of AGENTS.md inside CLAUDE.md.
7. **Repo-local duplicates:** if the repo has its own `release` skill, `convention-reviewer` agent or path-protection hook, recommend removing them in favour of the plugin. Keep repo-specific skills and agents.
