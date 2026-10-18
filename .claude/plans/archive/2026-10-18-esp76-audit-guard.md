# Plan (archived): Audit PR B — guard git prefix and linked entry points (ESP-76)

## Goal
Make every guard git rule see the command after git global options (`git -C . push origin main`, `git --no-pager commit`), and deny `git commit -n`, which skips hooks like `--no-verify` (F3). Make the four scripts that check "am I the main module" still run when started through a link or junction, instead of exiting 0 without doing anything (F4).

## Requirement references
- `docs/audits/2026-10-17-ponytail-audit.md` F3 and F4, and its "How to use this brief" rules (test-first, smallest fix, no new dependencies)
- ESP-76 (sub-task of ESP-74)

## Pre-plan checklist
- (a) New validation rules and format checks:
  - F3 changes the git command rules. Callers:
    - `DENY_COMMANDS` and `ASK_COMMANDS` (`governance-rules.mjs:35-59`) are used by `decideBash` (`governance-policy.mjs:466,478`) and by `tests/governance-rules.test.mjs:63`, which checks that every rule compiles.
    - `pushTargets` and `gitAction` are module-private in `governance-policy.mjs:460,470`.
    - `GIT_CHECKOUT_CMD` (`workflow-rules.mjs:47`) already has a git global-options prefix, with a bound of 8 options so it stays linear. Its tests are `tests/workflow-rules.test.mjs`, including the two 1 MB timing tests at `:884-888`.
    - Fixtures: the deny and ask tables in `tests/governance-policy.test.mjs:22-40`, and the protected-branch tests at `:83` and `:474`.
  - F4 is not a validation rule. Its callers are the entry blocks of `bash-workflow-check.mjs:351`, `mutation-runner.mjs:306`, `fake-pass-check.mjs:72`, `governance-checks.mjs:238`, and `isMainModule` in `jira-tracker.mjs:428-437`. The link-test pattern is at `tests/jira-tracker.test.mjs:746` and `tests/gate.test.mjs:71`.
- (b) Database or infrastructure mechanisms the design relies on:
  - Spike, 2026-10-17, in the scratchpad. The existing `GIT_CHECKOUT_CMD` prefix, used as a shared `GIT_PREFIX`, matches all 7 F3 commands, plus `--git-dir=/x` and `-C "my dir"`. The `-n` rule `commit\b[^;&|]*\s-[aqsv]*n` catches `-n`, `-nm x`, `-an` and `git -C . commit -n`. It leaves `-m x`, `--no-edit`, `-am x`, `-m new` and `git push -n` alone.
  - Node gives `import.meta.url` as the real path, and `realpathSync` on argv matches it. jira-tracker's link test already proves this on Windows junctions.
- (c) Docs and ADRs touched: searched the README, the docs, the ADRs and `AGENTS.md` for `isMainModule`, `argv[1]`, `--no-verify`, "git rules" and "global option".
  - Touched:
    - `AGENTS.md` gets the two PR B rules (`GIT_PREFIX` and `isMainModule`). Its AC6 import rule is reworded to allow the new built-ins-only module.
    - `plugins/usiatech-engineering/README.md` gets a new 0.18.2 Versioning row with an upgrade note: re-copy `templates/github/scripts/`, which has the new file `main-module.mjs`.
    - The README Deny list at `:117` names `--no-verify`, so it gets `git commit -n` added.
  - No ADR covers these rules. No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (F3 ask): on a feature branch, the guard asks for `git -C . push origin main`, `git -c core.x=1 push origin main`, `git -C . push --force origin x`, `git -C . reset --hard` and `git -C . rebase main`. On `main`, it asks for `git --no-pager commit -m x`. Every existing case in the deny, ask and allow tables still passes.
  - Evidence: governance-policy.test.mjs "should ask" table (3 new git -C cases) and "should see the git command after git global options (F3)": red before the fix, green after; mutations "F3 prefix: value options…", "F3 prefix: no global options", "F3 rewriting-history ask rule…", "F3 pushTargets…" and "F3 gitAction…" CAUGHT (shown, 2026-10-18T22:31Z)
