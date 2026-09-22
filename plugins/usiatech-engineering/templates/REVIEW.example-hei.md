# Review instructions — HEI Impact Intelligence

Used by the PR governance review (GitHub Action `pr-governance.yml`) and by Claude Code Review if it's enabled later. General project context is in `AGENTS.md`; don't repeat it here. Keep this file short.

## Verdict
- **BLOCK** if there is any Important finding.
- **FLAG** if there are no Important findings but at least one Flag finding. The Document Owner decides: fix it, or add the `governance-approved` label.
- **PASS** otherwise.

## Important (blocks merge)
- **Tenant isolation:**
  - DB access outside `withTenant`.
  - `tenantId` taken from the request body or query.
  - A tenant-owned table without `tenant_id` + policy + `FORCE ROW LEVEL SECURITY`.
  - Raw SQL without tenant context.
- **Humans validate:** an automated path (engine, AI, integration, job) sets Lecturer-confirmed, Reviewer-validated or Approved, or overwrites a human decision.
- **Privacy and residency:**
  - Personal data or evidence sent outside Malaysia or to an external AI service (ADR-0007, ADR-0017).
  - Personal data in logs, job payloads or errors.
  - Evidence served without signed URLs.
- **Secrets** in code, fixtures or `.env.example`, or keys shipped to the browser.
- **Auth:**
  - A route without an auth/role guard.
  - Possible privilege escalation.
  - Possible self-review.
- **Contradicts an Accepted ADR** (different ORM, queue, IdP, new infrastructure, etc.) without an ADR amendment in the same PR.
- **Weakened governance or safety:**
  - Changes that reduce checks in hooks, `.claude/**`, `REVIEW.md`, `.github/**`, RLS or auth.
  - Tests deleted, skipped or weakened to pass.
- **Data integrity:** a committed migration edited; a destructive schema change without expand/contract; audit rows updatable or deletable.

## Flag (needs the Document Owner's decision)
- **No requirement basis:** a changed area doesn't trace to an intent §, capability (C-number), FR/AC, ADR or D-item cited in the PR. Includes gold-plating and speculative features.
- **Pre-empted decision:** pre-empts a Proposed ADR or an open D-item (e.g. student accounts, ADR-0022; reuse of student-app assets, D20).
- **Needs-approval changes:**
  - a new dependency
  - changes to auth, Keycloak or roles
  - changes to infrastructure, CI or deploy
  - changes to `AGENTS.md`, `CLAUDE.md` or `.claude/**`
- **Missing required tests:**
  - API: 401, 403, cross-tenant, happy path, error path.
  - DB: a `test:rls` entry.
  - Jobs: idempotency.
- **Missing documentation duty:** intent/ADR/CHANGELOG/`intent.html` not updated for an architecture or scope change; user guide not updated for a visible change.

## Nit (at most 5; count the rest in the summary)
- AGENTS.md conventions not covered above (naming, i18n keys, error format, logging).

## Do not report
- Generated files (`generated/**`, `intent.html`), lockfiles.
- Anything CI already checks: types, lint, formatting, build, secrets scan.
- Pre-existing issues in lines the PR didn't change. Mention the count only.

## Verification bar
- Every finding cites `file:line` from the diff or the source. No claims inferred from naming alone.
- Map every changed area to a requirement reference (traceability).

## Summary format
- Open with a tally such as `0 Important · 1 Flag · 2 Nit`. If there are no Important findings, say so first.
