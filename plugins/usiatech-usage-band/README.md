# UsiaTech Usage Band (`usiatech-usage-band`)

A band above the Claude Code prompt that shows how much of your usage is left, in UsiaTech's brand.

## What it shows

- **Brand panel:** the UsiaTech logo and wordmark (Inter, weight 800, "Usia" `#075985`, "Tech" `#f59e0b`, as on www.usiatech.com) and the session's model, for example "Opus 5.5".
- **5-hour limit:** a ring gauge with the percent used and the local reset time.
- **Weekly limit:** a ring gauge with the percent used and the reset day and time.
- **Context:** a ring gauge with the percent of the context window used and the tokens, for example `192k/1M`.
- **Cost:** the session's total cost and a chip with the last turn's cost, for example `+$0.17`.

A ring is blue under 60%, amber from 60% and red from 85%.

## Where it works

| Surface | Brand | Gauges |
|---|---|---|
| Desktop app | SVG logo | SVG rings |
| VS Code extension | SVG logo | SVG rings |
| CLI (terminal) | Coloured "UsiaTech" text | Pie glyphs `○◔◑◕●` |

The desktop and VS Code draw one compact row, no taller than the stock usage band: the logo, footnote-size text and small rings. When the row is tight the text steps down to caption size; the close button stays on the first row, at the top right. The terminal draws the wordmark in its own font.

## Show or hide it

- `/usage-band hide` hides the band, `/usage-band show` shows it, and `/usage-band` alone toggles it.
- The band's own close button (top right on the desktop, `×` in the terminal) hides it too.
- These hide the band for the current session only.
- To hide it in every session, turn on the plugin's **Hide the usage band** option (`hidden`) in `/config`.

## Limits

- The 5-hour and weekly limits appear only on a Claude subscription, after the session's first response. Until then their rings read `–`.
- `–` means there is no reading yet, not zero. In a new window the limits and the context read `–` and the cost `$0.00` until the first response.
- After `/clear` the limits keep their last reading, because they belong to the account. The context reads `–` and the cost restarts at `$0.00`, because `/clear` starts the session over.
- The last turn's cost appears after the first finished turn.

## Install

```
/plugin marketplace add francis-usiatech/claude-plugins
/plugin install usiatech-usage-band@usiatech
```

## Development

The plugin is a Claude Code hooks module (`hooks/register.tsx`). Check it with:

```
claude plugin validate plugins/usiatech-usage-band
claude plugin test plugins/usiatech-usage-band
```