- AC2 (F3 deny): the guard denies `git commit -n` in any flag cluster where `n` follows only commit's no-value flags, whatever follows it: `-n -m x`, `-nm x`, `git -C . commit -n`, `-pn`, `-nmwip`, `git --attr-source HEAD commit -n`, `-n;`, `-m x -n&& git push`, `-n|cat`, `(git commit -n)`, `-nC HEAD`, `-nuno -m x`, `-nam x` and `-nSkey`. It fails closed: quoted words such as `-m "fix -Note"` and `-m "x -sanitize"` are denied too (Francis, 2026-10-18). It does not deny `git commit -m x`, `git commit --no-edit`, `git commit -am x`, `git push -n`, `git commit -m new`, `git --no-pager log -S commit -n 3` or `git -p log -S commit -n 3`.
  - Evidence: governance-policy.test.mjs "should deny" (16 -n cases, including the 2 fail-closed message cases) and "should not deny" (7 cases) green; earlier cases red before their fixes; mutations "F3 -n rule dropped", "F3 -n rule: n must come first in the cluster" and "F3 prefix: no-value options may take a value" CAUGHT (shown, 2026-10-18T22:31Z)
- AC3 (F3 shared prefix): `GIT_PREFIX` is defined once, in `workflow-rules.mjs`. `GIT_CHECKOUT_CMD`, the git `ASK_COMMANDS`, the `-n` deny rule, `pushTargets` and `gitAction` all build on it. Any global option may take a separate value (fail closed: `--attr-source HEAD`, `--config-env k=HOME`) except git's no-value options (`--no-pager`, `-p`, `-P`, `--bare` and the like). `git --attr-source HEAD fetch origin refs/pull/1/head` in a privileged workflow still gives `wf-privileged-checkout`, and `git --attr-source HEAD push origin main` still asks. The workflow-rules tests, including the two 1 MB timing tests, still pass.
  - Evidence: GIT_PREFIX exported once from workflow-rules.mjs; GIT_CHECKOUT_CMD, the 4 git ASK_COMMANDS, the -n DENY rule, pushTargets and gitAction build on it; workflow-rules.test.mjs "--attr-source HEAD fetch" and "--config-env k=HOME fetch" wf-privileged-checkout cases and governance-policy "--attr-source HEAD push origin main": red, then green; both 1 MB timing tests passed in the gate (shown, 2026-10-18T22:31Z)
- AC4 (F4): `bash-workflow-check.mjs`, `mutation-runner.mjs`, `fake-pass-check.mjs` and `governance-checks.mjs` each run when started through a junction to their folder. Given input they can't use, each prints to stdout or stderr instead of exiting 0 silently: invalid JSON on stdin for bash-workflow-check, no arguments for mutation-runner, and a non-git working directory for fake-pass-check and governance-checks. The tests skip where a link can't be made. jira-tracker's existing link test still passes, now using the shared helper.
  - Evidence: tests/main-module.test.mjs: 4 link tests red before the fix ("exit 0, no output"), green after; jira-tracker link test green; mutation "F4 isMainModule compares argv as written" CAUGHT (shown, 2026-10-18T22:31Z)
- AC5: one `isMainModule(moduleUrl)` lives in `templates/github/scripts/main-module.mjs`, which imports only Node built-ins. jira-tracker's local copy is removed. The after-Bash timing test (AC6 perf) still passes.
  - Evidence: templates/github/scripts/main-module.mjs imports only node:fs and node:url; jira-tracker local copy removed; bash-workflow-timing.perf.mjs passed in the gate (shown, 2026-10-18T22:31Z)
