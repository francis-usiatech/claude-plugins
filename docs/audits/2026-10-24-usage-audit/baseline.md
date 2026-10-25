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
