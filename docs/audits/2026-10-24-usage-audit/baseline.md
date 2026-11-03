# ESP-117 usage baseline (week 2026-10-17 to 2026-10-23)

The baseline for ESP-117 and its tickets ESP-118..123. Re-run both scripts on the same project folders around 2026-11-02, with `FROM`/`TO` moved to the week after 0.19.0 is installed, and compare.

```bash
node docs/audits/2026-10-24-usage-audit/usage.cjs ~/.claude/projects/<project-slug>...
node docs/audits/2026-10-24-usage-audit/window.cjs ~/.claude/projects/<project-slug>...
```

Pass every folder of one project together (for waypointcareer, the main folder and each `--claude-worktrees-*` folder). Shares are cost-weighted tokens at Opus price ratios (cache read 0.1, 5m cache write 1.25, 1h cache write 2, output 5).

## Numbers (run 2026-10-25)

| Measure | heiit | waypointcareer | AC |
| --- | --- | --- | --- |
| Sessions in the week | 57 | 18 | |
| Main-thread share while `release` drives the turn | 20.7% | 8.3% | ESP-118 AC1/AC3 |
| Main-thread share while `verify` drives the turn | 4.1% | not used | ESP-118 AC3 |
| `release` window: calls per invocation, avg context | 33, 490k | 27, 337k | ESP-118 AC1 |
| Reviewer subagents share | 6.6% | 6.4% | ESP-119 AC3 (target 3.5% or less each) |
| governance-reviewer spawns | 90 | 48 | ESP-119 |
| Subagent calls on Opus | 1,502 of 1,516 | 547 of 547 | ESP-119 |
| Main cost from calls above 400k context | 47.3% | 36.7% | ESP-121 AC3 (target: lower on each) |
| Main cost from calls above 200k context | 86.1% | 80.0% | ESP-121 |
| Skill text carried in main context | 0.7% | 0.5% | |
| Hook text injected (governance-guard) | 0 chars | 0 chars | |

Plugin share (release + verify + reviewers + skill text), the ESP-117 target of under 15% across both: heiit ~32%, waypointcareer ~15%, ~27% combined.

The `approve-plan` window (heiit 25.4%, waypointcareer 23.4%) is left out. It covers implementation work after plan approval, not plugin overhead.

The ESP-117 epic text gives waypointcareer `release` as 7.3%. This run reads 8.3%; the cause of the difference was not checked. Compare later runs against the numbers in this file.

## Re-measure (run 2026-11-03)

Week 2026-10-26 to 2026-11-01 (`TO` 2026-11-02 is exclusive), with `FROM`/`TO` moved in a copy of each script. Every folder of each project is passed: heiit is its main folder plus `heiit-dbhard` and `heiit-seo`, and waypointcareer is its main folder plus each worktree folder. The two extra heiit folders had no sessions in the baseline week, so its "before" column is unchanged.

The plugin running was 0.19.1. Plugin paths in the main transcripts name it almost throughout. Other versions appear in only three places: 0.19.3 in 6 heiit lines at 2026-11-02T05:56Z (the evening of 2026-11-01 local time, and the scripts' week is local time), 0.18.9 in 16 `heiit-dbhard` lines on 2026-10-27, and 0.7.1 in 30 waypointcareer lines on 2026-10-27. The cause of the last two was not checked. Subagent transcripts were not searched.

Plugin share here is the baseline's formula plus the two fork rows, since forked skills are the same work moved out of the main thread. Across both repos, weighted by each repo's total cost, it is 22.7%, so the target of under 15% is not met. ESP-144 follows this up.

| Measure | heiit before | heiit after | waypointcareer before | waypointcareer after | AC |
| --- | --- | --- | --- | --- | --- |
| Sessions in the week | 57 | 42 | 18 | 32 | |
| Main-thread share while `release` drives the turn | 20.7% | 11.0% | 8.3% | 9.3% | ESP-118 AC3 |
| Main-thread share while `verify` drives the turn | 4.1% | 0% | not used | not used | ESP-118 AC3 |
| `release-steps` fork share | n/a | 3.9% | n/a | 3.1% | |
| `verify` fork share | n/a | 2.3% | n/a | not used | |
| Reviewer subagents share | 6.6% | 6.9% | 6.4% | 6.2% | ESP-119 AC3: not met |
| Skill text carried in main context | 0.7% | 0.5% | 0.5% | 0.4% | |
| Main cost from calls above 400k context | 47.3% | 17.1% | 36.7% | 25.5% | ESP-121 AC3: met |
| `release` window: calls per invocation, avg context | 35, 541k | 33, 308k | 27, 337k | 25, 352k | |
| Reviewer subagent calls on Opus | 1,502 of 1,516 | 683 of 968 | 547 of 547 | 240 of 340 | ESP-119 |
| **Plugin share** | **32.1%** | **24.6%** | **15.2%** | **19.0%** | ESP-117: not met |

ESP-118 AC1 asks for main-thread growth under 5k tokens per release in a session above 300k context, measured with `window.cjs`. Francis recorded it as not met on 2026-11-03, and ESP-144 AC7 tracks it. `window.cjs` doesn't report growth, so these numbers come from a one-off script, not saved in this folder, that compares context before and after each `release-steps` call. `release-steps` ran 67 times over 16 `release` runs in heiit and 17 times over 8 in waypointcareer.

- **At 300k+ context (an estimate):** growth totals 50,085 over 40 calls in heiit and 19,660 over 8 in waypointcareer, a mean of 1,252 and 2,458 per call. Multiplied by the calls per release at any context (about 4.2 and 2.1), a release grows by about 5.2k in both, narrowly over the limit. Medians are 983 and 1,907, and 2 of 48 calls went over 5k on their own.
- **At any context:** growth totals 77,290 and 30,818, so a release grows by about 4.8k in heiit and 3.9k in waypointcareer.

How to read these numbers:

- **Forks:** `usage.cjs` and `window.cjs` count forked skills as `general-purpose`, so run as they are they give about 17.6%. The fork rows above come from a separate one-off script that finds each fork by the usiatech-engineering skill path in its first user messages. Fork counts equal `Skill` calls: `release-steps` 67 and `verify` 25 in heiit, `release-steps` 17 in waypointcareer. The scripts in this folder are unchanged; ESP-144 AC2 adds this to them.
- **Models:** the scripts price every model as Opus, so Sonnet savings don't show and real shares are somewhat lower. With Sonnet at zero, ESP-119 AC3 and the target still fail: as shares of today's total, reviewers on Opus alone are 4.8% and 4.4%, and plugin share is 22.5% and 17.2%. A smaller total would raise these slightly, so they are lower bounds, not figures to compare later runs against.
- **Baseline week re-run:** the `usage.cjs` numbers and the 400k+ shares reproduce. The heiit `release` window now reads 35 calls at 541k, against 33 at 490k in the table above; the cause was not checked. The "before" column here uses the re-run.
- **Session mix:** plugin cost per session fell about 37% across both repos (about 1.35M to 0.85M weighted units), partly because the mix of sessions changed.
