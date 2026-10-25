# Plan: ESP-117 plugin usage reduction (ESP-118..123)

## Goal
Cut the plugin's share of Claude Code usage (baseline ~27%, target under 15%) by moving verify and release's mechanical steps out of the main thread, running routine reviewers on Sonnet, capping reviewer replies, warning on stale plugins and large contexts, and making Jira writes cheap.

## Requirement references
- ESP-117 (epic, target), decisions in Jira comment 11025 (Francis, 2026-10-25)
- ESP-118 AC1–AC3, ESP-119 AC1–AC3, ESP-120 AC1–AC3, ESP-121 AC1–AC3, ESP-122 AC1–AC3, ESP-123 AC1–AC3
- ADR 0003 (Jira ticket tracker); AGENTS.md F4, F11, F15

## Pre-plan checklist
- (a) New validation rules: `tickets.jira.cloudId` (non-empty string) and `tickets.jira.transitions` (event → non-empty numeric-string ID, events from `EVENTS`) in `jira-tracker.mjs` `configProblems`; callers searched: `jira-tracker.mjs` (`check`, all commands via `loadConfig`), skills approve-plan/release/to-tickets/verify; fixtures: `tests/jira-tracker.test.mjs` config fixtures, `templates/engineering.json` `$comment`. `reviewerModels` (agent name → `sonnet|opus|haiku|inherit`) is read by skill instructions only; no script reads it, so no script validator; an unknown value falls back to the agent file's model with a warning (stated in the skill). `session.contextAdvisoryTokens` (positive integer) validated in the new `session-check.mjs`; no other caller.
- (b) Mechanisms: SKILL.md `context: fork` + `agent:` spike done 2026-10-25 (Jira comment 11025): runs the skill as a subagent without session history, skill text as the prompt; `background: false` keeps the full tool set. Context size from the newest transcript JSONL under `~/.claude/projects/<slug>/` (last assistant `usage`: input + cache write + cache read), the same reading `window.cjs` uses; proved by the ESP-117 audit run. Plugin version from `.claude-plugin/plugin.json` next to the script and sibling version folders in the plugin cache (listed 2026-10-25: `0.9.0`…`0.18.9`). Atlassian MCP `transitionJiraIssue` with a known ID used throughout ESP-113 (transitions 21/31/41/51 on ESP).
- (c) Docs and ADRs touched (search of `docs/` and `plugins/usiatech-engineering/README.md` for jira, reviewer, model, verify, release): `plugins/usiatech-engineering/README.md` (Jira tracker, reviewers, settings, Limits), `docs/adr/0003-jira-ticket-tracker.md` (add a dated addendum: MCP is the write path when configured, script stays for `check`/`keys` and repos without the MCP), `templates/engineering.json` `$comment`. `docs/specs/2026-10-09-jira-ticket-tracker.md` is history: not changed. No docs reviewer configured (`planning.preflightReviewers` unset).

## Acceptance criteria
- AC1 (ESP-118 AC1): A release run in a session above 300k context does commit, PR, merge, Jira and tag in a forked subagent; the main thread grows by under 5k tokens for those steps. Measured with `window.cjs` on the first release after 0.19.0 is installed. Not shown until the ~2026-11-02 re-measure.
  - Evidence: needs the first release on 0.19.0; re-measure ~2026-11-02 (not shown, 2026-10-25T20:40Z)
- AC2 (ESP-118 AC2): `verify` SKILL.md has `context: fork`, `agent:` and `background: false`; a new forked `release-steps` skill holds the mechanical steps; release keeps reviewers and AskUserQuestion in the main thread and the forked runs return decisions as a list. The forked verify judges ACs from the gate log, the diff and test names, plus a short evidence list the main thread passes in the skill args for ACs repo state can't prove. `npm test` (incl. plugin-structure frontmatter checks) exits 0.
  - Evidence: gate 2026-10-25T20:33:11Z tests exit 0 (1683 pass, 0 fail) incl. "should run "verify" as a forked foreground subagent that returns decisions as a list", "should give skill "release-steps" a matching name and a description", "should keep reviews in release and hand the mechanical steps to release-steps (ESP-118, ESP-122)", "should take AC evidence the repo cannot show from the verify arguments (ESP-118)"; release-jira fix governance re-review PASS (shown, 2026-10-25T20:40Z)
