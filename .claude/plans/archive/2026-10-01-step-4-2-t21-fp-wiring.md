# Plan: Step 4.2 #21: run fake-pass checks in verify and the CI gate

## Goal
Run the `fp-*` rule module from #20 in two places: in the local `verify` gate, through a new entry-point script, and in the CI governance gate. Both use the same tier and allowlist model as B9/B10. Prove that both places give the same findings, and document the rules in the plugin README.

## Requirement references
- Spec `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (Status: approved): R9, R10, R11, R18 (fp-* docs part); AC8, AC9, AC10; D1, D2, D3, D12
- ADR 0002 `docs/adr/0002-fake-pass-checks-fail-the-gate.md`
- Ticket #21 (blocked by #20, which shipped in PR #23)
- Roadmap step 4.2 (A6)

## Acceptance criteria
- AC1 (spec AC8, R9): A test runs the local entry point `templates/github/scripts/fake-pass-check.mjs` in a temp git repo that has an uncommitted test file containing `it.only(…)`. The script exits non-zero, and its output names the file, the line and `fp-only`. If the only findings are warnings, it exits 0 and prints them. If the repo's `.claude/engineering.json` allowlists the finding, it exits 0 and shows the finding as `suppressed: <reason>`. A structure test in `tests/plugin-structure.test.mjs` asserts that `skills/verify/SKILL.md` has a step that runs `fake-pass-check.mjs` after the commands pass, and that the step says an unsuppressed fail finding makes the result **Gate: FAIL** and that every finding is listed.
  - Evidence: fake-pass-check.test.mjs 6/6: .only exits 1 with [fp-only, high] tests/math.test.mjs:4; warnings-only exit 0; allowlisted shown as suppressed: <reason>; broken config exits exactly 2; run from a subdirectory finds both changed files (exit 1); git-reported deletion skipped. plugin-structure verify-step test (AC8) passes (shown, 2026-10-01T17:05Z)
- AC2 (spec AC9, R10): Tests in `tests/governance-checks.test.mjs`:
  - (a) A PR that adds a test file with `.only` fails the gate (exit 1), and the report names `fp-only`.
  - (b) A PR whose only findings are warnings (`fp-placeholder`) passes (exit 0), with the warnings in the report.
  - (c) With the approval label, case (a) passes, and the finding is still reported as accepted.
  - (d) The fake-pass module is loaded from the base-branch copy, not the PR checkout. The proof is the same as the existing workflow-rules test: the PR rewrites its own copy of the module, and the result is unchanged.
  - Evidence: governance-checks.test.mjs "test content" 7/7: (a) fail exit 1 names fp-only, (b) warnings-only exit 0 listed, (c) label passes with "Accepted via label", (d) PR rewriting its own fake-pass-rules.mjs still fails; gitlink gives labellable fp-unreadable with git's stderr reason; 1.2 MB multibyte test file checked, not unreadable; control characters stripped from file names (shown, 2026-10-01T17:05Z)
- AC3 (spec AC10, R11): `tests/fake-pass-parity.test.mjs` is a table-driven test. It runs every fixture in `tests/fixtures/fake-pass/` through both the local entry point and the CI entry point (`runGovernanceChecks`), and asserts identical sorted `rule:tier` lists for each fixture. It also asserts that the union of rules seen covers every `fp-*` rule ID, so the parity check can't pass trivially on empty results.
  - Evidence: fake-pass-parity.test.mjs 9/9: 7 fixtures as test files plus placeholder as src give identical rule:tier lists locally and in CI (CI report asserted present); union covers all 6 fp-* rules (shown, 2026-10-01T17:05Z)
- AC4 (R18, fp-* part): The plugin README has an `fp-*` rule table (Rule | Tier | Catches) for `fp-only`, `fp-skip`, `fp-empty-test`, `fp-no-assert`, `fp-placeholder` and `fp-unreadable`. It also has an allowlist example for `fp-no-assert` (helper asserts), the known limits of pattern detection (D7), and an upgrade note that consumer repos must re-copy `templates/github/scripts/`. A structure test asserts every rule ID appears in the README table.
  - Evidence: plugin-structure "step-4.2 fake-pass docs (#21, R18)" 2/2: every fp-* rule row with tier matching the module, fp-no-assert allowlist example accepted by parseAllowlist, limits and re-copy note (shown, 2026-10-01T17:05Z)
- AC5 (gate): `npm test` passes, with no `.only`, `.skip` or stub tests in the changed files. Running `fake-pass-check.mjs` on this branch's changes gives no unsuppressed high finding. `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0.
  - Evidence: npm test 642/642 exit 0, 0 skipped/todo; fake-pass-check.mjs run from plugins/ (subdirectory) exit 0, 0 high findings, 3 deliberate TODO-data warnings; claude plugin validate . and plugins/usiatech-engineering both exit 0. Stage 1 governance PASS; stage 2 security PASS WITH NITS, conventions PASS WITH NITS, silent-failure FAIL then fixed and narrow re-review PASS WITH NITS (its one finding fixed) (shown, 2026-10-01T17:05Z)
