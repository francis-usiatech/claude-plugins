# Plan: ESP-62, reject unknown keys in the tickets config

## Final status
- Status: shipped · Branch: `feature/esp62-reject-unknown-ticket-keys` · Closed: 2026-10-15
- AC1 shown · AC2 shown · AC3 shown · AC4 shown · AC5 shown
- Deviations: the R2 token test was rewritten (a token in the config is now an unknown key, exit 2); after the review round the check reports every level in one run (T5) and the spec got a change-log line (T6, AC5). All recorded in the Change log. The release Versioning row is left to the develop → main release.

## Goal
Make `validateTicketsConfig` in `jira-tracker.mjs` report unknown keys in `tickets`, `tickets.jira` and `tickets.jira.statuses` (other than `$comment`) as config problems that name the key, so a typo such as `"statues"` or `"trackr"` is no longer silently ignored.

## Requirement references
- ESP-62 (sub-task of ESP-27)
- `docs/specs/2026-10-09-jira-ticket-tracker.md` R1 (invalid values reported as config problems that name the key)

## Acceptance criteria
- AC1: New tests in `plugins/usiatech-engineering/tests/jira-tracker.test.mjs` pass: an unknown key in `tickets` (also with no `tracker`, i.e. GitHub path), in `tickets.jira` and in `tickets.jira.statuses` each gives a problem naming the key and `tickets: null`; `$comment` is accepted at each of the three levels and is not in the returned `statuses`; `runCli check` with `"statues"` exits 2 and names the key.
  - Evidence: `node --test plugins/usiatech-engineering/tests/jira-tracker.test.mjs`: 109 pass, 0 fail, incl. "validateTicketsConfig unknown keys (R1; ESP-62)" (5 unknown-key cases, 2 "every level in one run" cases, `$comment` at all three levels and beside GitHub) and "should exit 2 on check when the config has a misspelt statuses key"; 6 failed before the T2 fix and 2 before the T5 fix (shown, 2026-10-15T18:05Z; re-run by governance-reviewer)
- AC2: `node plugins/usiatech-engineering/scripts/jira-tracker.mjs check` exits 0 on this repo's `.claude/engineering.json` and on a copy of `plugins/usiatech-engineering/templates/engineering.json`.
  - Evidence: repo config `check` exit=0 (jira / ESP / Subtask / ESP-27); template copy in a `mktemp -d` dir printed `{"tracker":"github"}`, exit=0 (shown, 2026-10-15T16:57Z; template re-checked by convention-reviewer)
- AC3: The verification gate (`node plugins/usiatech-engineering/skills/verify/gate.mjs`) passes, run on its own after the reviews.
  - Evidence: Gate: PASS (tests, validate marketplace, validate plugin, fake-pass check), run alone after the review round and the fix re-review (shown, 2026-10-15T18:09:01Z)
- AC4: The README sentence "Unknown keys are ignored, so a misspelled `statuses` or `tracker` is not reported: check the printed section." is replaced by a sentence saying unknown keys (other than `$comment`) are reported.
  - Evidence: `plugins/usiatech-engineering/README.md:75` now reads "Unknown keys (other than `$comment`) in `tickets`, `tickets.jira` and `statuses` are reported the same way, so a misspelled `statuses` or `tracker` is caught." (shown, 2026-10-15T16:58Z; confirmed by governance-reviewer)
- AC5: `docs/specs/2026-10-09-jira-ticket-tracker.md` has a dated change-log line saying ESP-62 reports unknown keys in `tickets`, `tickets.jira` and `statuses` (other than `$comment`) under R1. Also (T5, extends AC1): a config with problems at more than one level (e.g. `trackr` beside a bad `tracker`, or an unknown `tickets` key beside a `tickets.jira` problem) reports all of them in one run, tested.
  - Evidence: spec Change log line "2026-10-15: R1 now also covers unknown keys … every level is reported in one run (ESP-62). Approved by Francis."; tests "should report every level in one run for a misspelt tracker beside a bad tracker" and "… for an unknown tickets key beside a Jira problem" pass (shown, 2026-10-15T18:05Z; confirmed by governance re-review)

## Tasks
- [x] T1: Write the failing tests for unknown keys and `$comment` at each level, and the CLI `check` exit 2 (covers AC1; ESP-62)
- [x] T2: Add an internal unknown-key check for `tickets` (`tracker`, `jira`) and `tickets.jira` (`site`, `project`, `issueType`, `parent`, `statuses`), run the `tickets` check on the GitHub path too, skip and drop `$comment` in `statuses` (covers AC1, AC2; ESP-62)
- [x] T3: Replace the README sentence (covers AC4; ESP-62)
- [x] T5: Report problems from every level in one run: unknown `tickets` keys, a bad `tracker` and `tickets.jira` problems together (covers AC1; ESP-62)
- [x] T6: Add a one-line spec change-log note that ESP-62 tightened R1 to unknown keys and `$comment` (covers AC5; ESP-62)
- [x] T4: Run `check` on both configs, then the gate alone after the reviews (covers AC2, AC3; ESP-62)
- [x] Commit and open the PR into `develop`

## Files
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `docs/specs/2026-10-09-jira-ticket-tracker.md`

## Commands and actions
- None beyond the gate and `jira-tracker.mjs check` (reads config only, sends nothing).

## Out of scope
- Checking `tickets.jira` when `tracker` is `github` (it stays ignored on that path).
- The other jira-tracker nits (`create` parent opt-out, exit code for missing credentials, "fix in Jira" wording), ESP-61 and the AC10 dry run.
- Version bump (done at the next develop → main release, patch).

## Approved
- By: Francis · Date: 2026-10-15
- Route: small (cites ESP-62 and approved spec R1; 3 files at approval, 4 after the recorded scope change; no new skill, module, service or public interface)

## Change log
- 2026-10-15: plan approved by Francis.
- 2026-10-15: pre-flight PASS. Francis accepts that unknown keys under `tickets` are reported on the GitHub (or unset) tracker path too, so a typo such as `"trackr"` makes `check` exit 2 instead of falling back to GitHub (brushes the spec non-goal "Changing GitHub-tracker behaviour"; valid or missing sections are unaffected).
- 2026-10-15: the R2 test "token from the environment only" put `token`/`email` in `tickets.jira`; those are now unknown keys, so it expects exit 2 naming `"tickets.jira.token"` and checks the token value is not printed (same file in Files; R2 still holds, more strictly).
- 2026-10-15: after the review round, Francis chose (1) report problems from all levels in one run instead of returning early on unknown `tickets` keys (T5, extends AC1), (2) add a spec change-log note (T6, AC5; spec added to Files), (3) leave the release Versioning row (ESP-62 lifts the 0.16.0 limit; behaviour change: a stray `tickets` key now makes `check` exit 2) to the develop→main release. The fix gets a governance-only re-review.
- 2026-10-15: governance re-review of the fix PASS (evidence flags only, filled here); plan closed as shipped.
