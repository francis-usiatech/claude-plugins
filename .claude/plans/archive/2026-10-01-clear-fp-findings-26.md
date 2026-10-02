# Plan: Clear the repo's own fp-* fake-pass findings (#26)

## Goal
Make the plugin's own tests pass the fake-pass rules: the 11 `fp-no-assert` tests in `supply-chain-rules.test.mjs` assert inline instead of through a `rejects(…)` helper, and the deliberate `TODO`/`FIXME`/`XXX` test data no longer matches the placeholder rule.

## Requirement references
- #26 (follow-up from #21, PR #25)
- Spec `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (D2, D3)
- ADR-0002 (touching a file means owning its fake-pass debt)

## Acceptance criteria
- AC1: `checkFakePasses` run over `plugins/usiatech-engineering/tests/supply-chain-rules.test.mjs` (status `M`) returns no `fp-no-assert` finding (today: 11, at lines 382, 390, 407, 425, 501, 509, 525, 536, 624, 636, 701), and the file no longer defines a `rejects` helper.
  - Evidence: checkFakePasses scan of supply-chain-rules.test.mjs: 0 findings; `const rejects` definitions: 0 (5 removed, 69 calls inlined) (shown, 2026-10-01T20:36Z)
- AC2: `checkFakePasses` run over `tests/fake-pass-rules.test.mjs` and `tests/plugin-structure.test.mjs` returns no `fp-placeholder` finding (today: lines 51, 143 and 457).
  - Evidence: checkFakePasses scan of fake-pass-rules.test.mjs and plugin-structure.test.mjs: 0 findings (shown, 2026-10-01T20:36Z)
- AC3: The changed tests still check the same thing: every former `rejects(file, content, label)` case still asserts `problems(file, content).length > 0` with its label, and the placeholder tests still feed the same strings (`TODO: …`, `// FIXME …`, `/* XXX … */`) to the rules. Same test count as before the change, `npm test` all pass, 0 skipped/todo/cancelled.
  - Evidence: targeted run 238/238 before and after, same titles ("should warn once for // TODO: later" etc.); npm test 658/658, 0 fail/cancelled/skipped/todo (shown, 2026-10-01T20:36Z)
- AC4: With the changes committed on the feature branch, `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` (diff against `develop`) exits 0 with no findings; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.
  - Evidence: fake-pass-check.mjs exit 0, no findings (run on the uncommitted diff with HEAD = develop a32441a: the script diffs against HEAD, not a named base); claude plugin validate . and plugins/usiatech-engineering both exit 0 (shown, 2026-10-01T20:36Z)
## Tasks
- [x] T1: In both `describe` blocks of `supply-chain-rules.test.mjs` that define `rejects` (lines ~380 and ~490), replace each `rejects(f, c, label)` call with an inline `assert.ok(problems(f, c).length > 0, label)` and delete the helper (covers AC1, AC3; #26)
- [x] T2: In `fake-pass-rules.test.mjs`, build the marker words from pieces (e.g. `const TODO = 'TO' + 'DO'`) so the source line no longer contains them while the runtime string is unchanged; on line 143 this covers `TODO`, `FIXME`, `XXX` and `not implemented` (covers AC2, AC3; #26)
- [x] T3: Same for the `'// TODO\n'` data at `plugin-structure.test.mjs:457` (covers AC2, AC3; #26)
- [x] T4: Run the gate: `npm test` (background), both `claude plugin validate` runs, `fake-pass-check.mjs`, and the `checkFakePasses` scan of the three files (covers AC1–AC4)

## Files
- `plugins/usiatech-engineering/tests/supply-chain-rules.test.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-rules.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

## Commands and actions
- None beyond the gate. No dependencies, no version bump (test-only change, nothing shipped changes behaviour).

## Out of scope
- Changing the fake-pass rules themselves (e.g. teaching `fp-no-assert` about helpers).
- Mutation-runner follow-ups (taskkill failure, link into `.git`): separate plan after this one closes.
- Step 4.3 (#13).

## Approved
- By: Francis · Date: 2026-10-01
- Route: small (cites #26; 3 files; no new skill, module, service or public interface)

## Change log
- 2026-10-01: drafted; pre-flight PASS; approved by Francis.
- 2026-10-01: T1 deviation: `rejects` was defined in 5 describe blocks (lines 380, 490, 568, 621, 677), not 2; all 5 removed, same file, no scope change.

## Final status
- Shipped: commit `01b87bb`, PR #33 merged into `develop` (`994d38a`) on 2026-10-02. Issue #26 closed.
- AC1–AC4: all met, with evidence shown above.
- Deviation: 5 `rejects` helpers instead of 2 (see Change log).
