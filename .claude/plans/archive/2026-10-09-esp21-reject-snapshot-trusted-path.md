# Plan: Reject $TMP/usiatech-governance in trustedWritePaths (ESP-21)

## Goal
Make the guard report a config problem for any `governance.trustedWritePaths` entry under `$TMP/usiatech-governance`, the folder holding the after-Bash workflow snapshots, so an Edit or Write can never rewrite a snapshot without a prompt.

## Requirement references
- GitHub #70 (Jira ESP-21), filed from the stage 2 security review of ESP-7 (#48, PR #67)
- Spec `docs/specs/2026-10-02-workflow-checks-hardening.md` R6 (after-Bash check trusts its snapshot)
- ESP-9 (trusted write paths)

## Acceptance criteria
- AC1: `trustedEntryProblem` returns a config problem for `$TMP/usiatech-governance/**`, `$TMP/usiatech-governance/x/**`, `$TMP/usiatech-governance/bash-wf-1.json` and the case variants `$TMP/USIATECH-Governance/**`, plus the single-folder entry `$TMP/usiatech-governance` (the first folder name is compared lower-case). The trailing-dot/space, `\` and `:` spellings stay rejected by the existing rules, and glob spellings (`$TMP/usiatech-gov*/**`, `$TMP/*/**`) by the existing minLiteral rule; each of these has a test case. Shown by new cases in the `should report a config problem for trustedWritePaths …` loop of `tests/governance-policy.test.mjs`, which fail before the change (red) and pass after.
  - Evidence: 5 "should report a config problem for the snapshot folder entry …" tests failed before the change (✖, reason was "Edit outside the project folder") and pass after; 7 "… snapshot folder spelling …" tests pass via the existing rules; governance-policy.test.mjs 247/247 (shown, 2026-10-09T18:10Z)
- AC2: Other `$TMP/` entries are unaffected: `$TMP/usiatech-governance-notes/**` and `$TMP/claude/{project}/**` are still accepted (a test asserts a write under each is trusted).
  - Evidence: "should still trust a $TMP folder whose name only starts like the snapshot folder" passes; mutation "startsWith" CAUGHT (shown, 2026-10-09T18:15Z)
- AC3: The README's trusted-writes rules list `$TMP/usiatech-governance` as an entry that is a config problem, and say why.
  - Evidence: README trusted-writes entry rule and the snapshot note under the after-Bash check both state the config problem and the reason (shown, 2026-10-09T18:20Z)
- AC4: Gate passes: `npm test` 0 fail/skip/todo; `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exit 0; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.
  - Evidence: npm test exit 0, 989/989 + timing 1/1, 0 fail/skip/todo (18:31Z; an earlier run had the known timing flake at 107.3 ms median, passed 3/3 alone); fake-pass exit 0, both validates exit 0 (18:25Z); mutations 4/4 CAUGHT (shown, 2026-10-09T18:31Z)

## Tasks
- [x] T1: Add the red tests for AC1 and AC2 (covers AC1, AC2; #70)
- [x] T2: In `trustedEntryProblem`, reject a `$TMP/` entry whose first folder, lower-cased, is `usiatech-governance` (a named constant with a comment pointing at `snapshotDir`) (covers AC1, AC2; #70)
- [x] T3: README trusted-writes rule update, kept consistent with the existing "never add that folder" note at line 113 (covers AC3; #70)
- [x] T4: Run the gate; mutation-test the new check (covers AC4; #70)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- `npm test`
- `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`
- `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`
- `node "${CLAUDE_PLUGIN_ROOT}/skills/mutation-test/mutation-runner.mjs" --list <scratchpad list.json>` (targets `governance-policy.mjs`; restores it byte for byte)
- This edits the guard's own policy script (`hooks/scripts/governance-policy.mjs`): the guard will ask for it, approved here.

## Out of scope
- A version bump or release (a later release plan).
- A real-path check in `trustedWriteEntry` that refuses any write under the snapshot folder whatever the entry says (defence in depth; can be filed separately).
- ESP-20 (#69) and the Bash-built-path limitation in `snapshotDir`'s comment.
- ESP-22 (#72, `governance.planEdits: "all"`): its own plan after this one closes.

## Approved
- By: Francis · Date: 2026-10-09
- Route: small (cites #70; 3 files; no new skill, module, service or public interface)

## Change log
- 2026-10-08: drafted; 2026-10-09 approved by Francis after pre-flight FLAG fixes (approval left pending, commands listed, "all platforms" dropped from AC1, single-folder entry added, README consistency noted)

## Final status
- **Shipped** to develop: commit `f470ce0`, PR #74 merged as `f9d89ba` (2026-10-09). It is released as 0.10.1 under the version-bump rule (#73, ESP-23).
- AC1: shown (5 red-first tests, now green; 7 tests for spellings the existing rules already refuse).
- AC2: shown (the sibling-folder test; the startsWith mutation was CAUGHT).
- AC3: shown (README rule and snapshot note).
- AC4: shown (npm test 989/989 plus timing 1/1, fake-pass exit 0, both validates exit 0, mutations 4/4 CAUGHT).
- Reviews: stage 1 governance PASS; stage 2 security, silent-failure and convention PASS (nits listed in the PR).
- Deviations:
  - One `npm test` run hit the known timing flake (107.3 ms median). Reruns passed.
  - The fake-pass check flagged an assertion-free test body, and direct assertions were added.
  - The remote branch had already been auto-deleted at merge.
