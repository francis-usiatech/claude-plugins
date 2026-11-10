# Plan: Speed batch — Jira stage events, connector transport, honest gate runner


## Final status
- Status: shipped (closed 2026-11-09, in the same commit as the work)
- Branch: `feature/speed-batch`, PR into `develop`
- Acceptance criteria: AC1–AC17 all shown (full gate 2026-11-09T23:46Z, Gate: PASS). AC14 exit 130 shown by code reference; its interrupt test is POSIX-only and skipped on Windows.
- Release review: stage 1 governance-reviewer FLAG (unchecked background-command windows) acknowledged by Francis; stage 2 convention, silent-failure and security reviewers PASS with nits; mutation-test 8 mutations, 2 survivors closed by new tests; governance-only re-review of that fix PASS.
- Jira: ESP-36, 53, 54, 55, 56, 58, 61, 65, 104, 112, 116 moved In Progress → In Testing (testingComplete, connector, transition 31).
- Deviations: `testingComplete` moved from verify to release (code review fix, Change log); gate-steps.mjs split out of gate.mjs; the security note on quoting the Jira status name in jira-moves.md goes to a follow-up ticket.

## Goal
Ship the eleven "Speed: less manual work and faster runs" tickets in one PR: Jira tickets move at every stage through a configured transport (connector by default), and the local gate runner never reports a pass for something it did not check.

## Requirement references
- Spec `docs/specs/2026-11-09-speed-batch.md` (Status: approved 2026-11-09), R1–R15, AC1–AC16
- Jira: ESP-36, ESP-53, ESP-54, ESP-55, ESP-56, ESP-58, ESP-61, ESP-65, ESP-104, ESP-112, ESP-116
- ADR-0003 (Jira ticket tracker), extended by R1/R2
- ADR-0002 (fake-pass checks fail the gate), extended by R12 (a missing scan count fails the gate)

## Pre-plan checklist
- (a) New validation rules and format checks:
  - `tickets.jira.transport`, the five stage events + `verified` alias + `merged`, `--type`/`--parent`: the only validator is `validateTicketsConfig`/`EVENTS` in `scripts/jira-tracker.mjs`; callers and fixtures searched: `tests/jira-tracker.test.mjs` (only test file using `statuses`), this repo's `.claude/engineering.json`, `templates/engineering.json` `$comment`. The guard's per-key validation (`governance-rules.mjs`) does not look inside `tickets`, so it needs no change.
  - Near-miss step-list keys and chained `run`: callers of the gate config searched (`verifyConditional` appears in `skills/verify/gate.mjs`, `templates/github/scripts/run-verify.mjs`, `governance-rules.mjs`, `tests/gate.test.mjs`, `tests/run-verify.test.mjs`). The new rules apply to the local gate runner only; `run-verify.mjs` (CI) is not changed, so subscriber CI configs are unaffected. This repo's own `verify`/`verifyIterate` entries use no `;` or single `&` (checked).
  - Jira key as a requirement reference: `DEFAULT_REF_PATTERN` in `governance-checks.mjs`; callers/fixtures searched: `tests/governance-checks.test.mjs`, README, `templates/engineering.json`, `docs/roadmap.md` (mention only).
- (b) Database or infrastructure mechanisms: n/a: no database or infrastructure. The ESP-58 Windows kill-failure path is proven with an injected `kill` function (the `kill` option `runCommand` already takes), not a spike; a real elevated process is deferred per the spec.
- (c) Docs and ADRs touched (search of `docs/` and READMEs for `tickets`, `statuses`, `verified`, `gate.mjs`, `expectNoDiff`, `transport`): `docs/adr/0003-jira-ticket-tracker.md`, `docs/adr/0002-fake-pass-checks-fail-the-gate.md` (scan-count rule), `plugins/usiatech-engineering/README.md` (Jira tracker, gate runner sections and changelog row), `templates/engineering.json` `$comment`, `docs/specs/2026-10-09-jira-ticket-tracker.md` (read only; superseded parts noted in ADR-0003, not edited).

## Acceptance criteria
- AC1 (spec AC1, R1): `jira-tracker.mjs check` with no `transport` prints `"transport":"connector"`; with `"api"` prints `"transport":"api"`; with `"rest"` exits 2 naming the key. Unit tests cover all three.
  - Evidence: gate run: "transport setting (ESP-104 AC1)" passed: "should default to the connector and print it on check", "should print the api transport when it is set", "should exit 2 on any other transport, naming the key" (shown, 2026-11-09T23:46Z)
