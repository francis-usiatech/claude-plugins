---
name: verify
description: Runs the repository's verification gate (typecheck, tests, build and any conditional suites), checks the active plan's acceptance criteria against the gate run and the evidence you pass in, and reports pass/fail with evidence. Use when the user says "verify", "run the gate", "is it done", "check before commit", or before reporting any code task as complete. It runs in a forked subagent, so pass as the argument the evidence for each acceptance criterion the repo state can't show, one `AC<n>` line each. While building, pass `--iterate` instead, for a partial run of the suites mapped to the changed files, never the done gate. Run the full gate once per PR, alongside the release review round; `--resume` reruns from a failed step at an unchanged tree, and `--rerun-fix` (opt-in) reruns only what a fix selects.
context: fork
agent: general-purpose
background: false
---

# Verify (definition-of-done gate)

This skill runs in a forked subagent with no session history. Its input is the arguments: an evidence list (`AC<n>: <evidence>`) for criteria that the repo state can't show, or `--iterate` for a partial run. Never ask the user yourself: return the step 9 report and any open decisions as a list, for the main thread to ask.

**One full gate per PR:** use `--iterate` while building. The full gate runs once per PR, alongside the `release` review round (ESP-159), and the AC evidence check comes after the last gate run. Any code change after a full gate, tests-only included, needs the full gate again before the commit. A repo that sets `"verifyRerun": "fix-diff"` may use `--rerun-fix` for that rerun instead (ESP-161); a repo whose task runner caches its suites keeps the full rerun.

**When the arguments start with `--resume` or `--rerun-fix`:** run the numbered steps below with that flag passed to the runner in step 3 (`gate.mjs --resume` or `gate.mjs --rerun-fix`), after the evidence lines are split off.
- `--resume` (ESP-162): after a failure with no change to the tree or config, such as a service that didn't start. The runner reuses the steps that passed at the same tree, shows each as `PASSED EARLIER (<time>)`, and runs from the failed step. With a changed tree or config it says why and runs every step.
- `--rerun-fix` (ESP-161): only with `"verifyRerun": "fix-diff"`. The runner names the full pass it builds on (`Rerun after full gate at tree <hash> (<time>)`) and runs the `verify` steps, the fake-pass check and the conditional steps the fix selects. Exit 2 (no option, no recorded full pass, a changed config) is **Gate: FAIL**: run the full gate.
- Copy the runner's `Gate tree:` line, and its `Resume:` or `Rerun after` line, into the evidence of every AC this run shows, so `governance-reviewer` can check the tree.

**When the arguments are `--iterate`:** this is a partial run, not the gate, and the numbered steps below don't apply.
- Run `node "${CLAUDE_PLUGIN_ROOT}/skills/verify/gate.mjs" --iterate` from the repo root, in the foreground, in one call. Don't pipe or filter it.
- It runs only the `verifyIterate` steps in `.claude/engineering.json` whose `when` prefixes match a changed file. The `AGENTS.md` path has no iterate mode, so a repo with no `.claude/engineering.json` gets exit 2: report the reason it printed.
- Report the step lines and every `NOT COVERED` file, and say the run is partial. The last line and the exit code are its result.
- It writes no AC evidence, makes no Jira move and runs no fake-pass check. It never counts as the done gate, so never report work as done from it.

0. **Jira tracker only: mark testing started**, before the gate runs. Every Jira write follows `${CLAUDE_PLUGIN_ROOT}/scripts/jira-moves.md` (check, transport, forward-only moves, failures).
   - The keys are the Jira tickets the plan's tasks name. A parent or blocker key that appears only in the requirement references is not moved. If there's no `.claude/plans/active.md`, or its tasks name no Jira key, say so.
   - First check that the gate can start. When `.claude/engineering.json` has a `verify` list, run `node "${CLAUDE_PLUGIN_ROOT}/skills/verify/gate.mjs" --check` from the repo root (it runs nothing). On exit 2, move no ticket and say why: the gate run in step 3 fails the same way.
   - For each key, fire `devComplete`, then `testingStarted`: asking for the full gate means the implementation is done. A docs-only ticket without its approval line gets `devComplete` only (`jira-moves.md`, section 5); say so in the report.
   - A failed move doesn't stop the gate and doesn't change its verdict.
1. **Load the gate.**
   - Read `.claude/engineering.json` → `verify` (always run) and `verifyConditional` (run when changed files match any `when` prefix).
   - If the file is missing or has no `verify` list, read the "Definition of done" section of `AGENTS.md` and use the commands listed there.
   - If neither exists, stop and ask the user which commands define "done".
