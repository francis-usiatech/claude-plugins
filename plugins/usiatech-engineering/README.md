# UsiaTech Engineering (`usiatech-engineering`)

Shared engineering workflow **and governance** for UsiaTech repositories (WaypointCareer, HEI Impact Intelligence). Project rules stay in each repo's `AGENTS.md`. This plugin supplies the procedures, reviewers and guard that are the same everywhere.

## Components

| Type | Name | What it does |
|---|---|---|
| Skill | `verify` | Runs the repo's definition-of-done gate (from `.claude/engineering.json` or AGENTS.md) and reports PASS/FAIL; checks the active plan's acceptance criteria against evidence from this session (unshown criteria warn, they don't fail the gate) |
| Skill | `release` | Scoped staging → verify → reviewers → one conventional commit → PR → merge → `DDMMMYYYY-XX` tag → branch cleanup |
| Skill | `user-guide-update` | Finds and updates affected user-guide pages and the changelog |
| Skill | `setup-engineering` | Creates `.claude/engineering.json` for a repo and checks the AGENTS.md/CLAUDE.md layout |
| Skill | `approve-plan` | Routes work small (plan directly) or large (`clarify` → `to-spec` → `to-tickets` first); records the approved plan with acceptance criteria and tasks as the scope baseline (`.claude/plans/active.md`) after a governance pre-flight; updates it on approved scope changes; archives it when done |
| Skill | `tdd` | Test-first cycles (red → green → refactor) with the failing and passing evidence for each cycle, then the verify gate |
| Skill | `debug` | Root cause before fix: reproduce → localize (hypotheses, bisect) → reduce → approved fix via `tdd` → regression guard test |
| Skill | `clarify` | One question at a time until purpose, success, constraints and scope edges are clear; ends with an understanding note the user corrects. Writes no files |
| Skill | `to-spec` | Writes the confirmed understanding to `docs/specs/YYYY-MM-DD-<slug>.md`: requirements R1…, measurable acceptance criteria AC1…, open questions answered or deferred before approval |
| Skill | `to-tickets` | Splits an approved spec into small tickets (covers R/AC, blocked by, done when); files GitHub issues after one confirmation, or writes a Tickets section into the spec without `gh` |
| Agent | `governance-reviewer` | Read-only gate: traces every change to a requirement, flags out-of-plan work, ADR/rule violations and dangerous actions; verdict PASS/FLAG/BLOCK |
| Agent | `convention-reviewer` | Read-only review of a diff against the repo's root and folder AGENTS.md |
| Agent | `silent-failure-reviewer` | Read-only review for swallowed errors, masking fallbacks, lost async errors, ignored exit codes and tests that can't fail |
| Agent | `security-reviewer` | Read-only security review of a diff: injection, access control, input handling, secrets, SSRF/path traversal, crypto, dependencies and CI workflows |
| Agent | `workflow-reviewer` | Read-only review of `.github/workflows/` changes: privileged triggers running PR code, script and prompt injection, exposed secrets, pinning and token permissions; judges the `wf-*` rule findings |
| Agent | `supply-chain-reviewer` | Read-only review of `package.json` and lockfile changes: typosquats and dependency confusion, advisories, install scripts, deprecated or stale packages, lockfile drift and widened ranges; judges the `sc-*` rule findings and lookup fail-opens |
| Hook | Governance guard (PreToolUse on Bash + edits) | **Deny:** catastrophic or rule-breaking actions and edits that write secrets. **Ask:** risky commands, likely hard-coded credentials, high-risk workflow or dependency content, governance/CI/dependency files, edits outside the approved plan. **Log:** every decision, workflow and dependency finding, and failed dependency lookup to `.claude/governance-log.jsonl` |

## Per-repo configuration: `.claude/engineering.json`
Start from `templates/engineering.json` (or run the `setup-engineering` skill).

| Key | Purpose |
|---|---|
| `verify` | Commands always run by `verify`, in order |
| `verifyConditional` | Extra commands run only when changed files start with a `when` prefix |
| `git` | Base/release branch, tag format, commit style |
| `protectedPaths` | Globs the agent may never edit |
| `immutableWhenCommitted` | Globs editable only until committed (e.g. migrations) |
| `allowEnvExample` | Allow edits to `.env.example` (default `true`) |
| `userGuide` | Guide folder, changelog file, optional manifest |
| `reviewers` | Agents `release` runs before committing, in two stages: `governance-reviewer` first, then the rest in parallel (default adds `convention-reviewer`, `silent-failure-reviewer`, `security-reviewer`; repo-specific ones allowed) |
| `governance` | `protectedBranches`, `askPaths`, `requirePlan`, extra `denyCommands` / `askCommands` (regex + reason), `allowlist` (see below), `rulesFile` |

## Governance model (layered)

| Layer | Mechanism | Effect |
|---|---|---|
| 1. Before work | `approve-plan` + `governance-reviewer` pre-flight | Plan must cite requirements. Scope is recorded. |
| 2. During work | Governance guard hook | Denies catastrophic actions. Asks on risky or out-of-plan actions. Logs everything. |
| 3. Before commit | `governance-reviewer` (+ `convention-reviewer`) in `release` | `BLOCK` stops the commit. `FLAG` needs the user's decision. |
| 4. Pull requests (CI) | `templates/github/` → `.github/` + repo `REVIEW.md` | Every PR runs these jobs (details below). `governance-gate` is the required check. |
| 5. After | Archived plans + `governance-log.jsonl` + PR verdict comments | Audit trail of scope and approvals |

**PR governance jobs:**
- `governance-checks` (deterministic):
  - requirement reference present in the PR description
  - branch flow (only `develop` or `hotfix/*` into `main`)
  - no `.env` files, no edits to committed immutable files
  - governance/CI/dependency changes need the `governance-approved` label
  - workflow content checks on each changed `.github/workflows/*.yml` (below): high-risk findings fail unless labelled; warnings are listed
  - dependency checks on each changed `package.json` and lockfile (below): the same tiers, and a failed npm lookup fails the job even with the label
  - gitleaks secrets scan
- `verify-gate`: the same `.claude/engineering.json` gate as the local `verify` skill.
- `ai-governance-review`: Claude Code GitHub Action applies `REVIEW.md` + AGENTS.md + `governance.md` + intent/ADRs. It returns a structured PASS/FLAG/BLOCK verdict, posts inline comments, and keeps one verdict comment per commit.
- `governance-gate` (required check): fails on failed checks or verify, on BLOCK or ERROR, on FLAG without the label, or when there's no verdict for the head commit.

Scripts and rules are read from the **base branch** (`_gov/`), so a PR can't change the checks it is judged by. The workflow file itself is the exception: GitHub runs `pr-governance.yml` from the PR, so a PR that edits it can change or skip the gate. The checks flag such edits (`.github/**` needs the approval label), but a required status check alone does not stop them: the edited workflow can still report a passing `governance-gate`. To enforce it, require Code Owner review on `.github/**` (the ruleset in `templates/ruleset-governance.json`, which `setup-engineering` applies after you approve), or use an org ruleset with **Require workflows to pass** pointing at the base-branch workflow. The PR description is passed to the reviewer as untrusted data.

The AI review job runs with `--setting-sources user`, so a PR's own `.claude/settings.json` hooks, plugins and `.mcp.json` are not loaded. It has no Bash tool: the diff (as text, so `.gitattributes` can't hide a file) and commit list are written to `.pr-diff.patch` and `.pr-log.txt` before it starts, and base versions of files come from `_gov/`. As defence in depth against a prompt-injected reviewer, its checkouts don't persist the token and it can't read `/proc`, the runner's temp and install folders, the workspace `.git/` folder (the action writes its token into the remote URL), or credential folders in the home folder (`~/.claude`, `~/.config`, `~/.ssh`, `~/.docker`); the workspace itself sits under the home folder, so the home folder as a whole stays readable, alongside the main defence that fork PRs get no AI review (below). A solo owner keeps Code Owner review on and merges with the ruleset's admin bypass, which GitHub records per PR. `claude-code-action` is pinned to a commit and the gitleaks image to a digest; bump both on purpose. Fork PRs get no AI review (secrets are withheld), so they fail the gate until a maintainer re-opens them from a branch.

