# ESP-117 usage baseline (week 2026-10-17 to 2026-10-23)

The baseline for ESP-117 and its tickets ESP-118..123.

```bash
node docs/audits/2026-10-24-usage-audit/usage.cjs <from YYYY-MM-DD> <to YYYY-MM-DD> ~/.claude/projects/<project-slug>...
node docs/audits/2026-10-24-usage-audit/window.cjs <from YYYY-MM-DD> <to YYYY-MM-DD> ~/.claude/projects/<project-slug>...
```

Pass every folder of one project together (for waypointcareer, the main folder and each `--claude-worktrees-*` folder). Days are local time and `to` is exclusive. A session counts whole when any of its records falls in the week.

The scripts now report dollars at each call's model (see [Scripts updated](#scripts-updated-esp-144-run-2026-11-03)). The two sections before that one were measured with the earlier scripts: cost-weighted tokens at Opus price ratios (cache read 0.1, 5m cache write 1.25, 1h cache write 2, output 5), with `FROM`/`TO` set in the file. Compare later runs with the new section, not with those.

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

ESP-118 AC1 asks that the forked steps of a release (commit, PR, merge, Jira and tag) grow the main thread by under 5k tokens in a session above 300k context, measured with `window.cjs`. Francis recorded it as not met on 2026-11-03, and ESP-144 AC7 tracks it. `window.cjs` didn't report growth at the time, so these numbers come from a one-off script, not saved in this folder, that compares context before and after each `release-steps` call. It counts only those calls, not the rest of the main-thread `release` window, which AC1 doesn't cover. `release-steps` ran 67 times over 16 `release` runs in heiit and 17 times over 8 in waypointcareer.

- **At 300k+ context (an estimate):** growth totals 50,085 over 40 calls in heiit and 19,660 over 8 in waypointcareer, a mean of 1,252 and 2,458 per call. Multiplied by the calls per release at any context (about 4.2 and 2.1), those steps add about 5.2k per release in both, narrowly over the limit. Medians are 983 and 1,907, and 2 of 48 calls went over 5k on their own.
- **At any context:** growth totals 77,290 and 30,818, so those steps add about 4.8k per release in heiit and 3.9k in waypointcareer.

How to read these numbers:

- **Forks:** `usage.cjs` and `window.cjs` count forked skills as `general-purpose`, so run as they are they give about 17.6%. The fork rows above come from a separate one-off script that finds each fork by the usiatech-engineering skill path in its first user messages. Fork counts equal `Skill` calls: `release-steps` 67 and `verify` 25 in heiit, `release-steps` 17 in waypointcareer. ESP-144 has since added this to the scripts.
- **Models:** the scripts price every model as Opus, so Sonnet savings don't show and real shares are somewhat lower. With Sonnet at zero, ESP-119 AC3 and the target still fail: as shares of today's total, reviewers on Opus alone are 4.8% and 4.4%, and plugin share is 22.5% and 17.2%. A smaller total would raise these slightly, so they are lower bounds, not figures to compare later runs against.
- **Baseline week re-run:** the `usage.cjs` numbers and the 400k+ shares reproduce. The heiit `release` window now reads 35 calls at 541k, against 33 at 490k in the table above; the cause was not checked. The "before" column here uses the re-run.
- **Session mix:** plugin cost per session fell about 37% across both repos (about 1.35M to 0.85M weighted units), partly because the mix of sessions changed.

## Scripts updated (ESP-144, run 2026-11-03)

ESP-144 changed what the scripts measure, so both weeks are restated here. Prices are in `audit-common.cjs`, cited to the published pricing page.

- **Models:** each call is priced at its own model, including cache reads, which were weighted 0.1 and cost 0.05 of base input on Opus 5.5 and Sonnet 5.5. A model with no price is printed as unpriced; neither week had any.
- **Forks:** forked skills appear under their own names. A subagent counts as a fork only when its first user messages hold the injected `Base directory for this skill` line, not when a prompt merely names a plugin skill path. Fork counts on the re-measure week equal `Skill` calls: `release-steps` 67 and `verify` 25 in heiit, `release-steps` 17 in waypointcareer.
- **Output:** one call spans several transcript records, and only the last has the final `output_tokens`. The earlier scripts read the first, which missed 13% of output tokens on the re-measure week (6.06M of 6.97M). Reading the last record moves that week's plugin share across both repos from 23.4% to 23.8%.
- **Plugin share formula:** `release` window + `verify` window + reviewers + forks. It leaves out the skill text that the earlier sections include, which is 0.3% of the total on the re-measure week.
- **Cache writes:** a call holding only 5m writes is no longer also charged at the 1h rate.
- **Gaps:** calls with no price (an unknown model, or fast mode, which the table leaves out) and unreadable transcript lines are printed, not hidden. Neither week had any priced this way, since every call ran at standard speed on a listed model.

