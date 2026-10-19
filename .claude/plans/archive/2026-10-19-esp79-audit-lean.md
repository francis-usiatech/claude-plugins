# Plan: Audit PR E — lean cleanup (ESP-79)

**Final status: shipped** on branch `feature/esp79-audit-pr-e` (closed 2026-10-19). AC1–AC6 all shown: see the Evidence lines (last Gate: PASS at 2026-10-19T18:17:40Z). Reviews: pre-flight FLAG (fixed); stage 1 FLAG (acknowledged by Francis, no action); stage 2 convention, silent-failure and security all PASS, nits only. Deviations: two extra test files and re-audit R12 added by approved scope changes; AC2 narrowed to `.mjs` files; no mutation test (refactor, as planned).

## Goal
Close ponytail-audit finding F15 with no change in behaviour: merge duplicate helpers into one imported copy, delete two hook aliases, and drop `export` from symbols no other file imports. Fold in two PR D nits (README "password", the doubled `siteShapeProblem` call). Then re-run /ponytail-audit on the branch.

## Requirement references
- `docs/audits/2026-10-17-ponytail-audit.md` F15 (lines 148–164) and its "How to use this brief" rules (smallest change, grep the whole tree before each removal)
- ESP-79 (sub-task of ESP-74)
- `AGENTS.md`: "Shared helpers are imported, not copied", "Export only what another file imports", and the no-change-path import limit for hook scripts (AC6 timing test)
- PR #123 (ESP-78) review nits: README Jira Keys line omits "password"; `jiraProblems` calls `siteShapeProblem(j.site)` twice

## Pre-plan checklist
- (a) New validation rules and format checks: none are new. The merged helpers keep their behaviour; callers and fixtures were searched with `grep -rnw` over the plugin (code, tests, markdown, JSON), `docs/` and `AGENTS.md` for every F15 symbol:
  - `isPlainObject`: defined in `governance-rules.mjs:28` (`!!v && …`), `gate.mjs:29` and `jira-tracker.mjs:15` (`v != null && …`). Same result for every value. Importers of the governance-rules copy: `governance-policy.mjs`, `governance-checks.mjs`, `fake-pass-check.mjs`.
  - `isObject` (`supply-chain-rules.mjs:27`, and a fourth copy indented inside a function at `supply-chain-lookups.mjs:196` that the audit missed) and `isObj` (`workflow-rules.mjs:362`): same function.
  - `escapeRe` (`supply-chain-rules.mjs:581`, one caller at `:584`) is `escapeRegExp` (`governance-rules.mjs:25`; importer `governance-policy.mjs:13`).
  - `TIER`: defined in `workflow-rules.mjs:5` (re-exported by `governance-rules.mjs:77`), `fake-pass-rules.mjs:9` and `supply-chain-rules.mjs:445`. `supply-chain-lookups.mjs:5` imports it from supply-chain-rules, `tests/fake-pass-rules.test.mjs:6` from fake-pass-rules (pre-flight finding 1), and `governance-policy.mjs:15` from governance-rules. The lookups import and the test import are pointed at `workflow-rules.mjs`.
  - `isText` (`gate.mjs:30`) is `isNonEmptyString` (`jira-tracker.mjs:16`). `mutation-runner.mjs:25` `isText` (no trim) is left alone, as the audit says.
  - **Import cycle:** `governance-rules.mjs` imports `workflow-rules`, `supply-chain-rules` and `fake-pass-rules`, so those three can't import from it without a cycle. `workflow-rules.mjs` has no imports and already holds the shared `TIER` and `GIT_PREFIX`, so `isPlainObject` and `escapeRegExp` move there and `governance-rules.mjs` re-exports them (its importers don't change). `workflow-rules.mjs` gains no import, so the hook's lazy `import('…/workflow-rules.mjs')` at `bash-workflow-check.mjs:322` loads nothing new.
  - `isNonEmptyString` is added to `workflow-rules.mjs` next to `isPlainObject` (not re-exported). `gate.mjs` and `jira-tracker.mjs` import both from `workflow-rules.mjs`, so jira-tracker loads one import-free module, not all the rules modules (pre-flight note, confidence 60). jira-tracker already imports `main-module.mjs` from the same folder.
  - Aliases: `snapshotFolderProblem` (`bash-workflow-check.mjs:38`) is used only by `tests/bash-workflow-check.test.mjs:643-661`, which is the only test of `stateFolderProblem`, so that test is pointed at `stateFolderProblem` from `governance-state.mjs` rather than deleted. `snapshotDir` (`:35`) is used by `checkedSnapshotDir` (`:42`) and 43 times in the same test file (17 `import(` lines); they use `stateDir` from `governance-state.mjs`, and the `describe('snapshotFolderProblem (fix set D)')` title at `:643` is renamed.
  - Dropped exports, each with no importer outside its file (tests included): `TRACKERS`, `EVENTS` (jira-tracker); `DEFAULT_TIMEOUT_MS`, `RestoreError`, `formatReport` (mutation-runner); `runFakePassCheck` (fake-pass-check); `blankCode` (fake-pass-rules); `MANIFEST_SECTIONS`, `POPULAR_PACKAGES`, `typosquatOf` (supply-chain-rules). **Kept** against the audit list: `ListError` and `validateList`, which `tests/mutation-runner.test.mjs:389` imports.
