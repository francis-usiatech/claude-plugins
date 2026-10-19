# Plan: Audit PR D — runner and tracker fixes (ESP-78)

## Goal
Close six ponytail-audit findings in the mutation runner, the gate runner and the Jira tracker: a mutation timeout of 2³¹ ms or more fires at once (F12), `check` accepts a Jira site with a path (F13), `keys` silently finds nothing in a UTF-16 file (F14), a failing gate step's whole output is read into memory (F16), a short token corrupts the redacted output (F17), and mutations re-encode non-UTF-8 files (F18). Also complete the ERROR row in the mutation-test SKILL.md report table.

## Requirement references
- `docs/audits/2026-10-17-ponytail-audit.md` F12, F13, F14, F16, F17, F18, the "Small items" nit (mutation-test SKILL.md ERROR row), and its "How to use this brief" rules (test first, smallest fix, no new dependencies)
- ESP-78 (sub-task of ESP-74)
- `docs/specs/2026-10-09-jira-ticket-tracker.md` R1 (config check), R7 (`keys`) and R11 (site shape), which F13 and F14 tighten, and R2 (redaction), which F17 narrows to tokens of 16 characters or more (Francis, 2026-10-18)
- `AGENTS.md`: "Shared helpers are imported, not copied" (F12 constant, F13 site check) and "Export only what another file imports" (the new export is imported by gate.mjs)

## Pre-plan checklist
- (a) New validation rules and format checks:
  - F12, `isTimeout` (`mutation-runner.mjs:24`): used only by `validateList` (list and entry `timeoutMs`). `validateList` is called by `runMutations` and `readList`. Tests: `tests/mutation-runner.test.mjs`. gate.mjs has its own range check at `:49` against `MAX_STEP_TIMEOUT_MS` (`:27`), and it already imports `runCommand` and `handleInterrupts` from mutation-runner. So the constant moves to mutation-runner as an exported `MAX_TIMEOUT_MS` and gate.mjs imports it. The other direction would load gate.mjs, an entry point that runs when loaded.
  - F13, `httpsSite` (`jira-tracker.mjs:18-25`): called only by `jiraProblems` (`:51`). `trustedApiBase` (`:110-134`) does the shape check (`:117-120`) plus the host-trust check, which depends on `JIRA_SITE` from the environment. Only the shape part moves into a shared `siteShapeProblem(site)` that both call. The trust check stays in `trustedApiBase`, because `check` must not depend on the environment. A trailing `/` stays allowed, because `validateTicketsConfig` already strips it (`:78`) and `trustedApiBase` ignores it. Fixtures: `tests/jira-tracker.test.mjs` config cases and the AC12 site cases; the repo's own `.claude/engineering.json` site `https://usiatech.atlassian.net` stays valid.
  - F14, `readOptionFile` (`jira-tracker.mjs:306-313`): called for `--messages-file` (`keys`) and, through `readBodyFile`, for `--body-file` (`create`, `comment`). The `\0` check goes there, so a UTF-16 body file is refused too. UTF-8 text never contains a NUL byte. Tests: `tests/jira-tracker.test.mjs` `keys` cases. The release skill (`skills/release/SKILL.md:49`) already says to write the file from a POSIX shell.
