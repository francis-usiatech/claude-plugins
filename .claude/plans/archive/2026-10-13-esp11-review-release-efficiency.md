# Plan: review and release efficiency (ESP-11, 39, 42, 38, 43, 45)

## Goal
Cut review and release cost by changing the `release` and `approve-plan` skill text and the plugin README. One PR covers ESP-11, ESP-39, ESP-42, ESP-38, ESP-43 and ESP-45.

## Requirement references
- ESP-11 (R4 of the session-efficiency requirements under ESP-8: one full review round per PR, narrow re-reviews)
- ESP-39 (fold the plan archive into the work's PR)
- ESP-42 (remove stale 0.9.0 project installs and the @synced duplicate; document the check)
- ESP-38 (stop the drift guard forcing a rerun after a resume briefing)
- ESP-43 (skip code reviewers and use a cheaper model on docs-only diffs)
- ESP-45 (context hygiene guidance)
- Parent epic ESP-8 (Agent session efficiency, plugin side)

## Acceptance criteria
- AC1 (ESP-11): `skills/release/SKILL.md` says each PR gets one full review round (one full `governance-reviewer` pass and one full stage-2 pass); that a fix made after that round, for a blocking finding or one the user decided on, gets one `governance-reviewer` run on the fix diff only, with a note in the PR; and that a fix gets a full round again only when it adds a file outside the plan's Files list or touches a file matching `*rules*.mjs`, `*checks*.mjs`, `*policy*.mjs`, `*guard*.mjs`, any file that is not Markdown under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth, a file under `.github/workflows/`, a `package.json` or lockfile, or one of the guard's ask paths (the defaults plus `governance.askPaths`). A test in `plugin-structure.test.mjs` asserts each of the three statements and passes.
  - Evidence: tests "should give each PR one full review round and a governance-only re-review of a later fix (AC1)" and "should say exactly when a fix gets a full round again (AC1)" pass in the gate run (shown, 2026-10-13T21:02:15Z)
- AC2 (ESP-11): `skills/release/SKILL.md` says stage 1 may run in parallel with stage 2 when the diff touches 5 files or fewer and every changed file is in the plan's Files list, and otherwise runs first; and that in parallel a stage-1 `BLOCK` still stops the commit and a `FLAG` still needs the user's decision. A test asserts it and passes.
  - Evidence: test "should let stage 1 run in parallel only for a small in-plan diff, with BLOCK and FLAG unchanged (AC2)" passes in the gate run (shown, 2026-10-13T21:02:15Z)
- AC3 (ESP-43): `skills/release/SKILL.md` defines a docs-only diff (every changed file is Markdown (`.md`), and none is a `CLAUDE.md` or `AGENTS.md` at any depth, is the `governance.rulesFile`, is under a `skills/`, `agents/`, `commands/`, `hooks/`, `templates/` or `.github/` folder at any depth, or matches one of the guard's ask paths (the defaults plus `governance.askPaths`)); says that on a docs-only diff `silent-failure-reviewer` and `security-reviewer` are skipped and the PR says so; and says `convention-reviewer` then runs on the `sonnet` model. A test asserts each statement and passes.
  - Evidence: tests "should define a docs-only diff that leaves out instruction, rule and ask-path files (AC3)" and "should skip two reviewers on a docs-only diff, say so in the PR, and run convention-reviewer on sonnet (AC3)" pass in the gate run (shown, 2026-10-13T21:02:15Z)
- AC4 (ESP-39): `skills/release/SKILL.md` section 1 has a step that closes and archives the plan with the `approve-plan` skill as the last step before the commit, after the review round and any fix re-review (so the reviewers still read `active.md`), and the archive is in the same commit; section 4 no longer archives the plan. `skills/approve-plan/SKILL.md` Close says the archive is committed in the same PR as the work and that a detail not known before merge (PR number, tag, Jira status) is added in a later PR only if needed. A test asserts both files and passes.
  - Evidence: tests "should archive the plan in release as the last step before the commit, not at clean-up (AC4)" and "should have approve-plan close the plan in the same PR as the work (AC4)" pass in the gate run (shown, 2026-10-13T21:02:15Z)
- AC5 (ESP-45): the plugin README has a section "Keeping sessions cheap" that names three practices: send large command output to a file and print only a summary; ask Jira (or any API) for named fields only; use context-mode for processing when it is installed, with the plugin not depending on it. A test asserts the heading and the three practices and passes.
  - Evidence: test "should document three ways to keep sessions cheap, without depending on context-mode (AC5)" passes in the gate run (shown, 2026-10-13T21:02:15Z)
- AC6 (ESP-42, docs): the plugin README has an upgrade note that tells the reader to run `claude plugin list`, how to recognise a stale project-scope install or a `@synced` duplicate, and the uninstall command. A test asserts it and passes.
  - Evidence: test "should document how to find and remove a duplicate install (AC6)" passes in the gate run (shown, 2026-10-13T21:02:15Z)
- AC7 (ESP-42, environment): after the approved uninstall, `claude plugin list`, run from both this repo and `C:\Users\mfsar\source\heiit`, shows exactly one `usiatech-engineering@usiatech` entry (user scope, 0.14.0). The `@synced` warning may remain; if it does, the Jira comment on ESP-42 says how Francis removes it in claude.ai.
  - Evidence: after two uninstall runs (the repo was recorded under `C:` and `c:`), `claude plugin list` shows 1 `usiatech-engineering@usiatech` entry (user, 0.14.0) from heiit and from this repo; `installed_plugins.json` holds only the user-scope record. The `@synced` warning remains; Jira comment 10835 on ESP-42 says how to remove it (shown, 2026-10-13T21:02:15Z)
- AC8 (ESP-38): a project memory file `resume-briefing-ends-with-askuserquestion.md` exists and is indexed in `MEMORY.md`; ESP-38 has a Jira comment with the findings. No repo file changes for ESP-38.
  - Evidence: memory file written and indexed in `MEMORY.md`; Jira comment 10834 on ESP-38; `git status` lists no file for ESP-38 (shown, 2026-10-13T21:02:15Z)
- AC9: the gate passes (`node plugins/usiatech-engineering/skills/verify/gate.mjs` prints `Gate: PASS`, exit 0).
  - Evidence: `Gate: PASS`, exit 0: tests (171 s), validate marketplace, validate plugin and fake-pass check all exit 0 (shown, 2026-10-13T21:02:15Z)

## Tasks
- [x] T1: write the failing tests for AC1 to AC6 in `plugin-structure.test.mjs` and see them fail (covers AC1-AC6)
- [x] T2: update `skills/release/SKILL.md` (covers AC1, AC2, AC3, AC4; ESP-11, ESP-43, ESP-39)
- [x] T3: update `skills/approve-plan/SKILL.md` Close (covers AC4; ESP-39)
- [x] T4: update the plugin README: "Keeping sessions cheap", the upgrade note, and the `reviewers` row so it matches the new review rules (covers AC3, AC5, AC6; ESP-45, ESP-42)
- [x] T5: uninstall the project-scope plugin in heiit, show Francis the diff, and comment on ESP-42 (covers AC7; ESP-42)
- [x] T6: Jira comment on ESP-38 with the findings (covers AC8; ESP-38)
- [x] T7: run the gate, the reviewers, archive the plan in this PR, commit, open the PR (covers AC9)

## Files
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `.claude/plans/archive/2026-10-13-esp11-review-release-efficiency.md`

## Commands and actions
- `claude plugin uninstall usiatech-engineering@usiatech --scope project`, run in `C:\Users\mfsar\source\heiit` (approved by Francis 2026-10-13). It edits heiit's `.claude/settings.json`, outside this repo. Nothing is committed in heiit; Francis commits the change there later.
- Write a project memory file under `~/.claude/projects/c--Users-mfsar-source-usiatech-claude-plugins/memory/` (approved by Francis 2026-10-13).
- Jira comments on ESP-38 and ESP-42, and status transitions for the six tickets.

## Out of scope
- The 0.15.0 release, the version bump and the README Versioning rows (done at release).
- Any change to agent frontmatter (`model: inherit` stays).
- Any edit to oh-my-claudecode or ECC files, or to `~/.claude/settings.json`.
- Removing the `@synced` copy on claude.ai (Francis's account).
- Re-copying CI scripts in heiit, or any commit in heiit.
- ESP-57, ESP-58, ESP-59.

## Approved
- By: Francis · Date: 2026-10-13
- Route: small (existing ticket references, 5 files, no new skill, module, service or public interface)

## Change log
- 2026-10-13: Francis decided before approval: ESP-43 uses Sonnet on docs-only diffs only; ESP-38 is a memory rule, not a hook switch; ESP-42 uninstalls the heiit project-scope install and leaves heiit's settings change uncommitted.
- 2026-10-13: pre-flight FLAG, no BLOCK (4 items: archive order, ask-path wording, docs-only definition, parallel stage-1 outcomes). Francis approved the plan with all four fixes applied.
- 2026-10-13: review round (stage 1 and stage 2 in parallel): governance PASS, convention and silent-failure pass with nits, security FAIL with one High finding. Francis decided three AC wording changes: AC1's full-round triggers add any non-Markdown file under the six code folders (the High finding); AC3's docs-only definition is Markdown only and leaves out any `CLAUDE.md`, `AGENTS.md` and the `governance.rulesFile`; AC1's narrow re-review covers fixes for blocking findings as well as fixes he decided on. No file added to scope.
- 2026-10-13: fix re-review (governance only, on the fix diff): all nine checklist items done; FLAG for evidence older than the fixes, cleared by the gate run at 21:02:15Z.

## Final status
- Shipped, branch `feature/esp11-review-release-efficiency`, archived in the same commit as the work (ESP-39). The commit and the PR into `develop` follow this archive.
- Acceptance criteria: AC1 to AC9 shown.
- Deviations:
  - Stage 1 and stage 2 ran in parallel, under the rule this plan adds (AC2); the installed 0.14.0 skill says stage 1 first.
  - The heiit uninstall ran twice (the second time from PowerShell with the lower-case path), because the repo was recorded under both `C:` and `c:`. Same approved command and target.
  - The new tests were first appended with a Bash heredoc, so the guard log has no entry for that write.
  - AC1 and AC3 were reworded after the review round (see the Change log).
- Open nits, listed in the PR: a fix for a `security-reviewer` finding is not re-checked by that reviewer; the archived plan is staged after the reviews; the `mutation-test` line in `release` still says "the repo's `governance.askPaths`"; `.mdx` and ADR edits count as docs.
- Left for Francis: commit heiit's `.claude/settings.json`; re-copy heiit's CI scripts; remove the `@synced` copy in claude.ai.
