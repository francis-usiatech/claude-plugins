# Plan: Guard settings per restriction (ESP-166)

## Goal
Make each non-destructive governance-guard restriction optional through its own `governance` key in `.claude/engineering.json` (`deny` | `ask` | `allow`). Stop ADR edits from prompting, and add a config-only master bypass. Destructive command rules, denies and the guard's own config files stay fixed.

## Requirement references
- ESP-166 (parent ESP-27)
- ADR-0005 `docs/adr/0005-guard-settings-per-restriction.md` (written in T1; it records the guard settings review page accepted in full on 2026-11-16, D0.1–D7.2, and the 2026-11-16 follow-up decisions)
- ADR-0004 (amended by ADR-0005 only where it says so)

## Pre-plan checklist
- (a) New validation rules and format checks: one shared validator `resolveSettings` in `templates/github/scripts/governance-rules.mjs` (AGENTS.md F15), used by `sanitizeConfig` (`hooks/scripts/governance-policy.mjs`) and `governance-checks.mjs` (CI reads the base-branch config through `govRoot`, F11). Callers searched: `evaluate`, `governance-after-bash.mjs` (it reads workflow rules only, not ask paths: unchanged), `governance-checks.mjs` `stringList`, `skills/verify/docs-only.mjs` (imports `DEFAULT_ASK_PATHS`; the combined list stays exported and gains `**/CLAUDE.md`, so a nested CLAUDE.md is no longer docs-only, which matches the release skill's rule). Fixtures searched: the `sanitizeConfig` and config-problem tables in `tests/governance-policy.test.mjs`, the config table in `tests/governance-checks.test.mjs`, the `DEFAULT_ASK_PATHS` asserts in `tests/governance-rules.test.mjs`, and `tests/docs-only.test.mjs`.
- (b) Database or infrastructure mechanisms: n/a: hook logic and JSON config only, with no database or infrastructure.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (config table, governance section, changelog), the `$comment`s in `templates/engineering.json`, and `skills/approve-plan/SKILL.md` (the default ask-path list gains `**/CLAUDE.md`). ADR-0004 is read only and amended by the new ADR-0005. The root `README.md` and `.claude-plugin/marketplace.json` carry the public-marketplace fix, which the user asked to ship in this PR.

## Settings (from ADR-0005)
File and edit keys, directly under `governance`, each taking `deny`, `ask` or `allow`:
- `agentsFiles` (ask): `AGENTS.md`, `**/AGENTS.md`
- `claudeMdFiles` (ask): `CLAUDE.md`, `**/CLAUDE.md`
- `reviewFile` (ask): `REVIEW.md`
- `claudeConfig` (ask): `.claude/**`. Guard config files (`.claude/engineering.json`, `.claude/settings.json`, `.claude/settings.local.json`) always ask, whatever this key or bypass says (`deny` still denies).
- `ciFiles` (ask): `.github/**`
- `dependencyFiles` (ask): `**/package.json`
- `adrEdits` (allow) with `adrPaths` (default `docs/adr/**`, `docs/decisions/**`): skips the plan-scope ask.
- `planScope` (ask): edits not in the plan's Files list.
- `outsideWrites` (ask): writes outside the project that no trusted write path covers. Agent config names (`settings.json`, `settings.local.json`, `.mcp.json`, `.claude.json`, `CLAUDE.md`, `AGENTS.md`) and `.git`, `hooks`, `plugins` and `.ssh` segments always ask.
- `envFiles` (deny), `secrets` (deny), `possibleSecrets` (ask), `protectedPaths` (deny), `immutableFiles` (deny), `workflowFindings` (ask), `dependencyFindings` (ask)
- `uncheckable` (ask), edit side only: a Windows 8.3 short name, a plan path through a link, a non-string target, and a failed worktree or trusted-path lookup.

Command keys under `governance.commands`, each mapping to one rule in `ASK_COMMANDS` or one protected-branch check, default ask:
- `addDependency` (adding a dependency), `publishPackage` (publishing a package), `remoteInfra` (remote host / infrastructure change), `readSecrets` (reading secrets), `writeEnvFile` (writing an env file), `sudo` (elevated privileges), `worldWritable` (world-writable permissions)
- `protectedBranchWork` (commit, merge or push while on a protected branch), `protectedBranchPush` (push to a protected branch)

Fixed, with no key; bypass leaves them as they are:
- Every `DENY_COMMANDS` entry (10 entries).
- The destructive `ASK_COMMANDS`: force push, discarding work, deleting a branch, deleting a remote branch, rewriting history, recursive delete, delete inside a command wrapper, ANSI-C quoted escape, destructive SQL, weakening row-level security, resetting/dropping a database, destroying infrastructure (split out of the remote host rule in the release review).
- The command-side fail-closed checks (a command over 16 KB, an undecodable `-EncodedCommand`, a command naming the after-Bash snapshots), since they guard the destructive rules.
- The repo's own `denyCommands`.

`governance.bypass` (config only, default `false`): every other ask becomes an allow, logged as `bypassed`; every deny still denies.

## Acceptance criteria
- AC1: Each file-group key (`agentsFiles`, `claudeMdFiles`, `reviewFile`, `claudeConfig`, `ciFiles`, `dependencyFiles`) set to `allow` lets an Edit to a matching file through and logs `allowed-by-config` naming the key. Unset, it asks as today; set to `deny`, it denies. `docs/CLAUDE.md` asks by default. Shown by tests in `tests/governance-policy.test.mjs`.
  - Evidence: governance-policy.test.mjs "evaluate: one setting per restriction (ESP-166; ADR-0005)": "should follow governance.agentsFiles/claudeMdFiles (incl. docs/CLAUDE.md)/reviewFile/claudeConfig/ciFiles/dependencyFiles for ..." pass; governance-rules "should put each default ask path in one settings group, nested CLAUDE.md included" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC2: Edits to `.claude/engineering.json` and `.claude/settings.json` ask with `claudeConfig: "allow"` and with `bypass: true`, and deny with `claudeConfig: "deny"`. Shown by tests.
  - Evidence: governance-policy "should always ask for the guard's own config .claude/engineering.json", ".claude/settings.json", ".claude/settings.local.json" and "should keep denies, fixed destructive asks and config problems under governance.bypass" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC3: With no `adrEdits` key, an Edit to `docs/adr/0001-x.md` that is outside the plan's Files is allowed with no plan-scope ask. `adrEdits: "ask"` brings the ask back, and a custom `adrPaths` is honoured. Shown by tests.
  - Evidence: governance-policy "should let ADR edits outside the plan through by default and follow governance.adrEdits"; governance-policy "should keep requirePlan for ADR edits when no plan is active" (the decideScope fix); governance-guard "should allow an ADR edit outside the plan outright, and leave a group allow to Claude Code (ESP-166)" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC4: `planScope`, `outsideWrites`, `envFiles`, `secrets`, `possibleSecrets`, `protectedPaths`, `immutableFiles`, `workflowFindings`, `dependencyFindings` and `uncheckable` each change their decision to the configured value. Unset keeps today's decision. `outsideWrites: "allow"` still asks for `~/.claude/settings.json`. Shown by one test per key.
  - Evidence: governance-policy "should follow governance.planScope", ".outsideWrites, but always ask for agent config outside the project", ".envFiles", ".secrets and .possibleSecrets", ".protectedPaths and .immutableFiles", ".workflowFindings and .dependencyFindings", ".uncheckable on the edit side" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC5: Each of the 9 `governance.commands` keys set to `allow` lets its command through with no ask, and `deny` denies it. A command that also matches a fixed rule still asks. Shown by a table-driven test.
  - Evidence: governance-policy "should follow governance.commands.<key> for: ..." x9 (addDependency, publishPackage, remoteInfra, readSecrets, writeEnvFile, sudo, worldWritable, protectedBranchWork, protectedBranchPush) and "should still ask for a fixed destructive rule beside an allowed command" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC6: `bypass: true` turns asks into allows logged as `bypassed`. Every deny, every fixed destructive ask (force push, recursive delete, destructive SQL) and every guard-config edit keeps its decision. Shown by tests.
  - Evidence: governance-policy "should let asks through under governance.bypass, logged as bypassed" and "should keep denies, fixed destructive asks and config problems under governance.bypass"; governance-guard "should ask for a bypassed edit when its log entry cannot be written (ESP-166)" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC7: A bad setting value (`"maybe"`, a number) is reported as a config problem and replaced by the stricter of its default and `ask`. An unknown `governance.commands` key, or a non-boolean `bypass`, is an advisory warning. Shown by tests.
  - Evidence: governance-policy "should report bad values as advisory and use the stricter of the default and ask" (maybe, number, non-boolean bypass, unknown commands key forcePush) pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC8: The PR governance check reads the file-group keys from the base-branch `.claude/engineering.json` (`govRoot`). A file whose group is `allow` needs no approval label, and a bad value is a config error from the same shared validator. Shown by a test in `tests/governance-checks.test.mjs`.
  - Evidence: governance-checks "should need no label for a file group set to "allow" in the base-branch config", "should still need the label for the guard's own config and for other groups", "should report a bad setting with the shared validator" pass; Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z); npm test 2441 pass / 0 fail / 4 skipped (shown, 2026-11-16T18:48Z)