- AC6: `AGENTS.md` has the `GIT_PREFIX` and `isMainModule` rules. Its AC6 import rule names the allowed set: Node built-ins plus the built-ins-only modules `governance-log.mjs`, `governance-state.mjs` and `templates/github/scripts/main-module.mjs`. The README Deny list (`:117`) adds `git commit -n`. The README has the 0.18.2 row, whose upgrade note says to re-copy the whole `templates/github/scripts/` folder.
  - Evidence: AGENTS.md: AC6 import rule names the allowed set, plus the GIT_PREFIX and isMainModule rules; README :117 adds git commit -n; README 0.18.2 row with the whole-folder upgrade note (shown, 2026-10-18T22:31Z)
- AC7: `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS. A mutation-test run on the changed rule and policy lines has no survivors.
  - Evidence: repo runner node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-18T22:31:43Z, after the mutation run (22:29Z) (tests, both validations, fake-pass check); mutation run 9 of 9 CAUGHT, 0 SURVIVED (shown, 2026-10-18T22:31Z)

## Tasks
- [x] T1: Failing tests first (tdd). Add the AC1 and AC2 commands to the `governance-policy.test.mjs` tables, including the allowed ones. Add a new `tests/main-module.test.mjs` with one link test per script (covers AC1, AC2, AC4; ESP-76)
- [x] T2: F3. Export `GIT_PREFIX` from `workflow-rules.mjs` and build `GIT_CHECKOUT_CMD` on it. It fails closed: any option may take a separate value, except git's no-value options (`GIT_NO_VALUE`). In `governance-rules.mjs`, import it, use it in the git ask rules, and add the fail-closed `-n` deny rule `${GIT_PREFIX}commit\b[^;&|]*\s-[aeiopqsvz]*n`. Re-export it for `governance-policy.mjs`, which uses it in `pushTargets` and `gitAction` (covers AC1–AC3; ESP-76)
- [x] T3: F4. Add `main-module.mjs` with `isMainModule(moduleUrl)`, using jira-tracker's realpath logic. Use it in the four scripts and in jira-tracker, and drop each script's now-unused `fileURLToPath` and `path` imports only where nothing else uses them (covers AC4, AC5; ESP-76)
- [x] T4: `AGENTS.md` rules and the README 0.18.2 row (covers AC6; ESP-76)
- [x] T5: Run the gate on a quiet machine, then a mutation test on the changed lines (covers AC7; ESP-76)

## Files
- `AGENTS.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/main-module.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/bash-workflow-check.mjs`
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/main-module.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`

## Commands and actions
- None beyond the normal gate, mutation test and release flow.

