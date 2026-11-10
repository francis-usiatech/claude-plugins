# Spec: Speed batch — less manual work and faster runs

Status: approved · Date: 2026-11-09 · Author: Francis Amalraj (drafted by Claude)

Covers the Jira tickets grouped as "Speed: less manual work and faster runs": ESP-36, ESP-53, ESP-54, ESP-55, ESP-56, ESP-58, ESP-61, ESP-65, ESP-104, ESP-112, ESP-116. ESP-144 from the same group is excluded: it is Ready for Release and waits on the ESP-117 AC6 re-measure.

The tickets themselves are the understanding notes (each has a problem, a fix and, for ESP-104, ESP-112 and ESP-116, acceptance criteria). Design choices the tickets left open were decided by Francis on 2026-11-09 and are recorded under "Constraints & decisions".

## Problem
Two parts of the plugin still cost manual work or hide what was checked.

- **Jira tracker.** Tickets move only at plan approval, verify and release. The board shows no work during clarify, spec and planning (ESP-112), and has no events for "implementation done" or "testing started" (ESP-116). A move to a status more than one step ahead fails on linear workflows. The skills pick the connector or the script by whether the MCP and transition IDs happen to be present, so sessions without `JIRA_*` variables hit `JIRA_EMAIL is not set` first (ESP-104). `to-tickets` can file only one issue type under one parent (ESP-65). The CI reference check rejects a PR whose only reference is a Jira key (ESP-61). A spec named a function that did not hold the logic, which cost a review round (ESP-36).
- **Gate runner** (`skills/verify/gate.mjs`). It can print `PASS` or `SKIPPED` while checking less than the config meant: a misspelt step-list key runs nothing and a chained `run` hides an earlier failure (ESP-53). `expectNoDiff` is honoured in CI but dropped locally (ESP-54). With everything committed, no file counts as changed, so conditional steps skip and the fake-pass check scans nothing, and a fake-pass check that did nothing looks like one that found nothing (ESP-55). Old log folders pile up, a failing step's whole output is read into memory, and a background writer can garble the next step's lines (ESP-56). A step stopped at its timeout can leave part of its process tree running with no word of it (ESP-58).

## Goals
- Tickets move on the board at the moment the work reaches each stage, without manual moves.
- The tracker path (connector or API) is a config choice, with the connector as the default.
- The gate runner never reports a pass for something it did not check, and matches CI on `expectNoDiff`.

## Non-goals
- A GitHub tracker through a connector; storing Jira tokens (ESP-104 out of scope).
- New ticket statuses beyond the five stage events plus `merged`.
- Sharing the CI template's diff code with the gate runner, if sharing would change a CI template's public behaviour.
- Reproducing ESP-58 with an elevated process on CI; the fix is proven with a simulated kill failure.
- ESP-144 and the ESP-80 orchestration epic.

## Requirements

### Jira tracker
- R1 (ESP-104): `tickets.jira.transport` takes `"connector"` or `"api"`; a missing value means `"connector"`; any other value is a config error. `check` prints the resolved value.
- R2 (ESP-104): with `connector`, the skills make every move, comment and ticket creation through the Atlassian connector and never run the script's network commands. With `api`, they use the script only and never quietly switch to the connector. On either path a key that could not be moved is reported by key; the git steps stand.
- R3 (ESP-116): `tickets.jira.statuses` accepts five stage events: `started`, `devComplete`, `testingStarted`, `testingComplete`, `released`. `verified` stays valid as an alias of `testingComplete`, and `merged` stays a separate optional event. Setting both `verified` and `testingComplete` is a config error. An unmapped event is skipped with a message.
- R4 (ESP-112, ESP-116): the skills fire each event when the work reaches it: `started` when tickets are picked up (clarify, to-spec, to-tickets on existing tickets, approve-plan in planning mode, and again at approval); `devComplete` when implementation is done, before verification; `testingStarted` when verification begins; `testingComplete` when the gate, reviews and acceptance criteria pass; `merged` after the merge; `released` after the user confirms the release.
- R5 (ESP-112, ESP-116): a move never takes a ticket backwards. A ticket already at the target status, or at a later one in the configured order, is left alone. A move to a status more than one step ahead walks the intermediate transitions in order and reports each step.
- R6 (ESP-65): a spec's ticket entry may name its own issue type and parent; the config values are the defaults. The script's `create` takes `--type` and `--parent`. Both are validated before any ticket is created.
- R7 (ESP-61): the CI reference check accepts a Jira key of the configured project as a requirement reference when the repo uses the Jira tracker, rejects a key inside a longer word, and its error message names Jira keys.
- R8 (ESP-116): when a repo's config has no `tickets` section, `setup-engineering` says the Jira steps will not run. (The stale-plugin warning already exists from ESP-120.)
- R9 (ESP-36): `to-spec` tells the author to read the touched code before naming functions or files in requirements and criteria, or to keep them at behaviour level.

