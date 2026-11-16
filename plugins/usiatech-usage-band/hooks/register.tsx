import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMeasureInput, SessionRateLimit } from 'claude-code'

import type { Limit, Snapshot } from '../types'

const PLUGIN = 'usiatech-usage-band'
const COMMAND = 'usage-band'
// Change the tag when Snapshot's fields change: an older stored value is then read as null.
const snapshot = atom({ plugin: 'usiatech-usage-band', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const lastTurnUsd = atom({ plugin: 'usiatech-usage-band', key: 'lastTurnUsd' } as const, null)
const isHidden = atom({ plugin: 'usiatech-usage-band', key: 'isHidden' } as const, false)
// Kept in $.store too, so a hidden band stays hidden in the next session.
const HIDDEN_KEY = 'isHidden'

// Brand from www.usiatech.com: Inter 800, "Usia" primary-dark, "Tech" accent, primary-light logo gradient.
const BRAND = { usia: '#075985', tech: '#f59e0b', panel: '#f8fafc', light: '#0ea5e9', font: "'Inter', system-ui, -apple-system, sans-serif" }
const LEVEL = { ok: '#0ea5e9', warn: '#f59e0b', hot: '#ef4444', track: '#94a3b866' }

const LOGO_PATHS = `<rect width="24" height="24" rx="5" fill="url(#ug)"/><path d="M5 7C5 5.9 5.9 5 7 5H17C18.1 5 19 5.9 19 7V14C19 17.87 15.87 21 12 21C8.13 21 5 17.87 5 14V7Z" stroke="#fff" stroke-width="2.5" fill="none"/><path d="M12 10V15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="8" r="1.5" fill="#fff"/>`
// Logo and wordmark in one drawing, so the wordmark gets the website's font and weight.
const BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="22" viewBox="0 0 112 22"><defs><linearGradient id="ug" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="${BRAND.light}"/><stop offset="100%" stop-color="${BRAND.usia}"/></linearGradient></defs><g transform="scale(0.9166)">${LOGO_PATHS}</g><text x="28" y="16" font-family="${BRAND.font}" font-weight="800" font-size="15" letter-spacing="-0.3"><tspan fill="${BRAND.usia}">Usia</tspan><tspan fill="${BRAND.tech}">Tech</tspan></text></svg>`

const levelColor = (percent: number | null): string =>
  percent == null ? LEVEL.track : percent >= 85 ? LEVEL.hot : percent >= 60 ? LEVEL.warn : LEVEL.ok

const ringSvg = (percent: number | null): string => {
  const circumference = 2 * Math.PI * 15
  const filled = Math.min(100, Math.max(0, percent ?? 0)) / 100 * circumference
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="${LEVEL.track}" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="${levelColor(percent)}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 18 18)"/></svg>`
}

// The terminal has no Svg: a pie glyph stands in for the ring.
const PIES = ['○', '◔', '◑', '◕', '●']
const pieGlyph = (percent: number | null): string =>
  percent == null ? '○' : PIES[Math.min(4, Math.round(Math.max(0, percent) / 25))]

const percentText = (percent: number | null): string => (percent == null ? '–' : `${Math.round(percent)}%`)

const tokensText = (n: number): string =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const usdText = (usd: number): string => `$${usd.toFixed(2)}`

// "claude-opus-5-5[1m]" or "claude-sonnet-4-5-20250929" reads "Opus 5.5"; anything else is shown as given.
const modelName = (id: string): string => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i.exec(id)
  if (!match) return id
  const [, family, major, minor] = match
  return `${family[0].toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`
}

