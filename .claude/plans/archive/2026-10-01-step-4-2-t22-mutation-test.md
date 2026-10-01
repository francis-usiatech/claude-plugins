# Plan: Step 4.2 #22: mutation-test skill, runner and 0.9.0

## Goal
Make the hand-run B9/B10 `mutate*.cjs` method a step the plugin ships: a `mutation-test` skill in which Claude picks the fix points and writes a mutation list, and a zero-dependency runner that applies each mutation, reports CAUGHT/SURVIVED/NOT-FOUND/TIMEOUT/ERROR and restores every file byte for byte. Release the whole of step 4.2 as 0.9.0.

## Requirement references
- Spec `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (Status: approved): R12, R13, R14, R15, R16, R17, R18 (mutation-test and version parts); AC11, AC12, AC13, AC14, AC15; D9, D10, D11
- ADR 0002 `docs/adr/0002-fake-pass-checks-fail-the-gate.md` (context only; nothing in this ticket fails a gate)
- Ticket #22 (blocked by #21, shipped in PR #25)
- Roadmap step 4.2 (B26)

## Acceptance criteria
- AC1 (spec AC11, R13): A test in `tests/mutation-runner.test.mjs` builds a temp git repo whose test command fails unmutated. The runner exits 1 and prints "baseline failed". It applies no mutation, and every listed file is byte-identical before and after (Buffer compare).
  - Evidence: mutation-runner.test.mjs "should stop with \"baseline failed\"…": exit 1, "baseline failed", no CAUGHT/SURVIVED lines, guard-lf/guard-crlf Buffers equal and git status unchanged (shown, 2026-10-01T18:47Z)
- AC2 (spec AC12, R14): Against a temp fixture module and its `node --test` tests, one run reports:
  - removing a tested guard → `CAUGHT`
  - a no-op mutation (comment text) → `SURVIVED`
  - a find string that occurs 0 times and one that occurs 2 times → `NOT-FOUND` each
  - a command that sleeps past a short `timeoutMs` → `TIMEOUT`, with the child process tree killed
  - a command that can't start, or a file that can't be read or written → `ERROR`

  The run exits 0, because survivors never block (D10). An invalid list exits 2 before touching any file. Invalid means: bad JSON, a missing field, an absolute path, or a path outside the repo root or through `..`.
  - Evidence: mutation-runner.test.mjs statuses test: CAUGHT, SURVIVED, NOT-FOUND 0 matches, NOT-FOUND 2 matches, TIMEOUT (60 s sleeper ended in ~4 s total on Windows, so the tree was killed), ERROR (unreadable file); exit 0. Invalid-list test: bad JSON, no mutations, missing find, absolute path, ../ path, bad timeout each exit 2, no command ran (marker absent), files unchanged. Deviation: a command that can't start fails the baseline (exit 1) before any mutation, so ERROR is shown through the unreadable-file case (shown, 2026-10-01T18:47Z)
- AC3 (spec AC13, R15): The runner runs over a CRLF fixture and an LF fixture, including a mutation whose test command crashes (non-zero exit with stderr) and a run cancelled mid-mutation through the runner's abort signal (the SIGINT/SIGTERM path). Afterwards every file matches its original byte for byte, and `git status --porcelain` in the fixture repo is unchanged.
  - Evidence: mutation-runner.test.mjs restore tests: LF guard, CRLF guard and CRLF crash mutations all CAUGHT with both files byte-identical and git status unchanged; runMutations aborted mid-mutation (marker seen, file mutated) returns interrupted with only "hangs" run and the CRLF file restored. Self-mutation of the runner: 4/5 CAUGHT; the survivor was a redundant path check, removed in refactor (shown, 2026-10-01T18:47Z)
- AC4 (spec AC14, R12, R16, R17): Structure tests in `tests/plugin-structure.test.mjs` confirm:
  - `skills/mutation-test/SKILL.md` exists, with frontmatter and a description that names its triggers
  - it documents the mutation list format (label, file, find, replace, command, optional `timeoutMs`), the runner path `${CLAUDE_PLUGIN_ROOT}/skills/mutation-test/mutation-runner.mjs`, and reporting each SURVIVED mutation as a missing test with a question to the user
  - `skills/release/SKILL.md` stage 2 suggests `mutation-test` for the D11 paths (`*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs`, `*guard*.mjs`, `governance.askPaths`) as a suggestion, not a gate
  - Evidence: plugin-structure "step-4.2 mutation-test (#22, AC14, R18)" 5/5 plus skill frontmatter and README components tests (shown, 2026-10-01T18:47Z)
- AC5 (spec AC15, R18): Gate.
  - `npm test` passes locally, and CI passes 4/4 (Node 20/22, ubuntu/windows)
  - `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0
  - `package.json` gains no `dependencies`
  - the plugin README has a `mutation-test` component row, the runner's report format and a 0.9.0 version row with upgrade steps
  - `plugin.json`, `marketplace.json`, the plugin README and the root README all say 0.9.0 (the existing structure test enforces this)
  - `fake-pass-check.mjs` on the branch gives no unsuppressed high finding
  - Evidence: npm test 658/658 exit 0 (after the stage-2 fix set), 0 skipped/todo/cancelled; both claude plugin validate runs exit 0; package.json has no dependencies; fake-pass-check.mjs exit 0, no high finding (1 fp-placeholder warning: the #21 test data '// TODO' at plugin-structure.test.mjs:457); version test passes at 0.9.0. CI 4/4: pending PR (shown locally, 2026-10-01T19:21Z)
## Tasks
- [x] T1: Write the runner tests first (red): baseline failure, all five statuses, invalid list, CRLF/LF byte restore with a crash and an abort, `git status` unchanged. Fixtures are built in `os.tmpdir()` with exact bytes rather than committed, because `core.autocrlf=true` would rewrite committed CRLF fixtures. (covers AC1–AC3; #22)
- [x] T2: Implement `skills/mutation-test/mutation-runner.mjs` with Node built-ins only:
  - read the list from `--list <file.json>`, validate it, resolve paths under the repo root (`git rev-parse --show-toplevel`)
  - run the baseline once per distinct command
  - snapshot each listed file as a Buffer, apply a mutation only when `find` occurs exactly once
  - run the command with `spawn(shell)` and a timeout that kills the tree (`taskkill /T /F` on Windows, process group elsewhere)
  - restore in `finally` after every mutation, and on SIGINT/SIGTERM through an AbortController
  - print one line per mutation plus a summary
  - exit codes: 0 run complete, 1 baseline failed, 2 invalid list

  It never stages or commits anything. It runs from the plugin and isn't copied into consumer repos (D9). (covers AC1–AC3; #22)
- [x] T3: Write `skills/mutation-test/SKILL.md`:
  - triggers
  - how to pick fix points (conditions, guards and early returns the diff adds or the plan's ACs depend on)
  - the list format with an example
  - the run command
  - reading the report: SURVIVED → a missing test, ask the user whether to add one; never block (D10)
  - NOT-FOUND/ERROR → fix the list

  Add structure tests. (covers AC4; #22)
- [x] T4: `skills/release/SKILL.md` stage 2: add the D11 suggestion, plus a structure test. (covers AC4; #22)
- [x] T5: Docs and the version bump:
  - plugin README: `mutation-test` component row, runner report format and exit codes, 0.9.0 version row with upgrade steps (re-copy `templates/github/scripts/` for the fp-* CI step; no new config)
  - root README version 0.9.0
  - `plugin.json` and `marketplace.json` 0.9.0
  - roadmap: step 4.2 row "Shipped v0.9.0", backlog A6 `Done (step 4.2, #20/#21)` and B26 `Done (step 4.2, #22)`

  (covers AC5; #22)
- [x] T6: Run the gate: `npm test`, both validate runs, the fake-pass check, and the `dependencies` check. (covers AC5; #22)

## Files
- `plugins/usiatech-engineering/skills/mutation-test/SKILL.md`
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `README.md`
- `docs/roadmap.md`
- `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (requirement reference only; not edited)

## Commands and actions
- Branch `feature/step-4-2-mutation-test` off `develop`; the PR targets `develop` (new flow, 2026-10-01).
- After Francis promotes `develop` → `main`: tag `v0.9.0` on `main` (the repo's existing semver tags) and push the tag to origin.
- Then `claude plugin marketplace update usiatech` and `claude plugin update usiatech-engineering@usiatech` (these fetch from GitHub).
- No dependency adds. No network in the runner or its tests.

## Out of scope
- Generated mutations or third-party frameworks such as Stryker (spec non-goal).
- Running mutation testing in CI, or blocking a commit on a survivor (D10).
- Copying the runner into consumer repos' CI kit (D9).
- Follow-up #26 (existing fp-* findings in this repo's tests).
- Step 4.3 (#13 guard gaps).
- Applying the PR #28 review nits (`persist-credentials`, `concurrency`).

## Approved
- By: Francis · Date: 2026-10-01
- Route: large (adds a new skill and a shipped runner; the spec and ticket #22 already exist)

## Change log
- 2026-10-01: drafted from ticket #22. Pre-flight PASS. Applied its 2 low fixes: the tag push and the plugin-update fetches are listed as actions, and the roadmap A6/B26 backlog rows are added to T5.
- 2026-10-01: implementation deviations (stage 1 PASS): (1) AC2's "a command that can't start → ERROR" is covered by the baseline instead: such a command fails the unmutated run (exit 1, nothing mutated), so ERROR is shown through the unreadable-file case. (2) The runner also exits 130 when interrupted (R15 interrupt path), beyond T2's 0/1/2. (3) Stage-1 nit: plugin README design-records line updated from "Nothing here has shipped yet" to "Shipped in 0.9.0". Within plan Files; no scope change.
- 2026-10-01: stage 2: silent-failure FAIL (second Ctrl+C skips the restore), security PASS WITH NITS (Medium: list commands run unseen), conventions PASS WITH NITS. Francis approved the whole fix set: A interrupt handling (persistent handlers, notice, SIGHUP, named restore failure exit 3 with partial report); B command trust (SKILL.md rule: show the distinct commands and confirm; runner prints them; recovery line); C+D path and kill hardening (reject .git, resolve symlinks, more path cases, narrow kill catches, signal-killed run → ERROR, abort wins, stronger abort test); E doc nits. Within plan Files; no scope change.
- 2026-10-01: fix set applied test-first (6 new red tests + 2 structure tests, then green). Self-mutation of the fix points: 8/9 CAUGHT, 1 NOT-FOUND (list escaping; the check is covered by the UNC case on Linux). Narrow re-reviews: silent-failure PASS, security PASS WITH NITS. Low-confidence notes left for the PR: a non-128 taskkill failure can hang a timed-out run; a committed link into .git passes the literal .git check.

## Final status
- Shipped: PR #29 into `develop` (merge 3766687), promoted to `main` by Francis in PR #30 (merge 6105c7a), tagged `v0.9.0` on 2026-10-01. CI 4/4 green on `main` (ubuntu and windows, Node 20 and 22). `npm test` 658/658. Issue #22 closed by PR #29. Installed plugin updated to 0.9.0.
- Acceptance criteria: AC1–AC5 all shown (evidence above; AC5 CI shown on `main` at 6105c7a).
- Deviations:
  - AC2's "command that can't start → ERROR" is covered by the baseline (exit 1, nothing mutated); ERROR is shown through the unreadable-file case.
  - The runner also exits 130 when interrupted and 3 when a restore fails, beyond T2's 0/1/2 (stage-2 fix set, approved).
  - Stage-2 fix set A–E (interrupt restore, command trust, path and kill hardening, doc nits) applied test-first; see Change log.
  - First ticket under the new develop → main flow (2026-10-01).
  - Open low-confidence notes, not fixed: a non-"not found" taskkill failure can leave a timed-out run waiting; a committed link into `.git` passes the literal `.git` check.
