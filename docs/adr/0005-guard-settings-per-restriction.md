# ADR 0005: One guard setting per restriction, fixed destructive rules, and a config bypass

Status: Accepted (Francis, 2026-11-16) · Date: 2026-11-16 · Author: Francis

References: Jira ESP-166 (parent ESP-27). This ADR amends ADR-0004 only where the "ADR-0004" section below says so.

## Context

The governance guard asks or denies from hard-coded lists. Repos can extend some of them (`askPaths`, `askCommands`, `protectedPaths`, `trustedWritePaths`), but they can't turn off one restriction on its own.

Two problems came up on 2026-11-16:
- ADR edits prompted every time. `docs/adr/**` is never in a plan's Files list, so even a comment fix or a renumber got "not in the approved plan".
- `AGENTS.md` and `CLAUDE.md` asks couldn't be turned off without replacing the whole `askPaths` list.

The user asked for every restriction to be optional through its own setting, and for a way to bypass them all.

## Decision

The user accepted the decisions on one review page (D0.1–D7.2, "accept all") and settled the pre-flight flags the same day.

**Shape (D0.1, D0.2).** Each restriction has its own key in `.claude/engineering.json` under `governance`:
- File and edit keys sit directly under `governance`.
- Command keys sit under `governance.commands`.
- Each key takes `"deny"`, `"ask"` or `"allow"`. A missing key uses the default below.
- A bad value is reported, and the guard uses the stricter of the default and `"ask"`.
- An allow given because a key says `"allow"` is still logged, as `allowed-by-config` naming the key, so governance-reviewer sees it.

**File keys (D1.1–D1.6).** Each defaults to `"ask"`:
- `agentsFiles`: `AGENTS.md`, `**/AGENTS.md`
- `claudeMdFiles`: `CLAUDE.md` and, new, `**/CLAUDE.md`
- `reviewFile`: `REVIEW.md`
- `claudeConfig`: `.claude/**`
- `ciFiles`: `.github/**`
- `dependencyFiles`: `**/package.json`

**Ask paths (D1.7).** A repo-set `askPaths` still replaces this list. A path on it asks unless its group key says `"allow"`.

**Guard config (pre-flight decision).** Edits to `.claude/engineering.json`, `.claude/settings.json` and `.claude/settings.local.json` always ask, whatever `claudeConfig` or bypass says. `claudeConfig: "deny"` still denies them. Claude can't loosen its own guard without the user. The same fixed ask covers git internals (any `.git` folder, and a `.git` file, which points a worktree or submodule at its git folder) and Claude Code hooks and agents (`.claude/hooks/**`, `.claude/agents/**`), since they run code (release security review); `claudeConfig: "deny"` denies the two `.claude` folders.

**ADRs and scope (D2.1–D2.4).**
- `adrEdits` defaults to `"allow"`. Files under `adrPaths` (default `docs/adr/**`, `docs/decisions/**`) skip the plan-scope ask. governance-reviewer still checks that no Accepted ADR is contradicted.
- `planScope` defaults to `"ask"`.
- `requirePlan` and `planEdits` keep their current meaning.
- `outsideWrites` defaults to `"ask"`. Even under `"allow"`, agent config names (`settings.json`, `settings.local.json`, `.mcp.json`, `.claude.json`, `CLAUDE.md`, `AGENTS.md`) and the `.git`, `hooks`, `agents`, `plugins` and `.ssh` folders keep asking.

**Edit content (D3.1–D3.7).**

| Key | Default |
|---|---|
| `envFiles` | `"deny"` |
| `secrets` | `"deny"` |
| `possibleSecrets` | `"ask"` |
| `protectedPaths` | `"deny"` |
| `immutableFiles` | `"deny"` |
| `workflowFindings` | `"ask"` |
| `dependencyFindings` | `"ask"` |

**Commands (D4, narrowed by the pre-flight decision).** The user decided that destructive commands get no option. Only these keys exist, each defaulting to `"ask"`:

| Key | Rule |
|---|---|
| `addDependency` | adding a dependency |
| `publishPackage` | publishing a package |
| `remoteInfra` | remote host / infrastructure change (`ssh`, `scp`, `rsync`, `terraform apply`, `kubectl apply`, `ansible-playbook`, `firebase deploy`) |
| `readSecrets` | reading secrets |
| `writeEnvFile` | writing an env file |
| `sudo` | elevated privileges |
| `worldWritable` | world-writable permissions (`chmod 777`) |
| `protectedBranchWork` | commit, merge or push while on a protected branch |
| `protectedBranchPush` | push to a protected branch |

These have no key, and bypass leaves them as they are:
- every built-in deny command;
- force push, discarding work, deleting a branch or a remote branch, rewriting history, recursive delete, delete inside a command wrapper, ANSI-C quoted escapes, destructive SQL, weakening row-level security, resetting or dropping a database, destroying infrastructure (`terraform destroy`, `kubectl delete`, `docker system prune`, `docker volume rm`, split out of the remote host rule so `remoteInfra` doesn't cover it);
- the repo's own `denyCommands`.

**Fail-closed checks (D5.1, narrowed; D5.2).**
- The command-side checks stay fixed, because they are how a destructive command would be hidden: a command over 16 KB, an undecodable `-EncodedCommand`, a command naming the after-Bash snapshots.
- `uncheckable` (default `"ask"`) covers only the edit side: a Windows 8.3 short name, a plan path through a link, a non-string target, and a failed worktree or trusted-path lookup.
- Config problems keep asking, with no key.

**Bypass (D6.1).** `governance.bypass` is set only in the config file and defaults to `false`. When it is `true`:
- Every other ask becomes an allow, logged as `bypassed`. That includes the repo's own `askCommands` and `askPaths` entries.
- When the log line can't be written, the guard asks instead.
- Every deny still denies, and so do the fixed rules.
- To lift one deny, set that key to `"ask"` or `"allow"`.

**CI (D7.1).** The PR governance check reads the same file-group keys from the base-branch config, through the same validator. A file whose group is `"allow"` needs no approval label.

## ADR-0004

ADR-0004 keeps the database-drop deny for any command that may run SQL. That stands: the rule is in the fixed destructive set, with no key and no bypass. This ADR changes nothing in it.

## Consequences

- A repo can turn off exactly the prompts it finds noisy, such as `AGENTS.md` edits or new dependencies, and keep the rest.
- ADR edits no longer prompt by default. A repo that wants ADR changes confirmed sets `adrEdits: "ask"`.
- Turning on `bypass` or any `"allow"` still needs an edit to `.claude/engineering.json`, which always asks. Only the user can loosen the guard.
- Known gap: a shell command that writes `engineering.json` (`sed -i`, `>`) is not checked, because the guard doesn't read Bash file targets in general. The governance log and governance-reviewer remain the check there.
- Destructive commands still need the user every time, in every repo.
