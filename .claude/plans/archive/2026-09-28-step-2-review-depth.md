# Plan: Step 2 — test-first and review depth (v0.6.0)

## Goal
Add `tdd` and `debug` skills, `silent-failure-reviewer` and `security-reviewer` agents, a guard rule that denies/asks on secrets in edited content, confidence scoring for all reviewers, and a two-stage review in `release`.

## Requirement references
- Improvement roadmap step 2: B4, B5, B7, B8, A8, A9 (session notes 2026-09-28-08a41718)
- Implementation plan: `docs/superpowers/plans/2026-09-28-step-2-review-depth.md`

## Files
- `docs/superpowers/plans/2026-09-28-step-2-review-depth.md`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/hooks.json`
- `plugins/usiatech-engineering/agents/convention-reviewer.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/agents/silent-failure-reviewer.md`
- `plugins/usiatech-engineering/agents/security-reviewer.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/setup-engineering/SKILL.md`
- `plugins/usiatech-engineering/skills/tdd/SKILL.md`
- `plugins/usiatech-engineering/skills/debug/SKILL.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `README.md`

## Commands and actions
- `npm test`, `claude plugin validate .`, `claude plugin validate plugins/usiatech-engineering`
- One commit per task on `feature/step-2-review-depth`; push; PR into `main`; merge after CI green and user go-ahead
- After merge: `claude plugin marketplace update usiatech` and `claude plugin update usiatech-engineering@usiatech`

## Out of scope
- Bash-written files bypassing edit rules (deferred step-1 item)
- A6/A7 (verify fake-pass detection, excuse tables)
- Repo-configurable secret allowlist; CI secret-content scanning (gitleaks covers PRs)

## Approved
- By: Francis · Date: 2026-09-28

## Change log
- 2026-09-28: initial plan approved (native execution)

## Final status
- Shipped: v0.6.0 via PR #4 (merge commit 06a63c8), 2026-09-28. CI 4/4 green; npm test 209/209.
- Deviations: +2 fix commits after review (secret-rule false positives and credential-ask reasons from the final review; AWS trailing-boundary bypass from security-reviewer). All within the plan's Files list.
- Deferred minors: credential-ask noise on fixtures; OpenAI placeholder matches; release step-4 confidence wording; tdd/debug trigger overlap; CI not using findSecret.
