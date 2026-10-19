# Ponytail re-audit — fix brief (2026-10-19)

Source: `/ponytail:ponytail-audit` of the whole repo on branch `feature/esp79-audit-pr-e`, after the fixes for the
[2026-10-17 audit](2026-10-17-ponytail-audit.md) (PRs A–E, ESP-75 to ESP-79). At audit time the full suite passed
(1372 tests, 3 skipped) and the gate printed Gate: PASS. All paths are relative to `plugins/usiatech-engineering/`
unless they start with `.` or `docs/`.

**What this repo does:** a Claude Code plugin marketplace with one plugin, usiatech-engineering. The plugin adds a
governance guard (hooks that deny or ask before risky tool calls), CI scripts and a workflow that consumer repos copy
into `.github/`, and skills for planning, test-first work, verification, mutation tests, release and Jira tickets.
**Load assumed:** one developer's Claude Code session, where the hooks fire on every tool call, plus CI once per PR
event. Hook speed and fail-closed behaviour matter; many-user scale does not apply.

## How to use this brief

- This brief lists findings only. Nothing in it is approved work. Follow the repo flow: approve-plan → tdd → verify → release.
- Fix in the order given. **R1–R4 are guard bypasses and come first.**
- Tracked in Jira under ESP-105, one sub-task per PR: **ESP-106** (guard: R1–R5), **ESP-107** (CI: R6, R8, R10, R11), **ESP-108** (mutation runner: R7, R9, R15), **ESP-109** (nits: R13, R14, R16, R17). R12 was fixed in ESP-79.
- Bug fixes are test-first. Each finding names the test that must fail before the fix and pass after it.
- Make the smallest fix that works. Keep error handling and validation. Add no new dependencies.
- "Proven" means the case was reproduced by running the real code. "Reasoned" means it was read from the code only.
- Known and not repeated here: ESP-101 (TEST_CALL regex stalls CI), the shell-tokenizer follow-up, flaky tests, and
  the documented 8-option limit of `GIT_PREFIX` (`workflow-rules.mjs:51-56`).

## The 2026-10-17 findings

Every fix below was broken on purpose in a scratch copy, one at a time: all 21 breaks failed a test.

| F | Title | Status | Guarding test |
|---|---|---|---|
| F1 | Forged verdict marker | Closed | post-verdict and governance-gate "(F1)" tests |
| F2 | Edit or label skips the AI verdict | Closed | governance-gate "(F2)" test |
| F3 | git global options get past the guard | Closed (gaps next to it: R3, R5) | governance-policy "(F3)" tests |
| F4 | Scripts started through a link do nothing | Closed | main-module "through a link" tests (×4, real junctions) |
| F5 | Rename out of the governance folder | Closed | governance-checks "(F5)" test |
| F6 | Non-ASCII paths in run-verify | Closed (by-hand procedure: R16) | run-verify "(F6)" test |
| F7 | Immutable file turned into a symlink | Closed | governance-checks "(F7)" test |
| F8 | Chained only/skip | Closed (edges: R17) | fake-pass-rules F8 cases |
| F9 | `issue_comment` is privileged | Closed | workflow-rules "(F9)" test |
| F10 | Untrusted text through `env:` | Closed (indirect paths: R8) | workflow-rules "(F10)" suite |
| F11 | Approval label in 3 places | Closed | governance-gate and post-verdict "(F11)" tests |
| F12 | Mutation timeout of 2³¹ ms or more | Closed | mutation-runner "(F12)" test |
| F13 | Jira site with a path | Closed (follow-on: R14) | jira-tracker "(F13)" test |
| F14 | UTF-16 messages file | Closed | jira-tracker "(F14)" test |
| F15 | Lean: duplicates, aliases, dead exports | Closed in ESP-79 (three more exports: R12) | plugin-structure, AC6 timing test |
| F16 | Whole failing output read | Closed | gate "(ESP-78 F16)" test |
| F17 | Short-token redaction | Closed | jira-tracker "(F17)" test |
| F18 | Mutation re-encodes non-UTF-8 files | Closed | mutation-runner "(F18)" test |
| F19 | Symlinked test file in CI | Closed | governance-checks "(F19)" test |
| Nit | mutation-test SKILL.md ERROR row | Closed | (prose) |

---

## Must fix

