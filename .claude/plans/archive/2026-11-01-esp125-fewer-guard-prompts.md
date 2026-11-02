# Plan: Fewer unnecessary guard prompts (ESP-125)

## Goal
Cut guard prompts that protect nothing, found in the 2026-11-01 review of the waypointcareer and heiit governance logs (25 Oct–1 Nov). On Linux, Claude Code keeps the session scratchpad in `/tmp/claude-<uid>/{project}/…`, which the default trusted write path `$TMP/claude/{project}/**` never matches; add a `{uid}` placeholder and trust `$TMP/claude-{uid}/{project}/**` by default. Then narrow the rules that fire on text no command runs.

## Requirement references
- ESP-125 (task under epic ESP-117, usage reduction)
- 2026-11-01 governance-log review of waypointcareer and heiit (this session)
- ESP-9 (trusted write paths), ESP-21 (snapshot folder never trusted), ESP-113 item 9 (ANSI-C, EncodedCommand): context, narrowed only as below
- AGENTS.md: F15 (export only what another file imports)

## Pre-plan checklist
- (a) New validation rules and format checks: `trustedEntryProblem` accepts `{uid}` the way it accepts `{project}`, and a new root `~/.claude/plans/`. Callers: `sanitizeConfig` only. Fixture: `tests/governance-policy.test.mjs` "trusted write paths" suite. Rule changes in `ASK_COMMANDS` (callers: `decideBash` only).
- (b) Mechanisms the design relies on: `process.getuid()` (Node built-in; absent on Windows); the existing real-path and link checks in `trustedWriteEntry`; PowerShell refusing an -EncodedCommand value that is not valid base64. No spike needed.
- (c) Docs and ADRs touched: README "Trusted writes" section and the guard rule notes; `templates/engineering.json` default list. No ADR touched. The README version row is added by the release bump PR.

## Acceptance criteria
- AC1: On POSIX with uid 1000, a write to `/tmp/claude-1000/{project}/…` is trusted by the default list and logged naming `$TMP/claude-{uid}/{project}/**`.
  - Evidence: gate 2026-11-02T00:00:48Z, governance-policy.test.mjs "should trust the Linux scratchpad of the current user only (ESP-125; AC1, AC2)" passed (shown, 2026-11-02T00:15Z)
- AC2: With uid 1000, a write to `/tmp/claude-1001/{project}/…` (another user's scratchpad) still asks.
  - Evidence: same test (claude-1001 and another project’s folder ask) passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC3: Where there is no uid (Windows), an entry with `{uid}` trusts nothing, and the Windows defaults are unchanged.
  - Evidence: "should trust nothing through a {uid} entry where there is no uid, as on Windows (ESP-125; AC3)" passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC4: `$TMP/claude-{uid}/{project}/**` in a repo list is not a config problem; the existing bad-entry and snapshot-folder refusals still hold.
  - Evidence: "should accept a {uid} entry in a repo list (ESP-125; AC4)" and the snapshot-folder config-problem tests passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC5: README and `templates/engineering.json` list the new defaults and explain `{uid}` and the narrowed rules.
  - Evidence: diff: README Trusted writes lists `$TMP/claude-{uid}/{project}/**` and `~/.claude/plans/**`, explains `{uid}`; guard notes cover ANSI-C, EncodedCommand, text no command runs, SQL rules; templates/engineering.json lists both defaults (shown, 2026-11-02T00:15Z)
- AC6: The verification gate passes.
  - Evidence: gate.mjs run 2026-11-02T00:00:48Z: tests (1830, 0 fail), validate marketplace, validate plugin, fake-pass check all PASS; Gate: PASS (shown, 2026-11-02T00:15Z)
- AC7: ANSI-C quoting asks only for an escape that can spell a command (octal, `\x`, `\u`, `\U`, `\c`), also after an escaped quote; `\r`, `\n` and `\t` escapes go through.
  - Evidence: suite "ANSI-C quoting (AC7)" passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC8: An -EncodedCommand value that is literal and not valid base64 (PowerShell refuses it) no longer asks; a value with a dollar sign, backtick, `%`, `(`, `@`, `{`, `[` or `<` still asks.
  - Evidence: suite "-EncodedCommand values (AC8)" passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC9: `truncate` asks only as SQL (`truncate table|only`, or `truncate <name>` before `;`, `,`, a quote or the end) or as the shell tool (`truncate -…`); `bypassrls` asks only after `create|alter role|user`.
  - Evidence: suite "truncate, bypassrls and secrets (AC9)" passed in gate 2026-11-02T00:00:48Z (secrets clause dropped per change log) (shown, 2026-11-02T00:15Z)
- AC10: `~/.claude/plans/**` (Claude Code plan mode) is a default trusted write path.
  - Evidence: "should trust Claude Code plan-mode files by default (ESP-125; AC10)" passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)
