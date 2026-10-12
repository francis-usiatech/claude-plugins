# Spec: Per-key config validation (warn once for harmless problems, ask only for weakening ones)

Status: approved · Date: 2026-10-10 · Author: Francis

## Problem
Any problem `sanitizeConfig` reports in `.claude/engineering.json` makes the guard's `evaluate()` turn every action into an ask ("Config problem: …"), even when the bad key isn't read by the guard or dropping it only makes the guard stricter. This repo hit it: `planEdits: "all"` was set while the installed guard was 0.10.1, and the guard asked on almost every action until Claude Code was restarted (governance log, 0.11.0 release session). The ESP-12 `decisions` keys will do the same on any repo still running 0.11.0. The after-Bash check (`bash-workflow-check.mjs`) also logs a decision `error` entry for every config problem after every Bash call. Tracked as Jira ESP-35 (High, efficiency).

## Goals
- A config problem that is harmless, or whose dropped value makes the guard stricter, is reported once and doesn't prompt.
- A config problem whose dropped value could weaken the guard still asks on every action, as today.

## Non-goals
- Reporting keys the guard doesn't know about (they stay unreported, as today).
- Config schema versioning.
- Changing what any valid key means, the default deny rules, or the CI governance checks in `templates/github/scripts/`.

## Requirements
- R1: Each config problem is classed as **advisory** or **escalating**.
  - Advisory: a non-object `decisions` or a non-boolean `decisions.batch` / `decisions.nitsNeedDecision`; a non-array `governance.trustedWritePaths` or a bad entry in it; an unknown `governance.planEdits` value; a non-array `governance.allowlist` or a bad entry in it.
  - Escalating: `.claude/engineering.json` can't be parsed or isn't an object; `governance` isn't an object; a bad `governance.askPaths`, `governance.protectedBranches`, `governance.denyCommands`, `governance.askCommands` (the list or an entry); a bad `git` or `git.releaseBranch`; a bad `protectedPaths` or `immutableWhenCommitted`.
- R2: An unknown `governance.planEdits` value is treated as `"ask"` (today it is dropped, which acts like `"allow"`). A non-array `governance.trustedWritePaths` is treated as an empty list, so no path is trusted (the defaults would trust more than a valid empty list).
- R3: When there are escalating problems, the guard behaves as today: every action that isn't denied becomes an ask, and the reason lists every problem, advisory ones included.
- R4: When there are only advisory problems, the guard doesn't change its decision because of them. The first time a given set of advisory problems is seen, it writes one governance-log entry (decision `warn`) and returns a non-blocking message naming the problems. A `trustedWritePaths` entry quoted in that message is JSON-quoted and cut to 60 characters, since the message also reaches Claude's context. The message names as many problems as fit in 1000 characters and then says how many more there are; the log entry names them all. The action's own decision (allow, ask or deny) is unchanged.
- R5: The advisory warning is repeated only when the set of advisory problems changes. This is remembered across hook runs and Claude Code restarts in a marker that holds a hash of the problem set, written only after the `warn` entry is in the log. Fixing every advisory problem and later reintroducing the same one warns again, including when the fix was made while an escalating problem was present. A file that can't be parsed leaves the marker as it is, since its advisory set isn't known.
- R6: The after-Bash check uses the same classification and the same marker: advisory problems are logged once (decision `warn`); escalating problems are still logged with decision `error` on every run. As before, the check reads the config only after a Bash call that changed a workflow file. A config entry it can't log is shown as a message instead.
- R7: If the marker can't be read, isn't a small regular file, or sits in a folder that can't be trusted (the rule the after-Bash snapshots use), the warning is shown again (fail towards reporting). If it can't be written, or can't be removed (it is removed only from a folder that can be trusted), that failure is logged as decision `error`, and the action's decision is still unchanged. A marker failure that can't be logged is shown as a message instead, by the guard and by the after-Bash check.
- R8: The plugin README describes the advisory/escalating split and the warn-once behaviour.