## Out of scope
- The other audit findings (PRs C–E: ESP-77 to ESP-79).
- Other ways to skip hooks: `git -c core.hooksPath=…`, `HUSKY=0`, `-n` after a value-taking flag in the same cluster (`-Cn`), `-n` after a quoted `;`, `&` or `|` (`-m "a;b" -n`), `-n` built by shell expansion (`f=-n; git commit $f`), abbreviated long options (`--no-ver`), and shell quoting or escapes around the flag or the subcommand (`'-n'`, `"-n"`, `\-n`, `
- A line continuation, or a 9th global option, before the git subcommand. The existing prefix bound already allows this.
- The fail-closed `-n` rule denies quoted message words that read as a cluster (`-n`, `-Note`, `-sanitize`). This is accepted (Francis, 2026-10-18), of the same kind as the existing `--no-verify` rule.
- Re-copying the CI kit into subscriber repos. The README upgrade note tells them to.

## Approved
- By: Francis · Date: 2026-10-17
- Route: large (override: 13 files and a new module, but the audit brief stands in for the spec and ESP-74/ESP-76 are the tickets, as for PR A)

## Change log
- 2026-10-17: plan drafted. The requirement reference is the audit (Francis, as for PR A).
- 2026-10-17: pre-flight FLAG (governance-reviewer). (1) The planned `-n` rule denied harmless commands. Francis chose to tighten both: the shared prefix takes a separate value only after git's value options, and the `-n` cluster ends at a boundary (re-spiked, which clears `-sanitize`, `-Note` and `log -S commit -n`). The quoted ` -n` at the end of a message is accepted in Out of scope. (2) The AGENTS.md AC6 rewording is accepted with a named allowed list. (3) The README `:117` edit is made unconditional. AC4 inputs are named and the upgrade note says to copy the whole folder. Plan approved.
- 2026-10-18: stage 1 FLAG (governance-reviewer): the evidence stamps came before the mutation runner restored four files. The gate was re-run on the current files (PASS 20:23:28Z) and the evidence restamped.
- 2026-10-18: stage 2 blocking (security-reviewer, silent-failure-reviewer): the narrowed GIT_PREFIX missed git value options it did not list (`--attr-source`, `--config-env`). A workflow PR checkout lost its wf-privileged-checkout finding, and every guard git rule could be skipped. Fixed to fail closed: any option may take a separate value except git's known no-value options. Also from stage 2: the `-n` cluster was widened to commit's no-value flags plus a stuck `-m`/`-F` (`-pn`, `-nmwip`). The pre-flight false-positive cases still pass. AC2 and AC3 were updated, and new red-then-green tests were added in governance-policy and workflow-rules tests (`tests/workflow-rules.test.mjs` added to Files). The fix touches `*rules*.mjs`, so a full review round runs again.
- 2026-10-18: second round stage 1 PASS (governance-reviewer), with two plan wording nits fixed: T2 now describes the final design, and the Out of scope hook-skip bullet narrowed to what is still a gap.
- 2026-10-18: second round stage 2. security-reviewer BLOCK: `-n` followed straight by a shell operator (`-n;`, `-n&&`, `-n|cat`, `(…-n)`) skipped the deny rule. silent-failure-reviewer FLAG: a stuck value flag after `n` (`-nC HEAD`, `-nuno`) skipped it too. Both fixed: the cluster now ends at a space, quote or shell operator, or is followed at once by `[mFcCtu]` (kept directly after `n`, so `-Note` and `-Nice` stay allowed under the `i` flag). Tests red then green, mutation run 11 of 11, gate re-run. convention-reviewer PASS. Nits listed in the PR: quadratic `[^;&|]*` on many repeated `git commit`, escaped quotes or spaces in an option value, abbreviated `--no-ver`, `isMainModule` catch returning false, the link test asserting any output, and `z` in the cluster class. The fix touches `*rules*.mjs`, so a third full review round runs.
- 2026-10-18: third round. Stage 1 PASS and convention PASS. silent-failure-reviewer FLAG and security-reviewer FLAG: more `-n` cluster shapes skipped the rule (`-nam x`, `-nSkey`, `-n$x`). Francis chose to fail closed: the rule is now `\s-[aeiopqsvz]*n` with nothing required after `n`, so quoted words such as `-Note` and `-sanitize` are denied. This reverses the pre-flight allowance. Tests updated, mutation run 9 of 9, gate re-run. The security-reviewer obfuscated its probe text to get past the ecc --no-verify hook (read-only scratchpad probe; reported to Francis). The fix touches `*rules*.mjs`, so a fourth full review round runs.
-n'`, `git 'commit'`).
- A line continuation, or a 9th global option, before the git subcommand. The existing prefix bound already allows this.
- The fail-closed `-n` rule denies quoted message words that read as a cluster (`-n`, `-Note`, `-sanitize`). This is accepted (Francis, 2026-10-18), of the same kind as the existing `--no-verify` rule.
- Re-copying the CI kit into subscriber repos. The README upgrade note tells them to.

## Approved
- By: Francis · Date: 2026-10-17
- Route: large (override: 13 files and a new module, but the audit brief stands in for the spec and ESP-74/ESP-76 are the tickets, as for PR A)

