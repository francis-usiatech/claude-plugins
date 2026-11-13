# Spec: Gate and release speed-ups

Status: approved · Date: 2026-11-13 · Author: Francis

## Problem
In the HEIL repo, one release on 2026-11-12 (HEIL-583) spent several 30-minute full gates on reruns that proved nothing new:
- The fake-pass check runs last, so its findings appear only after the long suites (`test:rls`, `test:e2e`) pass.
- The release skill runs the full gate before the review round, so a blocking review fix needs a second full gate.
- A `verifyConditional` step can't exclude files, so the demo e2e suite runs on live-only web files that never reach it.
- A review fix always needs the full gate again, even when it touches one package.
- An infrastructure flake (container or Keycloak start timeout) makes the next run start again from the first step, though the tree has not changed.

Separately, building any change prompts for every file edit, often several times in one file. The guard only returns `deny` or `ask`; for an edit it lets through (in the plan's **Files**, or a trusted write) it returns nothing, so Claude Code falls back to its own permission mode and asks each time. On 2026-11-13 the spec and plan writes for this work prompted although the guard log shows no guard `ask`.

Tickets: ESP-158, ESP-159, ESP-160, ESP-161, ESP-162, ESP-163 (epic ESP-117).

## Goals
- Cheap checks fail before slow ones.
- A blocking review finding costs at most one extra gate run, and with the rerun option, only the steps its fix selects.
- A rerun after a flake at an unchanged tree runs only the failed step and the ones after it.
- Local and CI gates select the same conditional steps.
- An edit the approved plan covers, or a trusted write, runs without a permission prompt.

## Non-goals
- No step ordering change in the CI gate (`run-verify.mjs` runs every selected step anyway).
- No task-runner cache in the plugin: repos that cache their suites keep the full-gate rerun.
- No change to the docs-only skip or the `--iterate` partial run, except that `unless` and `slow` also apply to `verifyIterate` steps.
- No guard change for Bash or PowerShell commands, and no allow for an edit when no plan is active.

## Requirements
- R1 (ESP-158): the full gate runs the fake-pass check before the first command step; a failing check stops the gate before any command step runs.
- R2 (ESP-158): a `verify`, `verifyConditional` or `verifyIterate` step may set `"slow": true`. Every selected non-slow step runs before any slow one, in config order inside each group. The first failure stops the run, as today. A `slow` that isn't a boolean is a config error (exit 2).
- R3 (ESP-158): the report lists the steps in the order they ran, and `Gate: PASS`/`Gate: FAIL` keep their meaning.
- R4 (ESP-159): the release skill starts the review round and the full gate at the same time. A review fix that changes code discards that gate run, and the gate runs again (or the R11 rerun applies). The AC evidence check is a short final step after the last gate. The verify skill and the README state the same order.
- R5 (ESP-160): a `verifyConditional` or `verifyIterate` step may set `unless`, a non-empty list of globs relative to the repo root (forward slashes, no leading `./` or `/`, no `..` segment, no control character). The step is selected when a changed file matches a `when` prefix and no `unless` glob. A step skipped because every matching file was excluded says so in its `SKIPPED` line. A malformed `unless` is a config error (exit 2).
- R6 (ESP-160): the CI runner `run-verify.mjs` selects conditional steps with the same rule, from one shared module.
- R7 (ESP-162): every gate run records, in a run record inside the repo's git folder, the hash of the working tree (tracked and untracked, non-ignored files), the hash of `.claude/engineering.json`, and each step that passed with the time it passed. Every full gate run prints `Gate tree: <hash>`, and `gate.mjs --tree-hash` prints the current tree hash and runs nothing.
- R8 (ESP-162): `gate.mjs --resume` with the same tree hash and config hash as the last recorded run skips the steps that passed and shows each as `PASSED EARLIER (<UTC time>)`. With a different tree or config, or no record, it runs every step and says why.
- R9 (ESP-162): a resumed run ends in `Gate: PASS` only when every selected step has passed at the same tree hash.
- R10 (ESP-161): the top-level key `verifyRerun` takes one value, `"fix-diff"`. Any other value is a config error (exit 2). Without the key the option is off.
- R11 (ESP-161): with the option on, `gate.mjs --rerun-fix` needs a recorded full `Gate: PASS` at the same config hash. It runs the `verify` steps, the fake-pass check and the conditional steps that the diff between that pass's tree and the current tree selects, and prints `Rerun after full gate at tree <hash> (<UTC time>)`. Without the option, or without such a pass, it exits 2 and runs nothing.
- R12 (ESP-161): the release and verify skills state the rerun rule: a code change after a full gate needs the full gate again; a repo whose task runner caches its suites keeps that rule; a repo with `verifyRerun` set may use `--rerun-fix` instead.
- R13 (ESP-161, ESP-162): `governance-reviewer` accepts a resumed or narrowed gate as AC evidence only when the gate's tree hash equals the current tree hash (`gate.mjs --tree-hash`) and, for a narrowed rerun, the full pass it names is in the run record. Otherwise it flags the evidence. Its check for evidence older than the last change is unchanged.
- R14 (ESP-161): this repo sets `"verifyRerun": "fix-diff"`.
- R15 (ESP-163): for an Edit, MultiEdit, Write or NotebookEdit that passes every guard check and is either a trusted write or a file the active plan's **Files** list covers, the guard returns `permissionDecision: "allow"` with its reason, so Claude Code doesn't prompt.
- R16 (ESP-163): every case that asks or denies today still does: a file outside the plan, an ask path, `active.md` unless `planEdits` trusts the write, a likely secret, a high-risk content finding, a Windows short name, a config problem. With no active plan the guard returns no decision, as today. Trusted writes are still logged as `trusted`; in-plan allows are not logged. No allow is given in plan mode or without a permission mode in the hook input, after a failed-open dependency lookup, for a file under any `.git/` folder, or for a plan or archive write trusted by `planEdits: "all"` (security review 2026-11-13: an unprompted plan write could widen **Files** and then allow any edit); an evidence-only plan edit is still allowed.

## Acceptance criteria
- AC1 (R1): a fake-pass finding fails the gate and no command step runs (test).
- AC2 (R2): with steps marked slow, every selected non-slow step runs before any slow one; a non-boolean `slow` exits 2 (test).
- AC3 (R2, R3): a config with no `slow` key runs its steps in the same order as before, after the fake-pass check, and the report lists them in that order (test).
- AC4 (R4): the release skill, verify skill and README give one order: review round and full gate together, AC evidence check last.
- AC5 (R4, R11): a dry run in a scratchpad repo with `verifyRerun` set, following the release skill's new order, where the review round finds a blocking issue: the first full gate overlaps the review round, and after the fix `--rerun-fix` runs instead of a second full gate. Pass: one full gate and one narrowed rerun from the review round to the commit, where the old order needed two full gates in a row (manual evidence: the gate outputs).
- AC6 (R5): a diff whose every `when` match is excluded by `unless` skips the step, and the `SKIPPED` line names the exclusion; a malformed `unless` exits 2 (test).
- AC7 (R5): one changed file that matches `when` and not `unless` selects the step (test).
- AC8 (R5): configs without `unless` select the same steps as before (test).
- AC9 (R6): `gate.mjs` and `run-verify.mjs` select the same steps for the same diff (test).
- AC10 (R7, R8): after a failure at step N, `--resume` at the same tree runs step N and later only, and shows each earlier step as `PASSED EARLIER (<time>)` (test).
- AC11 (R8): editing a tracked file, or adding an untracked file, makes `--resume` run every step (test).
- AC12 (R8): a change to `.claude/engineering.json` makes `--resume` run every step (test).
- AC13 (R7, R9): a full run prints `Gate tree: <hash>` equal to `--tree-hash` output; a resumed run whose steps all passed at that tree ends `Gate: PASS`, and one with a failing step ends `Gate: FAIL` (test).
- AC14 (R10, R11): with `verifyRerun` set and a recorded full pass, a fix touching one conditional step's folder runs the `verify` steps, the fake-pass check and that step only, and prints the `Rerun after full gate at tree` line (test in a fixture repo).
- AC15 (R10, R11): `--rerun-fix` without the key, with an unknown value, or without a recorded full pass exits 2 and runs nothing (test).
- AC16 (R12, R13): the release and verify skills state the rerun rule and its conditions, and `governance-reviewer` checks the tree hash and the named full pass, flagging a mismatch.
- AC17 (R14): this repo's `.claude/engineering.json` sets `"verifyRerun": "fix-diff"`, and `gate.mjs --check` exits 0.
- AC18 (R15): the guard returns `allow` for an edit to a file in the plan's Files list and for a trusted write (scratchpad; a plan write trusted by planEdits "all" is logged but keeps Claude Code's prompt, security review 2026-11-13), and the trusted write is still logged as `trusted` (test).
- AC19 (R16): an out-of-plan file, an ask path and a broken config still return `ask`, a secret still denies, and an edit with no active plan returns no decision (test).