**Default guard rules**
- **Deny:**
  - `rm -rf` of root, home or the workspace
  - `curl … | sh`
  - `--no-verify`
  - `mkfs`/`dd` to devices
  - `DROP DATABASE`/`SCHEMA`
  - shutdown/reboot
  - `chmod -R 777`
  - editing `.env*`, protected paths or committed immutable files
  - edits whose content contains a private key or a provider API key/token (AWS, GitHub, Anthropic, OpenAI, Stripe live, Google, Slack); documented placeholders are ignored
- **Ask:**
  - force push; reset/clean/restore; branch deletion; history rewrite; `rm -r`
  - `DROP TABLE`/`TRUNCATE`/unfiltered `DELETE`; weakening RLS; DB reset
  - dependency adds; publish; ssh/scp/rsync/terraform/kubectl/ansible/firebase deploy/docker prune
  - reading `.env`; `sudo`; `chmod 777`
  - commits or merges on protected branches, and pushes to them
  - edits to `.claude/**`, AGENTS.md, CLAUDE.md, REVIEW.md, `.github/**`, `package.json`
  - edits that look like a hard-coded credential (`password = "…"`, `apiKey: "…"`)
  - edits outside the approved plan, and edits to the plan itself (`.claude/plans/active.md`)
  - any action while `.claude/engineering.json` is malformed or has an invalid command pattern (default deny rules still apply)