### Gate runner
- R10 (ESP-53): a top-level config key that is a near miss of a step-list key (`verify`, `verifyConditional`, `verifyIterate`) stops the gate with a config error (exit 2) naming the key. A step whose `run` chains commands with `;` or a single `&` stops the gate with a config error saying to use one command per step or `&&`. `&&`, and `;` or `&` inside quotes, stay allowed.
- R11 (ESP-54): a step with `expectNoDiff: [paths]` that exits 0 but leaves a change in any listed path fails, naming the paths, with the same shape and rule as the CI runner.
- R12 (ESP-55): changed files are compared against the merge-base with `git.baseBranch` (plus uncommitted and untracked files) by default; `--base <ref>` overrides it. When the base cannot be resolved the gate says so and falls back to `HEAD`. The fake-pass line shows how many files were scanned, and the gate fails when the check gives no scan count.
- R13 (ESP-56): at start the runner removes its own log folders older than 7 days (name pattern match, owned by the user, links never followed). A failing step's tail is read from the end of its log, not the whole log. Each step writes to its own log file.
- R14 (ESP-58): when stopping a step's process tree fails for any process, the step's reason says that part of the process tree may still be running and names the process. `taskkill` is called by its absolute path under `%SystemRoot%\System32`. A step that never started because of an interrupt is shown as `NOT RUN`, and an interrupted gate exits 130.

- R16 (ESP-116): a ticket whose change is docs-only stops at `devComplete` (Ready to Test) for the user's review: the skills do not fire `testingStarted`, `testingComplete`, `merged` or `released` for it until the user approves it.

### Documentation
- R15: the README (and the plugin changelog row) documents every new setting and behaviour, including a migration note: repos that rely on the Jira API must set `"transport": "api"`. ADR-0003 records the transport setting, its default and the trade-off.

