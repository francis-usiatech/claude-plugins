# UsiaTech plugin marketplace

Private Claude plugin marketplace for UsiaTech repositories.

| Plugin               | Version | Install ID                      |
| -------------------- | ------- | ------------------------------- |
| UsiaTech Engineering | 0.5.1   | `usiatech-engineering@usiatech` |

## Releasing a new plugin version

1. Change the plugin under `plugins/usiatech-engineering/`.
2. Run `npm test` from this folder and make sure it passes.
3. Bump `version` in **both** `plugins/usiatech-engineering/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, update the version in the table above, and add a row to the plugin README's version table.
4. Run `claude plugin validate .`, then commit and push to `main`.
5. Users get it automatically (background auto-update), or right away with `/plugin marketplace update usiatech`.


