/** One rate-limit window as the band shows it. */
export type Limit = { percent: number; resetsAt: string | null }

/** What the band draws, refreshed on every usage measurement. */
export type Snapshot = {
  model: string
  fiveHour: Limit | null
  week: Limit | null
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  costUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usiatech-usage-band': { snapshot: Shaped<Snapshot | null>; lastTurnUsd: number | null; isHidden: boolean }
  }
}
