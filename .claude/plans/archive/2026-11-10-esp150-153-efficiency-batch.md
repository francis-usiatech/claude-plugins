# Plan: ESP-150..153 efficiency batch (guard asks, wait-loop errors, lighter pre-flight, docs-set version)


## Final status
- Status: shipped (closed 2026-11-10, in the same commit as the work)
- Branch: `feature/esp150-153-improvements`, PR into `develop`
- Acceptance criteria: AC1–AC9 all shown (full gate 2026-11-10T19:12:34Z, Gate: PASS).
- Release review: round 1: governance FLAG (pre-plan after-Bash `error`, acknowledged by Francis), convention PASS, silent-failure PASS WITH NITS, security FAIL (3 PowerShell bypasses of `trustedDeletePaths`), fixed test-first. Round 2 (the fix touched `governance-policy.mjs`): governance FLAG (the same acknowledged item only), convention, silent-failure and security PASS WITH NITS. Mutation run on the security-fix checks skipped (Francis).
- Jira: ESP-150, 151, 152, 153 moved In Progress → In Testing (testingComplete, connector, transition 31).
- Deviations: `scripts/next-version.mjs` added to Files (exports `isRepoPath`); `trustedDeleteEntry` refuses `:`, `\`, wildcards and folders ending in `.` or a space after the security review; mapping Jira `testingStarted` to "In Testing" goes to a follow-up change.

## Goal
Cut routine guard prompts and false fail-open errors, make the small-route pre-flight cheaper when no sensitive path is touched, and let a release assign a docs-set version so parallel PRs stop renumbering. One PR, built ticket by ticket.

## Requirement references
- ESP-150 (AC1–AC4): `git branch -d` and trusted recursive deletes need no ask
- ESP-151 (AC1–AC3): read-only wait loops get no `error`
- ESP-152 (AC1–AC4): `planning.sensitivePaths` and the lighter pre-flight
- ESP-153 (AC1–AC4): `docVersions` bump at release
- ADR-0004 (the read-only command split ESP-151 reuses)

## Pre-plan checklist
- (a) New validation rules: `governance.trustedDeletePaths` entries (searched `trustedEntryProblem`, `sanitizeConfig` and their fixtures in `tests/governance-policy.test.mjs`); `planning.sensitivePaths` (reuses `isPathPrefix`, as `checkPlanning` does for `when`; fixtures in `tests/governance-policy.test.mjs`); `docVersions` entries (validated by the new script only; no other caller reads the key, searched `docVersions` repo-wide: no hits).
- (b) n/a: no database or infrastructure mechanism. Link and junction resolution reuses the guard's existing `realOf` helper, already proven for trusted write paths.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (config table, Trusted writes section, advisory-problem list, Semver bump section, changelog row); `docs/adr/0004-guard-drop-deny-scope.md` (one addendum line: the read-only list gains `sleep` and bash loop keywords, and the after-Bash check reuses it). Search for `trustedWritePaths`, `preflightReviewers` and `versionFiles` in `docs/` found only older specs (2026-10-10, 2026-10-16, 2026-11-07), which are historical and stay unchanged.

## Acceptance criteria
- AC1 (ESP-150 AC1): `git branch -d feature/x` → no prompt, logged as `trusted`; `git branch -D feature/x`, `git branch -d -f x`, `git branch --delete --force x`, `git branch -dr origin/x` and `git push origin --delete x` → ask. Proven by guard tests.
  - Evidence: gate run 2026-11-10T19:12:34Z PASS; spec run of tests/governance-policy.test.mjs, describe "evaluate: trusted branch and build-output deletes (ESP-150; AC1–AC3)": "should trust: git branch -d feature/x" and "should ask" for git branch -D feature/x, -d -f x, -df x, --delete --force x, -dr origin/x, git push origin --delete x pass (shown, 2026-11-10T19:12Z)
- AC2 (ESP-150 AC2): with `governance.trustedDeletePaths: ["apps/*/.next"]`, `rm -rf apps/web/.next` → no prompt, logged `trusted`; `rm -rf apps/web/.next ../other` → ask; `rm -rf .` → deny as today; a target that is a link or junction leaving the project → ask; a `cd` before the delete, an unquoted wildcard or a `$` → ask. Proven by guard tests.
  - Evidence: same describe: "should trust with trustedDeletePaths: rm -rf apps/web/.next" (and 7 more), "should ask with trustedDeletePaths" for ../other, $D, cd apps &&, dist/*, "should ask when a trusted path is a link or junction that leaves the project", "should still deny a root or home delete with trustedDeletePaths set" pass; 9 security-fix PowerShell asks (FileSystem::, Temp:, env:, quoted wildcards, .git./dist, a./dist) pass, red before the fix per caller evidence (shown, 2026-11-10T19:12Z)
- AC3 (ESP-150 AC3): an absolute, `..`, `.`, `.git`, `.claude`, wildcard-only, backslash or non-string `trustedDeletePaths` entry is dropped with one advisory `warn`; a non-list value trusts nothing. Proven by `sanitizeConfig` tests.
  - Evidence: same describe: "should drop bad trustedDeletePaths entries as advisory problems" passes (shown, 2026-11-10T19:12Z)
- AC4 (ESP-151 AC1, AC2): the after-Bash check logs no `error` for the background command `until test -f "<scratchpad>/linux-gate.exit"; do sleep 20; done; cat "<scratchpad>/linux-gate.exit"`, and the guard gives it no prompt; a loop whose body holds `rm -rf x` or `git push --force` is still asked by the guard, and a background command that isn't read-only still logs the error. Per ADR-0004, the drop-database deny still fires for loops and `sleep` next to a program: `until psql -c "drop database x"; do sleep 1; done`, `sleep 1 && psql -c "drop database x"`, and a `$(…)` in the loop condition; a mutation test on the new read-only words and keyword strip is caught. Proven by tests with that exact command.
  - Evidence: tests/governance-policy.test.mjs "evaluate: read-only wait loops (ESP-151; AC4)" (exact wait loop no prompt; risky loop bodies ask; until psql / sleep 1 && psql / $(…) in condition still deny) and tests/bash-workflow-check.test.mjs "should log nothing for a read-only background command (ESP-151; AC4)" / "should still log a background command that isn't read-only" pass; mutation run 2026-11-10 (caller evidence): 13 of 13 fix points caught (shown, 2026-11-10T19:12Z)
- AC5 (ESP-152 AC1–AC3): `approve-plan` says: with `planning.sensitivePaths` set, a small-route plan whose Files has no entry under a sensitive path, an ask path (`governance.askPaths` plus the defaults) or a governance file runs `governance-reviewer` pre-flight on `sonnet` with the light checklist, and the Approved line names the model; any sensitive entry, or the large route, runs the agent file's model with full checks; with no `sensitivePaths` the current rule (5 paths or fewer → `sonnet`) applies unchanged. When `sensitivePaths` is set it replaces the 5-path rule; a `reviewerModels` entry still wins over both. `governance-reviewer.md` defines the light checklist (requirement reference, Files list, AC measurability, pre-plan checklist). A bad `planning.sensitivePaths` is an advisory config problem (`sanitizeConfig` test).
  - Evidence: tests/governance-policy.test.mjs "sanitizeConfig: planning.sensitivePaths (ESP-152; AC5)" and tests/plugin-structure.test.mjs "should pick the pre-flight model from planning.sensitivePaths (ESP-152; AC5)" pass (shown, 2026-11-10T19:12Z)
- AC6 (ESP-153 AC1): `node scripts/doc-versions.mjs` on a fixture with two `Unreleased` rows after 0.78 writes 0.79 and 0.80 (table order) with today's date, sets the README to v0.80, prints the `after` command to run, and changes nothing when there is no `Unreleased` row. Proven by `tests/doc-versions.test.mjs`.
  - Evidence: tests/doc-versions.test.mjs "planDocVersions (ESP-153; AC6)", "validateDocVersions (ESP-153; AC6)" and "doc-versions.mjs as a script (ESP-153; AC6)" pass (shown, 2026-11-10T19:12Z)
- AC7 (ESP-153 AC2, AC3): `governance-reviewer.md` FLAGs a non-bump PR that changes a released docs-set version or a `docVersions` version file's version; `release` SKILL.md runs the docs-set bump on the release bump branch and states that a bump PR touching only those rows, version strings and the `after` outputs runs `verify` with no reviewer round.
  - Evidence: tests/plugin-structure.test.mjs "should assign the docs-set version before promotion, with the verify-only bump path (ESP-153; AC7)" passes (shown, 2026-11-10T19:12Z)
- AC8 (all AC4s, ESP-151 AC3): README config table rows for `trustedDeletePaths`, `planning.sensitivePaths` and `docVersions`, and one changelog row naming the ESP-151 cause (the after-Bash check logged every background command as an error).
  - Evidence: diff: README config rows docVersions (l.58), planning.sensitivePaths (l.67), governance.trustedDeletePaths (l.68, l.284); 0.25.0 changelog row (l.411) names the ESP-151 cause (after-Bash check logged every background command as unchecked); ADR-0004 addendum 2026-11-10 (l.38) (shown, 2026-11-10T19:12Z)
- AC9: full `verify` gate passes.
  - Evidence: gate run 2026-11-10T19:12:34Z: tests, validate marketplace, validate plugin PASS; fake-pass check PASS (15 files, no findings); Gate: PASS (shown, 2026-11-10T19:12Z)

## Tasks
- [x] T1: split the branch-delete ask rule into local and remote rules; guard skips the local rule for safe `git branch -d` only; tests first (covers AC1; ESP-150)
- [x] T2: `governance.trustedDeletePaths` validation and trusted recursive delete, logged `trusted`; tests first (covers AC2, AC3; ESP-150)
- [x] T3: export the read-only split, add `sleep` and bash loop keywords; after-Bash check skips the background error for a read-only command, loading `governance-policy.mjs` lazily inside the background branch only (AGENTS.md F15 no-change path stays built-ins only); tests with the exact command, ADR-0004 deny tests and a mutation test (covers AC4; ESP-151)
- [x] T4: `planning.sensitivePaths` validation; approve-plan model rule, plan template Approved line, governance-reviewer light checklist (covers AC5; ESP-152)
- [x] T5: `scripts/doc-versions.mjs` with tests; release skill step; governance-reviewer FLAG rule (covers AC6, AC7; ESP-153)
- [x] T6: README rows and changelog row, ADR-0004 addendum (docs-only) (covers AC8; ESP-150..153)
- [x] T7: `/code-review high`, fixes, full gate (covers AC9)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/bash-workflow-check.mjs`
- `plugins/usiatech-engineering/scripts/doc-versions.mjs`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/templates/plan.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs`
- `plugins/usiatech-engineering/tests/doc-versions.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `docs/adr/0004-guard-drop-deny-scope.md`
- `plugins/usiatech-engineering/scripts/next-version.mjs`

