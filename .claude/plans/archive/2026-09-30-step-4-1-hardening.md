# Plan: CI kit hardening and staleness fix (step 4 follow-ups), roadmap gaps

## Goal
Close the CI-kit items from #13 (the shipped `pr-governance.yml` breaks the plugin's own B10 rules and lets the AI review job be steered into running code) and the silent staleness skip from #16. Add the three gaps found in the 2026-09-30 comparison to the roadmap.

## Requirement references
- Issue #13 "Pre-existing / CI kit": pin `anthropics/claude-code-action`; unpinned container image (`gitleaks:latest`); AI review job may load the PR's `.claude` settings/hooks; `git log --output=` may write files into `_gov/`; `pr-governance.yml` runs from the PR (ship a ruleset / CODEOWNERS setup step)
- Issue #16 "Lookups": a registry document without `time[latest]` skips the staleness check silently
- `docs/roadmap.md` (improvement roadmap); new items B26–B28 requested by Francis on 2026-09-30 after the in-session comparison with the installed engineering plugins (Trail of Bits `mutation-testing`, `fp-check`, pr-review-toolkit `pr-test-analyzer`)

## Design decisions
- D1 Pin `anthropics/claude-code-action` to commit `12dd8d74c712f5f3669365b2369b558c495b1104` (tag v1.0.238, the commit `v1` points to on 2026-09-30) with a `# v1.0.238` comment. First-party `actions/*` stay on major tags (the B10 rule exempts them).
- D2 Pin gitleaks to `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f` (latest release, digest read from ghcr on 2026-09-30).
- D3 AI review runs with `--setting-sources user`, so the PR's `.claude/settings*.json` hooks, plugins and `.mcp.json` are not loaded (the action defaults to `user,project,local`; `base-action/src/parse-sdk-options.ts`).
- D4 AI review loses all `Bash(git …)` tools. A step before it writes `git diff origin/<base>...HEAD` to `.pr-diff.patch` and `git log --oneline origin/<base>..HEAD` to `.pr-log.txt`; base versions of files are read from `_gov/`. This closes `--output=` writes into `_gov/` or `.git/` from every git subcommand, not just `log`.
- D5 Ship `templates/ruleset-governance.json` (branch ruleset: required `governance-gate` check, pull request with Code Owner review, no force-push or deletion). `setup-engineering` shows it and applies it with `gh api` only after the user approves. README says plainly that a required status check alone does not stop a PR from editing its own workflow; Code Owner review on `.github/**` (or an org "Require workflows to pass" rule) does.
- D6 A registry result whose `latestTime` is missing or unparseable gives an `sc-stale` warning saying the release date is unknown, instead of no finding. No new rule ID.

## Acceptance criteria
- AC1: The shipped `pr-governance.yml`, run through `checkWorkflow`, gives no `wf-unpinned-action` or `wf-unparsed` finding, and `claude-code-action` is pinned to a 40-hex SHA.
  - Evidence: `plugin-structure.test.mjs` "should pass its own workflow rules with no unpinned action and no parse problem (AC1)": red (wf-unpinned-action line 132), green after pin (shown, 2026-09-30T22:00Z)
- AC2: Every `docker run` image in the shipped workflow has an `@sha256:` digest and none uses `:latest`.
  - Evidence: "should pin every container image to a digest and never use :latest (AC2)": red (`gitleaks:latest`), green (shown, 2026-09-30T22:00Z)
- AC3: The `ai-governance-review` job's `claude_args` contain `--setting-sources user`.
  - Evidence: "should keep the PR's own .claude settings, hooks and MCP servers out of the AI review (AC3)": red (no `--setting-sources`), green (shown, 2026-09-30T22:00Z)
- AC4: The `ai-governance-review` allowed tools contain no `Bash` tool; a step before the review writes `.pr-diff.patch` and `.pr-log.txt`, and the prompt names both.
  - Evidence: "should give the AI review no Bash tool and hand it a pre-generated diff and log instead (AC4)": red (Bash(git …) in allowedTools), green (shown, 2026-09-30T22:00Z)
- AC5: `templates/ruleset-governance.json` parses, requires the `governance-gate` status check and has a pull request rule with `require_code_owner_review`; `setup-engineering` step 5 names the file and says to apply it only after approval; the README states which setting stops a PR editing its own gate.
  - Evidence: "should ship a governance ruleset template and apply it only after approval (AC5)": red (ENOENT), green; ruleset fields checked against the GitHub REST schema (pull_request and required_status_checks required params) (shown, 2026-09-30T22:00Z)
- AC6: `registryFindings` with `latestTime` null or unparseable returns an `sc-stale` warning (red before the fix), and the README `sc-stale` row mentions the unknown-date case.
  - Evidence: `supply-chain-lookups.test.mjs` "should warn when the latest release date is missing or unreadable instead of skipping the staleness check": red (actual []), green; README `sc-stale` row updated (shown, 2026-09-30T22:00Z)
