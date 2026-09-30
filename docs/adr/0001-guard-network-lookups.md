# ADR 0001: Network lookups in the guard hook

Status: Accepted (Francis, 2026-09-29) · Date: 2026-09-29 · Author: Francis

References: spec `docs/specs/2026-09-28-security-supply-chain.md` (R3–R5, R13, R14), issue #11, roadmap step 4 (B9).

## Context

The governance guard (`hooks/scripts/governance-guard.mjs`) runs before every file edit. Until B9 it ran entirely offline: it read the edit, the repo's config and git, and decided. B9 checks new and changed npm dependencies for known advisories (R3), deprecated or stale packages (R4) and install scripts (R5). None of those can be answered offline, and waiting until CI finds them only after the dependency is already in the branch.

The hook has a 10 s timeout (`hooks/hooks.json`). The project has no runtime dependencies (Node built-ins and global `fetch` only) and uses no API keys.

## Decision

When an edit touches a `package.json`, `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`, the guard calls two public, keyless endpoints on `registry.npmjs.org`:

- `POST /-/npm/v1/security/advisories/bulk` for advisories on every added or changed entry, in one request.
- `GET /<name>` (the full packument) for direct dependencies added in a manifest, and to find the latest version of an entry changed to an open range such as `*` or `latest`, at most 8 at a time.

All lookups share one 6 s deadline, enforced with an `AbortController` and a race against a timer, so a request that ignores the abort can't hold the hook open. The offline rules (typosquat, drift, range widening, non-registry specifiers, unparsed files) run first and stand on their own.

A lookup that fails or times out **fails open** in the guard: the edit gets the offline result, and one `error` entry naming the lookup is written to `.claude/governance-log.jsonl` (A11), which `governance-reviewer` counts. The same lookups **fail closed** in CI (`governance-checks.mjs`), where a missing check can wait for a re-run and the approval label can't stand in for it.

Non-registry specifiers (`workspace:`, `file:`, `link:`, git and URL specifiers, `npm:` aliases) are never looked up.

## Consequences

- **Data leaves the machine.** Each dependency edit sends the added or changed package names and versions to `registry.npmjs.org`, the same data `npm install` and `npm audit` send. Names of private, unscoped packages can leak this way; keeping internal packages in a scope with its own registry avoids that, and the `sc-not-found` warning points at the dependency-confusion risk those names carry.
- **Latency.** Dependency edits can take up to about 6 s longer when the registry is slow. Other edits are unaffected.
- **Offline work.** With no network, dependency edits still get the offline checks and a logged fail-open; CI then fails closed until the registry is reachable.
- **Trust.** The guard now trusts the npm registry's answers. A wrong "no advisories" answer lets an edit through that CI would also accept; this is no worse than `npm audit`.
- **Testing.** Lookups are injected (`opts.lookups` in the guard, the `lookups` parameter of `runGovernanceChecks` in CI), so tests use stubs and never touch the network.

## Alternatives considered

- **CI only.** Keeps the guard offline, but a risky dependency is found only after it is committed and pushed.
- **OSV or the GitHub Advisory Database.** OSV needs one request per package or a batch format that doesn't return severity directly; the GitHub API needs a token. The npm endpoint is keyless and is what `npm audit` uses.
- **Fail closed in the guard.** Would block all dependency edits whenever the registry is unreachable, which is worse than a logged, reviewed fail-open.