## Commands and actions
- none beyond the normal release flow (no dependency, no migration)

## Out of scope
- A CI check for ESP-153 AC2 (decided: reviewer only).
- Asks for `rm -rf` of untrusted paths, `git branch -D`, and remote branch deletes stay.
- Background commands that aren't read-only (dev servers, `pnpm dev`) still log the after-Bash `error`.
- `[ … ]` test brackets in loops still fail closed (the split rejects `[`).
- The version bump PR (0.25.0) is a separate `chore(release)` PR per the release flow.

## Approved
- By: Francis · Date: 2026-11-10
- Route: small (override: "treat as small"; the four Jira tickets carry the ACs, so no spec)
- Pre-flight: opus, full

## Change log
- 2026-11-10: route override "treat as small" (Francis); ESP-153 AC2 is reviewer-only, no CI check (Francis).
- 2026-11-10: pre-flight FLAGs fixed in the draft: T3 loads the policy module lazily (F15); AC4 adds the ADR-0004 deny and mutation tests; AC5 states which model rule wins. Notes kept: branch rules stay on `GIT_PREFIX`; `doc-versions.mjs` uses `isMainModule` and `-z` git reads.
- 2026-11-10: added `scripts/next-version.mjs` to Files: it exports `isRepoPath` for `doc-versions.mjs` to reuse (Francis).
- 2026-11-10: `/code-review high` fixes: PowerShell comma targets never trusted; doc-versions finds the Date/Version table, needs its separator row, sets every version match, and lets two sets share a version file; the README upgrade note is corrected.
- 2026-11-10: stage-1 governance review FLAG acknowledged (Francis): the after-Bash `error` at 2026-11-10T00:33:31Z is a background read-only wait loop from the 0.24.0 release session, before this plan; it is the ESP-151 case this change fixes, so no code change.
- 2026-11-10: stage-2 security review FAIL fixed (3 PowerShell bypasses of trustedDeletePaths): a target with `:` (provider paths such as `FileSystem::`, `Temp:`, `env:`), a wildcard even when quoted, or a folder ending in `.` or a space is never trusted; tests first. The fix touches `governance-policy.mjs`, so a full review round runs again. Convention PASS (3 nits) and silent-failure PASS WITH NITS (3 nits) from the first round.
- 2026-11-10: second full round: governance FLAG (the same acknowledged pre-plan `error`, no new item), convention, silent-failure and security PASS WITH NITS; the PowerShell 5.1 junction note was tested and is not a risk. Decisions (Francis): skip a mutation run on the three new target checks (each has red-then-green tests); map Jira `testingStarted` to "In Testing" in a follow-up change outside this PR (`.claude/engineering.json` is outside Files).