- AC3 (ESP-118 AC3): `docs/audits/2026-10-24-usage-audit/` (usage.cjs, window.cjs, baseline.md) is committed and the PR body records the baseline for heiit and waypointcareer. The after-measurement is not shown until the ~2026-11-02 re-measure.
  - Evidence: usage.cjs, window.cjs and baseline.md exist but are not committed yet, the PR body is not written, and the after-measurement waits for ~2026-11-02 (not shown, 2026-10-25T20:40Z)
- AC4 (ESP-119 AC1): Each of the six agent files states `model:` (sonnet: convention, silent-failure, supply-chain, workflow; opus: governance, security); README documents the defaults and the `reviewerModels` override. plugin-structure test asserts each file's model.
  - Evidence: gate 2026-10-25T20:33:11Z: "should give agent "<name>" a matching name, its model and no edit tools" passes for all six agents (shown, 2026-10-25T20:40Z)
- AC5 (ESP-119 AC2): release and approve-plan pass a `model` on every reviewer spawn: `reviewerModels[agent]` from the base-branch `.claude/engineering.json`, else the agent file's model; governance pre-flight and fix re-review use sonnet when the plan or fix touches 5 files or fewer, unless `reviewerModels` names the agent. plugin-structure test asserts the skill text.
  - Evidence: gate 2026-10-25T20:33:11Z: "should pick each reviewer model from base-branch reviewerModels, then the agent file (ESP-119)" passes (shown, 2026-10-25T20:40Z)
- AC6 (ESP-119 AC3): Re-measured reviewer share is 3.5% or less on each repo (baseline 6.6% heiit, 6.4% waypointcareer). Not shown until the ~2026-11-02 re-measure.
  - Evidence: re-measure ~2026-11-02 (not shown, 2026-10-25T20:40Z)
- AC7 (ESP-120 AC1–AC3): `node scripts/session-check.mjs` (entry check via `isMainModule`, F4; `isPlainObject` imported from `governance-rules.mjs`, F15) runs in a new release section "0. Session check" before 1.1 and at the start of approve-plan "Record". It prints a warning naming the running and newest cached versions when the running version is older; prints nothing when same or when the cache folder is missing. Tests cover older, same and missing-cache cases.
  - Evidence: gate 2026-10-25T20:33:11Z: suites "session-check: stale plugin (ESP-120)" and "session-check: entry script" pass (shown, 2026-10-25T20:40Z)
- AC8 (ESP-121 AC1–AC2): `session-check.mjs` reads `session.contextAdvisoryTokens` from the base-branch `.claude/engineering.json` via `git show` (F11; working-tree fallback when the base ref has none) (default 300000) and prints one advisory when the current transcript's last context is above it; a second run in the same session prints nothing. approve-plan also recommends saving the session and starting a fresh one when this session already closed a plan (ESP-121 Change, first bullet; an instruction, judged from the session's own work, no script). Tests cover above, below, default and once-per-session.
  - Evidence: gate 2026-10-25T20:33:11Z: suites "session-check: context advisory (ESP-121)" and "session-check: threshold from the base branch (ESP-121 AC1)" pass (shown, 2026-10-25T20:40Z)
- AC9 (ESP-121 AC3): Re-measured share of main cost above 400k context is lower than baseline on each repo (heiit 47%, waypointcareer 37%). Not shown until the ~2026-11-02 re-measure.
  - Evidence: re-measure ~2026-11-02 (not shown, 2026-10-25T20:40Z)