## Acceptance criteria
- AC1 (R1, R4): A test calls `evaluate` with `decisions: { batch: "yes" }` and an empty marker. It gets the same decision as with a valid config, plus one advisory warning naming `decisions.batch`. A second call with the marker already written gets no warning and no ask.
- AC2 (R1, R4): The same as AC1, one test per advisory case: `trustedWritePaths: "x"`, a bad `trustedWritePaths` entry, a bad `allowlist` entry.
- AC3 (R2): A test with `planEdits: "bogus"` shows an evidence-only edit to `.claude/plans/active.md` gets an ask, the same as `planEdits: "ask"`, with no "Config problem" escalation of other actions.
- AC4 (R1, R3): One test per escalating case: unparseable JSON, `governance: 1`, bad `askPaths`, bad `protectedBranches`, bad `denyCommands` entry, bad `askCommands` entry, bad `git.releaseBranch`, bad `protectedPaths`, bad `immutableWhenCommitted`. Each turns an otherwise-allowed action into an ask with the "Config problem" reason on every call, whatever the marker holds.
- AC5 (R3): A test with one escalating and one advisory problem gets an ask whose reason names both.
- AC6 (R5): A test shows a changed advisory set (a second problem added) warns again; the same set doesn't; clearing all problems and then reintroducing the first one warns again, also when they were cleared while an escalating problem was present.
- AC7 (R6): A test of the after-Bash check with only advisory problems shows one `warn` log entry over two runs; with an escalating problem it shows one `error` entry per run.
- AC8 (R7): Tests show an unreadable marker leads to the warning being shown, and a marker write failure leads to one `error` log entry with the action's decision unchanged.
- AC9 (R8): `plugins/usiatech-engineering/README.md` names the advisory and escalating keys and says advisory problems warn once per change.
- AC10 (all): `npm test` passes with 0 failures; the fake-pass check reports 0; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.

## Constraints & decisions
- Francis decided (2026-10-10): Option A, per key. The rule: a problem whose dropped value makes the guard stricter, or that the guard doesn't read, is advisory; one whose dropped value could weaken it escalates. The other keys (`git.releaseBranch`, `protectedPaths`, `immutableWhenCommitted` escalate; a non-array `trustedWritePaths` is advisory) were classed by this rule (2026-10-10).
- Francis decided (2026-10-10): bad `allowlist` entries are advisory, since dropping one only brings back the findings it would have hidden. This reverses the earlier note that `allowlist` escalates.
- Francis decided (2026-10-10): warn again per change of the advisory set (hash marker), not per session; the after-Bash check shares the marker; the warning is a log entry plus a non-blocking message.
- Francis decided (2026-10-11, release review): a non-array `allowlist` is advisory too, by the same reasoning as a bad entry.
- Francis decided (2026-10-11, release review): with an escalating problem present and no advisory problem left, the marker is cleared, so R5's "warns again" also holds across an escalating phase. The asks under escalation are unchanged (AC4).
- Francis decided (2026-10-11, release review stage 2): a non-array `trustedWritePaths` counts as an empty list (R2); quoted config values are capped (R4); the marker is recorded after the log entry and read only when it can be trusted (R5, R7); the state-folder rule is shared by both hooks in `governance-state.mjs`.
- Francis decided (2026-10-11, narrow re-review): the shown problem list is capped with a count of the rest while the log entry names every problem (R4); the marker is removed only from a trusted folder (R7); the 60-character cut is stated for `trustedWritePaths` entries only, which is what the code does (R4).
- The marker can only ever suppress an advisory warning. It never affects an escalating problem or any decision, so tampering with it can at worst hide an advisory warning. The hooks write it only after the warning is logged; a marker planted by something else can hide a warning that was never logged.
- The marker is local state, not committed, and lives with the guard's other temporary state, outside any path the repo config can mark trusted.
- ADR-0001 (guard network lookups) is unaffected. The change narrows when the guard asks and is easy to reverse, so no new ADR is needed; the README Versioning row records it.

## Open questions
- Once per config change or once per session? Answered: per change of the advisory set (R5).
- How should the after-Bash check log advisory problems? Answered: once, as `warn`, sharing the marker (R6).
- How is the warning shown? Answered: governance log plus a non-blocking message (R4).
- Is `allowlist` escalating? Answered: no, advisory (Constraints).

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
Filed as Jira sub-tasks of ESP-35:
- ESP-47 · Classify config problems as advisory or escalating · Covers: R1, R2, R3, AC3, AC4, AC5, AC10 · Blocked by: none
- ESP-48 · Warn once per advisory set using a hash marker · Covers: R4, R5, R7, AC1, AC2, AC6, AC8, AC10 · Blocked by: ESP-47
- ESP-50 · Log advisory config problems once after Bash · Covers: R6, AC7, AC10 · Blocked by: ESP-48
- ESP-49 · Document advisory and escalating config keys · Covers: R8, AC9, AC10 · Blocked by: ESP-47
