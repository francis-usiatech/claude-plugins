# UsiaTech plugin marketplace

Private Claude plugin marketplace for UsiaTech repositories.

| Plugin               | Version | Install ID                      |
| -------------------- | ------- | ------------------------------- |
| UsiaTech Engineering | 0.4.1   | `usiatech-engineering@usiatech` |

## Releasing a new plugin version

1. Change the plugin under `plugins/usiatech-engineering/`.
2. Bump `version` in **both** `plugins/usiatech-engineering/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and add a row to the plugin README's version table.
3. Run `claude plugin validate .`, then commit and push to `main`.
4. Users get it automatically (background auto-update), or right away with `/plugin marketplace update usiatech`.