### R1 — The guard never sees the PowerShell tool (proven)
- **File:** `hooks/hooks.json:6` (PreToolUse matcher), and the PostToolUse matchers at `:14` and `:22`
- **What this is:** The matcher decides which tool calls the guard and the after-Bash workflow check run on.
- **Problem:** The matcher is `Bash|Edit|MultiEdit|Write|NotebookEdit`. Claude Code on Windows also has a `PowerShell` tool, so `git push --force origin main` or `Remove-Item -Recurse ~` sent through it gets no deny, ask, log entry or workflow check. Repro: a command holding `--no-verify` was denied through Bash and ran through PowerShell.
- **Fix:** Add `PowerShell` to the matchers and send its command through the same command rules as Bash. Name the remaining gap (MCP tools that write files or push, such as a GitHub `push_files`) in the README's known limits.
- **Test:** A PowerShell tool call with `git push --force origin main` is asked, and one with `--no-verify` is denied.
- **If we skip it:** On Windows, every command rule can be bypassed by using the other shell tool.

### R2 — A `::$DATA` suffix gets past the env-file deny and the plan and AGENTS.md asks on Windows (proven)
- **File:** `hooks/scripts/governance-policy.mjs:509-537` (`decideEdit`); `windowsCanonical` (`:29`) is used only for the workflow and dependency checks.
- **What this is:** Windows names a file's main data stream `name::$DATA`, so writing to `.env::$DATA` writes `.env`.
- **Problem:** With no plan active, a Write to `.env::$DATA`, `AGENTS.md::$DATA`, `CLAUDE.md::$DATA` or `.claude/plans/active.md::$DATA` is allowed. The plan path is allowed even with a plan active, because it matches the exempt glob `.claude/plans/**` instead of the plan path. Node's `writeFileSync('a.md::$DATA', …)` overwrites `a.md`.
- **Fix:** On win32, canonicalize the path (strip the stream suffix) once, before every path check in `decideEdit`, not only the workflow and dependency checks.
- **Test:** On win32, each of the four paths gets the same decision as the plain name.
- **If we skip it:** A secret `.env` can be written with no deny, and the approved plan can be rewritten without a prompt.

### R3 — An abbreviated `--no-verify` or a `core.hooksPath` override skips git hooks (proven)
- **File:** `templates/github/scripts/governance-rules.mjs:37` (deny) and `:40`
- **What this is:** The deny rule against skipping git hooks.
- **Problem:** git accepts any unique prefix of a long option. `git commit --no-verif -m x` and `git -c core.hooksPath=/dev/null commit -m x` both commit past a failing pre-commit hook, and the guard allows both. `git config core.hooksPath /dev/null` is allowed too. Only the full spelling `--no-verify` is denied.
- **Fix:** Match `--no-veri(?:fy?)?\b`. `--no-veri` is the shortest prefix git can tell apart from `--no-verbose`. Deny `core\.hooksPath` in the `-c` and `config` forms, built on `GIT_PREFIX`.
- **Test:** `git commit --no-verif -m x`, `git push --no-veri origin x`, `git -c core.hooksPath=/dev/null commit -m x` and `git config core.hooksPath /dev/null` are denied.
- **If we skip it:** The hook-bypass deny is one character away from useless.

### R4 — A recursive delete with separate or long flags is not even asked (proven)
- **File:** `governance-rules.mjs:35` (deny) and `:51` (ask)
- **What this is:** The rules for `rm -rf`.
- **Problem:** `rm -f -r $HOME` and `rm --recursive --force ~` are allowed: the ask rule `\brm\s+-[a-z]*r` looks only at the first flag. `rm -rf -- ~` and `rm -rf "$HOME"` are only asked, not denied.
- **Fix:** Ask on `\brm\b[^;&|]*\s(?:-[a-z]*r|--recursive\b)`. Let the deny accept separate or long flags, an optional `--`, and quotes around `~`, `$HOME` and `/`.
- **Test:** The four commands above are denied; `rm -r build/` is still asked.
- **If we skip it:** Deleting the home folder can run with no prompt.

## Should fix

### R5 — Several destructive git spellings get no ask (proven)
- **File:** `governance-rules.mjs:48-49`
- **What this is:** The ask rules for discarding work and deleting branches.
- **Problem:** These are all allowed: `git push --delete origin x`, `git push -d origin x`, `git push --mirror`, `git branch --delete --force x`, `git reset --har HEAD~1`, `git clean --force` and `git checkout -f main`.
- **Fix:** Widen the two regexes: `push … (--delete|-d|--mirror)`, `branch … (-D|--delete … --force|-d … -f)`, `reset --har`, `clean (-…f|--force)`, `checkout (-f|--force)`.
- **Test:** Each command above is asked.
- **If we skip it:** A remote branch delete, or a mirror push that can force-update every branch, runs without a prompt.