- (b) Database or infrastructure mechanisms: n/a: a refactor with no new mechanism; ESM re-export (`export { x } from`) is already used by `governance-rules.mjs:77-82`.
- (c) Docs and ADRs touched: searched the README, `docs/`, the ADRs, the skills and `AGENTS.md` for every symbol above and for "user name".
  - Touched:
    - `plugins/usiatech-engineering/README.md:76` (Jira Keys: "no path, port, user name, password, query or fragment") and the unreleased 0.18.2 row (`:316`): the same wording in its ESP-78 entry, plus one sentence for ESP-79 (no behaviour change; re-copy `templates/github/scripts/`, since its files changed).
    - `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs` header comment: it also holds the shared helpers.
  - Not touched: `AGENTS.md` already says to take `isPlainObject`, `escapeRegExp` and `TIER` from governance-rules "or the module that defines them", which stays true. `docs/superpowers/plans/2026-09-28-step-2-review-depth.md:338` is a historical plan. No ADR covers these helpers. No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (F15 duplicates): `grep -rnE "const (isPlainObject|isObject|isObj|escapeRe|escapeRegExp|isNonEmptyString|isText) =|const TIER =" plugins/usiatech-engineering --include=*.mjs` lists exactly: `isPlainObject`, `escapeRegExp`, `isNonEmptyString` and `TIER` in `workflow-rules.mjs`, and `isText` in `mutation-runner.mjs`.
  - Evidence: the AC1 grep lists TIER, isPlainObject, isNonEmptyString and escapeRegExp in workflow-rules.mjs:5-11 and isText in mutation-runner.mjs:25, nothing else (shown, 2026-10-19T17:33Z)
- AC2 (F15 aliases): `snapshotDir` and `snapshotFolderProblem` appear in no `.mjs` file of the plugin (the README 0.18.2 row names them as removed); the seven folder cases in `tests/bash-workflow-check.test.mjs` run against `stateFolderProblem` and pass.
  - Evidence: grep -rnw for snapshotDir and snapshotFolderProblem: 0 hits in plugin .mjs files (the 1 hit is the README 0.18.2 sentence); tests/bash-workflow-check.test.mjs 62 pass, 0 fail, including the seven stateFolderProblem cases (shown, 2026-10-19T17:33Z)
- AC3 (F15 exports): none of the ten symbols listed in (a) is exported; `ListError` and `validateList` still are.
  - Evidence: grep for an export of any of the ten symbols: 0 hits; mutation-runner.mjs:22 `export class ListError` and :60 `export const validateList` kept (shown, 2026-10-19T17:33Z)
- AC4 (nits): `README.md` Jira Keys line and 0.18.2 row say "user name, password"; `jiraProblems` calls `siteShapeProblem` once per check, and the F13 `check` tests still pass.
  - Evidence: README.md "user name, password" 2 hits (Keys line, 0.18.2 row); jira-tracker.mjs has 1 `siteShapeProblem(j.site)` call (const siteProblem); F13 check tests green in the gate run (shown, 2026-10-19T17:33Z)