## Acceptance criteria
- AC1 (R1): `jira-tracker.mjs check` with no `transport` prints `"transport":"connector"`; with `"api"` prints `"transport":"api"`; with `"rest"` exits 2 naming the key. Unit tests cover all three.
- AC2 (R2): a skill-text test confirms that on the connector path the approve-plan, verify, release-steps and to-tickets skills name no script `transition`, `comment` or `create` call, and that the api path names no MCP call. An existing test still shows a missing `JIRA_EMAIL` reported as a failure on the api path.
- AC3 (R3): `check` accepts the five stage events plus `verified` and `merged`, maps `verified` to `testingComplete` in its output, exits 2 when both `verified` and `testingComplete` are set, and prints a skip message for an unmapped event. Unit tests cover each case; this repo's `.claude/engineering.json` still passes `check` unchanged.
- AC4 (R4): a skill-text test confirms each skill fires its event at the stated step: clarify, to-spec, to-tickets and approve-plan (planning mode, before the draft) fire `started`; approve-plan fires `started` again at approval; `devComplete` comes before the verification run; `testingStarted` at the start of verify; `testingComplete` only on Gate PASS with all ACs shown; `released` only after the user's confirmation.
- AC5 (R5): unit tests with a fake Jira client show (a) a ticket at or past the target status is not moved, (b) a move two steps ahead calls both transitions in order and reports each, (c) a failed intermediate step stops the walk and is reported by key. The connector-path skill text tells the agent the same order and no-backwards rule.
- AC6 (R6): `jira-tracker.mjs create --type Bug --parent ESP-1` sends that type and parent; an invalid type or parent key exits 2 before any network call. to-tickets' skill text reads per-ticket type and parent with config defaults.
- AC7 (R7): `tests/governance-checks.test.mjs` shows a PR body citing only `ESP-24` accepted for a Jira-tracker repo, `XESP-24` rejected, and the error message naming Jira keys.
- AC8 (R8): setup-engineering's skill text has the no-`tickets` warning; a skill-text test checks it.
- AC9 (R9): to-spec's skill text has the read-the-code rule; a skill-text test checks it.
- AC10 (R10): gate tests show exit 2 for a `verifyConditionl` key and for `run: "a; b"` and `run: "a & b"`, and a pass for `run: "a && b"` and `run: "echo 'a;b'"`.
- AC11 (R11): a gate test with a step that changes a tracked file listed in its `expectNoDiff` paths prints `FAIL` naming the file; the same step without the key, or with a list that does not name the file, passes.
- AC12 (R12): in a test repo where every change is committed on a branch off the base, a conditional step whose `when` matches a committed file runs (not `SKIPPED`); `--base HEAD` restores the old result; an unresolvable base prints the fallback line. The fake-pass line shows `scanned N files`, and a stubbed check that prints no count fails the gate.
- AC13 (R13): gate tests show a matching log folder older than 7 days removed, a newer one and a non-matching one kept, a link not followed; each step has its own log file; the tail of a large log is read without reading the whole file (bounded read checked by test).
- AC14 (R14): a test with a simulated kill failure shows the step's reason naming the surviving process; a test shows `taskkill` called by absolute path; an interrupt between steps prints `NOT RUN` for the next step and exits 130. The mutation runner's output for the same case is unchanged or improved.
- AC15 (R15): the README documents `transport`, the five events and alias, per-ticket type and parent, `--base`, the chained-`run` rule, `expectNoDiff` and log cleanup; the changelog row has the `"transport": "api"` migration note; ADR-0003 has the transport section.
- AC17 (R16): a skill-text test confirms that verify and release-steps skip the later events for a docs-only ticket and say so, and that the skip ends only on the user's approval.
- AC16 (all): the full gate passes and `claude plugin validate` passes for the marketplace and the plugin.

## Constraints & decisions
- ADR-0003 (Jira tracker) applies; R1/R2 extend it.
- AGENTS.md rules apply: git paths read raw with `-z` and `-c core.quotePath=false`; config values from `engineering.json`; shared helpers imported, not copied; `isMainModule` for entry scripts; export only what another file imports.
- Decisions by Francis, 2026-11-09: one PR for all eleven tickets; chained `;` or single `&` in `run` is a config error (exit 2); the default diff base is the merge-base with `git.baseBranch`; `verified` is kept as an alias of `testingComplete` and `merged` stays separate; `expectNoDiff` uses the CI path-list shape (decided at plan approval after the governance pre-flight); R16/AC17 (docs-only tickets stop at Ready to Test) added by Francis 2026-11-09 after approval.
- Default transport `connector` changes behaviour for repos using the API path today. The project is pre-1.0, so this ships as a minor bump (0.24.0) with a migration note.

## Open questions
- Does ESP-58 reproduce with a real elevated process on Windows? (deferred: not reproducible in CI; the fix is tested with a simulated kill failure, per Non-goals.)
- Should a non-near-miss unknown top-level key in the gate config warn? (Answered: no. The guard's per-key config validation from ESP-35 already reports unknown keys; the gate only stops on near misses of step-list keys.)
- Should `when` prefix matching become case-insensitive on Windows (ESP-53 "also in scope")? (Answered: no. It stays exact and case-sensitive, to match the CI runner; the README already says so.)

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
The tickets already exist in Jira (approved with the spec, 2026-11-09):

- ESP-104 · Covers: R1, R2, AC1, AC2
- ESP-116 · Covers: R3, R4, R5, R8, R16, AC3, AC4, AC5, AC8, AC17
- ESP-112 · Covers: R4, R5, AC4, AC5
- ESP-65 · Covers: R6, AC6
- ESP-61 · Covers: R7, AC7
- ESP-36 · Covers: R9, AC9
- ESP-53 · Covers: R10, AC10
- ESP-54 · Covers: R11, AC11
- ESP-55 · Covers: R12, AC12
- ESP-56 · Covers: R13, AC13
- ESP-58 · Covers: R14, AC14
- All · Covers: R15, AC15, AC16
