---
name: verify
description: Runs the repository's verification gate (typecheck, tests, build and any conditional suites), checks the active plan's acceptance criteria against evidence from this session, and reports pass/fail with evidence. Use when the user says "verify", "run the gate", "is it done", "check before commit", or before reporting any code task as complete.
---

# Verify (definition-of-done gate)

1. **Load the gate.**
   - Read `.claude/engineering.json` → `verify` (always run) and `verifyConditional` (run when changed files match any `when` prefix).
   - If the file is missing, read the "Definition of done" section of `AGENTS.md` and use the commands listed there.
   - If neither exists, stop and ask the user which commands define "done".
2. **Find changed files:** `git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`. Use them to select conditional suites.
3. **Run the commands in order**, one at a time, from the repo root. Stop at the first failure.
   - Capture the exit code and the last ~40 lines of output.
   - Don't skip, reorder or "fix and retry" silently.
4. **On failure:** report the failing command, the key error lines and the likely cause. Propose a fix plan and wait for approval (repo golden rule). Don't edit to make it pass.
5. **Clean up:**
   - Stop any dev server or watcher this session started.
   - Remove stray `nul` files (`find . -name nul -type f -delete 2>/dev/null`).
   - Leave no background processes running.
6. **Check acceptance criteria**, only if `.claude/plans/active.md` has an `## Acceptance criteria` section, and only after the commands pass:
   - For each AC, find evidence produced in this session: a named passing test, command output, or a result you observed. Earlier sessions, memory and "should work" don't count.
   - Mark it `shown` with that evidence, or `not shown`.
   - Rewrite every evidence line under its AC in the plan, even ones an earlier run filled, as `- Evidence: <evidence> (shown, <UTC timestamp>)` or `(not shown, <UTC timestamp>)`, e.g. `2026-09-28T17:50Z`. The stamp lets `governance-reviewer` spot evidence older than the latest change.
   - Tick (`- [x]`) each task whose ACs are all `shown`.
   - Collect everything first, then write all evidence lines and ticks in one edit. The guard asks before each edit to the plan, so one edit means one prompt.
7. **Report:**

| Check | Command | Result | Notes |
|---|---|---|---|

   If step 6 ran, add:

| AC | Criterion | Evidence | Status |
|---|---|---|---|

   End with **Gate: PASS** or **Gate: FAIL**, decided by the commands only. If any criterion is `not shown`, end with `Gate: PASS (N of M criteria not shown)` and list them. Never state that work is done unless the gate passed in this session.
