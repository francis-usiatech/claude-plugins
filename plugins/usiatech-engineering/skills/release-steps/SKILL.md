---
name: release-steps
description: Runs the mechanical steps of a release in a forked subagent (commit, push and PR; merge and the Jira merged update; merge to the release branch, tag and the Jira released update; branch clean-up) and returns a short summary. Called by the release skill after its reviews pass, with the phase and the paths of the commit message and PR body files as the argument; not for direct use.
context: fork
agent: general-purpose
background: false
model: sonnet
---

# Release steps

This skill runs in a forked subagent with no session history. Its input is the arguments the `release` skill passes:
- the phase: `commit`, `merge`, `release` or `release-jira`
- for `commit`: the files to stage, and the paths of the commit message file and the PR body file in the session scratchpad
- for `merge` and `release`: the PR number
- for `release-jira`: the confirmed Jira keys and the feature branch name

Never ask the user yourself. Return a summary of at most 15 lines: what ran (commit hash, PR link, merge state, tag), each failure with its message, and any open decisions as a list for the main thread to ask.

Settings come from `.claude/engineering.json` → `git`. Defaults:
- base `develop`, release branch `main`
- tag `DDMMMYYYY-XX`

Repo `AGENTS.md` rules win on conflict.

## Commit (phase `commit`)
1. Confirm the current branch is a feature branch off the base branch. Never commit on the release branch.
2. Stage exactly the files the arguments list (`git add <paths>`). Never use `git add -A` / `git add .`. Never stage `.env*` (except `.env.example`), credentials or scratch output; return any such file as an open decision.
3. Commit once with the message file: `git commit -F "<file>"`. The message is in conventional format, `type(scope): summary` (≤ 72 chars), with a body giving the why, references and migration notes; the `release` skill wrote it.
4. Push the branch and open the PR into the base branch with the PR body file. Return the PR link.

## Pull request into the base branch (phase `merge`)
- Merge the PR only when the arguments say the user approved it or a standing merge rule applies.
- **On merge, Jira tracker only** (see "Jira tracker" below): this step runs once the PR has merged into the base branch, meaning this run merged it or `gh pr view <n> --json state` shows `MERGED`.
  - The keys are the Jira tickets named by the tasks in the archived plan for this branch, the one whose final status names the branch. If there's no such plan, or its tasks name no keys, say so; don't skip without a word.
  - For each key, fire `merged`. Skip a docs-only ticket without its approval line in the plan's Change log, and say it waits at `devComplete` for the user's review.
  - Then add a comment holding the PR link to each key (`jira-moves.md`, section 4).
  - Add the comment even when the move failed, or moved nothing because no `merged` status is configured. Report both.

## Release (phase `release`, only when the user asked)
1. Confirm CI is green on the base branch. Merge base → release branch.
2. Tag with the configured format. For `DDMMMYYYY-XX`, use the date in upper-case (e.g. `12JAN2027`) plus a two-digit sequence for that day. Check `git tag -l` to pick the next number. For `vX.Y.Z`, use the version the merged bump PR wrote to the files in `git.versionFiles`; if those files disagree, or that tag already exists, stop and report it.
   - **Jira tracker only, `git.tagFormat` of `vX.Y.Z`:** before creating the tag, take the previous one from `previousTag` in the output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/next-version.mjs"`, because `git describe` misses tags the current branch can't reach. A non-zero exit is a failure: report it, and don't guess a tag.
   - **Jira tracker only, any other tag format:** before creating the tag, find the previous one with `git describe --tags --abbrev=0`. If git says "No names found", there's no earlier tag, and step 4 below scans the whole history. Any other error is a failure: report it, and don't guess a tag.
3. Push the branch and tag. Follow the repo's deploy runbook: migrations as a separate step before switching; smoke-test staging, then production; check the status page and health endpoints.
4. **Jira tracker only:** mark the released tickets. Skip this step when `jira.statuses` in the `check` output has no `released`, and say so.
   - From a POSIX shell (Git Bash on Windows; a PowerShell 5.1 redirect writes UTF-16, which `keys` refuses with exit 2), run `git log "<previous tag>..<new tag>" --format=%B > "<file>"`, or `git log "<new tag>" --format=%B > "<file>"` with no previous tag. The file goes in the session scratchpad.
   - Check that `git log` exited 0. If it didn't, stop this step and report the failure; an empty file from a failed `git log` would read as "no tickets".
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" keys --messages-file "<file>"`. It prints the project's keys found in the commit subjects and bodies.
   - Return the list as an open decision, with the new tag and the previous tag: the user may drop keys that are only mentioned, such as a "Follow-up: ESP-61" line. Stop here; phase `release-jira` moves the confirmed keys and cleans up.
5. Clean up: after the branch has merged through base and release, delete it **locally and on the remote** (`git branch -d`, `git push origin --delete`). When step 4 returned keys, leave this to phase `release-jira`.

## Released tickets (phase `release-jira`, Jira tracker only)
The `release` phase has already merged, tagged and pushed. Never merge, tag or push in this phase.
1. For each key the arguments confirm, fire `released`. With no confirmed list, move nothing and say so. Skip a docs-only ticket without its approval line in its archived plan's Change log, and say it waits at `devComplete` for the user's review.
2. Then do the `release` phase's step 5 clean-up.

## Jira tracker
- **Jira writes:** every check, move and comment follows `${CLAUDE_PLUGIN_ROOT}/scripts/jira-moves.md`: the `check` run, the configured transport (`connector` or `api`, never both), forward-only moves and the docs-only stop. "Fire `<event>`" above means a move with that event. Return any stderr warning `check` prints.
- **Failures:** a failed `check`, `git describe`, `git log`, `keys`, transition or comment (MCP call or script) never undoes a git step: the merge, the tag and the push stand.
  - Go on with the other keys. Then report each failure with its message as one the user must fix in Jira.
  - Don't retry silently, and don't report the release as fully done while a Jira step has failed.

## Rules
- Run `git commit` and `git push` through the Bash tool, not PowerShell, in every phase. The `security-guidance` plugin (tested on 2.0.17, [upstream issue](https://github.com/anthropics/claude-plugins-official/issues/7005)) skips PowerShell commits and pushes with no message. A Bash run can skip too, so this doesn't replace checking its log. If Bash refuses a git command, stop and return that as an open decision.
- The plan is already archived in the work's PR by the `release` skill. Don't open a PR just to update it.
- Never force-push, rewrite published history or delete unmerged branches.
