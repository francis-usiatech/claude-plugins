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

## 0. Session check
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-check.mjs"` from the repo root and show what it prints: a stale plugin version (save the session and start a new one), or a context above `session.contextAdvisoryTokens` (default 300000; compact or start fresh before the review round). Don't block: the user decides. A non-zero exit or "Cannot find module" (the running plugin folder was replaced) is reported too; the second also means the plugin is stale.

## 1. Commit (feature branch off the base branch)
1. Confirm the current branch is a feature branch off the base branch. Never commit on the release branch.
2. Run `git status`. Pick **only** the files that belong to the approved change; `release-steps` stages exactly those (never `git add -A` / `git add .`).
   - List any untracked or unrelated files and ask what to do with them.
   - Never stage `.env*` (except `.env.example`), credentials or scratch output.
3. Run the `verify` skill, passing as its argument the evidence for each acceptance criterion the repo state can't show. It runs forked and returns its report. Stop if the gate fails.
   - **One full gate per PR:** use `verify --iterate` while building. Run the full gate once per PR, after the last code change and before the commit. Any code change after a full gate, a review fix included and tests-only included, needs the full gate again before the commit.
4. Review in two stages, using the agents in `reviewers`:
   - **Stage 1 (scope and requirements):** run `governance-reviewer` on its own first, unless the "In parallel" rule below applies. A `BLOCK` stops here. A `FLAG` needs the user's explicit decision, recorded in the plan's change log, before stage 2: ask about all stage-1 items in one question. Don't spend stage 2 on work that may be thrown away. A `FLAG` reported as "FLAG, settled by SD-n" needs no decision: record it in the plan's Change log with its SD number, and leave it out of the question. With no unsettled `FLAG`, go straight to stage 2.
   - **Stage 2 (code quality):** run the other reviewers in parallel (default `convention-reviewer`, `silent-failure-reviewer`, `security-reviewer`; repos may add their own, e.g. `security-tenancy-auditor`). Also run `workflow-reviewer` when the diff touches `.github/workflows/`, and `supply-chain-reviewer` when it touches a `package.json`, `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`. Resolve every blocking finding before committing. List nits in the PR.
   - **In parallel:** when the diff touches 5 files or fewer (counting every file, not only production code) and every changed file is in the plan's **Files** list, run stage 1 and stage 2 at the same time; otherwise stage 1 runs first. In parallel, a `BLOCK` still stops the commit and a `FLAG` still needs the user's explicit decision, recorded in the plan's change log.
   - **Docs-only diff:** a diff is docs-only when every changed file is Markdown (`.md`), and none is a `CLAUDE.md` or `AGENTS.md` at any depth, is the `governance.rulesFile`, is under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth or matches one of the guard's ask paths (the defaults plus `governance.askPaths`). Those files are instructions or rules, so they count as code. On a docs-only diff, skip `silent-failure-reviewer` and `security-reviewer` and say so in the PR, and run `convention-reviewer` on the `sonnet` model and say that in the PR too. `governance-reviewer` and any repo-specific reviewer still run as usual.
   - **One round per PR:** each PR gets one full review round: one full `governance-reviewer` pass and one full stage-2 pass. For a fix made after that round, whether it fixes a blocking finding or one the user decided on, run one reviewer, `governance-reviewer`, on the fix diff only, and give it the open findings as one checklist. Say in the PR that the fix had a governance-only re-review. If `reviewers` doesn't include `governance-reviewer`, run the reviewer that raised the finding instead. Run a full round again only when the fix adds a file outside the plan's **Files** list, or touches a file matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs` or `*guard*.mjs`, any file that is not Markdown under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth (hook, gate and CI code), a file under `.github/workflows/`, a `package.json` or lockfile, or one of the guard's ask paths (the defaults plus `governance.askPaths`).
   - When the diff touches files matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs` or `*guard*.mjs` (any folder), or the repo's `governance.askPaths`, suggest running the `mutation-test` skill on the changed fix points and report its survivors in the PR. It's a suggestion, not a gate: the user decides.
   - **Models:** pass a `model` on every reviewer spawn. Use `reviewerModels[<agent>]` from the base-branch `.claude/engineering.json` (`git show <base>:.claude/engineering.json`), skipping keys that start with `$`. With no entry, use the agent file's `model` (`sonnet` for convention, silent-failure, supply-chain and workflow reviewers; `opus` for governance and security), except that a governance-only fix re-review on a fix diff of 5 files or fewer, counting every file, runs `governance-reviewer` on `sonnet`. `inherit` means pass no model. Any value other than `sonnet`, `opus`, `haiku` or `inherit` is ignored: tell the user and use the default.
   - **Reports:** name the session scratchpad in every reviewer prompt. Each reviewer writes its full report there and replies with the verdict, one line per finding and the report path. Read a report file only when a finding needs its detail; take the nits for the PR from the report files.
   - Reviewers only report findings with confidence 80 or above. Check a low-confidence note yourself before acting on it.
   - If `reviewers` doesn't include `governance-reviewer`, say in the PR that stage 1 was skipped.
   - **Decisions:** after stage 2, put every open decision (non-blocking findings, the `mutation-test` suggestion, any stage-1 item still open) into one question, with a recommended default for each. Blocking findings are never batched as decisions: fix them. Nits listed in the PR need no decision unless `decisions.nitsNeedDecision` is `true` in `.claude/engineering.json`. When `decisions.batch` is `false`, ask about each decision on its own instead.