- AC7: `docs/roadmap.md` lists B26 mutation-testing skill, B27 finding verification (false-positive check), B28 test-coverage reviewer, a step row for this hardening, and notes that B20 can build on `claude plugin eval`.
  - Evidence: `docs/roadmap.md`: step 4.1 row, B20 note, B26–B28 table (shown, 2026-09-30T22:00Z)
- AC8: `npm test` passes and `claude plugin validate` passes for the marketplace and the plugin.
  - Evidence: `npm test` 548/548 exit 0; `claude plugin validate` passes for the marketplace and the plugin (shown, 2026-09-30T22:00Z)

## Tasks
- [x] T1: roadmap: B26–B28, hardening step row, B20 note (covers AC7)
- [x] T2: pin `claude-code-action` and the gitleaks image, test-first (covers AC1, AC2; #13)
- [x] T3: `--setting-sources user`; drop Bash tools, pre-generate diff and log, update prompt; test-first (covers AC3, AC4; #13)
- [x] T4: ruleset template, `setup-engineering` step, README section (covers AC5; #13)
- [x] T5: staleness with unknown release date, test-first (covers AC6; #16)
- [x] T6: README `sc-stale` row (covers AC6); run the verification gate (`npm test`, `claude plugin validate`) (covers AC8)
- [x] T7: stage-2 fix set 1 (A solo bypass actor instead of review off; B CODEOWNERS/placeholder precondition; C persist-credentials false and Read deny rules; D `git diff --text --no-ext-diff`) (covers AC4, AC5)

## Files
- `docs/roadmap.md`
- `plugins/usiatech-engineering/templates/github/workflows/pr-governance.yml`
- `plugins/usiatech-engineering/templates/ruleset-governance.json`
- `plugins/usiatech-engineering/templates/github/scripts/supply-chain-lookups.mjs`
- `plugins/usiatech-engineering/skills/setup-engineering/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/supply-chain-lookups.test.mjs`
- `plugins/usiatech-engineering/templates/github/CODEOWNERS`
- `.claude-plugin/marketplace.json`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `README.md`

## Commands and actions
- Read-only lookups already done: `gh api` for the action tag, ghcr manifest digest for gitleaks.

## Out of scope
- The other #13 items (rule coverage, enforcement gaps, quality) and the other #16 items.
- Pinning first-party `actions/*` to SHAs.
- Applying a ruleset to this repo or any other repo.

## Approved
- By: Francis · Date: 2026-09-30
- Route: small (override: Francis, 2026-09-30; by the rule it is large: 8 files and a new shipped template)

## Change log
- 2026-09-30: drafted; pre-flight FLAG (route, T6 wording, B26–B28 source) resolved. Route override to small approved by Francis: issues #13 and #16 itemise each change and act as the tickets, D1–D6 hold the design, no new skill, module or service.
- 2026-09-30T22:00Z: T1–T6 done test-first (6 red, all green); gate 548/548. Next: stage-2 review.
- 2026-09-30: stage-2 review: governance PASS, security FLAG, workflow FLAG. Fix set 1 (A–D) approved by Francis, adding `templates/github/CODEOWNERS` to Files (its solo comment contradicts fix A). `strict_required_status_checks_policy` not adopted (rebase friction); noted for #13.
- 2026-09-30T22:40Z: fix set 1 implemented test-first (red: 4 new plugin-structure tests failed on assertions; the fix C test was corrected to compare the parser's string scalar `"false"`). Green: `npm test` 552/552 exit 0; `claude plugin validate` exit 0 for both. Next: narrow re-review.
- 2026-09-30T23:05Z: re-review of fix set 1: A, B, D closed; C regression [High 85]: `Read(~/**)` denied the whole workspace (under /home/runner). Fixed test-first within fix C: narrow home denies (`~/.claude`, `~/.claude.json`, `~/.config`, `~/.ssh`, `~/.docker`, runner install and temp folders) and a test that no deny rule covers a workspace path. Checked the action at 12dd8d74: agent mode sets its own git auth (so `persist-credentials: false` is safe) and, for write users, writes its token into the remote URL, so `Read(./.git/**)` is denied too (red, then green). Gate: `npm test` 553/553 exit 0; `claude plugin validate` exit 0 for both.
- 2026-09-30: final narrow re-review of the read denies: PASS. Francis chose "re-review, then release": version 0.8.1 and tag, adding the marketplace, plugin manifest and root README version files to Files.

## Final status
- Shipped: via PR #18 (merge commit de795ae), 2026-09-30. CI 4/4 green (ubuntu and windows, Node 20 and 22); npm test 553/553. Tagged v0.8.1; installed plugin refreshed from 0.8.0 to 0.8.1.
- Acceptance criteria: AC1–AC8 all shown (evidence above).
- Deviations: route override to small (Francis); fix set 1 (A–D) from stage-2 review, adding `templates/github/CODEOWNERS`; a `Read(~/**)` regression caught on re-review and fixed with a guard test; `Read(./.git/**)` added after reading the pinned action's git-config source; version files added for the 0.8.1 release. All approved by Francis and within the Files list.
- Deferred: remaining #13 and #16 items, plus three new follow-ups commented on #13 (large-diff paging, ruleset read-back, strict status-check policy).
