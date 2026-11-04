# Plan: ESP-145 gate passes when started from PowerShell

Final status: shipped. Branch: `fix/esp145-gate-from-powershell`.

## Goal
Make `bash-workflow-check.test.mjs` run its commands in Git Bash on Windows, as Claude Code's Bash tool does, so the gate gives the same result from PowerShell and Git Bash.

## Requirement references
- ESP-145 (AC1, AC2, AC3)

## Pre-plan checklist
- (a) New validation rules and format checks: n/a: this adds no validation rule or format check, only how a test helper finds its shell.
- (b) Database or infrastructure mechanisms the design relies on: Git's `bin/bash.exe` sitting three levels above `git --exec-path`. Proven on this machine: `git --exec-path` prints `C:/Program Files/Git/mingw64/libexec/git-core`, and `C:\Program Files\Git\bin\bash.exe` ran every probe. Throwaway run on 2026-11-03: with that folder first on PATH, the file went from 42 pass, 21 fail to 63 pass, 0 fail from PowerShell. CI's Windows jobs check the layout on a runner.
- (c) Docs and ADRs touched: none. Searched `plugins/usiatech-engineering/skills`, its README, `docs/adr` and the root README for "Git Bash" and "WSL". The one hit, `skills/release-steps/SKILL.md:46`, is about a PowerShell 5.1 redirect and is unrelated. No docs reviewer is configured.

## Acceptance criteria
- AC1: From PowerShell, with `bash` on PATH resolving to WSL, `node --test plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs` reports 63 pass, 0 fail (it was 42 pass, 21 fail).
  - Evidence: Shown. From PowerShell, `bash` on PATH at `C:\Users\mfsar\AppData\Local\Microsoft\WindowsApps\bash.exe`, `uname` says Linux: 63 pass, 0 fail; 42 pass, 21 fail before the change.
- AC2: The full gate passes from both PowerShell and Git Bash.
  - Evidence: Shown. Git Bash: `verify` gate PASS, `npm test` exit 0, 1928 pass, 0 fail, 4 skipped, both validates pass. PowerShell, final run with nothing else running: `npm test` exit 0, 1928 pass, 0 fail, 4 skipped, both validates pass. Two of four PowerShell runs timed out on `should fail closed when a lookup misses the deadline` (see Deviations).
- AC3: CI passes on its Linux and Windows jobs, with non-Windows platforms still using `bash`.
  - Evidence: Not known when this file was archived: CI runs on the PR, and its result is checked before the merge.

## Tasks
- [x] T1: Record the red state: `uname` from `bash` on PATH says Linux, and the file fails 21 tests from PowerShell (covers AC1; ESP-145)
- [x] T2: Add a module-private Git Bash lookup, using the `git` helper from `helpers.mjs`, and use it in `sh()` (covers AC1, AC3; ESP-145)
- [x] T3: Run the file and the full gate from both shells (covers AC1, AC2; ESP-145)

## Files
- `plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs`

## Commands and actions
- Branch `fix/esp145-gate-from-powershell` from `develop`.
- Jira: move ESP-145 to In Progress (transition 21).

## Out of scope
- `verify` skill text, and any change to `helpers.mjs`.
- Git installs without `bin/bash.exe`, such as MinGit: these fall back to `bash` from PATH and can still fail this way.
- Version bump and the README Versioning row: these happen in the develop to main release PR.

## Approved
- By: Francis · Date: 2026-11-03
- Route: small (cites ESP-145, 1 file, no new skill, module, service or public interface)

## Deviations
- `sh()` also rethrows ENOENT, from a `/code-review high` finding. Same file, not in the original tasks.
- `should fail closed when a lookup misses the deadline` timed out in two PowerShell gate runs, at 5818 ms and 8634 ms against its 5000 ms limit. It is outside this change and is tracked in ESP-146. The cause is not proven.

## Change log
- 2026-11-03: Francis said to do this task in the current session, after ESP-144.
- 2026-11-03: Pre-flight by `governance-reviewer` passed. Francis approved two changes from its notes: T2 calls the `git` helper rather than `execFileSync`, and T1 records `uname` from `bash` on PATH.
- 2026-11-03: `/code-review high` finding fixed in the same file: `sh()` rethrows ENOENT, so a missing shell no longer counts as a failed command.
- 2026-11-03: Francis's decisions at release. Review findings accepted as they are: silent fallback to `bash` on PATH, and `git` missing at module load (the file fails loudly). The timing test `should fail closed when a lookup misses the deadline` stays unchanged and goes to its own sub-task, ESP-146; AC2 takes one more PowerShell gate run with nothing else running. The 3 `error` entries in `.claude/governance-log.jsonl` (after-Bash workflow check skipped on background gate runs) are accepted as harmless, since no workflow file changed.
