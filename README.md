# UsiaTech plugin marketplace

Private Claude plugin marketplace for UsiaTech repositories.

| Plugin               | Version | Install ID                      |
| -------------------- | ------- | ------------------------------- |
| UsiaTech Engineering | 0.14.0  | `usiatech-engineering@usiatech` |

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