// Local clock time for the 5-hour window, weekday and time for the weekly one.
const resetText = (iso: string | null, withDay: boolean): string => {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return at.toLocaleString([], withDay ? { weekday: 'short', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso.slice(11, 16)
  }
}

const limitOf = (limits: readonly SessionRateLimit[], kind: string): Limit | null => {
  const found = limits.find((l) => l.kind === kind)
  return found ? { percent: found.percentUsed, resetsAt: found.resetsAt ?? null } : null
}

const toSnapshot = (usage: Omit<SessionMeasureInput, 'changed'>, model: string): Snapshot => ({
  model,
  fiveHour: limitOf(usage.rateLimits, 'five_hour'),
  week: limitOf(usage.rateLimits, 'seven_day'),
  contextTokens: usage.context.tokens ?? null,
  contextWindow: usage.context.window,
  contextPercent: usage.context.percent ?? null,
  costUsd: usage.cost?.usd ?? null,
})

type Gauge = { key: string; percent: number | null; caption: string }

const gaugesOf = (s: Snapshot): Gauge[] => {
  const reset = (limit: Limit | null, withDay: boolean) => resetText(limit?.resetsAt ?? null, withDay)
  const tokens = s.contextTokens == null ? '' : ` · ${tokensText(s.contextTokens)}/${tokensText(s.contextWindow)}`
  return [
    { key: '5h', percent: s.fiveHour?.percent ?? null, caption: `5h${reset(s.fiveHour, false) && ` · ${reset(s.fiveHour, false)}`}` },
    { key: 'wk', percent: s.week?.percent ?? null, caption: `week${reset(s.week, true) && ` · ${reset(s.week, true)}`}` },
    { key: 'ctx', percent: s.contextPercent, caption: `ctx${tokens}` },
  ]
}

const setHidden = async ($: EngineInterface, hidden: boolean) => {
  await update($, isHidden, () => hidden)
  await $.store.set(HIDDEN_KEY, hidden)
}

export const register: Register = (on) => {
  let usdAtSubmit: number | null = null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: COMMAND, description: 'Show or hide the UsiaTech usage band (show | hide; no argument toggles)' })
    const savedHidden = (await readSavedHidden($)) === true
    await update($, isHidden, () => savedHidden)
    try {
      await refresh($, await $.session.usage())
    } catch (err) {
      $.ui.log(`${PLUGIN}: could not read session usage: ${err instanceof Error ? err.message : String(err)}`)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    usdAtSubmit = (await read($, snapshot))?.costUsd ?? null
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const usd = (await $.session.usage()).cost?.usd ?? null
      if (usd != null && usdAtSubmit != null) await update($, lastTurnUsd, () => Math.max(0, usd - usdAtSubmit!))
    } catch (err) {
      $.ui.log(`${PLUGIN}: could not read the turn's cost: ${err instanceof Error ? err.message : String(err)}`)
    }
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg && arg !== 'show' && arg !== 'hide') return { text: `Unknown option "${e.args.trim()}". Use /${COMMAND} show, /${COMMAND} hide, or /${COMMAND} to toggle.` }
    const hidden = arg === 'hide' ? true : arg === 'show' ? false : !(await read($, isHidden))
    await setHidden($, hidden)
    return { text: hidden ? `Usage band hidden. /${COMMAND} show brings it back.` : 'Usage band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null || (await read($, isHidden))) return next(e)
    const gauges = gaugesOf(s)
    const cost = s.costUsd == null ? '–' : usdText(s.costUsd)
    const turn = await read($, lastTurnUsd)
    const delta = turn == null ? '' : `+${usdText(turn)}`
    const hide = () => setHidden($, true)

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box borderStyle="round" borderColor={BRAND.light} paddingX={1} columnGap={2} flexWrap="wrap">
          <Text backgroundColor={BRAND.panel} bold>
            {' '}<Text color={BRAND.usia} backgroundColor={BRAND.panel} bold>Usia</Text><Text color={BRAND.tech} backgroundColor={BRAND.panel} bold>Tech</Text>{' '}
          </Text>
          <Text dimColor>{s.model}</Text>
          {gauges.map((g) => (
            <Text key={g.key}>
              <Text color={levelColor(g.percent)}>{pieGlyph(g.percent)} </Text>
              <Text bold>{percentText(g.percent)}</Text>
              <Text dimColor> {g.caption}</Text>
            </Text>
          ))}
          <Text>
            <Text bold>{cost}</Text>
            {delta && <Text color={BRAND.usia} backgroundColor="#e0f2fe"> {delta} </Text>}
          </Text>
          <Button key="hide" label="×" onPress={hide} />
        </Box>
      )
    }

    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    return (
      <Box borderStyle="round" borderColor={BRAND.light} flexDirection="row" alignItems="center">
        <Box backgroundColor={BRAND.panel} flexDirection="column" paddingX={1} paddingY={0}>
          <Svg source={BRAND_SVG} alt="UsiaTech" width={112} height={22} />
          <Text color={BRAND.usia} dimColor>{s.model}</Text>
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={2} paddingX={1} flexGrow={1} flexWrap="wrap">
          {gauges.map((g) => (
            <Box key={g.key} flexDirection="row" alignItems="center" columnGap={1}>
              <Svg source={ringSvg(g.percent)} alt={`${g.key} ${percentText(g.percent)}`} width={26} height={26} />
              <Box flexDirection="column">
                <Text bold>{percentText(g.percent)}</Text>
                <Text dimColor>{g.caption}</Text>
              </Box>
            </Box>
          ))}
          <Box flexDirection="column" marginLeft={1}>
            <Text>
              <Text bold>{cost}</Text>
              {delta && <Text color={BRAND.usia} backgroundColor="#e0f2fe"> {delta} </Text>}
            </Text>
            <Text dimColor>this session</Text>
          </Box>
        </Box>
        <Button key="hide" label="Hide" onPress={hide} />
      </Box>
    )
  })
}

async function refresh($: EngineInterface, usage: Omit<SessionMeasureInput, 'changed'>): Promise<void> {
  let model = ''
  try {
    model = modelName(await $.session.model())
  } catch (err) {
    $.ui.log(`${PLUGIN}: could not read the model: ${err instanceof Error ? err.message : String(err)}`)
  }
  await update($, snapshot, () => toSnapshot(usage, model))
}

async function readSavedHidden($: EngineInterface): Promise<unknown> {
  try {
    return await $.store.get(HIDDEN_KEY)
  } catch (err) {
    $.ui.log(`${PLUGIN}: could not read the saved show/hide choice: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