- AC2 (spec AC2, R2): a skill-text test confirms that on the connector path the approve-plan, verify, release-steps and to-tickets skills name no script `transition`, `comment` or `create` call, and the api path names no MCP call; an existing test still shows a missing `JIRA_EMAIL` reported as a failure on the api path.
  - Evidence: gate run: "should keep the connector path free of script writes and the api path free of MCP calls (AC2)", "should send every move and comment through the shared procedure (AC2)" and "should still report a missing JIRA_EMAIL as a failure on the api transport (ESP-104 AC3)" passed (shown, 2026-11-09T23:46Z)
- AC3 (spec AC3, R3): `check` accepts the five stage events plus `verified` and `merged`, maps `verified` to `testingComplete` in its output, exits 2 when both `verified` and `testingComplete` are set, and prints a skip message for an unmapped event. Unit tests cover each case; this repo's `.claude/engineering.json` passes `check` unchanged.
  - Evidence: gate run: "stage events and the verified alias (ESP-116 AC3)" passed (five events plus merged, verified mapped to testingComplete, both set reported, this repo's config accepted unchanged); "should say so for an event with no configured status" passed (shown, 2026-11-09T23:46Z)
- AC4 (spec AC4, R4): a skill-text test confirms each skill fires its event at the stated step (clarify, to-spec, to-tickets, approve-plan planning mode before the draft → `started`; approve-plan again at approval; `devComplete` before the verification run; `testingStarted` at the start of verify; `testingComplete` only on Gate PASS with all ACs shown; `released` only after the user's confirmation).
  - Evidence: gate run: "should fire started from clarify, to-spec, to-tickets and approve-plan (AC4)", "should fire devComplete and testingStarted before the gate runs, testingComplete only on a pass (AC4)", "should fire merged after the merge and released only after the user confirms (AC4)" passed (shown, 2026-11-09T23:46Z)
- AC5 (spec AC5, R5): unit tests with a fake Jira client show no move at or past the target, a two-step walk in order with each step reported, and a failed intermediate step stopping the walk reported by key; the connector-path skill text states the same order and no-backwards rule.
  - Evidence: gate run: "forward-only walk (ESP-116, ESP-112 AC5)" passed (at/past target untouched, two-step walk reported, failed step stops the walk naming the key); "should tell the connector path the walk order and the no-backwards rule (AC5)" passed (shown, 2026-11-09T23:46Z)
- AC6 (spec AC6, R6): `create --type Bug --parent ESP-1` sends that type and parent; an invalid type or parent exits 2 before any network call; to-tickets reads per-ticket type and parent with config defaults.
  - Evidence: gate run: "create --type and --parent (ESP-65 AC6)" passed (type and parent sent, invalid type/parent exit 2 before any call); "should read each ticket type and parent with the config as default, checked before filing (AC6)" passed (shown, 2026-11-09T23:46Z)
- AC7 (spec AC7, R7): `tests/governance-checks.test.mjs` shows `ESP-24` accepted for a Jira-tracker repo, `XESP-24` rejected, and the error message naming Jira keys.
  - Evidence: gate run: governance-checks "Jira keys" passed: "should accept a key of the configured project in a Jira-tracker repo", "should reject a key inside a longer word or with no number and name Jira keys in the error", "should fail on a Jira tracker with no usable project key" (shown, 2026-11-09T23:46Z)
- AC8 (spec AC8, R8): setup-engineering has the no-`tickets` warning; a skill-text test checks it.
  - Evidence: gate run: "should warn in setup-engineering that no tickets section means no Jira steps (AC8)" passed (shown, 2026-11-09T23:46Z)
- AC9 (spec AC9, R9): to-spec has the read-the-code rule; a skill-text test checks it.
  - Evidence: gate run: "should tell to-spec to read the code before naming functions or files (AC9)" passed (shown, 2026-11-09T23:46Z)
- AC10 (spec AC10, R10): gate tests: exit 2 for `verifyConditionl` and for `run: "a; b"` / `"a & b"`; pass for `"a && b"` and `"echo 'a;b'"`.
  - Evidence: gate run: "should run nothing and exit 2 with a misspelt verifyConditional key", "... a run that chains commands with ;", "... with a single &", "should run a step with && between two commands", "should run a step with ; inside single quotes" passed (shown, 2026-11-09T23:46Z)
- AC11 (spec AC11, R11): a gate test with a step that changes a tracked file listed in its `expectNoDiff` paths prints `FAIL` naming the file; the same step without the key, or with a list that does not name the file, passes. Same shape and rule as `run-verify.mjs` (`expectNoDiff: [paths]`, `git diff --quiet -- <paths>`).
  - Evidence: gate run: "gate runner: expectNoDiff (ESP-54 AC11)" passed (fails naming the file; passes without the key and when the file is not in the list) (shown, 2026-11-09T23:46Z)
- AC12 (spec AC12, R12): in a committed test branch a matching conditional step runs; `--base HEAD` restores `SKIPPED`; an unresolvable base prints the fallback line; the fake-pass line shows `scanned N files`; a check that prints no count fails the gate.
  - Evidence: gate run: "gate runner: diff base and scan count (ESP-55 AC12)" passed (merge-base step runs, --base HEAD compares with HEAD, fallback line, no scan count fails the gate); "fake-pass-check: scan count and base" passed (shown, 2026-11-09T23:46Z)
- AC13 (spec AC13, R13): old matching log folder removed, newer and non-matching kept, link not followed; one log file per step; bounded tail read checked by test.
  - Evidence: gate run: "gate runner: old log folders (ESP-56 AC13)" passed (7-day removal, link not followed); "should write the index and one log per step ..." and "should read at most the last 64 KB of a failing step's output (ESP-78 F16)" passed (shown, 2026-11-09T23:46Z)
- AC14 (spec AC14, R14): simulated kill failure names the surviving process in the reason; `taskkill` called by absolute path; interrupt between steps prints `NOT RUN` and exits 130; mutation runner output unchanged or improved.
  - Evidence: gate run: "gate steps: a process tree stopped only in part (ESP-58)", "should call taskkill by its absolute path under System32, not through PATH (ESP-58)", "should start no further step once the interrupt has landed, and fail the run" (NOT RUN lines) and the mutation-runner suites passed; exit 130 shown by code reference (caller evidence): skills/verify/gate-steps.mjs runSelected prints NOT RUN on signal.aborted (line 121) and skills/verify/gate.mjs exits 130 on an aborted signal (line 314); the interrupt process test is POSIX-only and skipped on Windows in this run (shown, 2026-11-09T23:46Z)
- AC15 (spec AC15, R15): README documents `transport`, the five events and alias, per-ticket type and parent, `--base`, the chained-`run` rule, `expectNoDiff` and log cleanup; the changelog row has the `"transport": "api"` migration note; ADR-0003 has the transport section.
  - Evidence: README documents transport, the six stage events and verified alias, --type/--parent, --base and --check, the chained-run rule (; & || |), expectNoDiff and 7-day log cleanup; the 0.24.0 changelog row has the "transport": "api" migration and re-copy notes; ADR-0003 has the 2026-11-09 transport addendum (checked in the diff) (shown, 2026-11-09T23:46Z)
- AC17 (spec AC17, R16): a skill-text test confirms that verify and release-steps skip the later events for a docs-only ticket and say so, and that the skip ends only on the user's approval.
  - Evidence: gate run: "should stop a docs-only ticket at devComplete until the user approves it (AC17)" passed (shown, 2026-11-09T23:46Z)
- AC16 (spec AC16): full gate passes; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` pass.
  - Evidence: gate run 2026-11-09T23:46:07Z: tests (2211 tests, 2207 pass, 0 fail, 4 platform skips), validate marketplace and validate plugin PASS, fake-pass check PASS (5 warnings), Gate: PASS (shown, 2026-11-09T23:46Z)

## Tasks
Build test-first (red → green → refactor), gate runner first, then the tracker. `verify --iterate` after each task.
- [x] T1: chained-`run` and near-miss key config errors in the gate runner (covers AC10; ESP-53)
- [x] T2: `expectNoDiff` in the gate runner, same rule as `run-verify.mjs` (covers AC11; ESP-54)
- [x] T3: merge-base default, `--base <ref>`, fallback line; fake-pass check prints a scan count and the runner requires it (covers AC12; ESP-55)
- [x] T4: log-folder cleanup, per-step log files, bounded tail read (covers AC13; ESP-56)
- [x] T5: kill-failure reason, absolute `taskkill`, `NOT RUN`, exit 130 (covers AC14; ESP-58)
- [x] T6: `transport` setting, stage events, `verified` alias, forward-only walk, `create --type/--parent` in `jira-tracker.mjs` (covers AC1, AC3, AC5, AC6; ESP-104, ESP-116, ESP-65)
- [x] T7: skills fire each event at its step through the configured transport: clarify, to-spec, to-tickets and approve-plan fire `started`; verify fires `devComplete` then `testingStarted` before its gate run (full gate only, not `--iterate`) and `testingComplete` on pass; release-steps fires `merged` and `released`; skill-text tests and the docs-only stop at `devComplete` (covers AC2, AC4, AC5, AC17; ESP-104, ESP-112, ESP-116)
- [x] T8: Jira key accepted as a requirement reference in the CI check (covers AC7; ESP-61)
- [x] T9: setup-engineering no-`tickets` warning; to-spec read-the-code rule (covers AC8, AC9; ESP-116, ESP-36)
- [x] T10: README, changelog row with the `"transport": "api"` migration note and a re-copy note for `templates/github/scripts/` (fake-pass-check, governance-checks), ADR-0003, ADR-0002 note, `templates/engineering.json` comment (covers AC15, AC16; all). The version bump is not in this PR: it ships in the separate `chore(release)` PR.

## Files
- `docs/specs/2026-11-09-speed-batch.md`
- `docs/adr/0003-jira-ticket-tracker.md`
- `docs/adr/0002-fake-pass-checks-fail-the-gate.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/skills/verify/gate-steps.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/supply-chain-rules.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/scripts/jira-moves.md`
- `plugins/usiatech-engineering/skills/clarify/SKILL.md`
- `plugins/usiatech-engineering/skills/to-spec/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/release-steps/SKILL.md`
- `plugins/usiatech-engineering/skills/setup-engineering/SKILL.md`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/tests/gate-steps.test.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-check.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker-stages.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

## Commands and actions
- Jira moves for the eleven tickets through the Atlassian connector (started now; later stages as the work reaches them).
- No dependency adds, no migrations, no deploys.

## Out of scope
- ESP-144 and the ESP-117 epic; the ESP-80 orchestration epic.
- Changing `templates/github/scripts/run-verify.mjs` (CI gate) or sharing its diff code; the gate runner repeats the `expectNoDiff` comparison, as ESP-44 decided for `gitList`/`changedFiles`.
- A GitHub tracker through a connector; storing Jira tokens.
- Case-insensitive `when` matching; warnings for non-near-miss unknown gate keys.
- Reproducing ESP-58 with a real elevated process.
- The 0.24.0 version bump (separate `chore(release)` PR).
- Adding a `tickets` section to waypointcareer (follow-up in that repo).

## Approved
- By: Francis Amalraj · Date: 2026-11-09
- Route: large (the user listed eleven tickets; it adds config settings and public script options, and touches more than 5 production-code files; spec approved 2026-11-09)

## Change log
- 2026-11-09: decisions by Francis — one PR for all eleven tickets; chained `;`/single `&` in `run` is exit 2; default diff base is the merge-base with `git.baseBranch`; `verified` kept as an alias of `testingComplete`, `merged` separate.
- 2026-11-09: pre-flight (governance-reviewer) — AC3 and AC15 copied to the spec wording (FLAG settled by SD-1); version bump and its three files removed (bump ships in the chore(release) PR); ADR-0002 added to Files; T7 names who fires each event; `expectNoDiff` uses the CI path-list shape (decided by Francis at plan approval). Plan approved by Francis 2026-11-09.
- 2026-11-09: scope added by Francis — spec R16/AC17, docs-only tickets stop at Ready to Test (ESP-116 rule missed in the first spec draft); plan AC17, T7 extended.
- 2026-11-09: T1 adds `templates/github/scripts/supply-chain-rules.mjs` to Files: `editDistance` is exported for the gate runner instead of copied (AGENTS.md: shared helpers are imported). Export only, no behaviour change.
- 2026-11-09: T2 — an empty `expectNoDiff` list checks nothing, as in `run-verify.mjs` (CI parity); a non-list or a path that is not repo-relative is a config error (exit 2).
- 2026-11-09: T3 — `--iterate` keeps diffing against HEAD (it checks what is being changed now; the whole branch would rerun earlier tasks' suites); `--base` is for the full gate only. `fake-pass-check.mjs` takes `--base <ref>` and ends with `fake-pass check: scanned N files`.
- 2026-11-09: T4 — `Log:` still names `gate.log`, now the index (command, result, `step-NN.log` name); each step and the fake-pass check write to their own `step-NN.log`. The bounded tail read already existed (ESP-78 F16, test kept); it now reads from the step file. A failed clean-up adds a note and never stops the gate.
- 2026-11-09: T5 — `runCommand` returns `leftRunning` when a kill reported a failure but the command closed; the gate appends "part of the process tree may still be running (process <pid>: <reason>)". Mutation runner output unchanged. `TASKKILL` is exported for its test. The between-steps `NOT RUN` path has no deterministic test (the interrupt would have to land between two steps); it is a guard before each step and before the fake-pass check, and the interrupt test (POSIX only) now expects exit 130.
- 2026-11-09: T6 — new test file `tests/jira-tracker-stages.test.mjs` added to Files (a heredoc append to jira-tracker.test.mjs broke, so the new cases live in their own file). On the connector transport the script refuses its network commands (exit 2), so the skills cannot fall back to it. New no-network command `steps --event <e> --from <status>` gives the forward-only walk order to the connector path, so both transports share one walk rule. `check` prints `verified` as `testingComplete`; skills move to the new key in T7.
- 2026-11-09: T7 adds `plugins/usiatech-engineering/scripts/jira-moves.md` to Files: one shared Jira move procedure (check, transport, forward-only walk, comment, docs-only stop, failures) that clarify, to-spec, to-tickets, approve-plan, verify and release-steps reference instead of each repeating the steps (DRY). verify fires `devComplete` and `testingStarted` in a new step 0 so the existing step numbers stay. A docs-only ticket is one whose tasks approve-plan marks `(docs-only)`; its stop ends with a dated `<KEY> docs review approved by <name>` Change log line.
- 2026-11-09: T8 adds `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs` to Files: `PROJECT_KEY` and the Jira key pattern move there from `scripts/jira-tracker.mjs`, so the CI check (which ships without `scripts/`) and the tracker import one helper instead of copying it (AGENTS.md: shared helpers are imported). Behaviour of `findJiraKeys` is unchanged.
- 2026-11-09: /code-review high found 9 issues; Francis chose "Fix all 9". Fixes: `testingComplete` moves from verify to `release` after the review round (R4 says reviews too); the gate takes the newer of the local and `origin/` merge-bases; an explicit `--base` that can't be found exits 2; `||` and `|` in `run` are config errors; `expectNoDiff` ignores files already changed before the step; a ticket in an unlisted Done-category status is never moved (`steps --from-category`); `gate.mjs --check` lets verify skip Jira moves when the gate can't start; the connector looks up a transition when two events share a status. Step running moves from `gate.mjs` (entry-only) to new `skills/verify/gate-steps.mjs` so new `tests/gate-steps.test.mjs` covers the between-steps `NOT RUN` path and the `leftRunning` text (closes the coverage gap noted under T5). Both files added to Files.
- 2026-11-09: release stage 1 (governance-reviewer) FLAG acknowledged by Francis: the guard's after-Bash workflow check did not run on 7 background commands (4 after plan approval: 18:49Z, 19:20Z, 22:31Z, 22:36Z). All were read-only test, `gh pr checks` or log-grep runs, and the diff touches no `.github/` or workflow file, so nothing went unchecked. No code change.
- 2026-11-09: release stage 2 — convention, silent-failure and security reviewers PASS (nits only). Francis chose: run mutation-test (8 mutations on `jiraKeyPattern`, `PROJECT_KEY`, `jiraReference`: 6 caught, 2 survived) and add tests for the 2 survivors in this PR (`tests/governance-checks.test.mjs`: `ESP-` with no number is not a reference; a one-letter project key is a config error), then a governance-only re-review and the full gate again. The security low-confidence note on quoting the Jira status name in `jira-moves.md` goes to a follow-up ESP ticket, not this PR.
- 2026-11-10: CI on PR 184 failed on Ubuntu (Node 20 and 22): the ESP-58 test checked the Windows `TASKKILL` path with `path` (POSIX on Linux, where `C:\...` is not absolute). Test-only fix in `tests/mutation-runner.test.mjs`: check it with `path.win32`. No production-code change. Governance-only re-review and the full gate again before the fix commit.