## Constraints & decisions
- ADR-0002 (fake-pass checks fail the gate): unchanged; R1 only moves the check earlier.
- ESP-159 decision (Francis, 2026-11-13): option B, review round and full gate together.
- ESP-161 decision (Francis, 2026-11-13): add `verifyRerun`, default off, and turn it on in this repo.
- ESP-163 folded into this work (Francis, 2026-11-13): released together.
- The run record lives under the repo's git folder (`git rev-parse --git-path usiatech-gate`), so it is never committed and is private to the clone.
- `run-verify.mjs` is copied into repos with the whole `templates/github/scripts/` folder (setup-engineering), so it may import the shared selection module; an existing install must re-copy the folder.
- A hook `allow` skips Claude Code's prompt for that call; the guard gives it only for edits its own rules have fully checked and the plan scopes.
- AGENTS rules: helpers are imported from their module, git paths are read with `-z`, `isMainModule` for entry scripts (gate.mjs keeps its documented exception).

## Open questions
- Does the guard need to know the new gate keys? Answered: the guard doesn't validate `verify*` step keys or `verifyRerun`; `gate.mjs` validates them.
- AGENTS.md template "order after the build" text (ESP-159 AC1)? Answered: no such text exists in this plugin's templates; the README and skills are the places to keep in step.

## Tickets
Existing Jira tickets cover this spec: ESP-158 (R1–R3), ESP-159 (R4), ESP-160 (R5, R6), ESP-161 (R10–R14), ESP-162 (R7–R9, R13), ESP-163 (R15, R16).