- AC9: `npm test` passes, and `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` pass.
  - Evidence: gate --rerun-fix: npm test exit 0 (2441 pass, 0 fail, 4 skipped), claude plugin validate . exit 0, claude plugin validate plugins/usiatech-engineering exit 0; claude plugin validate plugins/usiatech-usage-band exit 0 in this run (Validation passed; ICON_MISSING advisory only); Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z) (shown, 2026-11-16T18:48Z)
- AC10: The usiatech-usage-band plugin 0.1.0 passes `claude plugin validate plugins/usiatech-usage-band`, and its `hooks/band.test.tsx` passes under `claude plugin test plugins/usiatech-usage-band`.
  - Evidence: claude plugin validate plugins/usiatech-usage-band exit 0 in this run (Validation passed; ICON_MISSING advisory only); claude plugin test plugins/usiatech-usage-band exit 0, 2 pass / 0 fail (hooks/band.test.tsx), run 2026-11-16 after the license field was added, usage band unchanged since (evidence passed in); Gate tree: 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e; Rerun after full gate at tree eb8b967e26aa7bf23eddc76531a3e549cb36d6c3 (2026-11-16T17:58:22Z) (shown, 2026-11-16T18:48Z)

## Tasks
- [x] T1: Write ADR-0005 with the accepted decisions and the ADR-0004 amendment (covers AC1–AC8; ESP-166)
- [x] T2: In `governance-rules.mjs`: ask-path groups, command setting map, guard config paths, ADR defaults and the shared `resolveSettings` validator (covers AC1, AC5, AC7; ESP-166)
- [x] T3: Validate the keys in `sanitizeConfig` and apply them in `decideEdit`, `decideScope`, `decideOutsideEdit`, `decideBash` and `evaluate`, with bypass and the `allowed-by-config` and `bypassed` log entries (covers AC1–AC7; ESP-166)
- [x] T4: The CI check reads the file-group keys (covers AC8; ESP-166)
- [x] T5: Tests for AC1–AC8 (ESP-166)
- [x] T6: Update `templates/engineering.json`, the plugin README and the approve-plan SKILL.md ask-path list (covers AC9; ESP-166)
- [x] T7: Ship the usiatech-usage-band plugin 0.1.0 with its marketplace entry, README row and `license` field (covers AC10; combined PR)

