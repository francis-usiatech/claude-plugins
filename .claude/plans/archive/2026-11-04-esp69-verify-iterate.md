# Plan: verify --iterate and the one-full-gate rule (ESP-69, absorbs ESP-10)

## Goal
Let `verify` re-run only the suites mapped to changed files while building, and state that the done gate is the full gate, run once per PR after the last code change. An iterate run is never the done gate.

## Requirement references
- docs/specs/2026-10-16-delivery-speedup.md (Status: approved): P6, R16, R17, R18, R19 (`--iterate` part), AC12, AC13, AC14 (`--iterate` part), AC15
- Jira ESP-69 (sub-task of ESP-63), Jira ESP-10 (absorbed in part; closes when ESP-69 ships, per the spec's decisions)
- ADR-0002: unaffected. `--iterate` is never the done gate, so it skips the fake-pass check.

## Pre-plan checklist
- (a) New validation rules and format checks:
  - `verifyIterate` entries reuse `checkSteps(steps, key, true)` and `isPathPrefix` from `gate.mjs` and `governance-rules.mjs`, so there is no new rule. Fixtures: the `verifyConditional` bad-config table in `tests/gate.test.mjs` (lines 160-179).
  - New rule: `gate.mjs` rejects any argument other than `--iterate` with exit 2. Callers searched (`gate\.mjs` outside docs and plans): `tests/gate.test.mjs` (lines 34 and 84, no arguments), `skills/verify/SKILL.md` line 19 (no arguments), README lines 34 and 377. `governance-gate.mjs` hits are a different script. No caller passes arguments.
- (b) Database or infrastructure mechanisms: n/a: none. The change reuses the existing step runner, log and changed-file list.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (gate section lines 34-41, config table line 49). ADR search (`gate|verify` in docs/adr): ADR-0002 and ADR-0003, neither needs a change.

## Acceptance criteria
- AC1 (spec AC12, R16, R17): Tests in `tests/gate.test.mjs` show:
  - with a `verifyIterate` entry for a changed path, `gate.mjs --iterate` runs only the mapped command, and no `verify` or `verifyConditional` step;
  - an unmapped changed file is listed as not covered;
  - a run with nothing mapped, no changed files, or no `verifyIterate` key exits 0 and says so; `--iterate` reads only `verifyIterate`, so an empty or missing `verify` list doesn't stop it;
  - the runner's own verdict is always the last line and says the run is partial, on pass, on failure and on a run that can't start, and the runner never writes `Gate: PASS` or `Gate: FAIL` in this mode. A fixture whose failing step prints `Gate: PASS` shows that text stays step output and the last line is still partial;
  - a failing mapped step exits 1, its later steps print `NOT RUN`, and the last line says partial and failed;
  - a bad map, a missing or unparseable config, or a git failure exits 2 with a partial last line;
  - the fake-pass check does not run.
  - Evidence: gate run suite `gate runner: --iterate (ESP-69 AC1)` passed all 18 tests, among them "should run only the mapped step, and no verify or verifyConditional step", "should list a changed file with no mapping as not covered", "should exit 0 and say so when the verify list is missing", "should exit 1, mark later steps not run and end on a partial failure", "should keep a failing step's own text as output, with the partial verdict still last", "should not run the fake-pass check", and the exit-2 config and git cases (shown, 2026-11-05T04:55Z)
- AC2: A test shows `gate.mjs --bad-flag` exits 2 and runs no step, and `gate.mjs` with no argument still ends in `Gate: PASS` or `Gate: FAIL` (existing tests stay green).
  - Evidence: gate run suite `gate runner: arguments (ESP-69 AC2)` passed "should run nothing and exit 2 on an unknown argument" (uses `--bad-flag`) and "should still run the full gate with no argument"; `npm test` 0 failures (shown, 2026-11-05T04:55Z)
- AC3 (spec AC13, R17, R18): `tests/plugin-structure.test.mjs` asserts:
  - the `verify` skill says an `--iterate` run writes no evidence, makes no Jira move and reports as partial;
  - `--iterate` needs `.claude/engineering.json` (the `AGENTS.md` path has no iterate mode, and says so);
  - `verify` and `release` say to use `--iterate` while building and to run the full gate once per PR after the last code change, and that any code change after a full gate, tests-only included, needs the full gate again before the commit.
  - Evidence: gate run suite `plugin structure: verify --iterate and one full gate (ESP-69 AC3)` passed "should say an --iterate run writes no evidence, makes no Jira move and reports as partial", "should say the AGENTS.md path has no iterate mode", "should state the one-full-gate rule in verify" and "... in release" (shown, 2026-11-05T04:55Z)
- AC4 (spec AC14, R19): The plugin README documents `--iterate` and `verifyIterate`, and `templates/engineering.json` has a `verifyIterate` sample. The Versioning row comes with the release bump PR, as for every release, and is checked there.
  - Evidence: diff: plugin README Gate runner section lines 42-44 cover `--iterate`, one full gate per PR and arguments; config table line 53 has a `verifyIterate` row; `templates/engineering.json` line 28 has a `verifyIterate` sample. Versioning row deferred to the release bump PR, per this AC (shown, 2026-11-05T04:55Z)
- AC5 (spec AC15): `gate.mjs` prints `Gate: PASS`, with `npm test` at 0 failures, the fake-pass check at 0 and both `claude plugin validate` runs at exit 0.
  - Evidence: gate run 2026-11-05T05:01:24Z (this branch's own `gate.mjs`) printed `Gate: PASS`, exit 0; `tests`, `validate marketplace`, `validate plugin` and the fake-pass check all exit 0, with 3 fp-placeholder warnings in `tests/gate.test.mjs`. The 2026-11-05T04:54:43Z run on the installed 0.21.1 runner, on the same changes, counted 2006 tests: 2002 pass, 0 fail, 4 skipped (shown, 2026-11-05T05:01Z)
- AC6: This repo's `.claude/engineering.json` has a `verifyIterate` map (`plugins/usiatech-engineering/skills/verify/` to the gate tests, `plugins/usiatech-engineering/skills/` to the plugin-structure tests), and `node plugins/usiatech-engineering/skills/verify/gate.mjs --iterate` on this branch runs the mapped steps and ends on a partial last line.
  - Evidence: `.claude/engineering.json` lines 16-33 hold the map; the caller's evidence reports `gate.mjs --iterate` on this branch printed "PASS  gate tests (exit 0, 161 s)", "PASS  plugin structure tests (exit 0, 1 s)" and last line "Partial run: PASS. This is not the done gate.", exit 0 (shown, 2026-11-05T04:55Z)

## Tasks
- [x] T1: Add failing tests for `--iterate` and argument handling to `tests/gate.test.mjs`, in the shape of the existing conditional-step tests (covers AC1, AC2; ESP-69)
- [x] T2: Add `--iterate` to `gate.mjs`: read `verifyIterate` with `checkSteps`, select by the existing changed-file list, reuse `runStep`, skip the fake-pass check, print not-covered files and a partial last line on every path; reject unknown arguments (covers AC1, AC2; ESP-69)
- [x] T3: Update `skills/verify/SKILL.md` (iterate path skips steps 6-8, returns a partial report) and `skills/release/SKILL.md` (one-full-gate rule at step 3), with structure tests (covers AC3; ESP-69)
- [x] T4: Document `--iterate` and `verifyIterate` in the plugin README and add a sample to `templates/engineering.json` (covers AC4; ESP-69)
- [x] T5: Add this repo's `verifyIterate` map and run `--iterate` on the branch (covers AC6; ESP-69)
- [x] T6: Run the full gate and fill in the evidence (covers AC5; ESP-69)

## Files
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/helpers.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `.claude/engineering.json`
- `.claude/plans/archive/2026-11-04-esp69-verify-iterate.md`

## Commands and actions
- After ESP-69 ships: move ESP-10 to Released in Jira, with a comment naming what was left out (the tests-only exemption).

## Out of scope
- ESP-10's rule that a review fix touching only tests, docs or copy re-runs only the related suites (spec non-goal).
- Passing changed file names to a mapped command (for example `vitest related <files>`): the map is prefix to command, per R16.
- Changing CI: `run-verify.mjs` ignores `verifyIterate`, so CI always runs the full gate.
- Moving the `verify` step in the `release` order.
- The `tdd` skill: left unchanged. It still runs `verify` after its last cycle.

## Approved
- By: Francis · Date: 2026-11-04
- Route: large (adds a public flag and config key; spec and tickets already exist and are approved, so clarify, to-spec and to-tickets are done)

## Change log
- 2026-11-04: pre-flight FLAGs applied: the ESP-10 task dropped (ESP-10 stays a reference, its Jira close moved to Commands and actions), iterate paths decided in AC1, one-full-gate wording made explicit, AC3 and AC4 extended, archive path added to Files.
- 2026-11-04: Francis decided on the pre-flight FLAGs: spec AC12's "output never contains `Gate: PASS`" is narrowed to the runner's own verdict, with step output left verbatim; any code change after a full gate needs the full gate again; the map stays prefix to command, so ESP-69's `vitest related` example with file names isn't supported.
- 2026-11-04: Francis added this repo's `verifyIterate` map to scope (AC6, T5, `.claude/engineering.json`). The spec doesn't require it.
- 2026-11-04: `/code-review high` fixes: a run with no step now ends on `Partial run: nothing ran. This is not the done gate.` rather than PASS (AC1's "says so"; R16 is still exit 0); the repo map's `when` lists also name the two mapped test files; control characters in printed paths and arguments are escaped.
- 2026-11-04: Francis added `tests/helpers.mjs` to Files after `/code-review high`: `runNode` gets an `args` option, so `gate.test.mjs` doesn't copy it.
- 2026-11-04: Francis acknowledged the stage-1 FLAG: 8 guard `error` entries in `.claude/governance-log.jsonl` dated 2026-11-04T03:17Z to 23:50Z ("after-Bash workflow check: background command, so its workflow changes were not checked"). They predate this plan and the diff touches no `.github` files. No code change. AC5's evidence now names the run on the branch's own `gate.mjs`.

## Final status
- Status: shipped · Branch: `feature/esp69-verify-iterate`
- AC1: shown. AC2: shown. AC3: shown. AC4: shown (Versioning row deferred to the release bump PR). AC5: shown. AC6: shown.
- Deviations:
  - Spec AC12's "output never contains `Gate: PASS`" is narrowed to the runner's own verdict (Francis, see the Change log). A failing step's own text stays verbatim.
  - The AC6 iterate run came before the last change, a one-word fix to the `verify` skill description. The full gate at 2026-11-05T05:01:24Z came after that fix.
  - After ESP-69 ships, ESP-10 still has to be moved to Released by hand (Commands and actions).