- AC10 (ESP-122 AC1–AC3): All six agent files have `Write` in tools and an output contract: verdict plus one line per finding, at most ~30 lines and under 3 KB, full report written only to the session scratchpad and its path given. The scratchpad limit is instruction-only (Francis, 2026-10-25); the plugin-structure check changes from "no Write" to "Write plus the output contract" and keeps rejecting Edit, MultiEdit and NotebookEdit. A sample reply (from this PR's own review round) is under 3 KB. release lists nits in the PR from the report file. plugin-structure test asserts the contract in every agent file.
  - Evidence: gate 2026-10-25T20:33:11Z agent-file tests pass for all six; this PR's stage-2 report files are review-convention-reviewer-20261025T193610Z.md (1623 B) and review-silent-failure-reviewer-20261025T193640Z.md (2609 B), both re-checked with ls this session, both under 3 KB; replies were at most 30 lines (shown, 2026-10-25T20:40Z)
- AC11 (ESP-123 AC1–AC2, rewritten per comment 11025): approve-plan, verify, release(-steps) and to-tickets do Jira writes through the Atlassian MCP using `tickets.jira.cloudId` and `tickets.jira.transitions` IDs, with no `getTransitionsForJiraIssue` call; without the MCP or those settings they fall back to `jira-tracker.mjs`. `jira-tracker.mjs check` validates and prints both settings; tests cover valid, missing and bad values.
  - Evidence: gate 2026-10-25T20:33:11Z: "should keep a cloud ID and transition IDs for MCP writes (ESP-123)", "should print the cloud ID and transition IDs on check (ESP-123)", "should load no cloud ID and no transitions when neither is set (ESP-123)", "should report a cloud ID that is not a UUID as a problem naming tickets.jira.cloudId" and the transition-ID problem tests pass (shown, 2026-10-25T20:40Z)
- AC12 (ESP-123 AC3): The waypointcareer tracker-detection gap is explained (cause found) and fixed or documented in the PR and on ESP-123.
  - Evidence: ESP-123 comment 11059 was re-read through the MCP this session. It records the cause: waypointcareer has no `tickets` section, so the tracker is `github` and `transition` exits 2. It also records the NAS follow-up. The ESP-123 part is shown. The PR body has not been written yet, so the PR part is pending (not shown, 2026-10-25T20:40Z)

- AC13 (ESP-117 target): Re-measured plugin share is under 15% across heiit and waypointcareer (baseline ~27%). Not shown until the ~2026-11-02 re-measure.
  - Evidence: re-measure ~2026-11-02 (not shown, 2026-10-25T20:40Z)

## Tasks
- [x] T1: Commit the usage audit scripts (local user path in the header comments replaced by a placeholder: the repo is public) and write `baseline.md` with the heiit and waypointcareer numbers (covers AC3, AC13; ESP-118, ESP-117)
- [x] T2: Agent files: `model:`, `Write` tool, output contract; plugin-structure tests first (covers AC4, AC10; ESP-119, ESP-122)
- [x] T3: `reviewerModels` rule in release and approve-plan, template and README (covers AC5; ESP-119)
- [x] T4: Fork `verify`; split release's mechanical steps into forked `release-steps`; decisions returned as a list; nits from report files (covers AC2, AC10; ESP-118, ESP-122)
- [x] T5: `session-check.mjs` test-first (stale plugin, context advisory, once per session), called in release step 0 and approve-plan (covers AC7, AC8; ESP-120, ESP-121)
- [x] T6: `cloudId` + `transitions` in jira-tracker config, test-first; skills switch to MCP writes with fallback; ADR 0003 addendum; repo `.claude/engineering.json` gets this repo's IDs only after `JIRA_KEYS` accepts them, so `check` never exits 2 in between (covers AC11; ESP-123)
- [x] T7: Investigate the waypointcareer tracker gap, read-only (covers AC12; ESP-123)
- [ ] T8: Gate, one review round, PR, merge; release 0.19.0 in its own bump PR as usual (covers AC1–AC12)

## Files
- `docs/audits/2026-10-24-usage-audit/usage.cjs`
- `docs/audits/2026-10-24-usage-audit/window.cjs`
- `docs/audits/2026-10-24-usage-audit/baseline.md`
- `docs/adr/0003-jira-ticket-tracker.md`
- `plugins/usiatech-engineering/agents/convention-reviewer.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/agents/security-reviewer.md`
- `plugins/usiatech-engineering/agents/silent-failure-reviewer.md`
- `plugins/usiatech-engineering/agents/supply-chain-reviewer.md`
- `plugins/usiatech-engineering/agents/workflow-reviewer.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/release-steps/SKILL.md`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/scripts/session-check.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/tests/session-check.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `.claude/engineering.json`
- `.claude/plans/archive/2026-10-25-esp117-usage-reduction.md`

## Commands and actions
- Read-only reads of `~/.claude/projects/*` transcripts for the baseline (usage.cjs, window.cjs) and of the waypointcareer repo for T7.
- Jira transitions of ESP-117..123 through the Atlassian MCP (IDs 21/31/41/51).
- `git push -u origin feature/esp117-usage-reduction`, `gh pr create` into develop, `gh pr merge` (standing merge rule, memory 2026-10-12), then the 0.19.0 bump PR and develop→main PR, tag `v0.19.0`, branch deletion local and remote.
- No dependency adds.

## Out of scope
- The after-measurement (AC1 live number, AC3 after, AC6, AC9, epic target): ~2026-11-02, epic stays In Progress.
- Any change in the waypointcareer or heiit repos (T7 only reads).
- Removing `jira-tracker.mjs` write commands (kept for repos without the MCP).
- Version bump and develop→main release PR (separate bump PR, as usual).
- SKILL.md trimming (dropped in ESP-117: under 1% saving).

## Approved
- By: Francis · Date: 2026-10-25
- Route: large, override: no separate spec (Francis, Jira comment 11025). The work touches more than 5 files and adds a skill and a script; the tickets ESP-118..123 already exist with ACs, so clarify → to-spec → to-tickets is skipped.

## Change log
- 2026-10-25: route override "one plan, no spec" per Francis (ESP-117 comment 11025). ESP-123 AC1–AC2 rewritten from "jira-tracker.mjs only" to "MCP with configured IDs, script fallback" per the same comment.
- 2026-10-25: pre-flight FLAGs decided by Francis: forked verify gets evidence passed in from main; reviewer Write limit is instruction + test; AC6 3.5% per repo, AC9 any drop per repo; contextAdvisoryTokens read from base branch; no guard validation for reviewerModels; AC12 read-only, a plugin-side fix needs a dated scope change. Mechanical fixes: AC1 deferral wording, AC13 epic target, session-check placement, remote actions listed, T6 ordering, local path stripped from audit scripts.
- 2026-10-25: T7 outcome: waypointcareer files tickets in Jira (NAS) but its engineering.json has no tickets section, so the tracker defaults to github and a chained check && transition exits 2. A config gap in waypointcareer, not a plugin bug; documented on ESP-123 (comment 11059) and in the PR, with the config fix recommended as a NAS follow-up. No plugin change.
- 2026-10-25: stage-1 FLAG (empty AC Evidence lines; AC10 needs a stage-2 reply) decided by Francis: run stage 2, then verify with the evidence list (AC12 = ESP-123 comment 11059, AC10 = a stage-2 reply size) so it stamps Evidence before archive and commit; deferred ACs stay not shown.
- 2026-10-25: stage-2 silent-failure FAIL (one blocker): running phase `release` again after the Jira keys were confirmed would re-tag. Fixed in the same files, within AC2/T4: new phase `release-jira` moves only the confirmed keys and cleans up, and never merges, tags or pushes; phase `release` step 4 returns the keys and both tags, then stops. The fix is Markdown under `skills/` only, so it had a governance-only re-review: PASS. Its two low nits (the `release-jira` inputs in release-steps, the contradicting first bullet in release §3) were fixed. Gate PASS 2026-10-25T20:33:11Z.

## Final status
- Partial: built and shipped on branch `feature/esp117-usage-reduction` (PR into develop, to be released as 0.19.0). ESP-117 stays In Progress until the ~2026-11-02 re-measure.
- Shown (gate PASS 2026-10-25T20:33:11Z): AC2, AC4, AC5, AC7, AC8, AC10, AC11.
- Not shown at close: AC3 and AC12 (the PR body records the baseline and the T7 cause; done in this PR after archive), AC1, AC6, AC9, AC13 (re-measure ~2026-11-02 on 0.19.0).
- Deviations: route override "one plan, no spec" (comment 11025). The release-jira blocker fix had a governance-only re-review instead of a second full round. T8 stays open until the PR merges and 0.19.0 ships.
- Open nits (listed in the PR): session-check base starting with `-` is read as a git option; the marker folder is in the shared Linux `/tmp`; the reviewer Write limit is instruction-only; baseline.md names client projects that are already public; session-check falls back to the working copy without a warning when `git show` fails; one `try` wraps both session-check checks. Low confidence: a fixed transition ID assumes ESP Tasks and Sub-tasks share one workflow.
