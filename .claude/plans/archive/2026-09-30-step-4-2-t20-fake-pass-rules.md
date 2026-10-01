# Plan: Fake-pass rule module (step 4.2, ticket #20)

## Goal
Add the shared `fp-*` rule module that finds fake passes in changed JS/TS test files (focused, skipped, empty, assertion-free and unreadable tests, plus placeholder text), with allowlist suppression that keeps the reason. It is a pure function with no I/O wiring: #21 connects it to `verify` and the CI gate. This PR also commits the step 4.2 design records (spec, ADR 0002, roadmap, README design-records sections).

## Requirement references
- Spec `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (approved): R1–R8, AC1–AC7, decisions D2–D8
- ADR 0002 `docs/adr/0002-fake-pass-checks-fail-the-gate.md` (accepted)
- Issue #20; roadmap step 4.2 (A6)

## Acceptance criteria
- AC1 (spec AC1, R1): Unit tests over file sets:
  - A changed `*.test.mjs`, `*.spec.ts` or `__tests__/x.js` file is scanned with every rule.
  - A changed `src/x.js` gets `fp-placeholder` only.
  - A file with status `deleted` and a `.py`/`.md` file give no findings.
  - Evidence: fake-pass-rules.test.mjs "isTestFile / isJsTsFile" (2 tests) and "checkFakePasses: file scope (AC1)" (5 tests) pass (shown, 2026-10-01T00:40Z)
- AC2 (spec AC2, R2, R3): Each of these gives exactly one `high` finding with the right rule ID:
  - `fp-only`: `.only`, `fit`, `fdescribe`
  - `fp-skip`: `.skip`, `xit`, `xdescribe`, `xtest`, `.todo`, `test.fixme`, `{ skip: true }`, `{ skip: 'reason' }`, `{ todo: true }`

  A clean file gives none. `skip` inside a string or comment gives none.
  - Evidence: fake-pass-rules.test.mjs "focused and skipped tests (AC2)": 16 pattern cases, the skipped fixture, and the strings/comments/identifiers negative case pass (shown, 2026-10-01T00:40Z)
- AC3 (spec AC3, R4): `it('x', () => {})` and a comment-only body each give one `fp-empty-test` high finding. A body with one statement gives none.
  - Evidence: fake-pass-rules.test.mjs "empty tests (AC3)" (3 tests) pass; fix set 1 adds concurrent/serial/each/generic/function-param variants (shown, 2026-10-01T00:40Z)
- AC4 (spec AC4, R5): A body without a recognised assertion gives one `fp-no-assert` high finding. Bodies using each of these give none: `assert.equal(`, `assert(`, `expect(`, `await expect(`, `t.assert.`, `.should.` and `t.plan(`.
  - Evidence: fake-pass-rules.test.mjs "tests without an assertion (AC4)": 7 accepted assertion styles plus no-assert, string, per-test and describe/hook cases pass (shown, 2026-10-01T00:40Z)
- AC5 (spec AC5, R6): `// TODO`, `FIXME`, `XXX` and `throw new Error('not implemented')` in a changed file each give one `fp-placeholder` warning. Unchanged files aren't passed in, so they give nothing.
  - Evidence: fake-pass-rules.test.mjs "placeholders (AC5)" (4 markers plus the look-alike negative) pass (shown, 2026-10-01T00:40Z)
- AC6 (spec AC6, R7): A changed test file passed with unreadable content (`text: null`) gives one `fp-unreadable` high finding.
  - Evidence: fake-pass-rules.test.mjs "unreadable files (AC6)" (2 tests) pass; fix set 1 adds unclosed comment/template, over-1-MB, line-1, and 3 under-2-s timing cases (shown, 2026-10-01T00:40Z)
- AC7 (spec AC7, R8): A matching allowlist entry marks the finding `suppressed: true` with its `reason`. `blockingFindings` excludes it and `formatFinding` shows the reason. A non-matching entry leaves the finding unchanged. Existing allowlist tests still pass.
  - Evidence: governance-rules.test.mjs "should keep the entry reason on a suppressed finding and show it when formatted" and "should leave an unmatched finding without a reason" pass; governance-checks.test.mjs "should honour an allowlisted package" shows "suppressed: internal fork" in the CI report (shown, 2026-10-01T00:40Z)
- AC8: `npm test` exits 0 and all existing tests still pass. `package.json` has no `dependencies`.
  - Evidence: npm test exit 0, 617/617 pass (0 skipped, 0 todo); package.json has no dependencies; claude plugin validate exits 0 for the marketplace and the plugin (shown, 2026-10-01T00:40Z)

## Tasks
- [x] T1: Write red tests for AC1–AC6 in `tests/fake-pass-rules.test.mjs`, with fixtures under `tests/fixtures/fake-pass/` (covers AC1–AC6; #20)
- [x] T2: Implement `fake-pass-rules.mjs`:
  - comment and string stripping
  - test-file detection (D4)
  - focused and skip patterns
  - test-body extraction by brace matching for empty and no-assertion checks
  - placeholder warnings
  - unreadable files
  - Re-export it from `governance-rules.mjs`. (covers AC1–AC6; #20)
- [x] T3: Keep `reason` through `parseAllowlist` and `applyAllowlist`, and show it in `formatFinding`, test-first. This only adds a field: the callers `hooks/scripts/governance-policy.mjs` and `governance-checks.mjs` pass entries through unchanged and need no edits. `plugin-structure.test.mjs` doesn't list the scripts, so it needs no change either. (covers AC7; #20)
- [x] T4: Run the full suite, confirm no new dependencies, and commit the step 4.2 design records with the code (covers AC8; #20)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/fixtures/fake-pass/**`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `docs/specs/2026-09-30-fake-pass-and-mutation-test.md`
- `docs/adr/0002-fake-pass-checks-fail-the-gate.md`
- `docs/roadmap.md`
- `README.md`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- `gh issue create` for #20–#22 (done 2026-09-30, approved by Francis)
- Branch `feature/step-4-2-fake-pass-rules` off `main`. The repo uses `main` as its base, as in PRs #17–#19.
- Through `release`: commit, push, and open a PR to `main`. Merge only after CI is green and Francis confirms.

## Out of scope
- Wiring into `verify`, `run-verify.mjs` or the CI gate; the parity test (#21)
- The `mutation-test` skill and runner (#22)
- A version bump. 0.9.0 lands with #22.
- The README `fp-*` rule table (#21). This PR only adds the Design records sections.
- The guard hook. Non-JS/TS ecosystems.
- Fixing this repo's own tests for fake-pass findings. Revisit in #21, when the check is wired into this repo's gate.

## Approved
- By: Francis · Date: 2026-09-30
- Route: large (adds a new module; clarify → to-spec → to-tickets done; this plan covers ticket #20 only)

## Change log
- 2026-09-30: created
- 2026-09-30: added governance-checks.test.mjs and plugin-structure.test.mjs. AC7 puts the reason into parsed entries and formatted output, so two exact-shape assertions were tightened to include it. Approved by Francis.
- 2026-10-01: fix set 1 from the stage-2 review (silent-failure SF1–SF4, security High plus output note, convention nits). Covers test-call variants, function params, regex literals, fail-closed unterminated and oversized files, linear-time scanning, one-line formatFinding and the D7 known limits in the spec. All in planned files. Approved by Francis.

## Final status
- Shipped: PR #23, merge commit da67b51, on 2026-09-30. CI 4/4 green (ubuntu and windows, Node 20 and 22). `npm test` 617/617. Issue #20 closed. No version bump: 0.9.0 lands with #22.
- Acceptance criteria: AC1–AC8 all shown (evidence above, stamped 2026-10-01T00:40Z).
- Deviations:
  - Scope update: two existing tests were tightened for the allowlist reason (Change log).
  - Fix set 1 came from the stage-2 review: silent-failure SF1–SF4, the security High (quadratic CPU) and the output note, plus convention nits. It is closed per the narrow re-review.
  - The red phase ran per test group rather than one test per cycle.