- AC11: The rules don't see text no command runs: the body of a quoted-delimiter heredoc fed to cat or tee (not piped), a quoted command-substitution `cat` heredoc used as a git commit/tag or gh pr/issue/release message, and quoted arguments of grep, egrep, fgrep, rg (not with --pre), Select-String, sls or findstr. A command the scanner can't fully read (backtick, any other command substitution, parameter expansion with braces, an unquoted `#`, ANSI-C or locale quoting, process substitution, a PowerShell here-string or stop-parsing token, an unquoted-delimiter or unterminated heredoc, alias/function/PATH changes) keeps today's checks.
  - Evidence: suite "quoted heredoc bodies and search patterns (AC11)" passed in gate 2026-11-02T00:00:48Z (shown, 2026-11-02T00:15Z)

## Tasks
- [x] T1: Failing tests for AC1–AC4 (covers AC1–AC4; ESP-125)
- [x] T2: `{uid}` placeholder and default entry in `governance-policy.mjs` (covers AC1–AC4; ESP-125)
- [x] T3: README and template (covers AC5; ESP-125)
- [x] T4: Run the gate (covers AC6; ESP-125)
- [x] T5: Failing tests, then the ANSI-C, EncodedCommand, truncate, bypassrls and secrets rule changes (covers AC7–AC9; ESP-125)
- [x] T6: Failing tests, then trust ~/.claude/plans/** (covers AC10; ESP-125)
- [x] T7: Failing tests, then the data-text scanner in decideBash (covers AC11; ESP-125)
- [x] T8: README, gate, code review (covers AC5, AC6; ESP-125)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs` (added 2026-11-01: audit rule fixes)
- `plugins/usiatech-engineering/hooks/scripts/governance-state.mjs` (comment only; added 2026-11-01 from code review)

## Commands and actions
- None beyond the normal release flow (PR into develop).

## Out of scope
- Client-repo config changes (heiit, waypointcareer): `planEdits`, the AI-endpoint, Prisma, Stripe and release-age askCommands, worktree sessions.
- Plan-free `docs/specs/**` and a no-prompt `rm -r` of build or scratch folders (Francis left these out, 2026-11-01).
- The version bump and develop→main release.

## Approved
- By: Francis · Date: 2026-11-01
- Route: small (6 files, no new skill or module)

## Change log
- 2026-11-01: Plan recorded; Francis approved the upstream fix ("Yes, fix upstream"); ESP-125 created.
- 2026-11-01: Code review (high) fixes added: a `$TMP` entry's first folder must be owned by the current user when it exists (shared /tmp), one placeholder list, governance-state comment. Test added. The "silent {uid} skip on Windows" finding was not applied: the template lists the {uid} entry, so an advisory would warn every Windows user.
- 2026-11-01: Scope widened by Francis ("Add audit fixes first"; chose the low-risk rule fixes, trust ~/.claude/plans/**, and skip text in heredocs/grep): AC7–AC11 and T5–T8 added, governance-rules.mjs added to Files, goal reworded.
- 2026-11-01: Second code review (high), 8 findings, all fixed with tests: quoted redirect targets of a search command stay; PowerShell `<#` and bash `$[` are unreadable; rg `--hostname-bin` is not a search; an unquoted glob in an encoded value asks; truncate also before a line break, backtick or `)`; the secrets-rule change reverted (it removed no prompt and missed `cat >> out .env`), so AC9 drops that clause; attached braces don't start a command; a heredoc written to a git hook, shell startup file, home or system folder stays visible.
- 2026-11-01: Governance review (stage 1) FLAGs decided by Francis: (1) "Keep body if it runs": a cat/tee heredoc body stays visible when the same command runs a shell, interpreter, sourced or executed path, package script or wrapper; (2) "Fix it": truncate also asks before CASCADE, RESTRICT, RESTART/CONTINUE IDENTITY. Low note fixed too: MESSAGE_COMMAND built on GIT_PREFIX (AGENTS.md F3), so `git -C x commit -m "$(cat …)"` is read. Tests added for all three.
- 2026-11-01: Stage-2 blocking findings fixed with tests: (silent-failure) a heredoc body stays unless every other command is a quiet one (cat, tee, echo, printf, cd, pwd, ls, mkdir, touch, wc, head, tail, diff, git, true, test), replacing the runner list that missed psql -f, awk -f, go run; (security) PowerShell commands with typographic quotes are left unread; an encoded value with a backslash outside single quotes asks. Security nits folded in: `.git*` home files stay visible; truncate reads backtick-quoted names. Full review round re-run (policy file touched).
- 2026-11-01: Governance round 2 BLOCK fixed with tests: `git` removed from the quiet-command list (bisect run, -c core.pager, submodule foreach, hooksPath run files); a heredoc on a line naming `.husky` or any absolute path stays visible. Evidence to be re-stamped by a fresh verify run.
- 2026-11-01: Francis approved a one-off exception to the full-round rule ("Gov + security re-review"): after the round-2 fix, governance and security re-review the full diff with the open findings as a checklist; convention and silent-failure don't re-run.
- 2026-11-01: Governance round 3 BLOCK fixed with tests: RUNS_LATER is tested against the whole command (bodies removed), so an earlier `cd .husky` / `cd .git/hooks` / `cd /usr/local/bin` keeps the body visible.
- 2026-11-01: Governance round-3 low-confidence note fixed with a test: the hook input's cwd is read, and a heredoc body stays when the shell sits outside the project or in a hooks-like folder (Claude Code keeps the shell folder between calls). Governance PASS on the round-3 fix. Security confirmed all fixes by reading; its bypass probe pass did not run (a safety classifier stopped the probe-building twice).
- 2026-11-01: Francis chose "PR now, hunt before merge": the PR is opened marked do-not-merge until a fresh session runs the bypass probe pass on withoutDataText/encodedCommands and a governance check of the shell-cwd fix. Plan closed.

## Final status
- Status: shipped (PR into develop; do-not-merge until the bypass probe pass and the shell-cwd governance check pass)
- Branch: `feature/scratchpad-uid-trust`
- Acceptance criteria: AC1–AC11 shown in the gate run of 2026-11-02T00:00:48Z (AC9 without the dropped secrets clause).
- Reviews: governance PASS after rounds 1–3 (round-1 FLAGs decided by Francis; round-2 and round-3 BLOCKs fixed); convention PASS WITH NITS; silent-failure PASS WITH NITS (its blocking finding fixed); security round 1 FAIL, both bypasses fixed, and the re-review confirmed the fixes by reading only. The open-ended probe pass did not run, because a safety classifier stopped it.
- Deviations: secrets-rule narrowing reverted; full-round rule waived once by Francis (governance + security re-review); the shell-cwd fix has tests but no reviewer pass yet.