## Tasks
- [x] T1: Write the local entry point `fake-pass-check.mjs`, test first. It reads the changed files (`git diff --name-only HEAD` plus untracked files, matching verify step 2) from the working tree, runs `checkFakePasses`, applies `governance.allowlist` from the repo's `.claude/engineering.json` (`parseAllowlist`/`applyAllowlist`), prints `formatFinding` lines and exits 1 on any unsuppressed high finding. A config that can't be parsed exits non-zero with a readable reason (fail closed). (covers AC1; #21)
  The script checks every changed JS/TS file, test or not, so `fp-placeholder` (R6) covers source files too.
- [x] T2: Add step 6 "Test content (fp-*)" to `governance-checks.mjs`: `reportFindings('Test', …flatMap(checkFakePasses))` over changed JS/TS files, imported through `governance-rules.mjs` (add an `isJsTsFile` re-export). Test first. A file git can't read goes to `checkFakePasses({ content: null })`, so it gives the same tiered `fp-unreadable` finding as the local script instead of a plain, unlabellable error. (covers AC2; #21)
- [x] T3: Write the parity test `fake-pass-parity.test.mjs`, modelled on `workflow-parity.test.mjs`. Include a non-test source fixture with a placeholder. (covers AC3; #21)
- [x] T4: Add the verify step to `skills/verify/SKILL.md`, plus its structure test. The step runs `node "${CLAUDE_PLUGIN_ROOT}/templates/github/scripts/fake-pass-check.mjs"`: the plugin copy, so it works in repos that haven't copied the CI kit. The structure test asserts that path. The check runs after the commands pass and lists every finding. Step 7 changes from "decided by the commands only" to "decided by the commands and the fake-pass check", and the assertion at `plugin-structure.test.mjs:165` is replaced with one for the new wording, not removed. (covers AC1; #21)
- [x] T5: README: add the `fp-*` table, the allowlist example, the known limits and the upgrade note, plus a structure test. (covers AC4; #21)
- [x] T5b: Fix the existing `fp-no-assert` finding in `tests/plugin-structure.test.mjs` (the `assertBefore(…)` test at line 237), since T4 and T5 change that file. Make the test assert directly, for example `assert.ok(...)` around a helper that returns a boolean, without weakening what it checks. After this, running the fp rules on `plugin-structure.test.mjs` gives no findings. (covers AC5; ADR 0002 "touching a file means owning its debt")
- [x] T6: Run the gate, then a stage-1 governance review and a stage-2 review. (covers AC5)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/tests/fake-pass-check.test.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-parity.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/fixtures/fake-pass/*.txt`
- `plugins/usiatech-engineering/README.md`
- `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (tick #21 in the Tickets section only)

## Commands and actions
- None beyond `npm test` and `claude plugin validate`. There are no new dependencies and no version bump; 0.9.0 lands with #22.

## Out of scope
- The PreToolUse governance guard (the spec doesn't ask for fp checks at edit time).
- The `mutation-test` skill, runner and 0.9.0 bump (#22).
- The other existing findings in this repo's own tests: 11 `fp-no-assert` in `supply-chain-rules.test.mjs` (the `rejects(…)` helper) and 2 `fp-placeholder` warnings in `fake-pass-rules.test.mjs`. This PR doesn't change either file. They surface when those files next change, and a follow-up issue tracks them. The one in `plugin-structure.test.mjs` is fixed by T5b.
- Creating a root `.claude/engineering.json` or allowlisting anything.
- Non-JS/TS languages (D4).

## Approved
- By: Francis · Date: 2026-09-30
- Route: large (adds a public interface, the verify step and the CI gate check, and touches more than 5 files; the spec and tickets already exist)

## Change log
- 2026-09-30: drafted from ticket #21. Pre-flight FLAG resolved: Francis chose option (a), fix the `plugin-structure.test.mjs:237` finding in this PR (T5b). Also added: the verify script path, the replaced (not removed) step-7 assertion, `fp-unreadable` parity for git read errors, and non-test placeholder coverage.
- 2026-09-30: deviation: the spec Tickets section has no shipped markers (#20 has none), so the spec was not edited; it stays in Files only as the requirement reference.
- 2026-10-01: stage-2 fix set approved by Francis (all 4 items): local check runs from the repo root and takes deletions from git (silent-failure High, reproduced); formatFinding strips control characters from file names (security Low); test hardening (exit code 2, CI report asserted in parity, 8 MiB git show buffer, git stderr reason in fp-unreadable); README and verify wording nits. Narrow re-review: git reason used node's message, not git stderr; fixed test-first. Within the plan Files; no scope change.

## Final status
- Shipped: PR #25, merge commit 1b3fe78, on 2026-10-01. CI 4/4 green (ubuntu and windows, Node 20 and 22). `npm test` 642/642. Issue #21 closed. No version bump: 0.9.0 lands with #22.
- Acceptance criteria: AC1–AC5 all shown (evidence above, stamped 2026-10-01T17:05Z).
- Deviations:
  - The spec Tickets section was not edited (no shipped markers exist for #20 either); see Change log.
  - The stage-2 fix set (4 items) and the narrow re-review fix stayed within the plan Files; see Change log.
  - The remaining existing findings in this repo's own tests are tracked in follow-up issue #26.
