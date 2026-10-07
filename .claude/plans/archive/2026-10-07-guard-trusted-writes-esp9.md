# Plan: Guard stops prompting for no-risk writes and evidence-only plan edits (ESP-9)

## Goal
The governance guard stops asking for:
- writes to a few no-risk locations outside the project (this project's scratchpad and memory, and session-data);
- `.claude/plans/active.md` edits that only touch evidence, task ticks or the change log.

Every such write is still logged, and the governance-reviewer lists it. Matching Claude Code `settings.json` allow rules stop the harness's own prompt for those locations. Edits to a plan's Files list or AC list still ask, as do writes to Claude's own settings, hooks or plugins.

## Requirement references
- Jira ESP-9 (epic ESP-8, R1). Its Done when: guard tests cover each allowed path, the evidence-only diff, and a Files/AC edit that still asks; the README documents the new keys and defaults.
- Francis, 2026-10-06 (AskUserQuestion, this session):
  - both keys, `governance.trustedWritePaths` and `governance.planEdits: "allow"`;
  - shipped as plugin defaults;
  - the settings.json allow rules;
  - memory and scratchpad trust limited to this project;
  - evidence and tick edits allowed, with the reviewer listing them.

## Acceptance criteria
- AC1: With no config, `evaluate()` lets a Write/Edit through, with no `ask`, to each default trusted location:
  - `$TMP/claude/{project}/**`, the session scratchpad (`$TMP` = `os.tmpdir()`);
  - `~/.claude/projects/{project}/memory/**`;
  - `~/.claude/session-data/**`.

  `{project}` is the project root with every character other than `A-Za-z0-9` replaced by `-`. For example, `c:\Users\mfsar\source\usiatech-claude-plugins` becomes `c--Users-mfsar-source-usiatech-claude-plugins`.
  - This holds with `path.win32` (matched case-insensitively) and with `path.posix`. Home and tmp are injectable (`homeDir`, `tmpDir`).
  - The result has decision `null`, and `logEntries` gives exactly one entry with `decision: "trusted"`, the target and the matching entry.
  - The hook (`governance-guard.test.mjs`) writes no `permissionDecision` for a trusted write and appends one `trusted` log line.
  - With a config problem, the write still asks.
  - Evidence: describe "evaluate: trusted write paths (ESP-9; AC1, AC2)" (Windows, case-insensitive, POSIX, config-problem ask) + hook test "should print no decision for a write to this project's scratchpad…"; green 190/190 (shown, 2026-10-07T05:08Z)
- AC2: These still ask (or deny) as today, each pinned by a guard test:
  - an untrusted outside path (`~/.claude/settings.json`, `~/.ssh/id_x`);
  - another project's memory (`~/.claude/projects/other/memory/x.md`);
  - traversal out of a trusted folder (`~/.claude/session-data/../settings.json`);
  - a never-trusted name inside a trusted folder: `settings.json`, `settings.local.json`, `.mcp.json`, `.claude.json`, `CLAUDE.md`, `AGENTS.md`, or any `.git`, `hooks`, `plugins` or `.ssh` segment;
  - a target whose real path, through a symlink or junction on the target or its nearest existing parent, leaves the trusted folders (the tmp and home folders are compared by real path too);
  - a secret in the content (`deny`) and an env file (`deny`).

  Config:
  - A repo's `trustedWritePaths` replaces the defaults, and `[]` restores today's ask.
  - Each entry must start with `$TMP/`, `~/.claude/session-data/` or `~/.claude/projects/` (with `{project}` allowed), and must have a literal folder below that root.
  - Anything else gives a "Config problem" ask and is dropped. That covers a non-array, a non-string, a relative or other absolute path, and `~/**`, `~/.claude/**`, `$TMP/**`, `/**`, `C:/**`.
  - Evidence: same describe: 5 outside paths, 10 never-trusted names, secret/env deny, junction (real FS), repo list/[] and 10 invalid entries; green 190/190 (shown, 2026-10-07T05:08Z)
- AC3: With the default `planEdits: "allow"`, an Edit/Write to `.claude/plans/active.md` goes through with no ask, logged `decision: "trusted"`, when the only changes are:
  - lines in the Change log section;
  - the `[ ]`/`[x]` state of task lines in the Tasks section;
  - `Evidence:` blocks in the Acceptance criteria section: the `Evidence:` bullet and the lines indented deeper than it.

  Sections are found with the same heading rule as `planFiles` (`#`–`######`, case-insensitive).

  It still asks for:
  - any change in a Files section, including an `Evidence:`-looking block there, `### Files` and lowercase `# files`;
  - AC text, task text, or any other section;
  - an added, removed or renamed heading;
  - creating the plan;
  - an edit whose result can't be worked out;
  - every plan edit when `planEdits: "ask"`.

  A value other than `"allow"`/`"ask"` is a config problem.
  - Evidence: describe "evaluate: evidence-only plan edits (ESP-9; AC3)": evidence/tick/change-log and whole-file Write trusted; 8 still-ask edits, ### Files / # files, new plan, unworkable edit, planEdits ask/invalid; green 190/190 (shown, 2026-10-07T05:08Z)
- AC4: `plugins/usiatech-engineering/README.md` documents:
  - both keys and their defaults;
  - the `{project}` slug;
  - the allowed roots for entries;
  - the never-trusted names;
  - the realpath rule;
  - the `trusted` log decision;
  - the `settings.json` allow-rule snippet.

  `templates/engineering.json` shows both keys with the default values. The guard header comment mentions `trusted` entries. `agents/governance-reviewer.md` says to list every `trusted` entry in its log summary: plan edits (evidence, ticks) and memory/session-data writes.
  - Evidence: README "Trusted writes" section + config row + ask list; templates/engineering.json keys + $comment; guard header; governance-reviewer log summary lists trusted entries (shown, 2026-10-07T05:08Z)
- AC5: `~/.claude/settings.json` → `permissions.allow` has `Edit(...)` rules for the three locations on this machine.
  - They are added with the update-config skill, with the syntax checked there.
  - Nothing else in the file changes, and it still parses as JSON.
  - Evidence: ~/.claude/settings.json permissions.allow has the 3 Edit(...) rules at the top; JSON parses (180 rules) (shown, 2026-10-07T05:08Z)
- AC6: The gate passes:
  - `npm test`: 0 fail, 0 skipped, 0 todo;
  - `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`: exit 0;
  - `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`: exit 0.
  - Evidence: npm test exit 0, 847/847, 0 fail/cancelled/skipped/todo; fake-pass-check exit 0; both validates exit 0 (shown, 2026-10-07T05:08Z)

## Tasks
- [x] T1: Park ESP-5's plan at `.claude/plans/paused-esp5.md` (untracked, never staged); branch `feature/guard-trusted-writes-esp9` off develop `21f5d83` (ESP-9)
- [x] T2: Red: guard tests for trusted writes and their limits, including the hook-level test (covers AC1, AC2; ESP-9)
- [x] T3: Green: `trustedWritePaths` in `governance-policy.mjs` (validation in `sanitizeConfig`, `{project}`/`~`/`$TMP` expansion, allowed roots, never-trusted names, realpath check, `trusted` log entry via `logEntries`) (covers AC1, AC2; ESP-9)
- [x] T4: Red: guard tests for evidence-only plan edits and the edits that still ask (covers AC3; ESP-9)
- [x] T5: Green: `planEdits` in `governance-policy.mjs`: one section parser shared with `planFiles`; normalise and compare the plan before and after the edit (covers AC3; ESP-9)
- [x] T6: Docs: README, `templates/engineering.json`, guard header comment, governance-reviewer note (covers AC4; ESP-9)
- [x] T7: settings.json allow rules via the update-config skill (covers AC5; ESP-9)
- [x] T8: Gate (covers AC6; ESP-9)
- [x] T9: Stage 1 + stage 2 reviews; suggest a mutation test (policy file); one commit; PR into develop; ESP-9 → In Testing; then return to ESP-5 (PR #58, Jira) (covers AC1–AC6; ESP-9)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`

## Commands and actions
- Edit `~/.claude/settings.json` (user settings, outside the repo) with the update-config skill, adding three `Edit(...)` allow rules (AC5). Approved by Francis on 2026-10-06. It will prompt, since settings.json is never trusted.
- `git push` the feature branch and `gh pr create` into develop. Francis decides the merge.

## Out of scope
- The ticket's optional "let branch deletion through after merge".
- Repo-side guard config and AGENTS.md wording: NAS-13 (WaypointCareer).
- `setup-engineering` writing settings.json rules for consumer repos. The README snippet covers this.
- POSIX scratchpad folders other than `os.tmpdir()/claude/{project}`. The README notes a repo entry is needed if Claude Code uses another folder.
- A version bump or release: 0.10.0 (ESP-7).
- ESP-5's remaining T9 (Jira, merging PR #58): resumed after this ships.

## Approved
- By: Francis · Date: 2026-10-06
- Route: small (override: "treat small", Francis 2026-10-06. By the rule it would be large: 7 files and new config keys. Requirement reference: ESP-9)

## Change log
- 2026-10-06: plan drafted on `feature/guard-trusted-writes-esp9` off develop `21f5d83`. Francis chose plugin defaults, the small route, and parking ESP-5's plan in `paused-esp5.md`.
- 2026-10-06: pre-flight FLAG from the governance-reviewer, with 6 findings, all addressed:
  - Fixes:
    1. Repo entries are limited to the three roots, and a fixed never-trusted set is added.
    2. Francis limited memory and scratchpad trust to this project's `{project}` folder.
    3. Francis kept evidence and tick edits allowed, with the reviewer listing every `trusted` plan edit.
    4. `trusted` is decision `null` plus a log entry, and the hook output is pinned.
    5. `governance-guard.test.mjs` is added to Files.
    6. A shared section parser is used, with `### Files` and lowercase `# files` tests.
  - Low notes handled: realpath comparison of tmp and home (Windows 8.3 short paths), and the `Edit(...)` syntax checked in update-config.
- Merge note: ESP-5 (PR #58) also changes `sanitizeConfig` in `governance-policy.mjs`, so whichever PR merges second rebases.
- 2026-10-06: T2–T7 done.
  - Red: 16 trusted-path fails ("Edit outside the project folder"; no trustedWritePaths config problem), then 3 plan-edit fails (still asks; no planEdits validation).
  - Two test bugs fixed: a String.raw path with `${name}` (no interpolation) and a config-problem regex blocked by "." in the path.
  - Green: governance-policy + governance-guard 190/190, with the junction test running on the real file system (Windows).
  - Design note: only the tmp and home folders are resolved to real paths; the folders under them are compared as written, so a link such as session-data pointing at ~/.claude is never trusted.
  - T7: three Edit(...) rules added at the top of ~/.claude/settings.json permissions.allow (180 rules, valid JSON).
  - Watermarks-remover hook flagged the model: frontmatter in agents/governance-reviewer.md; kept, since it is a real agent setting.
- 2026-10-07: T8 gate. The first run failed fake-pass (6 fp-no-assert in the new tests: assertions only in helpers). Fixed by asserting in each test body (outcome() returns "trusted"/"ask"; trustedEntry results asserted with assert.match). Gate 05:08Z: npm test 847/847, fake-pass 0, validates 0. Session saved at ~$126; T9 (reviews, mutation suggestion, PR, Jira) next session.
- 2026-10-07: T9 reviews.
  - Stage 1 governance: PASS, no findings, 0 trusted log entries (installed guard is 0.9.0).
  - Stage 2 convention: PASS, nits; the `5 : 2` magic numbers are fixed, the rest are kept.
  - Stage 2 security BLOCK (PoCs confirmed): S1 a `\..` repo entry trusted all of home on Windows; S2 `.`/empty entry folders passed minLiteral; S3 `settings.json.`, `::$DATA`, `hooks.` dodged the never-trusted names.
  - Stage 2 silent-failure FLAG: F1 a realOf throw failed open; F2 a dangling link was trusted; F3 an unlogged trusted write went through; F4 an unreadable plan failed open.
  - Francis chose to fix all, test-first. Red: 16 new tests failed for the right reason. Green: governance tests 206/206; the security PoC script now asks for every bypass. README rules updated. No Files change.
  - Security re-review: PASS, all seven closed, no new bypass. Francis chose to add both nits test-first: Windows device names (CON, NUL, COM1, CONIN$) and existing files with more than one hard link now ask. Red: 5 fails.
  - Gate: npm test 868/868 (0 fail/skip/todo), fake-pass 0, both validates 0. Commit 6dc5cab; PR #59 into develop. Mutation test and Jira (ESP-9 → In Testing after CI; ESP-5) deferred to the next session.
- 2026-10-07: T9 mutation test (21 mutations on governance-policy.mjs and governance-guard.mjs): 18 caught, 3 survived. The survivors were the `\` entry check (the S1 test entry also ended in `.`, so S2 caught it), the trusted base resolved through `realOf`, and the `withoutEvidence` `lead > indent` boundary. Francis chose to add all three tests: a `\` entry with no dot-ended folder, a temp folder that is a junction, and a line after an Evidence bullet at the same indent. Re-run: 3/3 caught. Gate: npm test 871/871 (0 fail/skip/todo), fake-pass 0, both validates 0.
  - Reviews of the test diff: stage 1 governance PASS; stage 2 conventions, silent-failure and security PASS (one nit: the junction test's `'junction'` type, which matches the existing link tests). Commit aab2d13 pushed to PR #59; results posted in a PR comment; CI green on all 4 jobs. T9 done.
- 2026-10-07: Francis chose to merge #58 first (the recommendation). Claude merged PR #58 (`45f80d8`), merged develop into this branch (conflict only in the `templates/engineering.json` `$comment`: both texts kept; `sanitizeConfig` auto-merged with both changes), gate 894/894, fake-pass 0, validates 0, merge commit `3cb89fa`, CI green on 4 jobs, then merged PR #59 (`0c75a5c`). Both branches deleted locally and on the remote.

## Final status
- **Shipped:** commits `6dc5cab` and `aab2d13` (+ develop merge `3cb89fa`), PR #59 merged into `develop` (`0c75a5c`). Promotion to `main` is pending in PR #55. Jira ESP-9 → Ready for Release.
- AC1: met (evidence shown, 2026-10-07T05:08Z; re-run in the 871/871 and 894/894 gates).
- AC2: met (evidence shown, 2026-10-07T05:08Z; the S1–S3 and re-review fixes added cases, all in the 894/894 gate).
- AC3: met (evidence shown, 2026-10-07T05:08Z; the same-indent Evidence test added after the mutation test).
- AC4: met (evidence shown, 2026-10-07T05:08Z; README trusted-writes rules updated with the security fixes).
- AC5: met (evidence shown, 2026-10-07T05:08Z).
- AC6: met (final gate on the merged branch: npm test 894/894, 0 fail/skip/todo; fake-pass 0; both validates 0; CI green on 4 jobs).
- **Deviations:**
  - Stage 2 security (BLOCK, S1–S3) and silent-failure (FLAG, F1–F4) findings and both re-review nits were fixed inside ESP-9 (Francis's decision).
  - Two commits instead of one: the mutation-test gap tests (`aab2d13`) were added after the PR opened, plus the develop merge `3cb89fa` (no force-push).
  - Mutation test: 21 mutations, 3 survivors closed by new tests, 21/21 caught.
  - Claude merged PRs #58 and #59 into `develop` at Francis's go-ahead on the merge order.
  - Open: the POSIX scratchpad folder is unverified (README notes it).
  - No version bump: ships with 0.10.0 (ESP-7).