- (b) Database or infrastructure mechanisms: none. F12 relies on Node's documented `setTimeout` rule (a delay above 2147483647 becomes 1). gate.mjs already relies on it at `:26-27`.
- (c) Docs and ADRs touched: searched the README, `docs/`, the ADRs, the skills and `AGENTS.md` for `timeoutMs`, `2147483647`, `tickets.jira.site`, `JIRA_API_TOKEN`, `messages-file`, `UTF-16` and the mutation ERROR wording.
  - Touched:
    - `plugins/usiatech-engineering/skills/mutation-test/SKILL.md`: the ERROR row (`:65`) gets the README's wording (`README.md:30`: killed by a signal, process tree couldn't be stopped within 2 s); the `timeoutMs` line (`:41`) gains "up to 2147483647".
    - `plugins/usiatech-engineering/skills/release/SKILL.md:49`: "which `keys` can't read" becomes "which `keys` refuses (exit 2)".
    - `plugins/usiatech-engineering/README.md`:
      - the Jira "Keys" bullet: `site` must be https with a host only (no path, port, user name, query or fragment);
      - the mutation-test paragraph (`:30`): `timeoutMs` range, and that matching is done on bytes;
      - the unreleased 0.18.2 Versioning row (`:316`): the PR D changes.
    - the README Jira "Environment" bullet: body and messages files must be UTF-8;
    - `docs/specs/2026-10-09-jira-ticket-tracker.md`: a dated Change log line that R2 does not redact a raw token under 16 characters (the Basic credential is always redacted). R11 and AC12 already require a host-only site, so F13 needs no spec change.
  - Not touched: No ADR covers these scripts. No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (F12): a mutation list with `timeoutMs: 2 ** 31`, at list level or on an entry, is refused as a usage error (ListError, exit 2) naming the 2147483647 limit; `2147483647` is accepted. gate.mjs uses the same imported constant, and its existing timeout-range tests still pass.
  - Evidence: mutation-runner.test.mjs "should reject a timeoutMs of 2 ** 31 or more": red (Missing expected exception), then green; 2147483647 accepted; gate.mjs imports MAX_TIMEOUT_MS and its timeout tests stay green; mutation "F12 no upper timeout bound" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC2 (F13): `check` with `site: "https://x.atlassian.net/jira"` exits 2 with a message that names `"tickets.jira.site"` and keeps the existing combined wording ("must not have a user name, password, port, path, query or fragment"); so does a site with a non-default port (8443), a user name, a query or a fragment. `https://x.atlassian.net` and `https://x.atlassian.net/` still pass `check`. The existing AC12 client tests still pass.
  - Evidence: jira-tracker.test.mjs "should refuse in check a site with a path, port, user name, query or fragment (F13)": red (check exit 0 for /jira), then green for /jira, :8443, me@, ?a=1 and #top with the combined wording; bare and trailing-slash sites exit 0; AC12 client tests green; mutations "F13 path allowed" and "F13 check skips shape" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC3 (F14): `keys --messages-file` on a UTF-16LE file holding `feat: x (ESP-12)` exits 2 with "not UTF-8; regenerate from a POSIX shell"; so does `comment --body-file` with a UTF-16LE file, before any request. A UTF-8 file still prints its keys, and an empty file still prints `"keys":[]`.
  - Evidence: jira-tracker.test.mjs "should refuse a UTF-16 messages or body file": red (keys printed keys:[] with exit 0), then green for keys and comment, no request sent; existing keys tests green; mutation "F14 NUL not refused" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC4 (F16): a failing gate step that prints one 100000-character line shows a tail line of at most 65536 bytes that ends with the line's last characters. The fake-pass check's output is not capped (its comment at `gate.mjs:147` still holds).
  - Evidence: gate.test.mjs "should read at most the last 64 KB of a failing step's output": red (tail line 100000 characters), then green; fake-pass output uncapped (only the failing-step tail passes TAIL_BYTES); mutations "F16 no byte cap" and "F16 tail not capped" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC5 (F17): with `JIRA_API_TOKEN=t`, `check` prints the config JSON unchanged. The existing redaction tests use a `CLI_TOKEN` of 16 characters or more (it is 14 today) and still pass. A token of 16 characters or more is still replaced by `***` in stdout and stderr, and the Basic credential is always replaced.
  - Evidence: jira-tracker.test.mjs "should leave the output unchanged when the token is shorter than 16 characters": red, then green; CLI_TOKEN lengthened to 17 characters and every R2/AC2 redaction test green; mutations "F17 short token redacted" and "F17 long token not redacted" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC6 (F18): a mutation on a file holding a Latin-1 byte (`0xE9`) leaves that byte unchanged while the command runs, so a command that passes only when the byte is intact gives SURVIVED, not CAUGHT. The file is still restored byte for byte. Match counting (exactly 1) and the literal `replace` (no `$&` expansion) behave as before.
  - Evidence: mutation-runner.test.mjs "should keep a non-UTF-8 byte intact while the mutation runs, and replace literally": red (CAUGHT instead of SURVIVED), then green, file restored byte for byte; "should count matches without overlap" added after mutation "F18 overlapping match count" SURVIVED, then CAUGHT; mutations "F18 re-encode as UTF-8" and "F18 replace expands $&" CAUGHT (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC7 (nit): the ERROR row in `skills/mutation-test/SKILL.md` lists every ERROR cause the README lists.
  - Evidence: skills/mutation-test/SKILL.md ERROR row now lists unreadable/unwritable file, killed by a signal, process tree not killed and not closed within 2 s, and interrupted, matching README.md:30 (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC8 (docs): the README Jira Keys and Environment bullets, the mutation-test paragraph, the 0.18.2 row and `skills/release/SKILL.md:49` and the spec R2 Change log line say what AC1–AC6 changed.
  - Evidence: README Jira Keys (host-only site) and Environment (16-character redaction, UTF-8 files) bullets, mutation-test paragraph (byte matching, timeoutMs range), 0.18.2 row (ESP-78 entry); skills/release/SKILL.md:49 (keys refuses with exit 2); spec Change log line for R2 dated 2026-10-18 (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)
- AC9: a mutation-test run on the changed lines has no survivors. Then `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS. Mutations run first, the gate last.
  - Evidence: mutation run 11 of 11 CAUGHT after the overlap test (first run 10 CAUGHT, 1 SURVIVED; list scratchpad/esp78-mutations.json), then node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-19T05:21:49Z (tests 117 s, both validations, fake-pass check; three expected fp-placeholder warnings on existing TODO fixtures in gate.test.mjs) (shown, 2026-10-19T05:21Z; re-confirmed by Gate: PASS 05:21:49Z)

## Tasks
- [x] T1: Write the failing tests first (tdd):
  - mutation-runner: the 2³¹ timeout at list and entry level, and the Latin-1 byte;
  - jira-tracker: a site with a path, port 8443, user name, query or fragment in `check`; a UTF-16LE messages file and body file; a short token;
  - gate: a failing step that prints one 100000-character line.
  (covers AC1–AC6; ESP-78)
- [x] T2: F12. Export `MAX_TIMEOUT_MS = 2147483647` from mutation-runner. `isTimeout` checks `v <= MAX_TIMEOUT_MS`, and the error message names the range. gate.mjs imports the constant in place of `MAX_STEP_TIMEOUT_MS` (covers AC1; ESP-78)
- [x] T3: F13. Add `siteShapeProblem(site)`, which returns the reason or null (not a URL, not https, or a user name, password, port, path, query or fragment, in the existing combined wording). `jiraProblems` and `trustedApiBase` both call it; `httpsSite` is removed (covers AC2; ESP-78)
- [x] T4: F14. `readOptionFile` throws a UsageError "not UTF-8; regenerate from a POSIX shell" when the text holds `\0` (covers AC3; ESP-78)
- [x] T5: F16. `outputBetween` takes an optional byte limit, `from = Math.max(from, to - maxBytes)`; only the failing-step tail passes 65536 (covers AC4; ESP-78)
- [x] T6: F17. `redactor` always redacts the Basic credential, and redacts the raw token only when it has 16 characters or more; lengthen `CLI_TOKEN` in the tests to 16 or more characters (covers AC5; ESP-78)
- [x] T7: F18. `runOne` counts and replaces on Buffers: `indexOf` on `Buffer.from(m.find)`, and `Buffer.concat` with `Buffer.from(m.replace)`, with no UTF-8 decode (covers AC6; ESP-78)
- [x] T8: The SKILL.md ERROR row and `timeoutMs` line, the release SKILL.md line, the README bullets and 0.18.2 row, and the spec R2 Change log line (covers AC7, AC8; ESP-78)
- [x] T9: Mutation test on the changed lines, then the gate on a quiet machine (covers AC9; ESP-78)

## Files
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/skills/mutation-test/SKILL.md`
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `docs/specs/2026-10-09-jira-ticket-tracker.md`

## Commands and actions
- None beyond the normal gate, mutation test and release flow.

## Out of scope
- F15 lean cleanup (PR E, ESP-79), including the duplicate `isPlainObject` and `isText` in gate.mjs and jira-tracker.mjs, and dropping `export` from `DEFAULT_TIMEOUT_MS`, `ListError`, `RestoreError`, `validateList`, `formatReport`, `TRACKERS` and `EVENTS`.
- Decoding UTF-16 files instead of refusing them.
- The follow-ups ESP-101, ESP-102 and ESP-103; the shell-tokenizer and flaky-test items.
- The version bump and the 0.18.2 release itself.

## Change log
- 2026-10-18: drafted. Route large with override (Francis), as for PR A, PR B and PR C.
- 2026-10-18: pre-flight FLAG (governance-reviewer, 5 findings). Applied without a decision: AC4 made red-first (one 100000-character line), AC3 adds the UTF-16 body file, approval left out until Francis approves, AC2 uses port 8443 and the combined wording.
- 2026-10-18: decisions (Francis): F17 keeps the 16-character threshold; the test CLI_TOKEN is lengthened and the spec gets an R2 Change log line (spec added to Files). F16 caps only the failing-step tail; fake-pass output stays uncut.
- 2026-10-18: approved as drafted (Francis). Route large with override, as for PR A to C.
- 2026-10-19: AC6 adds a test that matches are counted without overlap ("aa" in "aaa" is one match, as before), after mutation "F18 overlapping match count" survived. Within the approved files.
- 2026-10-19: release round 1. Stage 1 governance PASS (note: plan evidence and doc edits were written through Bash scripts, so the guard log has no trusted entry for them; content matched the approved draft). Stage 2 convention, silent-failure and security PASS; nits listed in the PR (siteShapeProblem called twice in jiraProblems; README Keys line omits "password"; the 64 KB tail's first line can be a fragment; a short raw token echoed back is not redacted, by decision). No fix, so no re-review.

## Approved
- By: Francis · Date: 2026-10-18
- Route: large (override: 10 files, but the audit brief stands in for the spec and ESP-74/ESP-78 are the tickets, as for PR A to C)

## Final status
- Shipped on branch `feature/esp78-audit-pr-d` (PR to develop). AC1–AC9 shown (mutation run 11 of 11 CAUGHT, then Gate: PASS 2026-10-19T05:21:49Z).
- Deviations, all logged above: F17 narrows spec R2 to tokens of 16 characters or more (spec Change log line); F16 caps only the failing-step tail; AC6 adds a non-overlapping match-count test after a surviving mutation.