### R6 — The CI gate passes having run nothing when a PR deletes package.json (proven)
- **File:** `templates/github/scripts/run-verify.mjs:33`
- **What this is:** The bootstrap rule that skips npm steps while a repo has no package.json yet.
- **Problem:** With base-branch steps `npm run typecheck` and `pnpm test` and a PR that removes package.json, both steps are skipped and the output is `Gate: PASS`. The deletion needs the approval label, but the label approves a governance-file change, not a run with no tests.
- **Fix:** Allow the skip only when the base branch has no package.json either.
- **Test:** Base has package.json, PR checkout has none: exit 1.
- **If we skip it:** A labelled PR can merge with no tests run.

### R7 — The mutation restore overwrites an edit made during the run (proven)
- **File:** `skills/mutation-test/mutation-runner.mjs:195-196` (`finally { writeFileSync(m.path, original) }`)
- **What this is:** After each mutation the runner writes the original bytes back.
- **Problem:** It doesn't check that the file still holds the mutated bytes. An IDE autosave or a parallel Claude edit during the test run is overwritten without a word. Repro: the command wrote `USER EDIT` into the file; the run said SURVIVED and the edit was gone.
- **Fix:** Before restoring, compare the file with the mutated buffer. If they differ, save the current bytes to a temp backup and throw `RestoreError` naming both files (exit 3).
- **Test:** A command that rewrites the mutated file ends in exit 3, and the backup holds its bytes.
- **If we skip it:** Real work can be lost silently, which the "restored byte for byte" promise is meant to prevent.

### R8 — Untrusted text that reaches a step through `$GITHUB_ENV` or a step output is not flagged (proven)
- **File:** `templates/github/scripts/workflow-rules.mjs:429-456`, `:534-538` (F10 rule)
- **What this is:** `wf-untrusted-input` follows untrusted PR text into `${{ }}` in a `run:` script.
- **Problem:** Step 1 runs `echo "T=$TITLE" >> "$GITHUB_ENV"` with `TITLE` from the PR title, step 2 runs `echo "${{ env.T }}"`: no finding. The same holds through `$GITHUB_OUTPUT` and `${{ steps.s.outputs.t }}`.
- **Fix:** Treat any `${{ env.X }}` or `${{ steps.*.outputs.* }}` in a `run:` script as untrusted when an earlier step of the job writes untrusted text to `$GITHUB_ENV` or `$GITHUB_OUTPUT`; or, simpler and fail-closed, flag every `${{ steps.*.outputs.* }}` and every `env.X` set through `$GITHUB_ENV` in a job with a privileged trigger.
- **Test:** Both workflows above give `wf-untrusted-input`.
- **If we skip it:** A script injection that goes through one hop passes the check.

### R9 — A mutation baseline uses the last entry's timeout for a shared command (proven)
- **File:** `mutation-runner.mjs:212`
- **What this is:** Each distinct command's unmutated baseline runs once.
- **Problem:** It runs with the `timeoutMs` of the last entry for that command. Entry 1 (60000 ms, slow suite) and entry 2 (500 ms, a mutation that may loop) share a command: the 1.5 s baseline gets 500 ms, times out, and the run stops with "baseline failed (timeout, exit 1)". The "exit 1" is taskkill's code on Windows and "exit null" on POSIX.
- **Fix:** Run each baseline with the largest `timeoutMs` among its entries, and leave the exit code out of the message for a timeout.
- **Test:** The two-entry list above runs both mutations.
- **If we skip it:** A valid list fails with "fix the tests first" while the tests pass.

### R10 — post-verdict reads only the first 100 PR comments (reasoned)
- **File:** `templates/github/scripts/post-verdict.mjs:145`
- **What this is:** The lookup that finds the verdict comment to update.
- **Problem:** On a PR with 100 comments before the first verdict, the verdict comment is never on page 1, so every run posts a new one. The update response's `ok` isn't checked either. The gate pages through all comments, so verdicts stay correct.
- **Fix:** Page the way `governance-gate.mjs:79-93` does, and fail on a non-ok response.
- **Test:** With a 101-comment first page, the existing verdict is updated, not duplicated.
- **If we skip it:** Busy PRs pile up verdict comments.

