import { expect, mock, test } from 'claude-code/testing'
import { compactTime } from './register.tsx'

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

test('below caption size the captions turn compact: shorter reset times, context without the window', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // Resets on the hour (in every whole-hour time zone): a compact time drops ":00" and the space before AM/PM.
  const onTheHour = [
    { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-11-16T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 92, resetsAt: '2026-11-21T18:00:00Z' },
  ]
  on('session.usage', () => ({ value: { ...USAGE, rateLimits: onTheHour } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  const mount = (bodyColumns: number) =>
    $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'vscode', viewport: { columns: 200, rows: 40 } })

  const wide = await mount(200)
  expect((await wide.find({ type: 'Text', text: /^ctx / }))?.text).toBe('ctx 192k/1M')
  await wide.unmount()

  const narrow = await mount(40)
  expect((await narrow.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.props.size).toBe('caption')
  expect((await narrow.find({ type: 'Text', text: /^ctx / }))?.text).toBe('ctx 192k')
  for (const caption of [/^5h /, /^wk /]) {
    const node = await narrow.find({ type: 'Text', text: caption })
    expect(node).toBeDefined()
    // A 12-hour locale reads e.g. "5h 1PM", a 24-hour one keeps "5h 13:00": either way no ":00 PM" and no
    // space before AM/PM (\s also matches U+202F).
    expect(node?.text).not.toMatch(/:00\s*[ap]\.?m/i)
    expect(node?.text).not.toMatch(/\s[ap]\.?m/i)
  }
  await narrow.unmount()
})

test('the compact step is chosen only when the full captions do not fit at caption size', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // No rate limits: the captions hold no clock time, so the row's width is fixed.
  on('session.usage', () => ({ value: { ...USAGE, rateLimits: [] } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  // At caption size the full row needs 59.6 cells (36 of text) and the compact row 57.05 (33 of text).
  const cases = [[60, 'ctx 192k/1M'], [59, 'ctx 192k'], [58, 'ctx 192k']] as const
  for (const [bodyColumns, ctx] of cases) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'vscode', viewport: { columns: 200, rows: 40 } })
    expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.props.size).toBe('caption')
    expect((await ui.find({ type: 'Text', text: /^ctx / }))?.text).toBe(ctx)
    await ui.unmount()
  }
})

test('the segments sit centred in the row on desktop and VS Code, with the close button last', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, viewport: { columns: 200, rows: 40 } })
    const row = await ui.find({ type: 'Box' })
    expect(row?.props.flexWrap).toBe('nowrap')
    expect(row?.children?.[0]?.props.justifyContent).toBe('center')
    expect(row?.children?.[1]?.children?.[0]?.props.label).toBe('×')
    await ui.unmount()
  }
})

test('compactTime drops a :00 minute and the space before AM/PM, and keeps 24-hour times', async () => {
  const cases = [
    ['10:00 PM', '10PM'],
    ['10:30 PM', '10:30PM'],
    ['Sat 10:00 AM', 'Sat 10AM'],
    ['Sat 10:00\u202fAM', 'Sat 10AM'],
    ['10:00 p. m.', '10p. m.'],
    ['22:00', '22:00'],
    ['Sat 22:00', 'Sat 22:00'],
  ] as const
  for (const [full, compact] of cases) expect(compactTime(full)).toBe(compact)
})

test('the close button has its hover tip on the desktop and none in VS Code, which draws no hover cards', async ($, on) => {
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [surface, hasTip] of [['desktop', true], ['vscode', false]] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, viewport: { columns: 200, rows: 40 } })
    expect(Boolean(await ui.find({ type: 'Text', text: /^Hide for this session$/ }))).toBe(hasTip)
    expect((await ui.find({ type: 'Box' }))?.children?.[1]?.children?.[0]?.props.label).toBe('×')
    await ui.unmount()
  }
})
