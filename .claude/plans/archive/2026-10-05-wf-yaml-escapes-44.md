# Plan: Accept all YAML escapes; settle two flow forms (#44)

## Goal
Every valid YAML 1.2 double-quoted escape is decoded the way the YAML spec says instead of giving `wf-unparsed`, invalid escapes still give `wf-unparsed`, and the two flow forms from #13 that the parser currently misreads silently (hiding a privileged trigger or a `run` key) are reported as `wf-unparsed`, with the evidence recorded on #13.

## Requirement references
- Spec `docs/specs/2026-10-02-workflow-checks-hardening.md` (Status: approved): R4, R5; AC4, AC5, AC14
- Ticket #44 (spec ticket T2, parent #13)

## Acceptance criteria
- AC1 (spec AC4): Fixture `tests/fixtures/workflows/yaml-escapes.yml` is a complete workflow (a job with steps, so the parity test's full-parse check covers it) holding each YAML 1.2 escape (`\0 \a \b \t \<TAB> \n \v \f \r \e \<space> \" \/ \\ \N \_ \L \P \xHH \uHHHH \UHHHHHHHH`) in a double-quoted scalar, and gives zero `wf-unparsed` findings. Table test `it('should decode every YAML 1.2 escape to its spec value')` in `tests/workflow-rules.test.mjs` asserts each decoded value equals the YAML 1.2 value (e.g. `"\x41"` → `A`, `"\N"` → U+0085, `"\L"` → U+2028, `"\U0001F600"` → 😀). `"\q"`, a bad hex digit (`"\x4G"`), a short code (`"\u004"`), a lone surrogate (`"\uD800"`, not a Unicode scalar value; fail-closed choice) and a code point above U+10FFFF (`"\U00110000"`) each still give `wf-unparsed` (`it('should report invalid escapes as unparsed')`). Run: `node --test plugins/usiatech-engineering/tests/workflow-rules.test.mjs` from the repo root. An escape that decodes to an untrusted expression (`"\x24{{ github.event.pull_request.title }}"` in a `run` under `pull_request_target`) gives `wf-untrusted-input`, so decoding can't hide one.
  - Evidence: npm test 746/746 (scratchpad npmtest-44d.log): parseWorkflowYaml YAML 1.2 escapes (#44): "should decode every YAML 1.2 escape to its spec value", "should read the yaml-escapes fixture without any wf-unparsed finding", "should report invalid escapes as unparsed", "should report wf-untrusted-input for an expression whose \"$\" is written as a hex escape" all pass; workflow-rules.test.mjs 144/144 (shown, 2026-10-06T00:05Z)
- AC2 (spec AC5, form 1): `on: [ pull_request_target: null ]` (YAML 1.2 reads this as a sequence holding the one-pair mapping `{pull_request_target: null}`; the parser currently reads the string `"pull_request_target: null"` and finds nothing) gives `wf-unparsed`, pinned by a test and by fixture `tests/fixtures/workflows/flow-seq-pair.yml`. Plain `on: [push, pull_request_target]` still parses and is still checked.
  - Evidence: npm test 746/746: "should report wf-unparsed for a key: value pair inside a flow sequence under on", "should report wf-unparsed for the flow-seq-pair fixture", "should still parse a plain flow sequence of trigger names and check it" pass (shown, 2026-10-06T00:05Z)
- AC3 (spec AC5, form 2): `- {name:'x, run: echo ${{ github.event.pull_request.title }}'}` (YAML 1.2 reads `name:'x` as one plain key, so the next entry is a real `run`; the parser currently reads one `name` string and hides the `run`) gives `wf-unparsed`, pinned by a test and by fixture `tests/fixtures/workflows/flow-map-colon-quote.yml`. JSON-style `{"name":"x","run":"echo hi"}` and `{name: 'x', run: 'echo hi'}` still parse with no `wf-unparsed`.
  - Evidence: npm test 746/746: "should report wf-unparsed for a flow mapping key whose colon is directly followed by a quote", "should report wf-unparsed for the flow-map-colon-quote fixture", "should still parse a JSON-style flow mapping step", "should still parse a flow mapping step with a space after the colon" pass (shown, 2026-10-06T00:05Z)
- AC4 (spec AC5): #13 has a comment giving, for each of the two forms, the YAML 1.2.2 spec reading (with section links), the parser's chosen behaviour (`wf-unparsed`, fail-closed) and the test that pins it.
  - Evidence: gh api issues/comments/6000377141 on #13 (created 2026-10-05T18:14:33Z) checked this session: cites YAML 1.2.2 §7.4.1, §7.3.3, §7.4.2, names wf-unparsed and the flow-seq-pair / flow-map-colon-quote fixtures (shown, 2026-10-06T00:05Z)
- AC5 (spec AC14): `npm test` passes with 0 failures and 0 skipped/todo; `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exits 0; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0; `tests/workflow-parity.test.mjs` passes on the three new fixtures (guard and CI give the same tiers). The parity test keeps an explicit list of expected-unparsed fixtures (`flow-seq-pair.yml`, `flow-map-colon-quote.yml`): they are skipped only by the full-parse check, still run through the guard-vs-CI tier comparison, and a test asserts each gives `wf-unparsed:high` in both.
  - Evidence: npm test exit 0, 746/746, 0 fail/cancelled/skipped/todo; fake-pass-check exit 0 (repo template and installed 0.9.0, no findings); claude plugin validate . exit 0; claude plugin validate plugins/usiatech-engineering exit 0; parity "should give the same tiers for" yaml-escapes / flow-seq-pair / flow-map-colon-quote, "should report the expected-unparsed fixtures as wf-unparsed in both guard and CI" pass (shown, 2026-10-06T00:05Z)
- AC6 (scope additions, Change log 2026-10-05): `on: [push, {pull_request_target: null}]` (a `{ }` entry inside a flow sequence) gives `wf-unparsed`; any raw U+0085, U+2028 or U+2029 anywhere in the workflow text (e.g. `on: [ pull_request_target:<U+0085>null ]`, or NEL used as a line break) gives `wf-unparsed`. Each is pinned by a test in `tests/workflow-rules.test.mjs`. The decoded escapes `"\N"`, `"\L"`, `"\P"` (AC1) still give no `wf-unparsed`.
  - Evidence: npm test 746/746: describe "checkWorkflow: flow mapping in a sequence and raw line-break characters (#44, AC6)" 16/16 pass, incl. "should report wf-unparsed for a flow mapping entry inside a flow sequence under on", "…raw NEL between a key and its value in a flow sequence", "…raw NEL/LS/PS inside a comment", "…raw NEL inside a double-quoted value / plain value / run block scalar line"; "should decode every YAML 1.2 escape to its spec value" (\N \L \P) passes; mutation (report disabled) fails 7 of these, (on-entry check disabled) fails 1 (shown, 2026-10-06T00:05Z)

## Tasks
- [x] T1: Branch `fix/workflow-yaml-escapes-44` off `develop` (ticket #44)
- [x] T2: Red: escape table test + `yaml-escapes.yml` fixture; invalid-escape and `\x24{{` cases; confirm the valid rows fail today for the right reason (covers AC1; #44)
- [x] T3: Green: decode all YAML 1.2 escapes in `scalar()` with strict hex length/digit checks and code-point range checks; invalid ones call `problem()` (covers AC1; #44)
- [x] T4: Red: tests + fixtures for both flow forms and the still-valid neighbours; confirm the two forms give no `wf-unparsed` today (covers AC2, AC3; #44)
- [x] T4b: Parity test: add the expected-unparsed fixture list, exclude it from the full-parse check only, and assert `wf-unparsed:high` from guard and CI for each (covers AC5; #44)
- [x] T5: Green: report an implicit `key: value` pair inside a flow sequence, and a plain flow-mapping key with `:` directly followed by a quote, as `wf-unparsed`; keep the #43 linear-time property (no new backtracking pattern) (covers AC2, AC3; #44)
- [x] T5b: Red: tests for a `{ }` entry in a flow sequence and for raw NEL/LS/PS in the text; confirm they give no `wf-unparsed` today (covers AC6; #44)
- [x] T5c: Green: report both as `wf-unparsed` without a new backtracking pattern (covers AC6; #44)
- [x] T6: Post the evidence comment on #13, text shown to Francis first (covers AC4; #44)
- [x] T7: Run the full gate: npm test, fake-pass-check, both plugin validate runs (covers AC5; #44)
- [x] T8: Release into `develop` via PR (covers AC1–AC5; #44)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-parity.test.mjs`
- `plugins/usiatech-engineering/tests/fixtures/workflows/yaml-escapes.yml`
- `plugins/usiatech-engineering/tests/fixtures/workflows/flow-seq-pair.yml`
- `plugins/usiatech-engineering/tests/fixtures/workflows/flow-map-colon-quote.yml`

## Commands and actions
- Post one comment on issue #13 with the R5 evidence (text shown to Francis before posting)
- Standard gate (npm test, fake-pass-check, claude plugin validate) and release flow (branch, commit, PR into develop; Francis merges)

## Out of scope
- Multi-line double-quoted strings and the escaped line break (`\` at end of line): still `wf-unparsed`
- Parsing the two R5 forms into GitHub's shape (chosen: fail closed); a test-repo run on GitHub
- Other flow-context plain-scalar `:` cases with no quote (e.g. `{a:b}`), which over-read rather than hide a key
- R1–R3 and R6–R13 (tickets #45–#48); README, version bump, release notes
- The #39 and PR #28 review nits

## Approved
- By: Francis · Date: 2026-10-05
- Route: large (#44 is one ticket from the approved large-route spec, already through clarify → to-spec → to-tickets)

## Change log
- 2026-10-05: plan drafted for #44. Pre-flight FLAG fixed: the parity test joins Files with an explicit expected-unparsed fixture list (its full-parse check would otherwise fail on the two fail-closed fixtures); AC1 requires the escapes fixture to be a complete workflow and names its tests.
- 2026-10-05: green phase broke 3 pre-#44 test cases that pinned the removed behaviour: the G1 escapes test (expected wf-unparsed; AC1 now decodes and checks the decoded value) and the QUOTE_TABLE "after a colon" row (its `[a: "x, y"]` wrapper is AC2 form 1). Francis approved updating both in `workflow-rules.test.mjs` (same file, no scope change).
- 2026-10-05: stage-2 silent-failure FLAG: `on: [push, {pull_request_target: null}]` gives no findings (pre-existing on develop too). Francis approved adding it to #44: a `{ }` entry inside a flow sequence (at least under `on`) gives `wf-unparsed`, with a test. Same files. Not yet implemented.
- 2026-10-05: conventions FLAG fixed: ESCAPES `L`/`P` now written as `''`/`''` (were invisible literal chars); fixture `ESC_UNICODE` now really uses `A` (was a pre-decoded `A`). workflow-rules 128/128, parity 42/42 after the fix.
- 2026-10-05: stage-2 security nits deferred out of #44 (Francis): the nested-flow depth cap (pre-existing quadratic, 8–20 s at ~2000 levels) and the silent misreads `[ a:[b] ]`, `[ [a]:[b] ]`, `[ {run: a}:{b} ]`, `{ a:b: c }` now live in Jira ESP-17 (child of ESP-2). No change to #44 scope.
- 2026-10-05: stage-2 security finding 1 (Medium, NEL) added to #44 (Francis): any raw U+0085 / U+2028 / U+2029 anywhere in the workflow text → `wf-unparsed` (closes `on: [ pull_request_target:<NEL>null ]` and the older raw-NEL line-break bypass), with a test. Same files. Not yet implemented.
- 2026-10-05: AC6 delta re-reviewed. Silent-failure: PASS (nit: a raw NEL inside a value is not pinned by a test; a test is being added to `workflow-rules.test.mjs`, same file). Security: PASS WITH NITS. The one nit is pre-existing on develop: a nested block list under `on:` (`  - - pull_request_target`) is read as a string. Francis deferred it to ESP-17 (comment added). No change to #44 scope.
- 2026-10-06: stage-2 conventions nits 1+2 fixed in `workflow-rules.test.mjs` (Francis): one module-scope `unparsed` helper; AC6 inputs use `\n` escapes. Gate rerun 2026-10-06T00:05Z: npm test 746/746, fake-pass-check 0, both validates 0; mutation (raw-char report off) still fails the same 7. Nits 3–4 (table-driven NEL/LS/PS test, long names) listed in the PR.
- 2026-10-06: committed e5b18df, pushed, PR #52 into develop opened (https://github.com/francis-usiatech/claude-plugins/pull/52). ESP-3 → In Testing with comment. T8 ticks when Francis merges.
- 2026-10-06: PR #52 merged into `develop` (`a18e43c`) and promoted to `main` in PR #53 (`b35429c`). T8 ticked; plan closed.

## Final status
- **Shipped:** commit `e5b18df`, PR #52 merged into `develop` (`a18e43c`) and promoted to `main` in PR #53 (`b35429c`). Issue #44 closed.
- AC1: met (evidence shown, 2026-10-06T00:05Z).
- AC2: met (evidence shown, 2026-10-06T00:05Z).
- AC3: met (evidence shown, 2026-10-06T00:05Z).
- AC4: met (evidence shown, 2026-10-06T00:05Z).
- AC5: met (evidence shown, 2026-10-06T00:05Z).
- AC6: met (evidence shown, 2026-10-06T00:05Z).
- **Deviations:**
  - AC6 was added during stage-2 review, approved by Francis (see the change log): a `{ }` entry inside an `on` flow sequence, and any raw U+0085/U+2028/U+2029 in the workflow text, give `wf-unparsed`. Both stayed inside the plan's files.
  - Three pre-#44 test cases that pinned the old behaviour were updated (approved by Francis).
  - Deferred to Jira ESP-17: the nested-flow depth cap, the `[ a:[b] ]`-style silent misreads and the nested block list under `on:` (`  - - pull_request_target`).
  - Conventions nits 3–4 (table-driven NEL/LS/PS test, long test names) are listed in PR #52, not fixed.
  - `mutation-test` on `workflow-rules.mjs` was not run (only spot mutations); tracked in ESP-14.
  - No version bump: the fix ships with 0.10.0 (#48).
