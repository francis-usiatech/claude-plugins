# Plan: Tighten allowlist, renames and widened-permission checks (ESP-5, was #46)

## Goal
Close three gaps in how workflow findings are suppressed and compared:
- a broad allowlist entry, or one for `wf-unparsed`, no longer hides workflow findings;
- a file renamed into `.github/workflows/` from somewhere else is checked as a new workflow;
- a widened-permissions change is still caught when the old version can't be parsed.

## Requirement references
- Spec `docs/specs/2026-10-02-workflow-checks-hardening.md` (Status: approved): R8, R9, R10; AC8, AC9, AC10, AC14
- Jira ESP-5 (was GitHub #46; spec ticket T4, parent ESP-2 / #13)

## Acceptance criteria
- AC1 (spec AC8): Each of these allowlist entries, for a workflow rule, suppresses nothing and gives one warning that names the entry (its index, rule and path):
  - `{rule: 'wf-unpinned-action', path: '.github/workflows/*'}`
  - `{rule: 'wf-unpinned-action', path: '**/*.yml'}`
  - `{rule: 'wf-unparsed', path: '.github/workflows/ci.yml'}`

  A literal path is one with no `*`, `?`, `[`, `{`. It still counts as literal when it is matched case-insensitively (`ignoreCase` on Windows). A `wf-*` entry with only a `package` and no `path` never matches a workflow finding, as today, and also gives the warning (Francis, 2026-10-07: changed from "no warning" when fixing the security nit). The warning is a finding:
  - `{ rule: 'wf-allowlist-ignored', tier: 'warning', file: '.claude/engineering.json', line: 1, suppressed: false }`;
  - its detail names `governance.allowlist[i]`, the rule and the path, and says why the entry is ignored;
  - it is shown through `formatFinding`;
  - it appears once per entry per guard decision and once per CI run, however many workflows changed.

  This is pinned in `governance-rules.test.mjs` (unit), `governance-policy.test.mjs` (guard) and `governance-checks.test.mjs` (CI).
  - The warning doesn't make the config invalid. The guard doesn't turn it into a "Config problem" ask, and CI doesn't add it to errors. `parseAllowlist` returns the same `{ entries, problems }` as today, so `plugin-structure.test.mjs` is unchanged.
  - The guard logs the warning in the governance log on a workflow edit and adds it to the reason when it asks. CI lists it under warnings whenever workflow files are checked.
  - A literal-path `wf-*` entry still suppresses its finding and is logged as suppressed (B10 R15).
  - Broad `sc-*` and `fp-*` entries behave as today (R8 names workflow rules only).
  - Evidence:
    - Red: unit 3 fail (`true !== false` because they still suppressed; `0 !== 3` warnings); guard 3 fail (`suppressed true !== false`); CI 3 fail (`, suppressed`, no warning).
    - Green: governance-rules + governance-policy + governance-checks 242/242.
    - Covered: describe "allowlist: workflow entries need one literal path (R8; AC8)" (6 tests: the 3 entries, `?`/`[`/`{`, index/rule/path in the detail, config valid, literal and case-insensitive still suppress, no warning for sc/fp/package-only/missing); guard "a glob or wf-unparsed allowlist entry (R8; AC8)" (3 entries: unsuppressed, 1 warning, 1 log entry, in the ask reason for wf-unparsed, no Config problem; literal entry gives no warning; non-workflow edit gives nothing); CI the same 3 entries with 2 workflows changed (warning exactly once, finding unsuppressed, no config error) and no warning when no workflow changed.
    - (shown, 2026-10-07T00:50Z)
    - 2026-10-07 delta: red "should warn on a package-only workflow entry…" (`undefined !== 'wf-allowlist-ignored'`) and the CI workflow hint assertion; green governance-rules + governance-policy + governance-checks 244/244; the no-warning case now uses `npm-install-script`; mutations 1–8 all CAUGHT.
    - (shown, 2026-10-07T03:35Z)
- AC2 (spec AC9): A `governance-checks.test.mjs` test renames `docs/x.yml` (which has `permissions: write-all` and a job) to `.github/workflows/x.yml`, with the job's permissions changed. It gets the same findings as when the file is added (no `base`), and no `wf-permissions-widened` from comparing with `docs/x.yml`. A rename within `.github/workflows/` still compares with the old file.
  - Evidence:
    - Red: "should check a file renamed into .github/workflows from elsewhere as a new workflow (R9; AC9)" failed on `wf-permissions-widened` (contents: read → write against docs/x.yml). "Files changed: 1" shows that git saw a rename.
    - Green: governance-checks 59/59. The renamed findings equal the added-file findings (wf-write-all only). The existing "should check a renamed workflow against its old base version" still passes.
    - (shown, 2026-10-07T00:50Z)
    - Re-checked after the delta: governance-checks passes in the 824/824 gate; mutation 8 (R9 rename) CAUGHT.
    - (shown, 2026-10-07T03:35Z)
- AC3 (spec AC10): In `workflow-rules.test.mjs`, an old version with a parse problem and a new version that adds `contents: write` give `wf-permissions-widened` (warning). Its detail says the old version couldn't be parsed. When the old version can't be parsed:
  - every level (workflow and each job) is compared as if it granted no permissions;
  - a finding is given only when the new version grants a scope (or `read-all`/`write-all`) at that level;
  - a level with no permissions block in the new version gives nothing (Francis, 2026-10-06: only on real widening), unless the readable part of the old version has a block at that level: then the dropped block is reported, with a note that the old version could not be fully parsed (Francis, 2026-10-07: security Low fix);
  - an old version that parses but has a shape problem counts as unreadable too.
  - A parseable old version behaves as today, pinned by the existing tests.
  - Evidence:
    - Red: describe "checkWorkflow: widened permissions against an unparsable old version (ESP-5, R10; AC10)" 2 fail (actual `[]`).
    - Green: workflow-rules + workflow-parity 244/244:
      - adds contents: write gives one wf-permissions-widened with "contents: none → write" and "old version could not be parsed";
      - workflow read-all (line 2) and a new job's issues: write (line 5) are both reported with the note;
      - no block gives `[]`;
      - the existing R10/AC8 permission tests pass.
    - (shown, 2026-10-07T00:50Z)
    - 2026-10-07 delta: red "should warn on a dropped block that the readable part of the old version still shows" (actual `[]`); green workflow-rules + workflow-parity 245/245 (workflow line 1 and job line 3, both with the note). The shape-problem test catches mutation 10, which survived before it; mutations 9–14 all CAUGHT.
    - (shown, 2026-10-07T03:35Z)
- AC4 (spec AC14): `npm test` passes with 0 failures and 0 skipped/todo. `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exits 0. `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0. `tests/workflow-parity.test.mjs` passes.
  - Evidence:
    - npm test exit 0, 821/821, 0 fail/cancelled/skipped/todo.
    - fake-pass-check exit 0. Its one `fp-placeholder` warning, at governance-checks.test.mjs:334, was already on develop (line 294): a deliberate fixture string.
    - claude plugin validate . exit 0; claude plugin validate plugins/usiatech-engineering exit 0.
    - workflow-parity passes, in the 244/244 above.
    - (shown, 2026-10-07T00:50Z)
    - Re-run after the delta (last code edit 03:33Z): npm test exit 0, 824/824, 0 fail/cancelled/skipped/todo; fake-pass-check exit 0 (the same pre-existing fixture warning, now at governance-checks.test.mjs:336); both validates exit 0.
    - (shown, 2026-10-07T03:35Z)

## Tasks
- [x] T1: Branch `fix/allowlist-renames-perms-46` off `develop`; move ESP-5 to In Progress (ESP-5)
- [x] T2: Red: AC1 tests (unit, guard, CI); confirm the broad and `wf-unparsed` entries suppress today (covers AC1; ESP-5)
- [x] T3: Green: `applyAllowlist` skips a `wf-*` entry whose path isn't literal or whose rule is `wf-unparsed`. A new exported `allowlistWarnings(entries)` in `governance-rules.mjs` names each such entry. The guard (`governance-policy.mjs`) and CI (`governance-checks.mjs` step 4) report them.
  - The existing test "should mark a finding suppressed when rule and path glob both match" (`governance-rules.test.mjs`, `.github/workflows/*.yml`) is rewritten on purpose: R8 reverses it (spec constraint: "broad entries stop suppressing").
  - The template's allowlist `$comment` (`templates/engineering.json`) says that a `wf-*` entry needs one literal path.
  - (covers AC1; ESP-5)
- [x] T4: Red: AC2 test; confirm the rename is compared with `docs/x.yml` today (covers AC2; ESP-5)
- [x] T5: Green: for workflows only, `base` is null when the source path of a rename or copy isn't a workflow path. Dependency renames are unchanged (Francis, 2026-10-06) (covers AC2; ESP-5)
- [x] T6: Red: AC3 tests; confirm no `wf-permissions-widened` today (covers AC3; ESP-5)
- [x] T7: Green: `checkWorkflow` notes when `base` has parse or shape problems. `permissionRules` then compares against no permissions and adds the "could not be parsed" note (covers AC3; ESP-5)
- [x] T8: Run the full gate: npm test, fake-pass-check, both plugin validate runs (covers AC4; ESP-5)
- [x] T9: Stage 1 + stage 2 reviews; release into `develop` via PR (Francis merges); ESP-5 → In Testing (covers AC1–AC4; ESP-5)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`

## Commands and actions
- Standard gate (npm test, fake-pass-check, claude plugin validate) and release flow (branch, commit, PR into develop; Francis merges)
- Jira ESP-5 transitions and comments (In Progress at start, In Testing after the PR opens)

## Out of scope
- README and release notes for the R8 behaviour change (ESP-7 / R13; the spec puts the R8 README section there)
- Broad entries for `sc-*` and `fp-*` rules
- R1–R7, R11–R13 (other tickets); ESP-17, ESP-18 items
- Showing the R8 warning on edits or PRs that touch no workflow file (Francis, 2026-10-06)
- Renames into dependency files (R9 names workflows only)

## Approved
- By: Francis · Date: 2026-10-06
- Route: large (ESP-5 is one ticket from the approved large-route spec, already through clarify → to-spec → to-tickets)

## Change log
- 2026-10-06: plan drafted for ESP-5 (#46) on develop `21f5d83`.
- 2026-10-06: pre-flight FLAG (governance-reviewer).
  - Francis chose:
    1. R9 for workflows only;
    2. R10 warns only on real widening;
    3. the R8 warning shows only when workflows are checked.
  - Plan gaps fixed:
    - the reversed suppression test is named;
    - the warning's finding shape and its dedup are defined;
    - literal-path edge cases are covered;
    - `templates/engineering.json` is added to Files for the allowlist note.
- 2026-10-07: T2–T8 done.
  - Implementation notes:
    - `allowlistWarnings` takes the raw `governance.allowlist` (not the parsed entries), so the warning can name the entry's index in the raw list. The guard works it out in `sanitizeConfig` before invalid entries are dropped. It reuses `parseAllowlist` per entry, so invalid entries give a config problem, not a warning.
    - Adding a stub export first made the unit file fail on assertions rather than a missing-export SyntaxError.
    - `readChanged` takes `otherKindIsNew`, and only the workflow call sets it.
    - `checkWorkflow` now parses the base with `parseWorkflowYaml` plus `shapeProblems`.
  - Gate 2026-10-07T00:50Z: npm test 821/821, fake-pass 0, validates 0.
- 2026-10-07: T9 reviews on the uncommitted diff (develop `21f5d83` + 9 files). Nothing is committed yet.
  - Stage 1 governance: PASS.
    - Fixed its nit 7: a whitespace slip in `blockingFindings = (findings)`.
    - Nit 8: allowlist warnings are also added after an unreadable-edit `wf-unparsed`. Kept, since it matches the plan.
  - Stage 2 conventions: PASS WITH NITS (all ≤70). Shared glob metacharacter set; dense `before` ternary; comment at the `readChanged(..., true)` call; possible docs listing of `wf-allowlist-ignored`.
  - Stage 2 silent-failure: PASS WITH NITS.
    - The CI hint "allowlist them in the base-branch engineering.json" (`governance-checks.mjs` ~173) is now misleading for `wf-unparsed` and globs; reword it.
    - The guard's warning is log-only (as for other warnings).
  - Stage 2 security: PASS WITH NITS, one Low (conf 90), confirmed by running both versions.
    - With an unreadable base, `if (baseUnreadable) continue` hides a **dropped** permissions block. develop reports it, because the partial parse still sees the old block.
    - Suggested fix: under `baseUnreadable`, a missing block in the new version still gives `wf-permissions-widened` with the note, but only where the partial base parse shows a block at that level (otherwise a missing block stays silent, as Francis chose). This needs Francis's decision: it touches the "only on real widening" choice.
    - Nit: a `wf-*` entry with `package` only and no path suppresses nothing and gives no warning (unchanged from before).
  - Pending: Francis decides on the security Low and which nits to fix; the optional mutation-test run (the diff touches rules/checks/policy files); then the commit, the PR into develop and ESP-5 → In Testing.
- 2026-10-07: Francis chose to fix the security Low, fix the two recommended nits and run the mutation test. All three were done test-first.
  - Security Low: when the base is unreadable, a dropped block is still reported if the partial base parse has a block at that level (`baseBlock`). The finding adds `UNREADABLE_BASE_DROPPED_NOTE`. Where the partial base has no block, nothing is reported. Red: actual `[]`. Green: workflow-rules + workflow-parity 245/245.
  - Nit (silent-failure 1): the CI hint for workflow findings adds `WORKFLOW_ALLOWLIST_HINT`; other kinds keep the old hint (tested both ways).
  - Nit (security): a package-only `wf-*` entry gives `wf-allowlist-ignored` (`ignoredWorkflowEntry` now includes `path == null`). The old "no warning for a package-only entry" test now uses `npm-install-script`. Red: 2 fails. Green: governance-rules/policy/checks 244/244.
  - Mutation test, 14 mutations: 13 CAUGHT on the first run (2 NOT-FOUND were list errors, caught on re-run). 1 SURVIVED: shape problems in the base making it unreadable. Francis chose to add the test. A base with a plain-string step (`- echo hi`) gives a shape problem and no parse problem. The test is caught by the mutation re-run. Result: 14/14 caught; the runner left the tree unchanged.
  - Stage 1 on the delta: FLAG, procedural only (the AC evidence stamps were older than the last code edit). Fixed by re-stamping AC1–AC4 at 03:35Z from the gate below; AC1/AC3 wording updated for the two decisions. No scope findings.
  - Stage 2 on the delta: conventions PASS (nit: long `findings.push` line with the conditional note at workflow-rules.mjs ~576); silent-failure PASS; security (opus) PASS: the Low is closed (it ran the cases against the current code) and no new bypass was found. README wording for the new details stays with ESP-7.
  - Gate 2026-10-07T03:35Z: npm test 824/824 (0 fail/skip/todo), fake-pass exit 0 (the same pre-existing fp-placeholder, now governance-checks.test.mjs:336), both validates exit 0.
- 2026-10-07: Committed `d3006b6`, PR #58 into develop, CI green; ESP-5 → In Testing (comment 10791). Parked at `paused-esp5.md` while ESP-9 shipped. Francis chose to merge #58 before #59; Claude merged PR #58 (`45f80d8`). The ESP-9 branch then merged develop and resolved the only conflict (the `templates/engineering.json` `$comment`, both texts kept); PR #59 merged as `0c75a5c`, gate 894/894.

## Final status
- **Shipped:** commit `d3006b6`, PR #58 merged into `develop` (`45f80d8`). Promotion to `main` is pending in PR #55. Jira ESP-5 → Ready for Release.
- AC1 (spec AC8): met (evidence shown, 2026-10-07T03:35Z).
- AC2 (spec AC9): met (evidence shown, 2026-10-07T03:35Z).
- AC3 (spec AC10): met (evidence shown, 2026-10-07T03:35Z).
- AC4 (spec AC14): met (evidence shown, 2026-10-07T03:35Z; re-run after the merge with ESP-9: npm test 894/894, fake-pass 0, both validates 0, CI green on 4 jobs).
- **Deviations:**
  - The security Low (dropped block under an unreadable base) and two nits were fixed inside ESP-5 (Francis's decision); mutation test 14/14 caught after one added test.
  - Claude merged PR #58 at Francis's go-ahead on the merge order, instead of Francis merging it (T9 said Francis merges).
  - README wording for R8 and the new details stays with ESP-7.
  - No version bump: ships with 0.10.0 (ESP-7).
