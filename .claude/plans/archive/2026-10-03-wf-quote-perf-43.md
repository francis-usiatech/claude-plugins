# Plan: Unify quote rule and make workflow patterns linear-time (#43)

## Goal
Comment stripping and flow splitting in the workflow rules decide "a quote opens here" with one shared rule, and the key and expression patterns no longer backtrack, so a 1 MB worst-case workflow is checked in under 1 s by both the guard and CI.

## Requirement references
- Spec `docs/specs/2026-10-02-workflow-checks-hardening.md` (Status: approved): R11, R12; AC11, AC12, AC14
- Ticket #43 (spec ticket T1, parent #13)

## Acceptance criteria
- AC1 (spec AC11): A shared quote test table in `tests/workflow-rules.test.mjs` (quotes at line start, after `:`, after `,`, inside plain scalars, after `#`) gives identical "quote opens here" answers from comment stripping and flow splitting; the test fails on the current code for at least one row where the two disagree, or the PR states that no row disagrees and the change is a refactor onto one shared helper.
  - Evidence: QUOTE_TABLE tests in tests/workflow-rules.test.mjs; red: 5 fails on pre-fix code (after a space / after a dash inside a plain scalar, both quotes, plus the agreement test); green: workflow-rules 117/117 (shown, 2026-10-04T05:12Z)
- AC2 (spec AC12): A test builds 1 MB worst-case inputs for each changed pattern (`KEY_RE`, `EXPR`, `UNTRUSTED_EXPR`, `PR_CHECKOUT_RUN`, the flow-mapping entry regex in `scalar()` (also with a U+2028/U+2029 line end), `KEY_RE` with a U+2028/U+2029 line end, and `normalizeExpr` on long space runs; `WHOLE_EVENT_EXPR`, `PR_REF_EXPR` and `normalizeExpr` probed linear at 1 MB) and asserts `checkWorkflow` finishes in under 1 s; the same test exceeds 1 s on the pre-fix code, and the pre-fix time is recorded in the PR description.
  - Evidence: 1 MB worker-timed tests per pattern, each asserting findings too; pre-fix: EXPR 152 s, UNTRUSTED_EXPR 61 s, KEY_RE ~20 min (est.), PR_CHECKOUT_RUN ~90 s (est.), the rest hit the 3 s cap; post-fix 13-67 ms; 0 diffs old vs new in 500k-input fuzz (shown, 2026-10-04T05:12Z)
- AC3 (spec AC14): `npm test` passes with 0 failures and 0 skipped/todo; `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exits 0; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0; `tests/workflow-parity.test.mjs` passes (guard and CI share `workflow-rules.mjs`, and the parity test runs on every fixture).
  - Evidence: npm test 714/714, 0 fail/cancelled/skipped/todo; fake-pass-check exit 0; claude plugin validate . exit 0 and plugins/usiatech-engineering exit 0; workflow-parity 37/37 (shown, 2026-10-04T05:12Z)

## Tasks
- [x] T1: Branch `fix/workflow-quote-perf-43` off `develop` (ticket #43)
- [x] T2: Red: add the shared quote test table; confirm it fails for the right reason, or confirm and note that both functions already agree (covers AC1; #43)
- [x] T3: Green: extract one shared quote-open helper used by `stripComment` and `splitFlow` (covers AC1; #43)
- [x] T4: Red: add 1 MB worst-case timing tests for `KEY_RE` and the expression pattern; record the pre-fix times (covers AC2; #43)
- [x] T5: Green: rewrite the patterns (or replace them with linear scans) so the timing tests pass and all existing workflow-rules and parity tests stay green (covers AC2; #43)
- [x] T6: Run the full gate: npm test, fake-pass-check, both plugin validate runs (covers AC3; #43)
- [x] T7: Release into `develop` via PR, with the spec file committed and the pre-fix times in the PR description (covers AC2, AC3; #43)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `docs/specs/2026-10-02-workflow-checks-hardening.md`

## Commands and actions
- None beyond the standard gate (npm test, fake-pass-check, claude plugin validate) and the release flow (branch, commit, PR into develop; Francis merges)

## Out of scope
- R1–R10 and R13 (tickets #44–#48): YAML escapes, flow forms, secrets: inherit, PR checkout, computed indexes, allowlist/rename/permissions changes, Windows paths, the after-Bash hook, the 0.10.0 bump
- New workflow fixtures, version bump, README or release notes
- The #39 and PR #28 review nits

## Approved
- By: Francis · Date: 2026-10-02
- Route: large (#43 is one ticket from the approved large-route spec, already through clarify → to-spec → to-tickets)

## Change log
- 2026-10-02: plan drafted for #43
- 2026-10-02: AC2 names PR_CHECKOUT_RUN (red-phase probe found it quadratic, ~90 s at 1 MB); approved by Francis
- 2026-10-03: AC2 adds the flow-mapping entry regex in scalar() (green-phase probe found it quadratic, ~2 s at 64 KB); approved by Francis
- 2026-10-03: AC2 adds the existing quadratics found in security review (KEY_RE / flow-mapping with U+2028, normalizeExpr space runs); also fix the ANY_INDEX `[` detection regression this change introduced, with a test; approved by Francis
- 2026-10-04: committed 0ac5361, PR #49 into develop opened (awaiting merge)

## Final status
- **Shipped:** commit `0ac5361`, PR #49 merged into `develop` (`0bdd9ce`) and promoted to `main` in PR #50 (`2d4208e`). Issue #43 closed.
- AC1: met (evidence shown, 2026-10-04T05:12Z).
- AC2: met (evidence shown, 2026-10-04T05:12Z).
- AC3: met (evidence shown, 2026-10-04T05:12Z).
- **Deviations:**
  - AC2 was widened three times, each approved by Francis (see the change log): `PR_CHECKOUT_RUN`, the flow-mapping entry regex, and the U+2028/U+2029 and `normalizeExpr` cases plus the `ANY_INDEX` regression fix. All stayed inside the plan's 3 files.
  - Lines with U+2028/U+2029 stay `wf-unparsed` (fail-closed) rather than being parsed.
  - The quoted numeric index gap (`commits['0'].message`, also missed before #43) is deferred to #45 (R3) and noted on that issue.
  - `mutation-test` on `workflow-rules.mjs` was suggested in PR #49 but not run.
  - No version bump: the fix ships with 0.10.0 (#48).
