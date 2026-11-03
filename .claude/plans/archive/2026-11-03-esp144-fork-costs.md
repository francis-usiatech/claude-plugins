# Plan: ESP-144 cheaper release-steps fork and audit scripts that price correctly

## Goal
Run `release-steps` on Sonnet, and make `usage.cjs` and `window.cjs` attribute forks to their skills and price each call at its model's published rates, so the next re-measure is trustworthy. Find why cost per reviewer run rose.

## Requirement references
- ESP-144 (AC1, AC2, AC3, AC4, AC7, plus Francis's added requirement to split the `release` window)
- ESP-117 (epic), ESP-118 AC1
- `docs/audits/2026-10-24-usage-audit/baseline.md`, re-measure section

## Pre-plan checklist
- (a) New validation rules and format checks: the scripts gain required `<from> <to>` date arguments and fail on an invalid date or an empty folder list. Searched for callers: `audits/2026-10-24` appears only in `baseline.md`, `usage.cjs` and `window.cjs` under `plugins`, `docs` and `.github`, so `baseline.md` is the only caller to update. No test fixtures exist for these scripts yet.
- (b) Database or infrastructure mechanisms the design relies on: `model:` taking effect alongside `agent: general-purpose` in a forked skill. Spike run 2026-11-03: a throwaway plugin skill with `context: fork`, `agent: general-purpose`, `model: sonnet`, run by `claude -p --model opus --plugin-dir`, billed only `claude-sonnet-5-5` (`modelUsage` in the JSON output). No control run without `model:` was done, and it ran as a slash command, not through the `Skill` tool; AC1 still checks a real transcript. No database mechanism.
- (c) Docs and ADRs touched: `docs/audits/2026-10-24-usage-audit/baseline.md` (commands, method line, Models note, AC4 finding); `plugins/usiatech-engineering/README.md` (line 11, the `release-steps` row). Search for `audits/2026-10-24` and for model plus fork, verify or release-steps across docs and plugins. `docs/adr/` holds three ADRs, none on this work. No docs reviewer is configured.

## Acceptance criteria
- AC1 (ESP-144 AC1): `plugins/usiatech-engineering/skills/release-steps/SKILL.md` frontmatter has `model: sonnet`, and `verify`'s has no `model`. A test in `plugin-structure.test.mjs` asserts both. The README states why `verify` stays on the session model: it judges acceptance criteria. A subagent transcript from a real `release-steps` run shows `claude-sonnet-5-5`, or the plan records that this check waits for the first release after this ships.
  - Evidence: Diff shows `model: sonnet` on `release-steps`, none on `verify`; test "should run release-steps on sonnet and leave verify on the session model" passed (it also matches the README reason). The real-transcript check waits for the first release after this ships; spike 2026-11-03 billed only `claude-sonnet-5-5` (shown, 2026-11-03T22:46Z)
- AC2 (ESP-144 AC2): Given a fixture with forks, `usage.cjs` lists each fork under its skill name (`release-steps`, `verify`) rather than `general-purpose`, identified by the usiatech-engineering skill path in the fork's first 3 user messages. Fork counts equal `Skill` invocations in the fixture, and on the 2026-10-26 to 2026-11-02 week they equal `baseline.md`'s counts: `release-steps` 67 and `verify` 25 in heiit, `release-steps` 17 in waypointcareer. It prints a plugin share equal to `release` window + `verify` window + reviewers + forks, leaving skill text out. On the 2026-10-26 to 2026-11-02 week, with first-record usage as in the one-off script, the printed share is within 0.2 points of the 23.4% (both projects) from that script. `baseline.md` states that this formula leaves out the skill text its earlier shares included, and the size of that change.
  - Evidence: Tests "should list forks under their skill names with counts next to Skill calls" and "should print a plugin share of release, verify, reviewers and forks" passed. Real week 2026-10-26 to 2026-11-02 (caller's run): `release-steps` (fork) 67 and `verify` (fork) 25 in heiit, `release-steps` (fork) 17 in waypointcareer, equal to `Skill` calls and `baseline.md`; first-record share 23.4% against one-off 23.4%, last-record 23.8%. `baseline.md` states the skill-text change (0.3%) (shown, 2026-11-03T22:46Z)
- AC3 (ESP-144 AC3, plus the cache-read weight): a shared module holds per-model prices cited to https://platform.claude.com/docs/en/about-claude/pricing.md with the date read, and both scripts cost each call by its own model. Fixture tests assert exact dollar costs for: Opus 5.5 reads at $0.20/MTok, Sonnet 5.5 reads at $0.10/MTok, Fable 5.1, Haiku 5.5 at both prompt-length tiers, and a call with `cache_creation` holding only 5m tokens, which must not also be charged at the 1h rate. A model with no price is counted and printed as unpriced, never priced as Opus. `<synthetic>` calls are skipped. A call's usage comes from the last record of its `message.id`, which holds the final output count.
  - Evidence: Fixture tests in describe "callCost" passed, plus "should price each call at its own model" and "should report unpriced models and skip synthetic calls"; last-record usage is in the usage fixture's `edit` call. `audit-common.cjs` cites the pricing page, read 2026-11-03. The "callCost" tests now assert with `assert.ok(near(...))`, and the fake-pass check exits 0. Real week printed no unpriced line (caller's run) (shown, 2026-11-03T22:46Z)
- AC4 (ESP-144 AC4): `baseline.md` records, per repo, why cost per reviewer run rose between the baseline and re-measure weeks (heiit 105k to 129k, waypointcareer 94k to 136k), split into first-call context, calls per run and output. A fix to plugin text needs a dated plan update first that adds its files; otherwise `baseline.md` records the cause and why it was not fixed.
  - Evidence: `baseline.md` section "Why cost per reviewer run rose (ESP-144 AC4)" holds the per-repo split and the reason no plugin text changed; one-off breakdown run 2026-11-03 (caller's run): heiit 135k to 144k, waypointcareer 94k to 136k with final output, first-call context up about 4.5k, `Write` calls 0.60 and 0.83 per run (shown, 2026-11-03T22:46Z)
- AC5 (ESP-144 AC7, reporting half): `window.cjs` prints, per release, the main-thread context growth summed across its `release-steps` calls (context at the call after each `release-steps` result minus context at the call that invoked it, within the same turn) and marks releases that started above 300k context. A release starts at a `commit` phase and runs through the later phases; a commit before any later phase is a retry. A fixture test asserts the sum, including a call whose `Skill` tool use is in a later transcript record of the same `message.id`. The under-5k target itself stays open for the re-measure (ESP-144 AC6).
  - Evidence: Tests "should sum context growth across a release's release-steps calls" and "should start a new release at a commit after a later phase, not at a retried commit" passed. Real week (caller's run): heiit 18 releases, 11 above 300k, mean 4553; waypointcareer 8 releases, 5 above 300k, mean 3932; same in `baseline.md` (shown, 2026-11-03T22:46Z)
- AC6 (Francis's added requirement): `usage.cjs` prints the `release` window split into fixing work and overhead, as cost and share. A main-thread call counts as fixing work when its content has an `Edit` or `Write` tool use outside temp folders and `.claude/plans`; every other call is overhead. All records of a `message.id` count as one call. A fixture test asserts the split, including an `Edit` in a later record of the same `message.id`. The output and `baseline.md` state this definition; `baseline.md` also states that it errs both ways.
  - Evidence: Tests "should split the release window, counting an Edit in a later record of the call" and "should count the release flow's own scratchpad and plan writes as overhead" passed. `usage.cjs` prints the definition; `baseline.md` states it and that it errs both ways. Real week, both repos (caller's run): fixing 1.2%, overhead 8.1% (shown, 2026-11-03T22:46Z)
- AC7 (date arguments): `usage.cjs` and `window.cjs` take required `<from> <to>` arguments, read as local time, with `to` exclusive. Fixture tests assert a non-zero exit on an invalid date and on no folders, and that a call timestamped at `to` falls outside the week.
  - Evidence: Describes "usage.cjs arguments" and "window.cjs arguments" passed: "should exit non-zero on an invalid date", "should exit non-zero on no folders", "should read the week as local time with an exclusive end" (shown, 2026-11-03T22:46Z)

## Tasks
- [x] T1: Write fixture tests first (red), building transcripts in a temp folder (covers AC2, AC3, AC5, AC6, AC7; ESP-144)
- [x] T2: Add `audit-common.cjs` with prices, per-call cost, date and folder argument parsing and JSONL reading; both scripts import it (covers AC3, AC7; ESP-144)
- [x] T3: `usage.cjs`: fork attribution, plugin share line, per-model cost, `release` split, carried text at each call's read price (covers AC2, AC3, AC6; ESP-144)
- [x] T4: `window.cjs`: per-model cost and `release-steps` growth per release (covers AC3, AC5; ESP-144)
- [x] T5: `model: sonnet` on `release-steps`, structure test, README row with the `verify` reason (covers AC1; ESP-144)
- [x] T6: Investigate reviewer run cost across both weeks; record, or update the plan before any fix (covers AC4; ESP-144)
- [x] T7: Update `baseline.md`: commands with date arguments, method line, Models note, that older sections used the old Opus weights, the changed share formula and its size, the AC4 finding and split definition (covers AC2, AC4, AC6; ESP-144)
- [x] T8: Run the updated scripts on the re-measure week and compare share and fork counts to the one-off numbers (covers AC2; ESP-144)

## Files
- `plugins/usiatech-engineering/skills/release-steps/SKILL.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `docs/audits/2026-10-24-usage-audit/usage.cjs`
- `docs/audits/2026-10-24-usage-audit/window.cjs`
- `docs/audits/2026-10-24-usage-audit/audit-common.cjs`
- `docs/audits/2026-10-24-usage-audit/audit-scripts.test.mjs`
- `docs/audits/2026-10-24-usage-audit/baseline.md`

## Commands and actions
- Read-only reads of `~/.claude/projects/*` transcripts for T6 and T8.
- Jira: move ESP-144 to In Progress (transition 21); add the cache-read weight and the `release` split to its description.
- Branch `feature/esp144-fork-costs` from `develop`.
- At release, leave ESP-144 off the confirmed Released keys, so it stays open.

## Out of scope
- ESP-144 AC5 (target decisions) and AC6 (re-measure on a full week after shipping), and meeting the under-5k growth target.
- `verify`, `governance-reviewer` and `security-reviewer` model changes. Their reviewers' 3.5% target is revisited with the 15% one.
- `effort: low` on `release-steps` (not approved).
- Counting the `approve-plan` window in plugin share. It holds implementation work and stays outside the formula, as in the re-measure.
- Version bump and the README Versioning row: these happen in the develop to main release PR.
- PR #160, the leftover worktree, ESP-61, ESP-105 and the ESP-115 and ESP-125 follow-ups.

## Approved
- By: Francis · Date: 2026-11-03
- Route: small (override: the rule says large, 8 files and a new module)

## Change log
- 2026-11-03: Francis chose "treat as small" for ESP-144; ESP-144 is the requirement reference. Governance pre-flight still ran (FLAG, no BLOCK).
- 2026-11-03: Live pricing page read at drafting. Sonnet 5.5 cache reads are $0.10/MTok, not the $0.20 in the earlier session notes.
- 2026-11-03: Francis's decisions before drafting: Sonnet for `release-steps` only, `verify` stays on Opus; reviewers stay on Opus; the 15% decision waits for the measurement; `usage.cjs` splits the `release` window; ESP-144's description gains the cache-read weight and the split.
- 2026-11-03: Francis accepted the pre-flight defaults: an AC4 fix needs a dated plan update first; plugin share leaves skill text out, with the change stated in `baseline.md`; ESP-144 stays off the Released keys, with no new ticket; reviewers stay on Opus despite the corrected Sonnet read price (about 2.9 points), revisited with the 15% target.
- 2026-11-03: Found while implementing, no files added: first-record usage misses 13% of output tokens, so AC3 now reads the last record, which moves the 23.4% to 23.8%. AC2's 23.4% comparison is run with first-record usage so it still checks the formula. To be raised with Francis at the code-review hand-off.
- 2026-11-03: `/code-review high` findings changed two definitions, no files added: AC5 groups by release (commit phase onward) rather than by `release` skill window, and AC6 leaves temp and `.claude/plans` writes out of fixing work (160 of 339 uses). To be raised with Francis at the same hand-off.
- 2026-11-03: Francis was told of the output-token and definition changes above and said to commit. Francis also decided the audit scripts stay on CommonJS despite the global ES Modules rule, because `usage.cjs` and `window.cjs` are already `.cjs` and ESP-144 names them.
- 2026-11-03: Stage 1 FLAG, Francis accepted both: AC5 measures growth within the same turn only (no effect on the real week), and a fork needs the injected `Base directory for this skill` line, narrower than AC2's "skill path" (waypointcareer baseline 17.6% to 16.2%).
- 2026-11-03: After stage 2, Francis decided real dollar spend per project stays out of the public repo: `baseline.md` and this plan give shares only, and the scripts still print dollars locally. Governance-only re-review on that fix.

## Final status
- Shipped. Branch: `feature/esp144-fork-costs`.
- AC1 to AC7: shown, with evidence above. AC1's real-transcript check waits for the first release after this ships.
- Deviations: the definitions and the last-record usage in the Change log, all accepted by Francis; dollar figures left out of the repo.
- ESP-144 stays open for its AC5, AC6 and the under-5k target.
