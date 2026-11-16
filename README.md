# UsiaTech plugin marketplace

Public Claude Code plugin marketplace from UsiaTech.

| Plugin               | Version | Install ID                      |
| -------------------- | ------- | ------------------------------- |
| UsiaTech Engineering | 0.29.0  | `usiatech-engineering@usiatech` |
| UsiaTech Usage Band  | 0.2.0   | `usiatech-usage-band@usiatech`  |

## Install

```
/plugin marketplace add francis-usiatech/claude-plugins
/plugin install usiatech-engineering@usiatech
/plugin install usiatech-usage-band@usiatech
```

## What UsiaTech Usage Band does

A UsiaTech-branded band above the prompt with ring gauges for the 5-hour and weekly limits (with reset times) and context fill, plus the model, the session cost and the last turn's cost. It works in the CLI, the desktop app and the VS Code extension. `/usage-band show`, `/usage-band hide` or `/usage-band` alone shows, hides or toggles it. See its [README](plugins/usiatech-usage-band/README.md).

## What UsiaTech Engineering does

A shared engineering workflow and governance layer for Claude Code. Project rules stay in each repo's `AGENTS.md`; the plugin supplies the procedures, reviewers and guard.

- **Planning:** `clarify`, `to-spec`, `to-tickets` and `approve-plan` turn a request into a spec, tickets and an approved plan with measurable acceptance criteria. The plan sets the edit scope.
- **Building:** `tdd` (red, green, refactor with evidence), `debug` (root cause before fix) and `mutation-test` (proves the tests catch a broken fix).
- **Verifying:** `verify` runs the repo's gate (typecheck, tests, build, conditional suites) and checks the plan's acceptance criteria.
- **Releasing:** `release` and `release-steps` do scoped staging, reviews, a conventional commit, PR, merge, tag, semver bump and branch clean-up, with optional Jira updates.
- **Reviewers:** read-only agents for governance, conventions, security, silent failures, GitHub workflows and npm supply chain.
- **Governance guard:** a hook on every shell command and file edit. It denies destructive actions and secret writes, asks before risky commands, edits to governance, CI or dependency files and edits outside the plan, and logs every decision to `.claude/governance-log.jsonl`.
- **Docs:** `user-guide-update` keeps an end-user guide and its changelog current.

## Options

Each repo configures the plugin in `.claude/engineering.json`; run the `setup-engineering` skill or start from [templates/engineering.json](plugins/usiatech-engineering/templates/engineering.json). The main keys:

- `verify`, `verifyConditional`, `verifyIterate`, `verifyRerun`: the gate's commands, when each runs and how reruns work.
- `git`, `docVersions`: branches, tag format, version files and changelog.
- `governance`: the guard's protected branches, ask paths, extra deny and ask command rules, trusted write and delete paths, plan-edit trust and workflow or dependency finding allowlist.
- `protectedPaths`, `immutableWhenCommitted`, `allowEnvExample`: files the guard never lets Claude edit, or only until committed.
- `reviewers`, `reviewerModels`, `planning`, `decisions`, `session`: which reviewers run, on which model, and how decisions are batched.
- `tickets`: GitHub issues (default) or Jira.
- `userGuide`: where the end-user guide lives.

The plugin README's [configuration section](plugins/usiatech-engineering/README.md#per-repo-configuration-claudeengineeringjson) describes every key.

## Design records

- [Roadmap](docs/roadmap.md): steps, item IDs (A1–A12, B1–B28) and the agreed order of the next work.
- Specs in [docs/specs/](docs/specs/):
  - [security and supply chain](docs/specs/2026-09-28-security-supply-chain.md) (approved, shipped 0.8.0)
  - [fake-pass checks and mutation testing](docs/specs/2026-09-30-fake-pass-and-mutation-test.md) (approved, shipped 0.9.0)
  - [workflow checks hardening](docs/specs/2026-10-02-workflow-checks-hardening.md) (approved, shipped 0.10.0)
- ADRs in [docs/adr/](docs/adr/):
  - [0001 guard network lookups](docs/adr/0001-guard-network-lookups.md) (accepted)
  - [0002 fake-pass checks fail the gate](docs/adr/0002-fake-pass-checks-fail-the-gate.md) (accepted)
- The plugin README's [Design records](plugins/usiatech-engineering/README.md#design-records) section summarises each record and the step 4.2 decisions (D1–D12).

## Releasing a new plugin version

1. Change the plugin under `plugins/usiatech-engineering/`.
2. Run `npm test` from this folder and make sure it passes.
3. Bump `version` in **both** `plugins/usiatech-engineering/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, update the version in the table above, and add a row to the plugin README's version table.
4. Run `claude plugin validate .`, then commit and push to `main`.
5. Users get it automatically (background auto-update), or right away with `/plugin marketplace update usiatech`.


