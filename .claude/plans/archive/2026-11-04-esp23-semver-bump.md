# Plan: Semver bump on every release, from commit types

## Final status
- Status: shipped. Branch: `feat/esp23-semver-bump`.
- Acceptance criteria: AC1 to AC8 all shown (gate run 2026-11-04T23:33:35Z; see the Evidence lines).
- Deviations: route override to small. The Change log records the scope changes after pre-flight, `/code-review high` and stage 2. The first real use of the flow is the next release.

## Goal
The release skill computes the next version from the conventional commits since the last `vX.Y.Z` tag and ships it through a bump PR into the base branch, replacing the hand-made bump. Repos opt in by config, so repos on date tags don't change.

## Requirement references
- ESP-23 (GitHub #73)

## Pre-plan checklist
- (a) New validation rules and format checks: `git.versionFiles`, `git.changelogFile` and the `vX.Y.Z` value of `git.tagFormat` are new. Searched for `tagFormat` and `git.` readers: `templates/engineering.json:31` sets `tagFormat` to `DDMMMYYYY-XX`; `hooks/scripts/governance-policy.mjs:265` validates only `git.releaseBranch`; `templates/github/scripts/governance-checks.mjs:167-168` reads only the branches. No existing caller reads the new keys, so only `next-version.mjs` validates them. Fixtures: `tests/plugin-structure.test.mjs:750` keeps plugin, marketplace and both README versions in step, and still applies.
- (b) Database or infrastructure mechanisms the design relies on: n/a: no database or infrastructure. The one git behaviour relied on was checked: `git describe --tags --abbrev=0 develop` returns `v0.9.0` while the newest tag is `v0.20.2`, because tags sit on promotion merges that `develop` lacks. So the helper lists tags with `git tag -l` and compares them as versions.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (skill table line 10, config table line 50, plus the bump rule) and `plugins/usiatech-engineering/templates/engineering.json`. Searched `docs/` ADRs (0001, 0002, 0003, batch decisions): none covers versioning or needs a change. `docs/specs/2026-10-09-jira-ticket-tracker.md:18` and `docs/specs/2026-10-09-plan-edits-all.md:16` name ESP-23 only as out of scope, so they stay as they are. No docs reviewer is configured.

## Acceptance criteria
- AC1: `next-version.mjs` picks the level from commit messages since the last tag: any `feat` gives minor with patch reset; `type!:` or a `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer gives major with minor and patch reset; anything else, including a subject that isn't conventional, gives patch. Shown by named tests in `tests/next-version.test.mjs`, on the level functions and against temporary git repos.
  - Evidence: gate run 2026-11-04T23:33:35Z, tests pass in `next-version: level rules (AC1)` (8 tests) and `next-version: commits in a repo (AC1)` (4 tests, temporary git repos) (shown, 2026-11-04T23:33Z)
- AC2: The last tag is the highest `vX.Y.Z` by version order, and is found even when it isn't reachable from the base branch. `v0.10.0` beats `v0.9.0`, and non-matching tags are ignored. Shown by a test with a tag on a side branch and by a test of the ordering.
  - Evidence: gate run 2026-11-04T23:33:35Z, `next-version: last tag (AC2)` passes: "should compare tags as versions, not text", "should find the newest tag when the base branch cannot reach it", "should ignore tags that are not vX.Y.Z" (shown, 2026-11-04T23:33Z)
- AC3: `--level patch|minor|major` overrides the computed level, and the JSON output carries both `computedLevel` and `level` with `override: true`. A bad level exits 2. Shown by tests.
  - Evidence: gate run 2026-11-04T23:33:35Z, `next-version: override (AC3)` passes: "should apply --level and report both levels", "should not mark a run with no --level as an override", "should refuse a bad level, a missing value and an unknown argument"; fake-pass check has no findings (shown, 2026-11-04T23:33Z)
- AC4: A release bumps once. A `chore(release): X.Y.Z` commit since the last tag, with a newer version, makes the helper report `"bumpMerged":true`, compute no new version, and report `commitsAfterBump`, counted from the commit graph so a commit written before the bump but merged after it counts. The `release` skill shows those commits and asks before promoting. The helper exits 2, naming the file, when a file in `git.versionFiles` doesn't contain the expected version (the merged bump's, otherwise the last tag's). It also exits 2 with no commits since the tag, and with no `vX.Y.Z` tag. Shown by tests.
  - Evidence: gate run 2026-11-04T23:33:35Z, `next-version: one bump per release (AC4)` passes (12 tests), including "should report a merged bump, not compute another", "should count a commit written before the bump but merged after it", "should refuse a merged bump that missed a version file, naming the file", "should refuse a release with no commits since the tag", "should refuse when there is no vX.Y.Z tag"; `skills/release/SKILL.md` line 48 shows the commits and asks when `commitsAfterBump` is above zero; fake-pass check has no findings (shown, 2026-11-04T23:33Z)
- AC5: With no config file, or a missing or empty `git.versionFiles` in the base-branch config, the helper prints `{"enabled":false}` and exits 0, and the release skill follows its existing tag flow. A config that can't be parsed exits 2, so it never reads as opted out. A config found only in the working copy, opted in or not, or a base-branch config naming a different `git.baseBranch`, exits 2. A non-empty `git.versionFiles` with a `git.tagFormat` other than `vX.Y.Z`, `git.tagFormat` set to `vX.Y.Z` with no version files, or a bad `git.versionFiles` or `git.changelogFile`, exits 2. Shown by tests.
  - Evidence: gate run 2026-11-04T23:33:35Z, `next-version: git config rules (AC5)` (6 tests) and `next-version: config source (AC5)` (9 tests) pass; `release` section 3 step 2 skips the bump on `{"enabled":false}` (diff, `skills/release/SKILL.md` line 47); fake-pass check has no findings (shown, 2026-11-04T23:33Z)
- AC6: `release` phase 3 tells the agent, when opted in, to update the base branch and fetch tags, run the helper, show the level, wait for the user to confirm or override it, open one `chore(release)` PR into the base branch with the version files and changelog row, record an override in that commit body, and only then promote and tag. If the helper reports that a merged bump is waiting for promotion, the agent goes on to promote rather than bump again. A bump PR whose diff touches only the listed version files and changelog row, where each changed version-file line differs by the version string alone and the changelog change is one added row, runs the gate with no reviewer round and says so in the PR; any other diff gets the full release review. `release-steps` tags `vX.Y.Z` from the version files when `git.tagFormat` is `vX.Y.Z`, and for that format takes the previous tag from the helper's `previousTag`, not `git describe`. Shown by assertions in `tests/plugin-structure.test.mjs` that pin confirm-the-level, the bump PR, promote-after-bump and `previousTag`.
  - Evidence: gate run 2026-11-04T23:33:35Z, tests pass: "should keep the version bump steps in the release skill, in order (ESP-23 AC6)", "should tag vX.Y.Z from the version files in release-steps (ESP-23 AC6)", "should take the previous vX.Y.Z tag from next-version, not git describe (ESP-23)"; fetch-tags step and full-review path read in `skills/release/SKILL.md` lines 46 and 52 (shown, 2026-11-04T23:33Z)
- AC7: `.claude/engineering.json` opts this repo in with `git.versionFiles` = `plugins/usiatech-engineering/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`; `git.changelogFile` = `plugins/usiatech-engineering/README.md`; `git.tagFormat` = `vX.Y.Z`. The plugin README states the patch/minor/major rule with its resets, both new keys, the `vX.Y.Z` tag format, and that a repo moving from date tags needs a first `vX.Y.Z` tag by hand. `templates/engineering.json` describes the new keys without setting them, so new repos stay on date tags. Shown by the diff; the plugin-structure version test still passes.
  - Evidence: diff of `.claude/engineering.json` (`git` block with the listed values), `plugins/usiatech-engineering/README.md` (`## Semver bump`) and `plugins/usiatech-engineering/templates/engineering.json` (`git.$comment`; `tagFormat` stays `DDMMMYYYY-XX`); gate run 2026-11-04T23:33:35Z, "should keep plugin, marketplace and both README versions in step" passes (shown, 2026-11-04T23:33Z)
- AC8: `npm test` and both `claude plugin validate` runs exit 0.
  - Evidence: gate run 2026-11-04T23:33:35Z: `npm test` exit 0 (1,976 pass, 0 fail, 4 skipped, plus 1 pass in the second run), `claude plugin validate .` exit 0, `claude plugin validate plugins/usiatech-engineering` exit 0 (shown, 2026-11-04T23:33Z)

## Tasks
- [x] T1: Write failing tests for level, tag choice, override and failure cases, then build `next-version.mjs` test-first (covers AC1, AC2, AC3, AC4, AC5; ESP-23)
- [x] T2: Export `readConfigText`, `SEMVER` and `compareVersions` from `session-check.mjs`, have `readConfigText` return its base branch, and import them in the helper, so they aren't copied (covers AC2, AC5; ESP-23)
- [x] T3: Add the opted-in bump flow to the `release` and `release-steps` skills, and pin its key steps in the structure test (covers AC6; ESP-23)
- [x] T4: Opt this repo in, describe the keys in the template and update the README (covers AC7; ESP-23)
- [x] T5: Run the gate and the release reviews, including the global `/code-review high` step (covers AC8; ESP-23)
- [x] T6: Commit and open the PR (ESP-23)

## Files
- `plugins/usiatech-engineering/scripts/next-version.mjs`
- `plugins/usiatech-engineering/tests/next-version.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/scripts/session-check.mjs`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/release-steps/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `.claude/engineering.json`
- `.claude/plans/archive/2026-11-04-esp23-semver-bump.md`

## Commands and actions
- None beyond the normal release flow. No dependency is added.

## Out of scope
- Writing the version files from the helper: it computes and checks, and the agent edits, so each repo's file formats need no parser.
- `setup-engineering`: opt-in is documented in the README and the template only.
- A guard check on the new keys: the guard doesn't read them.
- Pre-release and build version suffixes.
- Back-merging `main` into `develop`, and the `git describe` step for repos on other tag formats.
- Releasing 0.21.0: this plan ends at the PR. The first opted-in release is its own step.

## Approved
- By: Francis · Date: 2026-11-04
- Route: small (override: Francis chose "treat as small"; the rule puts this on the large route because it touches more than 5 files and adds a module and config keys)

## Change log
- 2026-11-04: Route override to small, bump PR into the base branch, and opt-in by config, all chosen by Francis.
- 2026-11-04: After the pre-flight FLAG, Francis chose to document the keys in the template, to give a version-files-only bump PR the gate with no reviewer round, and to pin the flow's wording in the structure test. Francis noted the 7 background-command `error` log entries from ESP-145 and ESP-146 work; they need no plan change.
- 2026-11-04: After `/code-review high`, Francis chose to fix the `git describe` previous-tag step for `vX.Y.Z` repos in this PR (AC6 and Out of scope changed), and to leave the case of no config and no base branch reading as not opted in. Review fixes also changed AC1 (level tests on functions, to cut gate time), AC4 (a merged bump is reported from its commit, because a version file can't show it reliably), AC5 (config-source refusals) and T2 (more imports from `session-check.mjs`). No file was added.
- 2026-11-04: After stage 2, Francis chose to add `commitsAfterBump` with an ask before promoting (AC4), and to have version-only bump PRs skip the global review gates as well (a memory rule; CLAUDE.md unchanged). Reviewer fixes: a config found only in the working copy always refuses (AC5, silent-failure), and the review skip is scoped by content, not only by file (AC6, security). Francis also approved commit and PR after the re-review and final gate.
