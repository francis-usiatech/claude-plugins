# Spec: Plan edits without a prompt (`governance.planEdits: "all"`)

Status: approved · Date: 2026-10-09 · Author: Francis

## Problem
The guard asks before every create, replace or scope change of `.claude/plans/active.md`, and before every write under `.claude/plans/archive/`. With `governance.planEdits: "allow"` (the default, ESP-9), only evidence lines, task ticks and Change log lines in an existing `active.md` go through without a prompt. A repo that wants Claude to record, update and archive plans without a prompt can't say so. In this repo, `active.md` writes have caused more than 100 prompts (#72, ESP-22).

## Goals
- A repo can opt in to plan and archive writes that need no prompt and are still logged.
- With the opt-in, the governance-reviewer still catches scope that grew after approval without a record.
- This repo opts in.

## Non-goals
- Changing the `"allow"` default or the `"ask"` behaviour.
- Trusting plan files written or moved through Bash (`git mv`, `rm`, redirects). The Bash checks are unchanged.
- Version-bump automation (ESP-23, #73) and the no-snapshot fallback (ESP-20, #69).

## Requirements
- R1: `governance.planEdits` accepts `"all"`, in addition to `"allow"` and `"ask"`. Any other value is a config problem whose message names all three values.
- R2: With `"all"`, a Write, Edit or MultiEdit of `.claude/plans/active.md` doesn't ask, whether it creates the file, replaces it, or changes scope or any other section. It is logged with `"decision": "trusted"`.
- R3: With `"all"`, a Write, Edit or MultiEdit of any file under `.claude/plans/archive/` doesn't ask, whether it creates, edits or overwrites the file. It is logged with `"decision": "trusted"`.
- R4: With `"all"`, the secret, env-file and protected-path checks still run on plan and archive writes, and their deny or ask wins over the trust.
- R5: With `"allow"` (or no value) and with `"ask"`, plan and archive writes are decided exactly as before.
- R6: When the governance log shows a `trusted` write to `active.md` since the plan's approval, the governance-reviewer checks that every **Files** entry, acceptance criterion and task added after approval has a dated Change log line. It returns at least `FLAG` for each one that doesn't.
- R7: The plugin README, `templates/engineering.json` and the approve-plan skill describe `"all"`, what it trusts, and its trade-off: the governance-reviewer's check is then the only scope check on plan changes.
- R8: This repo's `.claude/engineering.json` sets `"governance": { "planEdits": "all" }`.
- R9: With `"all"`, a plan or archive write is trusted only when the file really is under `.claude/plans`. When the path resolves elsewhere through a link or junction, is a hard link, or is a link to a missing target, the guard asks instead.

## Acceptance criteria
- AC1 (R1): A test passes `planEdits: "all"` and gets no config problem. A test passes `planEdits: "yes"` and gets a config problem matching `"allow", "ask" or "all"`.
- AC2 (R2): Under `"all"`, tests create `active.md` with Write, replace it with Write, and add a **Files** entry with Edit and with MultiEdit. Each `evaluate()` call returns no ask or deny, and `logEntries` records `"decision": "trusted"`. The same create test without `"all"` still returns `ask`.
- AC3 (R3): Under `"all"`, tests create a new archive file, edit an existing one and overwrite an existing one. Each returns no ask or deny and is logged as `trusted`.
- AC4 (R4): Under `"all"`, a plan write and an archive write that contain a private key are denied. A write that contains a secret the guard only asks about still asks. A write to a path matched by `protectedPaths` is still denied.
- AC5 (R5): The existing `planEdits` tests for `"allow"` and `"ask"` pass unchanged, except the invalid-value message check, which changes to the three-value wording R1 requires. `npm test` exits 0.
- AC6 (R6): `plugins/usiatech-engineering/agents/governance-reviewer.md` tells the reviewer: when the log has a `trusted` write to `active.md`, compare the plan's Files, ACs and tasks against those at approval (from git history or the Change log) and return at least `FLAG` for any later addition without a dated Change log line. A grep for `planEdits` in that file finds the instruction.
- AC7 (R7): `grep -n '"all"'` finds the new value, with its trade-off, in `plugins/usiatech-engineering/README.md`, `plugins/usiatech-engineering/templates/engineering.json` and `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`.
- AC8 (R8): `node -e` that reads `.claude/engineering.json` prints `all` for `governance.planEdits`, and `loadConfig` on this repo reports no config problem.
- AC9 (R1–R5, R9): The mutation test on the changed decision code catches every mutant, or each survivor is explained.
- AC10 (R9): Under `"all"`, tests where `.claude/plans/archive` is a junction to another folder, where `.claude/plans` is a junction to another folder, where `active.md` is a hard link, and where the archive junction's target is missing each return `ask`, with a reason that names the link.

## Constraints & decisions
- ESP-9 (0.9.0) added trusted writes and evidence-only plan edits; `"all"` extends that model and uses the same `trusted` log decision.
- `.claude/engineering.json` is a governance file. Its creation asks in the guard, and CI needs the approval label on the PR.
- Trade-off accepted by the user: under `"all"`, Claude can widen its own scope without a prompt. R6 is the mitigation. This is easy to reverse (set the value back), so no ADR is needed.
- ADR-0002 applies: a test that can't fail fails the gate (fake-pass check).
- R9 limit: the link check runs before the write, so a link made between the check and the write isn't seen. A hook can't close this gap; commands that make links go through the guard on their own.

## Open questions
- None. Archive writes in scope and the reviewer check (R6) were settled in clarify.

## Change log
- 2026-10-09: AC5 clarified: the invalid-value message test changes per R1/AC1 (the two contradicted). Approved by Francis.
- 2026-10-09: R9 and AC10 added from the PR #78 security review: under `"all"`, a linked plan path would be trusted where it used to ask. Francis chose to fix it in the same PR.

## Tickets
Filed in Jira as sub-tasks of ESP-22 (#72):
- ESP-24 · Guard accepts planEdits "all", trusts plan and archive writes · Covers: R1–R5, AC1–AC5, AC9 · Blocked by: none
- ESP-25 · Reviewer flags scope added after approval without a Change log line · Covers: R6, AC6 · Blocked by: ESP-24
- ESP-26 · Document planEdits "all" and opt this repo in · Covers: R7, R8, AC7, AC8 · Blocked by: ESP-24