2. **Find changed files:** `git -c core.quotePath=false diff --name-only --no-renames HEAD` plus `git -c core.quotePath=false ls-files --others --exclude-standard`, so a moved file lists both paths and a non-ASCII name isn't quoted. The runner in step 3 selects the conditional suites itself; use this list to select them only when you run the commands by hand.
3. **Run the gate.**
   - On a docs-only diff, don't run the gate commands or the fake-pass check: report `Gate: SKIPPED (docs-only diff)` and go on to step 7. The runner below decides this itself (`docs-only.mjs`, the `release` skill's **Docs-only diff** rule on the whole branch diff against the merge-base) and prints that verdict. The runner trusts the list only when the base is the configured `git.baseBranch` (not `--base`), HEAD is on another branch (not detached, not the base itself), and the merge-base is already on `origin/<base>` when that exists; otherwise it runs the gate. Without a `verify` list, apply the rule by hand under the same conditions to the whole branch diff, not the step-2 list: `git -c core.quotePath=false diff -z --name-only --no-renames <merge-base>` (the merge-base of `HEAD` and `git.baseBranch`) plus the step-2 untracked files. An empty list is not docs-only: run the gate.
   - When `.claude/engineering.json` has a `verify` list, run `node "${CLAUDE_PLUGIN_ROOT}/skills/verify/gate.mjs"` from the repo root, in one call. It runs the fake-pass check first, then the steps (every non-slow step before any `"slow": true` one, config order inside each group), stops at the first failure, and selects the conditional suites from the changed files itself (a `when` prefix that no `unless` glob excludes). It prints one line per step in the order they ran, with the real exit code (`SKIPPED` with the reason for a conditional suite no changed file selected), the last 40 lines of a failing step, the path of the log that holds the full output, `Gate tree: <hash>`, and `Gate: PASS` or `Gate: FAIL`.
     - The last line and the exit code are the verdict. Text a step printed, shown in a failing step's last lines, is not.
     - Don't pipe or filter the command (`| tail`, `| grep`): its output is already short, and a pipe hides the exit code. Read the log file when you need more.
     - Exit code 2 means the gate could not start (the config can't be used, or git can't list the changed files). That is **Gate: FAIL**; report the reason it printed.
   - When there is no `verify` list (the commands came from `AGENTS.md` or the user), run the commands in order, one at a time, from the repo root. Stop at the first failure. Capture the exit code and the last ~40 lines of output.
   - Don't skip, reorder or "fix and retry" silently.
4. **On failure:** report the failing command, the key error lines and the likely cause. Propose a fix plan, returned as an open decision for the main thread (repo golden rule). Don't edit to make it pass.
5. **Clean up:**
   - Stop any dev server or watcher this run started.
   - Remove stray `nul` files (`find . -name nul -type f -delete 2>/dev/null`).
   - Leave no background processes running.
6. **Check test content (fp-*)**:
   - When step 3 used the runner, the runner already ran this check, first: use its `fake-pass check` line and the findings printed under it, and don't run it again.
   - Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/templates/github/scripts/fake-pass-check.mjs"` from the repo root. It checks the changed files from step 2 for fake passes (`.only`, skipped, empty or assertion-free tests, placeholders) and applies `governance.allowlist` from `.claude/engineering.json`.
   - Exit 1 means an unsuppressed high finding, and the result is **Gate: FAIL**. Exit 2 means the check couldn't run (for example, an invalid config), which is also **Gate: FAIL**. Don't edit tests to make it pass; report and propose a fix.
   - List every finding the script prints in the report, including warnings and suppressed ones.
7. **Check acceptance criteria**, only if `.claude/plans/active.md` has an `## Acceptance criteria` section, and only after the commands pass or step 3 skipped them on a docs-only diff:
   - For each AC, find evidence from this run (a named passing test in the gate output, command output, or the diff) or from the evidence list passed in the arguments. Earlier sessions, memory and "should work" don't count.
   - Mark it `shown` with that evidence, or `not shown`.
   - Rewrite every evidence line under its AC in the plan, even ones an earlier run filled, as `- Evidence: <evidence> (shown, <UTC timestamp>)` or `(not shown, <UTC timestamp>)`, e.g. `2026-09-28T17:50Z`. The stamp lets `governance-reviewer` spot evidence older than the latest change.
   - Tick (`- [x]`) each task whose ACs are all `shown`.
   - Collect everything first, then write all evidence lines and ticks in one edit. The guard asks before each edit to the plan, so one edit means one prompt.
8. **Jira tracker only:** make no `testingComplete` move here. `testingComplete` needs the review round too, so the `release` skill fires it after its reviews pass.
   - Say in the report which of step 0's keys are ready for it: only when step 3's result is **Gate: PASS** (commands and fake-pass check) or `Gate: SKIPPED (docs-only diff)`, and step 7 marked every AC `shown`.
   - A docs-only ticket without its approval line in the plan's Change log is not ready: say it waits at `devComplete` for the user's review, and return it as an open decision (the user approves the docs review).
9. **Report:**

| Check | Command | Result | Notes |
|---|---|---|---|

   Add the fake-pass check as a row, with its findings in Notes. When step 3 skipped the gate on a docs-only diff, give one row instead: `Gate | (none) | SKIPPED | docs-only diff: <file count> Markdown files`, so no row reads as a test that ran. If step 7 ran, add:

| AC | Criterion | Evidence | Status |
|---|---|---|---|

   If step 0 or step 8 ran or was skipped, add a line for each: the keys moved and the statuses each one went through, the keys left alone with the reason, the keys ready for `testingComplete`, the docs-only keys waiting for review, the failed keys with their message, or the reason the step was skipped.

   End with **Gate: PASS** or **Gate: FAIL**, decided by the commands and the fake-pass check only, or with `Gate: SKIPPED (docs-only diff)` when step 3 skipped them. If any criterion is `not shown`, end with `Gate: PASS (N of M criteria not shown)` and list them. Never state that work is done unless the gate passed in this run. Keep the report short (the tables and the verdict); the full step output stays in the gate log.