- AC5 (no behaviour change): `npm test` in `plugins/usiatech-engineering` is green, including `plugin-structure.test.mjs` and the AC6 timing test, with no test changed except the alias imports in AC2 (including `bash-workflow-timing.perf.mjs` and `governance-policy.test.mjs`) and the `TIER` import in `tests/fake-pass-rules.test.mjs`. Then `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS.
  - Evidence: first npm test run: 1 fail (bash-workflow-check.test.mjs:484, a call argument cut by the alias-removal regex), fixed, file rerun 62/62; then node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-19T17:33:50Z (tests 129 s incl. the AC6 timing test and plugin-structure, both validations, fake-pass check; one expected fp-placeholder warning on the PLACEHOLDER regex at fake-pass-rules.mjs:148) (shown, 2026-10-19T17:33Z); after the dead-import fix and R12, the gate printed Gate: PASS again at 2026-10-19T18:17:40Z (tests 124 s, both validations, fake-pass check, same single warning) (shown, 2026-10-19T18:17Z)
- AC6 (re-audit): /ponytail-audit has run on the branch after AC5; its report is committed as `docs/audits/2026-10-19-ponytail-audit.md` and shown to Francis, who decides what is filed.
  - Evidence: /ponytail-audit ran (3 read-only agents: F1–F19 closure, guard/CI, skills/scripts); F1–F19 closed, with all 21 deliberate breaks of the fixes failing a test; 17 new findings R1–R17 saved as docs/audits/2026-10-19-ponytail-audit.md and shown to Francis, who chose a new Jira parent ESP-105 with sub-tasks ESP-106..109 and folded R12 into ESP-79 (shown, 2026-10-19)

## Tasks
- [x] T1: Move `isPlainObject` and `escapeRegExp` into `workflow-rules.mjs` (renaming `isObj`), re-export them from `governance-rules.mjs`; add `isNonEmptyString` to `workflow-rules.mjs` (covers AC1; ESP-79)
- [x] T2: `supply-chain-rules.mjs`, `supply-chain-lookups.mjs`, `fake-pass-rules.mjs`: import `TIER`, `isPlainObject` and `escapeRegExp` from `workflow-rules.mjs`; delete the local copies; `tests/fake-pass-rules.test.mjs` imports `TIER` from `workflow-rules.mjs` (covers AC1; ESP-79)
- [x] T3: `gate.mjs` and `jira-tracker.mjs`: import `isPlainObject` and `isNonEmptyString` from `workflow-rules.mjs`; delete the local copies and rename `isText` in gate.mjs (covers AC1; ESP-79)
- [x] T4: Delete `snapshotDir` and `snapshotFolderProblem`; `checkedSnapshotDir` and the tests use `stateDir` and `stateFolderProblem` from `governance-state.mjs` (covers AC2; ESP-79)
- [x] T5: Drop `export` from the ten symbols, plus R12's `DEFAULT_TRUSTED_WRITE_PATHS`, `DENY_CONTENT` and `ASK_CONTENT` (Change log 2026-10-19) (covers AC3; ESP-79)
- [x] T6: `jiraProblems` computes `siteShapeProblem(j.site)` once; README "password" in the Keys line and the 0.18.2 row, plus the ESP-79 sentence; workflow-rules header comment (covers AC4; ESP-79)
- [x] T7: `npm test`, then the gate on a quiet machine (covers AC5; ESP-79)
- [x] T8: Run /ponytail-audit on the branch, save the report as `docs/audits/2026-10-19-ponytail-audit.md` and show the findings (covers AC6; ESP-79)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/supply-chain-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/supply-chain-lookups.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/hooks/scripts/bash-workflow-check.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-rules.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-timing.perf.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `docs/audits/2026-10-19-ponytail-audit.md`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`

## Commands and actions
- None beyond the normal gate and release flow. No mutation test: the change is a refactor with no new branch, and AC5 is the guard.

## Out of scope
- Dropping the partial first line of a cut 64 KB tail (optional PR D nit; behaviour change, not lean).
- `mutation-runner.mjs` `isText` (different meaning).
- Fixing anything the re-audit finds; new findings become tickets after Francis decides.
- Release 0.18.2.

## Approved
- Francis, 2026-10-19. Route: large with override (Francis: "large route with override", the audit F-number is the requirement reference, no separate spec, as for PRs A–D).

## Change log
- 2026-10-19: drafted. Route override to large without clarify/to-spec/to-tickets, as for PRs A–D.
- 2026-10-19: pre-flight FLAG (governance-reviewer): the fake-pass-rules test's TIER import is repointed and the test added to Files (finding 1); snapshotDir count and line numbers corrected (findings 2, 3); isNonEmptyString lives in workflow-rules so jira-tracker stays light (note, confidence 60).
- 2026-10-19: approved by Francis as drafted (test TIER import repointed); the re-audit report is committed to docs/audits (Francis).
- 2026-10-19: scope change approved by Francis: `tests/bash-workflow-timing.perf.mjs:9` and `tests/governance-policy.test.mjs:6` also import `snapshotDir` (the planning grep was cut at 25 lines); both switch to `stateDir` from `governance-state.mjs` and are added to Files.
- 2026-10-19: scope change approved by Francis: re-audit R12 folded in — drop `export` from `DEFAULT_TRUSTED_WRITE_PATHS` (governance-policy.mjs, added to Files), `DENY_CONTENT` and `ASK_CONTENT` (governance-rules.mjs); and the dead `stateFolderProblem` import left in bash-workflow-check.mjs is removed. The re-audit findings are filed as a new Jira parent with grouped sub-tasks (Francis).
- 2026-10-19: release stage 1 FLAG (governance-reviewer), acknowledged by Francis, no action: (1) two background commands of the re-audit agents (scratchpad npm test log, closure-mutate script in a scratchpad copy) were logged as after-Bash `error` entries (workflow check not run); no workflow file changed; (2) T8's re-audit caused 6 asks and 1 deny on scratchpad test folders and guard probes, part of T8.
- 2026-10-19: AC2 wording narrowed to `.mjs` files, since the README changelog sentence for ESP-79 names the removed aliases (no scope change).