**Workflow content checks** (`templates/github/scripts/workflow-rules.mjs`). The guard runs them on the post-edit content of any `.github/workflows/*.yml` edit, and `governance-checks` runs them on each changed workflow in a PR. Both compare against the previous version: the file on disk locally, the base-branch file in CI.

| Rule | Tier | Catches |
|---|---|---|
| `wf-privileged-checkout` | high | `pull_request_target` / `workflow_run` jobs that check out PR-controlled code |
| `wf-privileged-secrets` | high | secrets (or `secrets: inherit`) in such a job |
| `wf-untrusted-input` | high | untrusted event text (`github.event.*` titles, bodies, branch names, commit messages, `github.head_ref`), or a whole event object such as `toJSON(github.event)` or `join(github.event.issue.*)`, in `run:`, an `actions/github-script` script, or an AI action's inputs. Expressions are matched in any case, spacing or `['key']` notation |
| `wf-unparsed` | high | parts of the file the checks can't read: YAML anchors, aliases, merge keys, tags or explicit keys; double-quoted escapes other than `\" \\ \n \t \/` (GitHub decodes `\x24` to `$`); quoted strings or `[ ]` / `{ }` collections that span lines, and quotes or brackets that never close; `jobs`, a job, `steps` or a step of the wrong type; lines the parser skipped; or (in the guard) an edit whose result can't be worked out. The checks fail closed rather than pass a file they only partly read |
| `wf-unpinned-action` | warning | third-party actions and reusable workflows not pinned to a 40-character SHA (`actions/*`, `github/*` and local actions exempt) |
| `wf-write-all` | warning | `permissions: write-all` |
| `wf-permissions-widened` | warning | a scope that grows compared with the previous version, or an explicit `permissions` block that is removed |

High-risk findings make the guard ask, even when the path isn't in `askPaths`, and fail the CI checks unless the PR has the approval label. Warnings never block. Every finding is logged as `"decision": "finding"` with `rule`, `tier`, `file`, `line` and `detail`, and `governance-reviewer` counts them. The existing label requirement for `.github/**` changes is unchanged. The new checks add to it; they don't replace it.

**Dependency checks** (`templates/github/scripts/supply-chain-rules.mjs` and `supply-chain-lookups.mjs`). The guard runs them on the post-edit content of any `package.json`, `package-lock.json` (v1–v3), `pnpm-lock.yaml` (v5–v9) or `yarn.lock` (classic and berry) edit outside `node_modules/`, and `governance-checks` runs them on each changed one in a PR, against the previous version. Only added or changed entries are checked.