## Files
- `docs/adr/0005-guard-settings-per-restriction.md`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/docs-only.test.mjs`
- `README.md`
- `.claude-plugin/marketplace.json`
- `.gitignore`
- `plugins/usiatech-usage-band/**`

## Commands and actions
- None beyond tests and plugin validation.

## Out of scope
- An env-var bypass (the user chose config only).
- Keys for destructive command rules (the user's decision on 2026-11-16).
- Shell-command writes to guard config files (for example `sed -i` on `engineering.json`): the guard doesn't check Bash file targets in general. This is a known gap, noted in ADR-0005.
- Changing this repo's own `.claude/engineering.json`.
- Removing `askPaths`, `denyCommands`, `askCommands` or any other existing key.

## Approved
- By: Francis · Date: 2026-11-16
- Route: small (override: Francis chose "Treat as small" on 2026-11-16; the design was settled on the accepted review page)
- Pre-flight: inherit (agent file model), full

## Change log
- 2026-11-16: drafted from the accepted guard settings review page (D0.1–D7.2).
- 2026-11-16: the governance pre-flight returned FLAG (7). Francis decided:
  - the route: treat as small;
  - destructive command rules get no option (the denies plus the destructive asks; bypass leaves them too);
  - guard config edits always ask;
  - the README public fix ships in this PR.
  Fixed by Claude:
  - D-items recorded in ADR-0005;
  - one shared validator (F15) and a base-branch config in AC8 (F11);
  - the command keys listed against the rules they cover;
  - the Pre-flight line filled in;
  - the command-side fail-closed checks moved to fixed, since they guard the destructive rules (narrowing D5.1 to the edit side).
- 2026-11-16: scope widened by Francis, "All combined into a single PR. DO not separate" (confirmed as "One combined PR", relayed from the parent session). The PR also carries the root README public fix and the new usiatech-usage-band plugin 0.1.0 (written by the parent session: `plugins/usiatech-usage-band/**`, its marketplace.json entry and README row, `.gitignore`). The release bump applies to usiatech-engineering only; usage band stays 0.1.0.
- 2026-11-16: release stage 1 (governance-reviewer) returned FLAG (3). Francis decided:
  - ADR edits vs requirePlan: fix in code. `adrEdits` now applies only with an active plan; with none, `requirePlan` keeps its meaning and there is no outright allow. Test added.
  - The 13 asks in the governance log from 17:24 to 17:39Z (10 writes to `~/.claude/dev-mods/.../usiatech-usage-band/**`, two `npx -y -p typescript@5.6.3 tsc` runs and one `claude plugin validate` in dev-mods) were approved at the prompt during the usage-band build.
  - The usage band gets T7 and AC10 (validation plus `claude plugin test`).
  - Gate note: add `"license": "MIT"` to the usage band plugin.json in this PR.
  Nit fixed by Claude: the validator is named `resolveSettings`, not `settingProblem`.
- 2026-11-16: release stage 2. Blocking findings fixed by Claude:
  - silent-failure-reviewer: `uncheckable: "allow"` returned early in `decideOutsideEdit` and `decideWorktreeEdit`, skipping the content, outside-write and project checks. It now drops only that ask. Test added.
  - security-reviewer: `remoteInfra` covered `terraform destroy`, `kubectl delete`, `docker system prune` and `docker volume rm`. They move to a new fixed rule, "destroying infrastructure", with no key. Test added; ADR-0005 and README updated.
  Francis decided:
  - security-reviewer medium: fixed ask for `**/.git/**`, `.claude/hooks/**` and `.claude/agents/**` (`claudeConfig: "deny"` denies the `.claude` ones). Test added; ADR-0005 and README updated.
  - governance-reviewer FLAG: the guard failed open at 18:03:52Z on the background gate command; `git status` showed no new `.github/**` or workflow files. Acknowledged clean.
  - mutation-test suggestion: skipped.
- 2026-11-16: release review round 3.
  - security-reviewer medium, fixed by Claude under Francis's earlier `.git` decision: `**/.git/**` missed a `.git` file (a linked worktree or submodule pointer). `GIT_PATHS` (`**/.git`, `**/.git/**`) now covers both in the fixed ask, the plan allow and the outright allow. Outside the project, `agents` joins the always-ask folders, to match `.claude/agents/**` inside. Tests, ADR-0005, README and the template `$comment` updated.
  - governance-reviewer FLAGs, decided by Francis: the second guard fail-open at 18:18:10Z (background command; no new `.github/**` or workflow files) is acknowledged clean. The four Bash asks at 18:02:23, 18:11:44, 18:15:21 and 18:18:27Z (`node -e` edits and greps under false-positive rules) were approved at the prompt. Later plan edits use the Edit tool.
- 2026-11-16: release review round 4. convention, silent-failure and security reviewers PASS. governance-reviewer FLAG, decided by Francis: the two asks at 18:23:34Z (a grep whose pattern held `terraform destroy`, under the installed guard's remote host rule) and 18:27:17Z (security-reviewer's `rm -rf` of its scratchpad `probe` folder, the fixed recursive-delete rule) were approved at the prompt. Nit for the PR: the plugin README's trusted-folder list (line 302) doesn't name `agents` yet.

## Final status
- Status: shipped, in one combined PR on branch `feature/esp-166-guard-settings` (ESP-166 guard settings, the root README public-marketplace fix and the usiatech-usage-band plugin 0.1.0). The usiatech-engineering version bump follows in its own chore(release) PR.
- Acceptance criteria: AC1 to AC10 shown at gate tree 07b7f16cc3b3999dbf79c103c7c9afdef6b4185e (2026-11-16T18:48Z, `--rerun-fix` on the full pass at eb8b967e26aa7bf23eddc76531a3e549cb36d6c3).
- Reviews: four full rounds (governance, convention, silent-failure, security); every blocking finding fixed and every FLAG decided by Francis, as the Change log records. Jira ESP-166 moved to Ready for Release.
- Deviations: scope widened to the combined PR (Change log 2026-11-16); review fixes added the "destroying infrastructure" fixed rule, fixed asks for git internals and Claude Code hooks and agents, and an `agents` always-ask folder outside the project.
- Tasks: commit and PR are opened by this release.