### R11 — The gate trusts a verdict marker in any github-actions comment (reasoned)
- **File:** `templates/github/scripts/governance-gate.mjs:36-41`
- **What this is:** The gate reads the latest verdict marker for the head SHA from comments by `github-actions[bot]`.
- **Problem:** Any other workflow in the consumer repo that posts PR text as `github-actions[bot]` can carry a forged marker. post-verdict's escaping (F1) covers only its own comment.
- **Fix:** Accept a marker only from the comment post-verdict made, identified by a fixed header line, and only when the marker is the comment's last line.
- **Test:** A bot comment without the header that holds a PASS marker is ignored.
- **If we skip it:** A second bot workflow that echoes PR text can turn BLOCK into PASS.

### R12 — Three exports nobody imports (proven)
- **Files:** `hooks/scripts/governance-policy.mjs:34` (`DEFAULT_TRUSTED_WRITE_PATHS`), `templates/github/scripts/governance-rules.mjs:148` (`DENY_CONTENT`) and `:160` (`ASK_CONTENT`)
- **What this is:** Symbols used only inside their own file; F15 didn't list them.
- **Problem:** They break the AGENTS.md rule "Export only what another file imports" (a whole-tree grep, tests included, finds no importer).
- **Fix:** Drop `export`.
- **If we skip it:** convention-reviewer flags them on the next change to these files.

## Nice to have

### R13 — `GOVERNANCE_AI_REVIEW=OFF` fails the PR (reasoned, fails closed)
- **File:** `governance-gate.mjs:26`
- **Problem:** GitHub compares strings in expressions case-insensitively, so `OFF` skips the review job, but the gate's `=== 'off'` doesn't see an opt-out and fails the PR for a missing verdict.
- **Fix:** Compare `.toLowerCase()`.

### R14 — `check` passes a site whose host isn't trusted (reasoned)
- **File:** `scripts/jira-tracker.mjs:54` (`jiraProblems`) vs `trustedApiBase`
- **Problem:** `site: "https://evil.example.com"` passes `check` (exit 0), then every Jira command exits 1 ("not trusted"), the same symptom F13 fixed for the shape. The trust rule depends on `JIRA_SITE` from the environment, which `check` deliberately doesn't read.
- **Fix:** In `check`, report a site that isn't an `.atlassian.net` host as a warning naming `JIRA_SITE`; keep exit 0 so `check` stays environment-free.

### R15 — A repo folder whose name starts with `..` is refused as "links outside" (proven, fails closed)
- **File:** `mutation-runner.mjs:51` (`rel.startsWith('..')`)
- **Problem:** `..cache/b.txt` passes the segment check at `:47` but is refused at `:51`.
- **Fix:** `rel === '..' || rel.startsWith('..' + path.sep)`.

### R16 — The verify skill's by-hand file list disagrees with the gate runner (reasoned)
- **File:** `skills/verify/SKILL.md:12` (step 2) vs `skills/verify/gate.mjs:33-38`
- **Problem:** Step 2 uses plain `git diff --name-only HEAD`. With rename detection a staged move `src/a.js` → `lib/a.js` lists only `lib/a.js`, and a non-ASCII path is quoted, so a `src/` conditional suite is skipped. Reachable only when the steps come from AGENTS.md.
- **Fix:** `git -c core.quotePath=false diff --name-only --no-renames HEAD` and `git -c core.quotePath=false ls-files --others --exclude-standard`.

### R17 — Fake-pass edges (proven)
- **File:** `templates/github/scripts/fake-pass-rules.mjs:132-137`
- **Problem:** `it\n  .only('x', …)` (chain across lines), `it.skipIf(true)(…)` and `test.runIf(false)(…)` give no finding. The last two are close to the documented D7 limit (conditional calls).
- **Fix:** Allow whitespace and newlines around the `.` in the chain; add `skipIf`/`runIf` to the skip modifiers.

Left out: the fake-pass check's own output is still read uncapped (`skills/verify/gate.mjs:150`); that was Francis's F16 decision (2026-10-19), not a finding.

---

**Verdict:** the 2026-10-17 findings are closed and guarded by tests. Fix the guard bypasses first: R1 (PowerShell) and R2 (`::$DATA`) on Windows, then R3 and R4.

**Lean:** -3 `export` keywords possible (R12); no dependencies to remove (there are none).

**Not checked:** the bodies of most tests (read by name and targeted grep); `jira-tracker.test.mjs`; the clarify, debug, tdd, to-spec and user-guide-update skills; the six agent files beyond a grep; `workflow-rules.mjs` after line 90 for new findings (F9/F10 areas were checked); `supply-chain-rules.mjs` and `supply-chain-lookups.mjs` after line 140; `CODEOWNERS`, the PR template and the other `templates/` examples; the bootstrap `_pr` fallbacks; the POSIX process-group kill; F2 end to end on GitHub.