| Measure | heiit before | heiit after | waypointcareer before | waypointcareer after | Both before | Both after |
| --- | --- | --- | --- | --- | --- | --- |
| **Plugin share** | **32.4%** | **25.5%** | **16.2%** | **20.1%** | **27.7%** | **23.8%** |

"Before" is 2026-10-17 to 2026-10-24 and "after" is 2026-10-26 to 2026-11-02, both with `to` exclusive. Shares are by session, so a session that crosses the week's edge counts whole, including its calls outside the week. This file gives shares only, since the repo is public; the scripts print dollars when run. The re-measure week's forks ran on Opus, so this doesn't yet show `release-steps` on Sonnet; ESP-144 AC6 measures that.

### Release window split

Re-measure week. A call in the `release` window counts as fixing work when it has an `Edit` or `Write` tool use outside temp folders and `.claude/plans`. Those two hold the release flow's own files, such as the commit message, the PR body and the plan, and were 160 of the window's 339 `Edit` and `Write` uses. Every other call is overhead.

This is an estimate that errs both ways. The reads and test runs between edits fall in overhead, which understates fixing. Release-flow edits to repo files, such as a version row, count as fixing, which overstates it.

| | heiit | waypointcareer | Both |
| --- | --- | --- | --- |
| Fixing work | 1.2% | 1.0% | 1.2% |
| Overhead | 8.4% | 7.6% | 8.1% |

### Main-thread growth per release

Re-measure week, from `window.cjs`: context at the call after each `release-steps` result minus context at the call that invoked it, summed per release. A release starts at a `commit` phase and runs through the later phases, across skill windows and user turns; a commit before any later phase is a retry of the same release. A user message before the next call drops that step's growth, since the context change isn't the fork's. "Above 300k" means the release's first `release-steps` call was. These replace the 5.2k estimate above, which multiplied per-call means by calls per release.

| | heiit | waypointcareer |
| --- | --- | --- |
| Releases | 18 | 8 |
| Mean growth, all | 4,294 | 3,852 |
| Releases above 300k | 11 | 5 |
| Mean growth above 300k | 4,553 | 3,932 |
| Above 300k and over 5k | 3 (5,057, 7,072, 9,434) | 1 (11,543) |

The means are under 5k, but 4 of 16 releases above 300k are not, so the target stays open for ESP-144 AC6.

### Why cost per reviewer run rose (ESP-144 AC4)

Weighted units, as on the ticket, to compare with its numbers.

| Per run | heiit before | heiit after | waypointcareer before | waypointcareer after |
| --- | --- | --- | --- | --- |
| Cost as reported on the ticket (first-record output) | 105k | 129k | 94k | 136k |
| Cost with final output | 135k | 144k | 94k | 136k |
| Output part | 32k | 32k | 16k | 29k |
| Cache write part | 66k | 71k | 55k | 69k |
| Cache read part | 37k | 42k | 24k | 39k |
| Calls | 9.2 | 9.8 | 6.8 | 8.1 |
| First-call context | 20.1k | 24.7k | 24.8k | 29.3k |
| `Write` calls | 0 | 0.60 | 0 | 0.83 |

- **Most of the heiit rise was a measuring error.** Baseline-week heiit transcripts held the final output count only in later records, so the first-record figure was 317 output tokens per run against a real 6,319. With final output, heiit rose 7% rather than 23%. Waypointcareer's first-record output was close to final in both weeks, so its 44% rise is real.
- **First-call context rose about 4.5k in both repos.** The agent files account for little of it: each grew about 680 bytes in 0.19.0 and 0.19.1, or about 170 tokens. The rest comes from outside the agent files. Its source was not found, and a transcript doesn't split the first call's context.
- **Reviewers now write report files.** Reports moved to files in 0.19.0, adding 0.60 and 0.83 `Write` calls per run, about 3,000 to 3,700 characters each run, and a further context re-read for the call. This is deliberate, since it keeps report text out of the main thread, so it stays.
- **Waypointcareer's remaining rise is more work per review:** output up from 3,165 to 5,739 tokens per run and 1.3 more calls, more than the report files explain. Diff sizes were not measured, so whether reviews had more to read is not known.

No plugin text was changed for this. The only plugin-owned fix available is the agent files' 170 tokens, too small to matter.

Separately, `usage.cjs` shows forks starting far larger than reviewers: `release-steps` first-call context averages 60k in heiit and 88k in waypointcareer, against about 25k and 29k for reviewers. This was not looked into.
