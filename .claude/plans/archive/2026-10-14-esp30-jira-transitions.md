# Plan: Jira transitions in approve-plan and release (ESP-30)

## Goal
With `tickets.tracker` set to `"jira"`, `approve-plan` moves the plan's tickets to the `started` status, and `release` moves them to `merged` (with a PR-link comment) when the PR merges. On a release tag, `release` moves every key found in the commit messages since the previous tag to `released`. A tested helper finds those keys.

## Requirement references
- Spec `docs/specs/2026-10-09-jira-ticket-tracker.md` (Status: approved): R6, R7, AC6, AC7, and AC11 (the key helper's part: tests and mutation test)
- Jira ESP-30 (sub-task of ESP-27); blocker ESP-28 merged in PR #100

## Acceptance criteria
- AC1 (spec AC7, R7): `findJiraKeys(text, project)` is exported from `scripts/jira-tracker.mjs`. It returns the unique keys of the given project, in first-seen order, from commit-message text. Tests in `tests/jira-tracker.test.mjs` show:
  - keys of other projects are ignored;
  - a key inside a longer word is ignored (`XESP-1`, `ESP-1a`, `foo_ESP-2`);
  - duplicates are dropped;
  - text with no keys gives `[]`;
  - a project prefix of another project does not match (`ES` does not find `ESP-1`).
  - Evidence: findJiraKeys (R7; AC7) suite in tests/jira-tracker.test.mjs, 7 tests pass: order and dedupe, other projects, longer words, punctuation and slash, prefix project, no keys, bad input (shown, 2026-10-14T21:41:05Z)
- AC2 (R7): The CLI command `keys --messages-file <path>` reads the file, takes the project from the config, and prints `{"project":"ESP","keys":[...]}`. It makes no HTTP request and needs no credentials. Tests show:
  - output for a file with keys and for one without;
  - exit 2 for a missing file or a missing `--messages-file`;
  - exit 2 when the tracker is not `"jira"`;
  - `fetch` is never called.

  `keys` joins the `CLI_COMMANDS` token-handling tests (AC2 of the spec). The spawned-script test treats no-network commands (`check`, `keys`) as exit 0, and asserts their full output, so the test stays strict.
  - Evidence: runCli keys (R7; AC7) suite, 5 tests pass (output, project from config, empty file, exit 2 for a missing or unreadable file, exit 2 for the GitHub tracker, no fetch calls); keys is in CLI_COMMANDS, and the spawned-script test asserts its full output with exit 0 (shown, 2026-10-14T21:41:05Z)
- AC3 (spec AC6, R6): `skills/approve-plan/SKILL.md` gives the `started` step. After `active.md` is written, with the Jira tracker and a `started` status configured, it runs `jira-tracker.mjs transition --issue <KEY> --event started` for each Jira ticket key named by the plan's tasks. Parent and blocker keys that appear only in the references are not moved. A failure is reported as one the user must fix, and the plan is not undone. `grep -n -e tracker -e "--event started" skills/approve-plan/SKILL.md` finds it.
  - Evidence: grep finds approve-plan/SKILL.md:36-42 (Record step 4: check from the repo root, skip reasons said, a non-zero check reported, started for the keys named by tasks, failures reported, plan not undone) (shown, 2026-10-14T21:41:05Z)
- AC4 (spec AC6, R7): `skills/release/SKILL.md` gives:
  - the `merged` step: a new merge step in §2 that runs when the PR has merged into the base branch, whether Claude merged it or `gh pr view --json state` shows `MERGED`. It reads the ticket keys named by the tasks in the archived plan for this branch, runs `transition --event merged`, and runs `comment` with a scratchpad body file holding the PR URL;
  - the `released` step: when tagging the release branch, the previous tag is found with `git describe --tags --abbrev=0` on the commit before the merge. With no earlier tag, the whole history is used. `git log <previous tag>..HEAD --format=%B` goes to a scratchpad file and `keys --messages-file` reads it. The list is shown, and the user confirms it once and may drop keys that are only mentioned. Then `transition --event released` runs for each confirmed key;
  - that git steps are never undone by a Jira failure, and each failed transition is reported as one the user must fix.

  `grep -n -e "--event merged" -e "--event released" -e "keys --messages-file" skills/release/SKILL.md` finds each step.
  - Evidence: grep finds release/SKILL.md: --event merged (on merge, §2), keys --messages-file and --event released (§3 steps 2 and 4), and a "Jira tracker" section (which tracker; failures including git describe and git log) (shown, 2026-10-14T21:41:05Z)
- AC5 (spec AC11, key helper part): A mutation test on `findJiraKeys` and the `keys` command catches every mutant, or each survivor is explained.
  - Evidence: mutation runner: 10 mutants. 9 caught at first; the survivor "keys hardcodes project" got the test "should take the project from the config" and is now caught (10/10) (shown, 2026-10-14T21:41:05Z)
- AC6: The verification gate passes (npm test, both plugin validations, fake-pass check).
  - Evidence: Gate: PASS at 2026-10-14T21:41:05Z; jira-tracker tests 99/99 (shown, 2026-10-14T21:41:05Z)
## Tasks
- [x] T1: Test first: `findJiraKeys` tests (red), then the helper (green) (covers AC1; ESP-30)
- [x] T2: Test first: `keys` CLI tests, plus `keys` in `CLI_COMMANDS` (red), then the command and its USAGE line (green) (covers AC2; ESP-30)
- [x] T3: Add the `started` step to approve-plan's Record section (covers AC3; ESP-30)
- [x] T4: Add the `merged` and `released` steps to release sections 2–3 (covers AC4; ESP-30)
- [x] T5: Mutation test on the helper and the `keys` command; the mutation list is shown to Francis before it runs (covers AC5; ESP-30)
- [x] T6: Run the gate (covers AC6)

## Files
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `.claude/plans/archive/2026-10-14-esp30-jira-transitions.md`

## Commands and actions
- The mutation runner (`skills/mutation-test/mutation-runner.mjs`) on the list Francis confirms. It restores every file byte for byte.
- No live Jira calls: every test uses an injected `fetch`. This branch's own Jira moves (ESP-30 to Ready for Release after merge) are made with the Atlassian tool, as before.

## Out of scope
- ADR-0003, README, `templates/engineering.json` and this repo's opt-in, and the read-only dry run against ESP (ESP-31: R9, R10, AC9, AC10).
- The CI reference pattern for Jira keys (ESP-61).
- ESP-28's review nits, and the ESP-29 nits (parent opt-out, `JIRA_SITE` check, exit code for credentials).
- Running the Jira steps for real in this repo: that needs the opt-in from ESP-31.

## Approved
- By: Francis · Date: 2026-10-14
- Route: large (adds a public interface: the exported `findJiraKeys` and the `keys` CLI command). clarify → to-spec → to-tickets were already done: the spec is approved and ESP-30 is its ticket.

## Change log
- 2026-10-14: plan recorded. Pre-flight FLAG, decided by Francis:
  - Started and merged move only the ticket keys named by the plan's tasks, not every key in the references.
  - The released list is shown and confirmed once, and keys that are only mentioned can be dropped.

  Folded in from the reviewer:
  - the merge step's trigger and its key source (the archived plan);
  - the previous-tag lookup and the first-release fallback;
  - the strict spawn test for `keys`;
  - the stronger greps.
- 2026-10-14: release review. Governance and security PASS. Silent-failure and convention each raised one finding at 80:
  - a failed git log fed an empty file to keys;
  - a broken config (check exits non-zero) was skipped silently.

  Both were fixed in the skill text, with these nits folded in:
  - the comment is added even when the transition fails;
  - "No names found" is the only whole-history case;
  - the messages file is written from a POSIX shell;
  - the text says jira.statuses;
  - full command forms, with tags and paths quoted;
  - the skill says so when there is no plan or no keys.

  Governance-only re-review PASS. Gate PASS 2026-10-14T21:41:05Z.

## Final status
- Shipped on branch feature/esp30-jira-transitions, one commit, PR into develop.
- AC1–AC6 shown (gate PASS 2026-10-14T21:41:05Z; mutation 10/10 caught).
- Deviations:
  - Spec R6 says "each Jira key in the recorded plan's requirement references". Francis decided only the ticket keys named by tasks move. The R6 wording is left for ESP-31.
  - The released list is confirmed with drops allowed, beyond R7's "after showing the list".
