# UsiaTech Claude Code plugins

[![Plugin tests](https://github.com/francis-usiatech/claude-plugins/actions/workflows/test.yml/badge.svg)](https://github.com/francis-usiatech/claude-plugins/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace with one plugin, **UsiaTech Engineering**. It gives an AI coding agent the same engineering workflow and governance in every repository: requirements before plans, approved plans before code, a guard on dangerous actions, a verification gate, staged reviews and a release flow.

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Overview

| Plugin | Version | Install ID |
| --- | --- | --- |
| UsiaTech Engineering | 0.19.3 | `usiatech-engineering@usiatech` |

Project rules stay in each repository's `AGENTS.md`. The plugin supplies the parts that are the same everywhere: the procedures (skills), the read-only reviewers (agents), the guard (hooks) and a pull-request CI kit.

Every change follows one path, and each step leaves a record the next step checks:

```
clarify → to-spec → to-tickets → approve-plan → tdd / debug → verify → release
```

Small work (a cited requirement, 5 files or fewer, no new skill or interface) goes straight to `approve-plan`.

## Features

- **Requirements first.** `clarify`, `to-spec` and `to-tickets` turn a request into a spec with requirements and measurable acceptance criteria, then into tickets in GitHub or Jira.
- **Approved plans set the scope.** `approve-plan` records the plan with acceptance criteria, tasks and a file list after a governance pre-flight. Edits outside the plan need confirmation.
- **A guard on dangerous actions.** A PreToolUse hook denies catastrophic commands (recursive deletes of root or home, `curl | sh`, `--no-verify`, edits that write secrets), asks before risky or out-of-plan actions, and logs every decision to `.claude/governance-log.jsonl`.
- **Test discipline.** `tdd` (red → green → refactor with evidence), `debug` (root cause before fix) and `mutation-test` (proves the tests catch a broken fix). The gate fails fake passes such as `.skip`, `.only` and empty tests.
- **A verification gate.** `verify` runs the repo's gate from `.claude/engineering.json`, with per-step timeouts, and checks each acceptance criterion against evidence.
- **Staged reviews.** Before every commit, read-only reviewer agents check the diff: governance first, then conventions, silent failures and security, plus supply chain when package files change and CI workflows when workflow files change. Markdown-only diffs skip two of them. `BLOCK` stops the commit and `FLAG` needs your decision.
- **A release flow.** `release` does scoped staging, the gate, the reviews, one conventional commit, the PR, merge, tag and branch clean-up, following GitFlow-lite.
- **CI rules a PR can't change from inside the PR.** The `templates/github/` kit runs deterministic checks, the same gate and an AI governance review on every PR, with rules and scripts read from the base branch. The workflow file itself runs from the PR, so protect `.github/**` with Code Owner review (see the plugin README).
- **Jira or GitHub tickets.** With the Jira tracker, tickets move through `started → verified → merged → released` as the work does.

The full list is in [docs/capabilities.md](docs/capabilities.md). A version with diagrams is in `docs/capabilities.html`; GitHub shows HTML as source, so open it from a local clone in a browser.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- [Node.js](https://nodejs.org/) 20 or later on the machine running Claude Code (the hooks run on Node built-ins only; no npm dependencies)
- Git
- Optional: the [GitHub CLI](https://cli.github.com/) (`gh`) for issues and PRs, and Jira Cloud with the Atlassian MCP or an API token for the Jira tracker

Tested on Linux and Windows with Node 20 and 22.

## Installation

In Claude Code, add the marketplace and install the plugin:

```
/plugin marketplace add francis-usiatech/claude-plugins
/plugin install usiatech-engineering@usiatech
```

Restart Claude Code or run `/reload-plugins`. Updates arrive through the background auto-update, or at once with:

```
/plugin marketplace update usiatech
```

To remove it: `/plugin uninstall usiatech-engineering@usiatech`.

## Quick start

1. Open the repository you want to govern and run the `setup-engineering` skill. It creates `.claude/engineering.json`, checks your `AGENTS.md` / `CLAUDE.md` layout and offers to install the CI kit.
2. Ask for a piece of work and say "plan this". `approve-plan` picks the small or large route and records the plan once you approve it.
3. Build it. Use "tdd" for test-first work or "debug" for a bug.
4. Say "verify" to run the gate, then "release" to review, commit, open the PR, merge and tag.

## Configuration

Each repository sets its own rules in `.claude/engineering.json`. The CI gate and several skill settings read it from the base branch, so a PR can't loosen them; the local guard reads the working copy, so a local edit takes effect at once.

```json
{
  "verify": [
    { "name": "tests", "run": "npm test" },
    { "name": "build", "run": "npm run build", "timeoutMs": 600000 }
  ],
  "verifyConditional": [
    { "name": "e2e", "run": "npm run e2e", "when": ["src/app/"] }
  ],
  "governance": { "protectedBranches": ["main"], "planEdits": "ask" },
  "tickets": { "tracker": "github" }
}
```

| Key | Purpose |
| --- | --- |
| `verify`, `verifyConditional` | The gate: commands always run, and commands run only when a changed file starts with a `when` prefix |
| `git` | Base and release branches, tag format, commit style |
| `protectedPaths`, `immutableWhenCommitted`, `allowEnvExample` | Files the agent may never edit, or may edit only until committed |
| `reviewers`, `reviewerModels` | Which reviewer agents `release` runs, and the model for each |
| `governance` | Protected branches, extra deny / ask rules, allowlist, trusted write paths, plan edit mode |
| `planning`, `decisions`, `session` | Pre-flight reviewers, how decisions are batched, context-size advice |
| `tickets` | `github` (default) or `jira`, with the Jira site, project and status mapping |
| `userGuide` | User-guide folder and changelog for `user-guide-update` |

Every key, default and rule is documented in the [plugin README](plugins/usiatech-engineering/README.md#per-repo-configuration-claudeengineeringjson). Start from [`templates/engineering.json`](plugins/usiatech-engineering/templates/engineering.json).

## Documentation

- [Plugin README](plugins/usiatech-engineering/README.md): components, configuration, guard rules, CI kit, Jira tracker and the version history.
- [Capabilities](docs/capabilities.md): what the plugin does today and what is planned.
- [Roadmap](docs/roadmap.md): steps, item IDs (A1–A12, B1–B32), Jira epics and the agreed order of work.
- `docs/capabilities.html` and `docs/roadmap.html`: the same two documents with diagrams. Open them from a local clone in a browser; GitHub shows HTML as source.
- Specs in [docs/specs/](docs/specs/):
  - [security and supply chain](docs/specs/2026-09-28-security-supply-chain.md) (shipped 0.8.0)
  - [fake-pass checks and mutation testing](docs/specs/2026-09-30-fake-pass-and-mutation-test.md) (shipped 0.9.0)
  - [workflow checks hardening](docs/specs/2026-10-02-workflow-checks-hardening.md) (shipped 0.10.0)
  - [plan edits](docs/specs/2026-10-09-plan-edits-all.md) (shipped 0.11.0)
  - [batch decisions](docs/specs/2026-10-09-batch-decisions.md) (shipped 0.12.0)
  - [per-key config validation](docs/specs/2026-10-10-per-key-config-validation.md) (shipped 0.13.0)
  - [Jira ticket tracker](docs/specs/2026-10-09-jira-ticket-tracker.md) (shipped 0.16.0)
  - [delivery speed-up](docs/specs/2026-10-16-delivery-speedup.md) (in progress)
- ADRs in [docs/adr/](docs/adr/):
  - [0001 guard network lookups](docs/adr/0001-guard-network-lookups.md)
  - [0002 fake-pass checks fail the gate](docs/adr/0002-fake-pass-checks-fail-the-gate.md)
  - [0003 Jira ticket tracker](docs/adr/0003-jira-ticket-tracker.md)
- Audits in [docs/audits/](docs/audits/).

## Roadmap

Shipped through v0.19.3: hardening, test-first and review depth, the requirements flow, security and supply-chain checks, test honesty, guard gaps, the Jira tracker, the gate runner and audit fixes. Planned next, each tracked as a Jira epic:

- **Session efficiency and usage reduction** (ESP-8, ESP-117)
- **Parallel agent orchestration** (ESP-80): worktree streams, a governed merge and an unattended runner
- **Security audit** (ESP-126): a whole-codebase threat model with evidence-graded findings
- **Design review** (ESP-127): graded visual QA of live pages
- **Retro** (ESP-128): weekly engineering and governance metrics
- **Product challenge** (ESP-129): premise check, alternatives and scope mode before planning

See [docs/roadmap.md](docs/roadmap.md) for the full plan.

## Contributing

Issues and pull requests are welcome. The plugin governs its own development, so changes follow the same flow it enforces.

1. Branch off `develop` (for example `feature/<name>` or `docs/<name>`). Don't commit to `main`.
2. Change the plugin under `plugins/usiatech-engineering/` and add or update its tests under `tests/`.
3. Run `npm test` from the repository root and make sure it passes. The tests use Node's built-in runner and need no install.
4. For a new plugin version, bump `version` in **both** `plugins/usiatech-engineering/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, update the version in the [Overview](#overview) table, and add a row to the plugin README's version table. A test checks that all four match.
5. Run `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`.
6. Use a conventional commit message (`feat:`, `fix:`, `docs:` …) and open a pull request into `develop`. Releases merge `develop` into `main` and tag it.

Repository rules for contributors and agents are in [AGENTS.md](AGENTS.md).

## Security

The guard and reviewers reduce risk but are not a sandbox. Review what the agent proposes before you approve it.

Don't put vulnerability details in a public issue. Open an issue titled "Security contact request" with no details, and the maintainer will reply with a direct way to send the details.

## License

[MIT](LICENSE) © 2026 Francis Amalraj