5. Close and archive the plan with the `approve-plan` skill. This is the last step before the commit, after the review round and any fix re-review, so the reviewers still read `.claude/plans/active.md`. Add the archived file to the files to stage, so it goes into the same commit as the work. The commit and PR follow at once, so record the final status as shipped and tick the commit and PR tasks; if the commit or PR then fails, correct the archive before retrying.
6. Write the commit message to a file in the session scratchpad, in conventional format: `type(scope): summary` (≤ 72 chars), with a body giving the why, references (intent §, ADR, issue) and migration notes. Write the PR body to a second file: summary, motivation, references, test evidence (the gate table), screenshots for UI, migration/rollback notes, whether the user guide was updated, and the nits for the PR from the report files.
   - If the change is user-visible and the guide wasn't updated, run the `user-guide-update` skill first.
7. Run the `release-steps` skill with phase `commit`, the files to stage and the two file paths. It commits once, pushes and opens the PR in a forked subagent and returns a short summary.

## 2. Merge into the base branch
- When the user approves the merge (or a standing merge rule applies), run `release-steps` with phase `merge` and the PR number. It merges and does the Jira merged update.

## 3. Release (only when the user asks)
- **Version bump (repos that list `git.versionFiles`):** every release bumps the version once, before promotion.
  1. Update the base branch and fetch tags: `git fetch origin --tags`, then bring the local base branch up to date.
  2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/next-version.mjs"` from the repo root. It prints JSON with the computed level and the next version. `{"enabled":false}` means the repo hasn't opted in: skip the rest of this bump.
  3. `"bumpMerged":true` means the bump has already merged: go on to promote, and don't bump again. When `commitsAfterBump` is above zero, those commits aren't counted in the bumped version: show them and ask the user before promoting. A non-zero exit stops the release: show its message.
  4. Show the level and the next version, and wait for the user to confirm or override the level. For an override, run the script again with `--level <patch|minor|major>`.
  5. On a branch off the base branch, change the version in each of `versionFiles` and add the new row to `changelogFile`. Change nothing else.
  6. A bump PR whose diff touches only the listed version files and the changelog row runs the `verify` gate with no reviewer round, and says so in the PR. This holds only when each changed line in a version file differs by the version string alone and the changelog change is one added row, so read the diff to confirm it. Any other diff gets the full review in section 1.
  7. Open one `chore(release): <next>` PR into the base branch through `release-steps` phases `commit` and `merge`. When `override` is true, record the computed level, the chosen level and the reason in the commit body.
  8. Once that PR has merged, promote and tag as below.
- Run `release-steps` with phase `release`. It merges base → release branch, tags and pushes. It cleans up the branch only when the commits name no Jira keys.
- Otherwise it returns the Jira keys found in the commits as an open decision. Ask the user once to confirm the list, then run phase `release-jira` with the confirmed keys and the feature branch name so it marks them released and cleans up the branch, with no second merge or tag.

## Summaries and decisions
- Each `release-steps` run returns at most 15 lines: what ran, each failure with its message, and open decisions as a list. Ask the user about the open decisions in one question (or one at a time when `decisions.batch` is `false`). A failed Jira step never undoes a git step: report it as one the user must fix.
- Never force-push, rewrite published history or delete unmerged branches without explicit approval.
