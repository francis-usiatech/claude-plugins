---
name: verify
description: Runs the repository's verification gate (typecheck, tests, build and any conditional suites), checks the active plan's acceptance criteria against evidence from this session, and reports pass/fail with evidence. Use when the user says "verify", "run the gate", "is it done", "check before commit", or before reporting any code task as complete.
---

# Verify (definition-of-done gate)

1. **Load the gate.**
   - Read `.claude/engineering.json` → `verify` (always run) and `verifyConditional` (run when changed files match any `when` prefix).
   - If the file is missing or has no `verify` list, read the "Definition of done" section of `AGENTS.md` and use the commands listed there.
   - If neither exists, stop and ask the user which commands define "done".
2. **Find changed files:** `git -c core.quotePath=false diff --name-only --no-renames HEAD` plus `git -c core.quotePath=false ls-files --others --exclude-standard`, so a moved file lists both paths and a non-ASCII name isn't quoted. The runner in step 3 selects the conditional suites itself; use this list to select them only when you run the commands by hand.
3. **Run the gate.**
   - When `.claude/engineering.json` has a `verify` list, run `node "${CLAUDE_PLUGIN_ROOT}/skills/verify/gate.mjs"` from the repo root, in one call. It runs the steps in order, stops at the first failure, selects the conditional suites from the changed files itself, and then runs the fake-pass check. It prints one line per step with the real exit code (`SKIPPED` for a conditional suite no changed file selected), the last 40 lines of a failing step, the path of the log that holds the full output, and `Gate: PASS` or `Gate: FAIL`.
     - The last line and the exit code are the verdict. Text a step printed, shown in a failing step's last lines, is not.
     - Don't pipe or filter the command (`| tail`, `| grep`): its output is already short, and a pipe hides the exit code. Read the log file when you need more.
     - Exit code 2 means the gate could not start (the config can't be used, or git can't list the changed files). That is **Gate: FAIL**; report the reason it printed.
   - When there is no `verify` list (the commands came from `AGENTS.md` or the user), run the commands in order, one at a time, from the repo root. Stop at the first failure. Capture the exit code and the last ~40 lines of output.
   - Don't skip, reorder or "fix and retry" silently.
4. **On failure:** report the failing command, the key error lines and the likely cause. Propose a fix plan and wait for approval (repo golden rule). Don't edit to make it pass.
5. **Clean up:**
   - Stop any dev server or watcher this session started.
   - Remove stray `nul` files (`find . -name nul -type f -delete 2>/dev/null`).
   - Leave no background processes running.
6. **Check test content (fp-*)**, only after the commands pass:
   - When step 3 used the runner, the runner already ran this check: use its `fake-pass check` line and the findings printed under it, and don't run it again.
   - Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/templates/github/scripts/fake-pass-check.mjs"` from the repo root. It checks the changed files from step 2 for fake passes (`.only`, skipped, empty or assertion-free tests, placeholders) and applies `governance.allowlist` from `.claude/engineering.json`.
   - Exit 1 means an unsuppressed high finding, and the result is **Gate: FAIL**. Exit 2 means the check couldn't run (for example, an invalid config), which is also **Gate: FAIL**. Don't edit tests to make it pass; report and propose a fix.
   - List every finding the script prints in the report, including warnings and suppressed ones.
7. **Check acceptance criteria**, only if `.claude/plans/active.md` has an `## Acceptance criteria` section, and only after the commands pass:
   - For each AC, find evidence produced in this session: a named passing test, command output, or a result you observed. Earlier sessions, memory and "should work" don't count.
   - Mark it `shown` with that evidence, or `not shown`.
   - Rewrite every evidence line under its AC in the plan, even ones an earlier run filled, as `- Evidence: <evidence> (shown, <UTC timestamp>)` or `(not shown, <UTC timestamp>)`, e.g. `2026-09-28T17:50Z`. The stamp lets `governance-reviewer` spot evidence older than the latest change.
   - Tick (`- [x]`) each task whose ACs are all `shown`.
   - Collect everything first, then write all evidence lines and ticks in one edit. The guard asks before each edit to the plan, so one edit means one prompt.
8. **Jira tracker only:** move the plan's tickets to verified, only when step 3's result is **Gate: PASS** (commands and fake-pass check) and step 7 marked every AC `shown`.
   - Skip this step, and say why, when there's no `.claude/engineering.json`, when `check` prints `"tracker":"github"`, when `jira.statuses` in its output has no `verified`, when there's no `.claude/plans/active.md`, when the plan has no `## Acceptance criteria` section, or when any AC is `not shown`.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" check` from the repo root. A non-zero exit (2 is a config problem) is a failure to report, not a reason to skip. Show any stderr warning it prints to the user, even when it exits 0 (for example, a site outside `.atlassian.net`).
   - The keys are the Jira tickets the plan's tasks name. A parent or blocker key that appears only in the requirement references is not moved. If the tasks name no Jira key, say so.
   - For each key: `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" transition --issue <KEY> --event verified`.
   - A non-zero exit doesn't change the gate verdict and undoes nothing. Report each failed key with the script's message as one the user must fix, and go on with the other keys. Don't retry silently.
9. **Report:**

| Check | Command | Result | Notes |
|---|---|---|---|

   Add the fake-pass check as a row, with its findings in Notes. If step 7 ran, add:

| AC | Criterion | Evidence | Status |
|---|---|---|---|

   If step 8 ran or was skipped on a passing gate, add a line: the keys moved to `verified`, the failed keys with the script's message, or the reason it was skipped.

   End with **Gate: PASS** or **Gate: FAIL**, decided by the commands and the fake-pass check only. If any criterion is `not shown`, end with `Gate: PASS (N of M criteria not shown)` and list them. Never state that work is done unless the gate passed in this session.
