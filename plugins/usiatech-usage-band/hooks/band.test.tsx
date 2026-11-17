import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usiatech-usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false },
} as const

const USAGE = {
  startedAt: 0,
  context: { tokens: 192_000, window: 1_000_000, percent: 19 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-11-16T20:50:00Z' },
    { kind: 'seven_day', percentUsed: 92, resetsAt: '2026-11-21T18:00:00Z' },
  ],
  cost: { usd: 2.61 },
}

test('the band shows limits, context, model and cost on terminal, desktop and VS Code', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.text).toBe('Opus 5.5')
    expect((await ui.find({ type: 'Text', text: /^18%$/ }))?.text).toBe('18%')
    expect((await ui.find({ type: 'Text', text: /^92%$/ }))?.text).toBe('92%')
    expect((await ui.find({ type: 'Text', text: /192k\/1M/ }))?.text).toContain('192k/1M')
    expect((await ui.find({ type: 'Text', text: /^\$2\.61$/ }))?.text).toBe('$2.61')
    await ui.unmount()
  }
})

test('/usage-band hide hides the band and /usage-band show brings it back', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const hidden = await $.command.run({ command: 'usage-band', args: 'hide' })
  expect(hidden.text).toContain('hidden')
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()

  await $.command.run({ command: 'usage-band', args: 'show' })
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Opus 5.5$/ }))?.text).toBe('Opus 5.5')
  await ui.unmount()

  const unknown = await $.command.run({ command: 'usage-band', args: 'maybe' })
  expect(unknown.text).toContain('Unknown option')
})

test('the "hidden" option hides the band in every session and /usage-band show points to it', { options: { hidden: true } }, async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()

  const show = await $.command.run({ command: 'usage-band', args: 'show' })
  expect(show.text).toContain('"hidden" option')
})

test('the close button hides the band for this session', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'hide' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the desktop text steps down from footnote to caption as the window narrows', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [columns, size] of [[200, 'footnote'], [80, 'caption']] as const) {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop', viewport: { columns, rows: 40 } })
    const model = await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })
    expect(model?.props.size).toBe(size)
    await ui.unmount()
  }
})

test('the close button stays on the first row: the outer row never wraps on desktop and VS Code', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // VS Code wraps a row Box that sets no flexWrap, which dropped the close button to a second row.
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, viewport: { columns: 60, rows: 40 } })
    // find returns the outermost match first: the band's own row.
    expect((await ui.find({ type: 'Box' }))?.props.flexWrap).toBe('nowrap')
    await ui.unmount()
  }
})

test('the text size follows bodyColumns and leaves room for the close button', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // No rate limits: the captions hold no clock time, so the row's width is fixed.
  on('session.usage', () => ({ value: { ...USAGE, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  // The row needs 65 cells at footnote size: 36 of text, 5 per segment and 4 for the close button.
  const cases = [[200, 65, 'footnote'], [200, 64, 'caption'], [80, 200, 'footnote']] as const
  for (const [columns, bodyColumns, size] of cases) {
    const ui = await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, bodyColumns },
      surface: 'vscode',
      viewport: { columns, rows: 40 },
    })
    const model = await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })
    expect(model?.props.size).toBe(size)
    await ui.unmount()
  }
})