| Rule | Tier | Catches |
|---|---|---|
| `sc-typosquat` | high | an added unscoped name of 5+ characters one edit (insertion, deletion, substitution or swap) away from a bundled list of about 200 popular packages, e.g. `expresss`, `lodahs` |
| `sc-advisory` | high / warning | a known npm advisory for the added or changed version: critical or high is high risk, moderate or low a warning |
| `sc-resolved` | high / warning | a new or changed lockfile entry downloaded from outside `registry.npmjs.org` / `registry.yarnpkg.com` (https), or from a registry tarball that isn't `<name>/-/<name>-<version>.tgz` for that entry, is high risk; a changed download or checksum for an unchanged version is a warning. Local sources count as outside the registry: a pnpm `type: directory` resolution is reported as `file:<directory>`, and a yarn berry locator other than `npm:` or `patch:` (`file:`, `https:`, git) as the locator itself. Private registries need an allowlist entry |
| `sc-unparsed` | high | a manifest or lockfile the parser can't read. `pnpm-lock.yaml` and `yarn.lock` are read only in the layout pnpm and yarn write, so any other spelling is unread: quoted or spaced keys (`"packages":`, `packages :`), a repeated key or field, fields at another indentation, a value on the lines below any field other than the block fields pnpm and yarn write (`dependencies`, `engines`, `bin` and the like), so `name`, `version` and `resolution` must be on one line, a pnpm `resolution` that isn't a one-line `{key: value}` map, pnpm `name:` / `version:` fields that disagree with the key, a registry version (a pnpm key or `version:` field, a yarn berry `npm:` locator) that isn't an exact semver version, which rules out `::__archiveUrl=` suffixes, a pnpm git, URL or file package with no `tarball`, `repo` or `directory` source, an unknown pnpm resolution `type`, a yarn berry `resolution` (or the `npm:` locator inside a `patch:` one) whose version disagrees with `version:`, a double-quoted name, version, source or checksum holding a `\` escape, a yarn field the lockfile's format doesn't write (such as `resolved` in berry or `resolution` in classic; a classic `name` field is read as the installed package, so it gives `sc-alias`), a `__metadata` key other than berry's exact header, a yarn descriptor it can't read anywhere in an entry's key (`__metadata` among them), an `npm:` alias in any descriptor that asks for a different package from the entry's, a `package-lock.json` whose `packages` or `dependencies` is there but not an object, a pnpm `lockfileVersion` that isn't a number, a NEL, LS or PS line break, or a pnpm or yarn berry entry without a `resolution`. pnpm 10 `type: variations` resolutions are not read yet. Yarn berry entries are skipped as the project's own folders only when their `resolution` is a `workspace:`, `link:` or `portal:` locator. A lone CR counts as a line break, as it does for YAML and yarn. Also (in the guard) an edit whose result can't be worked out; nothing in it was checked |
| `sc-alias` | warning | a lockfile entry that installs under one name but fetches another package (`node_modules/lodash` holding `evil-pkg`, an `npm:` alias, a yarn berry `resolution` naming another package, or any yarn descriptor in an entry's key naming a package other than the one it fetches, such as `evil-pkg@^1, lodash@^4:`), unless the base had the same alias |
| `sc-install-script` | warning | the version has a `preinstall`, `install` or `postinstall` script |
| `sc-deprecated` | warning | the version is deprecated on the registry |
| `sc-stale` | warning | the package's latest release is more than 2 years old, or the registry gives no readable release date |
| `sc-not-found` | warning | the registry doesn't know the name (possible dependency confusion) |
| `sc-non-registry` | warning | a `workspace:`, `file:`, `link:`, git, URL or `npm:` alias specifier; it isn't looked up |
| `sc-lockfile-drift` | warning | a lockfile changes without its `package.json` (in the guard, any lockfile edit on its own) |
| `sc-range-widened` | warning | a range that widens to `*`, `latest`, `x` or `>=` |

The advisory, install-script, deprecated, stale and not-found checks look packages up on `registry.npmjs.org` (keyless; package names and versions are sent there, as `npm audit` does). Registry lookups cover direct dependencies added in a manifest, and find the latest version of an entry changed to an open range, 8 at a time; advisories cover every added or changed entry in one request. A manifest range is looked up at the version its lockfile pins in the same change. In the guard, all lookups share a 6 s deadline and a failed or timed-out lookup **fails open**: the offline findings stand and one `"decision": "error"` entry naming the lookup is logged. In CI each request has 20 s and the whole run 120 s, and a failed lookup **fails closed** with "Dependency lookup unavailable". See [ADR 0001](../../docs/adr/0001-guard-network-lookups.md).

To accept a known finding, add an entry to `governance.allowlist`: `{ "rule": "wf-unpinned-action", "path": ".github/workflows/pr-governance.yml", "reason": "…" }`, or for a package `{ "rule": "sc-install-script", "package": "esbuild", "reason": "…" }`. Each entry needs a rule ID plus a `path` glob or a `package` name, so a rule can't be turned off everywhere; a path made only of wildcards (`**`, `*`, `**/*`) is rejected. Allowlisted findings are still reported and logged as `suppressed`, but they don't block. CI reads the allowlist from the base branch, so a PR can't allowlist its own findings. The template's allowlist ships empty. The shipped `pr-governance.yml` gets one warning (`anthropics/claude-code-action@v1` is on a major tag): pin it to a SHA, or allowlist it with a reason as shown above.

All default rules live in one module, `templates/github/scripts/governance-rules.mjs`. The guard hook imports the plugin's copy. `setup-engineering` copies it into `.github/scripts/` with the CI scripts, which read the repo's copy. The two match at install time. After upgrading the plugin, re-copy `templates/github/scripts/` or the PR checks keep the older rules.

Path checks ignore case on Windows and macOS (`.ENV` is treated as `.env`), and CI always ignores case. A config value of the wrong type (e.g. a string where a list is expected) is reported the same way as malformed JSON, and the defaults apply for that key. The guard turns the problem into a confirmation prompt. The CI checks (`governance-checks`) fail with the problem named, so a broken base-branch config can't pass a PR.

The guard fails open on internal errors, so a bug can't lock a session. Each failure is logged as `"decision": "error"` in `governance-log.jsonl` and printed to stderr, and the reviewer reports these entries. `ask` depends on Claude Code's permission prompt: in a fully auto-approved session, rely on `deny` rules and the reviewer.

## Development
Tests use Node's built-in runner and have no dependencies. From the marketplace root run `npm test`. They cover the shared rules, the guard (as a function and as a hook subprocess), and each CI script against temporary git repos and a local GitHub API stub. `.github/workflows/test.yml` runs them on Ubuntu and Windows with Node 20 and 22.

## What stays in each repo
- `AGENTS.md` (canonical rules) + `CLAUDE.md` (`@AGENTS.md` + Claude-only notes) + folder `AGENTS.md` files.
- Project-specific skills and agents. Examples:
  - WaypointCareer: `add-ai-provider`, `change-subscription-tier`, `new-api-route`, `prisma-migration`
  - HEI: `new-api-endpoint`, `db-change`, `new-background-job`, `new-adr`, `security-tenancy-auditor`, `docs-sync`

## Requirements
Node ≥ 20 on the machine running Claude Code (used by the hook). Git.

## Versioning
Semver. Record changes below.

| Version | Change |
| 0.8.1 | Step 4.1 hardening (#13 CI kit, #16). `pr-governance.yml`: `claude-code-action` pinned to a commit and gitleaks to a digest; the AI review runs with `--setting-sources user` (no PR `.claude` hooks, plugins or `.mcp.json`), has no Bash tool (diff and log pre-written as text to `.pr-diff.patch` / `.pr-log.txt`), keeps no checkout token and cannot read `/proc`, runner folders, home credential folders or `.git/`. New `templates/ruleset-governance.json` (required `governance-gate` from GitHub Actions, Code Owner review, admin bypass per PR for solo owners); `setup-engineering` applies it after approval once no placeholder is left. `sc-stale` warns when the registry gives no readable release date. |
|---|---|
| 0.8.0 | Step 4: security and supply chain. **Workflow checks (B10):** the guard and `governance-checks` run shared `wf-*` rules on `.github/workflows/*.yml` changes (privileged triggers running PR code, untrusted input in scripts and AI prompts, unpinned actions, widened permissions, fail-closed parsing); new read-only `workflow-reviewer`. **Dependency checks (B9):** `sc-*` rules on `package.json`, `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock` changes (typosquats, npm advisories, install scripts, deprecated, stale and unknown packages, non-registry specifiers, lockfile drift, widened ranges, lockfile entries downloaded from elsewhere), with registry lookups that fail open (logged) in the guard and fail closed in CI ([ADR 0001](../../docs/adr/0001-guard-network-lookups.md)); new read-only `supply-chain-reviewer`. High-risk findings make the guard ask and fail CI unless labelled; `governance.allowlist` suppresses one finding by rule plus path glob or package name. `release` stage 2 runs `workflow-reviewer` and `supply-chain-reviewer` when their files change; `governance-reviewer` counts `wf-*` and `sc-*` findings and lookup fail-opens. The guard now sends added or changed package names and versions to `registry.npmjs.org` on dependency edits. **Upgrading repos:** re-copy `templates/github/scripts/` into `.github/scripts/` (new `workflow-rules.mjs`, `supply-chain-rules.mjs`, `supply-chain-lookups.mjs`); the `governance-checks` job needs outbound access to `registry.npmjs.org`. Optionally add `allowlist` entries to `.claude/engineering.json`. |
| 0.7.1 | Step 3 review fixes. `approve-plan` checks for an unfinished plan before routing, accepts a spec as a reference only once it's approved, keeps the requirement-reference rule when the user overrides the route, and has narrower triggers. `verify` stamps each evidence line with a UTC time, rewrites all of them on every run, and writes them in one edit. `governance-reviewer` flags evidence older than the latest change. `to-tickets` checks GitHub access before asking to confirm and finds labels by exact name. **Upgrading repos:** nothing required. Evidence written by 0.7.0 has no stamp, so the reviewer asks for `verify` to be re-run. |
| 0.7.0 | New `clarify`, `to-spec` and `to-tickets` skills; `approve-plan` routes work small (plan directly) or large (clarify → spec → tickets first), records measurable acceptance criteria, a task list and the route, and runs a governance pre-flight before approval; new `templates/spec.md`; `verify` reports each acceptance criterion as shown or not shown with evidence from the session (a warning, not a failure); `governance-reviewer` flags criteria without evidence and, in pre-flight, checks the plan against the spec and tickets. **Upgrading repos:** nothing required. Existing plans without acceptance criteria keep working. No CI changes; repos don't need to re-copy scripts. Specs go to `docs/specs/`, created on first use. |
| 0.6.0 | New `tdd` and `debug` skills; new read-only `silent-failure-reviewer` and `security-reviewer` agents; every reviewer scores finding confidence and reports only 80+ (50–79 as low-confidence notes); `release` reviews in two stages (governance first, then the rest in parallel); the guard denies edits that write private keys or provider API keys and asks on likely hard-coded credentials (rules and `findSecret()` in `governance-rules.mjs`); plugin structure test. **Upgrading repos:** add `silent-failure-reviewer` and `security-reviewer` to `reviewers` in `.claude/engineering.json`; re-copy `templates/github/scripts/` so `governance-rules.mjs` matches (CI behaviour is unchanged). |
| 0.5.1 | The guard asks before any edit to `.claude/plans/active.md`, so a plan can no longer widen its own scope without the user's confirmation. Archived plans and `governance-log.jsonl` stay exempt. No CI changes; repos don't need to re-copy scripts. |
| 0.5.0 | Guard hardening: shared rules module (`governance-rules.mjs`) used by the guard and CI; guard logic split into `governance-policy.mjs`; git calls no longer go through a shell (guard, `governance-checks`, `run-verify`); a malformed `engineering.json` or invalid command pattern now asks instead of silently dropping repo rules; fail-open errors are logged and reported by `governance-reviewer`; the guard also asks on `REVIEW.md` and all of `.github/**` (matching CI); `governance-gate`/`post-verdict` set `process.exitCode` instead of calling `process.exit()`; `setup-engineering` detects `dev` vs `develop`; wrong-type config values are reported instead of crashing the guard; edits on another Windows drive ask; path checks ignore case on Windows/macOS and in CI; protected-branch names are escaped and matched as whole refspecs, quoted or not; wrong-type `git` settings and non-string edit paths ask instead of crashing the guard; `governance-checks` reports a malformed or wrong-type base-branch config by name; CI honours `allowEnvExample`; `setup-engineering` detects `main` vs `master`; Node ≥ 20; the gate reports GitHub API errors; test suite and test workflow. **Upgrading repos:** re-copy `templates/github/scripts/` into `.github/scripts/` (the scripts now import `governance-rules.mjs`). |
| 0.4.1 | CI kit fixes: scripts read `engineering.json` from the base-branch copy; an empty verify list fails the gate; `GOVERNANCE_AI_REVIEW=off` opt-out; base-branch files extracted outside the workspace for `verify-gate` |
| 0.4.0 | Renamed from `nextascend-engineering` to `usiatech-engineering` (display name UsiaTech Engineering); no functional changes. Reinstall under the new name and uninstall the old one. |
| 0.3.0 | PR governance CI kit (`templates/github/`: workflow, 4 scripts, PR template, CODEOWNERS), `REVIEW.md` example; reviewer applies `REVIEW.md`; `setup-engineering` installs CI; `approvalLabel`/`requirementRefPattern` config |
| 0.2.0 | Governance: `approve-plan` skill, `governance-reviewer` agent, governance guard (replaces path guard; adds command rules, plan scope, governance log), `governance.md` + `plan.md` templates |
| 0.1.0 | Initial: verify, release, user-guide-update, setup-engineering, convention-reviewer, path guard |