## Change log
- 2026-10-17: plan drafted. The requirement reference is the audit (Francis, as for PR A).
- 2026-10-17: pre-flight FLAG (governance-reviewer). (1) The planned `-n` rule denied harmless commands. Francis chose to tighten both: the shared prefix takes a separate value only after git's value options, and the `-n` cluster ends at a boundary (re-spiked, which clears `-sanitize`, `-Note` and `log -S commit -n`). The quoted ` -n` at the end of a message is accepted in Out of scope. (2) The AGENTS.md AC6 rewording is accepted with a named allowed list. (3) The README `:117` edit is made unconditional. AC4 inputs are named and the upgrade note says to copy the whole folder. Plan approved.
- 2026-10-18: stage 1 FLAG (governance-reviewer): the evidence stamps came before the mutation runner restored four files. The gate was re-run on the current files (PASS 20:23:28Z) and the evidence restamped.
- 2026-10-18: stage 2 blocking (security-reviewer, silent-failure-reviewer): the narrowed GIT_PREFIX missed git value options it did not list (`--attr-source`, `--config-env`). A workflow PR checkout lost its wf-privileged-checkout finding, and every guard git rule could be skipped. Fixed to fail closed: any option may take a separate value except git's known no-value options. Also from stage 2: the `-n` cluster was widened to commit's no-value flags plus a stuck `-m`/`-F` (`-pn`, `-nmwip`). The pre-flight false-positive cases still pass. AC2 and AC3 were updated, and new red-then-green tests were added in governance-policy and workflow-rules tests (`tests/workflow-rules.test.mjs` added to Files). The fix touches `*rules*.mjs`, so a full review round runs again.
- 2026-10-18: second round stage 1 PASS (governance-reviewer), with two plan wording nits fixed: T2 now describes the final design, and the Out of scope hook-skip bullet narrowed to what is still a gap.
- 2026-10-18: second round stage 2. security-reviewer BLOCK: `-n` followed straight by a shell operator (`-n;`, `-n&&`, `-n|cat`, `(…-n)`) skipped the deny rule. silent-failure-reviewer FLAG: a stuck value flag after `n` (`-nC HEAD`, `-nuno`) skipped it too. Both fixed: the cluster now ends at a space, quote or shell operator, or is followed at once by `[mFcCtu]` (kept directly after `n`, so `-Note` and `-Nice` stay allowed under the `i` flag). Tests red then green, mutation run 11 of 11, gate re-run. convention-reviewer PASS. Nits listed in the PR: quadratic `[^;&|]*` on many repeated `git commit`, escaped quotes or spaces in an option value, abbreviated `--no-ver`, `isMainModule` catch returning false, the link test asserting any output, and `z` in the cluster class. The fix touches `*rules*.mjs`, so a third full review round runs.
- 2026-10-18: third round. Stage 1 PASS and convention PASS. silent-failure-reviewer FLAG and security-reviewer FLAG: more `-n` cluster shapes skipped the rule (`-nam x`, `-nSkey`, `-n$x`). Francis chose to fail closed: the rule is now `\s-[aeiopqsvz]*n` with nothing required after `n`, so quoted words such as `-Note` and `-sanitize` are denied. This reverses the pre-flight allowance. Tests updated, mutation run 9 of 9, gate re-run. The security-reviewer obfuscated its probe text to get past the ecc --no-verify hook (read-only scratchpad probe; reported to Francis). The fix touches `*rules*.mjs`, so a fourth full review round runs.
- 2026-10-18: fourth round. Stage 1 PASS, security PASS with nits, silent-failure PASS with nits. Auto mode denied the round-4 convention-reviewer launch; Francis chose to rely on the round-3 convention PASS, since round 4 changed only the -n rule line, its tests and the README text. Francis accepted shell quoting and escapes (`'-n'`) as out of scope, to be listed in the PR as a follow-up. A silent-failure probe ran `git commit` in the repo by mistake; nothing was staged, so no commit was made (checked: HEAD 0241a71, the same 14 files).

## Final status
- Shipped on branch `feature/esp76-audit-guard` (PR to develop). AC1–AC7 shown (gate PASS 2026-10-18T22:31:43Z, mutation run 9 of 9 CAUGHT).
- Deviations, all logged above:
  - `GIT_PREFIX` fails closed with a no-value list, instead of the audit's value-option regex.
  - The `-n` rule fails closed, which reverses the pre-flight -Note/-sanitize allowance.
  - `tests/workflow-rules.test.mjs` was added to Files.
  - Four full review rounds.
