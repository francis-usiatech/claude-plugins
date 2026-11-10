// ESP-104, ESP-116, ESP-112, ESP-65 (spec docs/specs/2026-11-09-speed-batch.md R1, R3, R5, R6): the transport
// setting, the stage events and the verified alias, the forward-only walk and create --type/--parent.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTicketsConfig, runCli } from '../scripts/jira-tracker.mjs'

const jira = (over = {}) => ({
  tracker: 'jira',
  jira: {
    site: 'https://usiatech.atlassian.net',
    project: 'ESP',
    issueType: 'Subtask',
    parent: 'ESP-27',
    statuses: { started: 'In Progress', merged: 'Ready for Release', released: 'Released' },
    transport: 'api',
    ...over,
  },
})

const API = 'https://usiatech.atlassian.net/rest/api/2'
const CLI_ENV = { JIRA_EMAIL: 'me@example.test', JIRA_API_TOKEN: 'tok-SECRET-123456' }

const stubFetch = (...replies) => {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body == null ? null : JSON.parse(init.body) })
    const reply = replies.shift() ?? { status: 500, body: { errorMessages: ['no stub reply left'] } }
    return new Response(reply.body == null ? null : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, calls }
}

const cliRepo = (t, tickets = jira()) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jira-stages-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, '.claude'))
  writeFileSync(path.join(dir, '.claude', 'engineering.json'), JSON.stringify({ tickets }))
  writeFileSync(path.join(dir, 'body.txt'), 'Body text\n')
  return dir
}

const printed = (result) => {
  assert.notEqual(result.stdout, '', `nothing on stdout; stderr: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

const NETWORK_COMMANDS = [
  ['create', '--summary', 'S', '--body-file', 'body.txt'],
  ['link', '--blocker', 'ESP-28', '--blocked', 'ESP-29'],
  ['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'],
  ['find-transition', '--issue', 'ESP-22', '--event', 'merged'],
  ['transition', '--issue', 'ESP-28', '--event', 'merged'],
]

describe('transport setting (ESP-104 AC1)', () => {
  it('should default to the connector and print it on check', async (t) => {
    const result = await runCli(['check'], { env: CLI_ENV, fetch: stubFetch().fetch, cwd: cliRepo(t, jira({ transport: undefined })) })
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /"transport":"connector"/)
  })

  it('should print the api transport when it is set', async (t) => {
    const result = await runCli(['check'], { env: CLI_ENV, fetch: stubFetch().fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(printed(result).jira.transport, 'api')
  })

  it('should exit 2 on any other transport, naming the key', async (t) => {
    const result = await runCli(['check'], { env: CLI_ENV, fetch: stubFetch().fetch, cwd: cliRepo(t, jira({ transport: 'rest' })) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.jira\.transport"/)
  })

  for (const args of NETWORK_COMMANDS) {
    it(`should refuse ${args[0]} on the connector transport and send nothing`, async (t) => {
      const { fetch, calls } = stubFetch()
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: cliRepo(t, jira({ transport: undefined })) })
      assert.equal(result.code, 2, result.stderr)
      assert.match(result.stderr, /connector/)
      assert.equal(calls.length, 0)
    })
  }

  it('should still report a missing JIRA_EMAIL as a failure on the api transport (ESP-104 AC3)', async (t) => {
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /JIRA_EMAIL is not set/)
  })
})

describe('stage events and the verified alias (ESP-116 AC3)', () => {
  const stages = { started: 'In Progress', devComplete: 'Ready to Test', testingStarted: 'In Testing', testingComplete: 'Ready to Release', released: 'Released' }

  it('should accept the five stage events plus merged', () => {
    const { tickets, problems } = validateTicketsConfig(jira({ statuses: { ...stages, merged: 'Merged' } }))
    assert.deepEqual(problems, [])
    assert.deepEqual(tickets.jira.statuses, { ...stages, merged: 'Merged' })
  })

  it('should map verified to testingComplete, in statuses and transitions', () => {
    const { tickets, problems } = validateTicketsConfig(jira({ statuses: { verified: 'In Testing' }, transitions: { verified: '31' } }))
    assert.deepEqual(problems, [])
    assert.deepEqual(tickets.jira.statuses, { testingComplete: 'In Testing' })
    assert.deepEqual(tickets.jira.transitions, { testingComplete: '31' })
  })

  it('should report verified and testingComplete set together', () => {
    const { tickets, problems } = validateTicketsConfig(jira({ statuses: { verified: 'In Testing', testingComplete: 'Done' } }))
    assert.equal(tickets, null)
    assert.match(problems.join('; '), /"tickets\.jira\.statuses".*"verified".*"testingComplete"/)
  })

  it('should accept this repo\'s own config unchanged', () => {
    const own = JSON.parse(readFileSync(fileURLToPath(new URL('../../../.claude/engineering.json', import.meta.url)), 'utf8'))
    assert.deepEqual(validateTicketsConfig(own.tickets).problems, [])
  })

  it('should take --event verified as testingComplete', async (t) => {
    const config = jira({ statuses: { started: 'In Progress', verified: 'In Testing' } })
    const result = await runCli(['steps', '--event', 'verified', '--from', 'In Progress'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { event: 'testingComplete', status: 'In Testing', from: 'In Progress', steps: ['In Testing'] })
  })
})

describe('forward-only walk (ESP-116, ESP-112 AC5)', () => {
  const statuses = { started: 'In Progress', testingComplete: 'In Testing', merged: 'Ready for Release', released: 'Released' }
  const config = () => jira({ statuses })
  const steps = (t, event, from) => runCli(['steps', '--event', event, '--from', from], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config()) })

  it('should list every configured status between the current one and the target, in order, on either transport', async (t) => {
    for (const transport of ['api', undefined]) {
      const { fetch, calls } = stubFetch()
      const result = await runCli(['steps', '--event', 'merged', '--from', 'To Do'], { env: {}, fetch, cwd: cliRepo(t, jira({ statuses, transport })) })
      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(printed(result).steps, ['In Progress', 'In Testing', 'Ready for Release'])
      assert.equal(calls.length, 0)
    }
  })

  it('should leave a ticket already at the target status alone', async (t) => {
    const out = printed(await steps(t, 'started', 'in progress'))
    assert.deepEqual(out.steps, [])
    assert.match(out.reason, /already at "in progress"/)
  })

  it('should never move a ticket back from a later status', async (t) => {
    const out = printed(await steps(t, 'started', 'Ready for Release'))
    assert.deepEqual(out.steps, [])
    assert.match(out.reason, /at or past "In Progress"/)
  })

  it('should say so for an event with no configured status', async (t) => {
    const out = printed(await steps(t, 'devComplete', 'In Progress'))
    assert.deepEqual(out, { event: 'devComplete', status: null, from: 'In Progress', steps: [], reason: 'no status is configured for "devComplete"' })
  })

  it('should exit 2 when --from is missing', async (t) => {
    const result = await runCli(['steps', '--event', 'merged'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /--from/)
  })

  const status = (name) => ({ body: { fields: { status: { name } } } })
  const to = (id, name) => ({ body: { transitions: [{ id, name: `to ${name}`, to: { name } }] } })

  it('should walk two steps in order on the API transport and report each', async (t) => {
    const { fetch, calls } = stubFetch(status('In Progress'), to('31', 'In Testing'), { status: 204 }, to('41', 'Ready for Release'), { status: 204 })
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'merged'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-28', event: 'merged', status: 'Ready for Release', from: 'In Progress', transitioned: true, steps: ['In Testing', 'Ready for Release'] })
    assert.equal(calls[0].url, `${API}/issue/ESP-28?fields=status`)
    assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.body), [{ transition: { id: '31' } }, { transition: { id: '41' } }])
  })

  it('should send no move for a ticket already past the target', async (t) => {
    const { fetch, calls } = stubFetch(status('Released'))
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'started'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(printed(result).transitioned, false)
    assert.deepEqual(calls.map((c) => c.method), ['GET'])
  })

  // Code review 2026-11-09: a status the config doesn't list may be a closed one, and moving it would reopen the ticket.
  it('should leave a ticket in an unlisted status of the Done category alone on the API transport', async (t) => {
    const done = { body: { fields: { status: { name: 'Done', statusCategory: { key: 'done' } } } } }
    const { fetch, calls } = stubFetch(done)
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'started'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-28', event: 'started', status: 'In Progress', from: 'Done', transitioned: false, steps: [], reason: '"Done" is a done status the config doesn\'t list, so the ticket is left there' })
    assert.deepEqual(calls.map((c) => c.method), ['GET'])
    assert.equal(calls[0].url, `${API}/issue/ESP-28?fields=status`)
  })

  it('should still move a ticket in an unlisted status of another category', async (t) => {
    const todo = { body: { fields: { status: { name: 'To Do', statusCategory: { key: 'new' } } } } }
    const { fetch } = stubFetch(todo, to('21', 'In Progress'), { status: 204 })
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'started'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result).steps, ['In Progress'])
  })

  it('should give the connector path no steps for an unlisted done status (--from-category done)', async (t) => {
    const out = printed(await runCli(['steps', '--event', 'started', '--from', 'Closed', '--from-category', 'done'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config()) }))
    assert.deepEqual(out.steps, [])
    assert.match(out.reason, /"Closed" is a done status/)
  })

  it('should still walk a listed status of the Done category, such as Released, by its configured order', async (t) => {
    const out = printed(await runCli(['steps', '--event', 'released', '--from', 'Ready for Release', '--from-category', 'done'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config()) }))
    assert.deepEqual(out.steps, ['Released'])
  })

  it('should exit 2 for a --from-category that is not a Jira status category key', async (t) => {
    const result = await runCli(['steps', '--event', 'started', '--from', 'Closed', '--from-category', 'finished'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /--from-category/)
  })

  it('should stop the walk at a failed step and name the key, the status and the steps already made', async (t) => {
    const { fetch, calls } = stubFetch(status('In Progress'), to('31', 'In Testing'), { status: 204 }, { body: { transitions: [] } })
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'merged'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config()) })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /ESP-28/)
    assert.match(result.stderr, /no transition to status "Ready for Release"/)
    assert.match(result.stderr, /after moving it to "In Testing"/)
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1)
  })
})

describe('create --type and --parent (ESP-65 AC6)', () => {
  it('should send the given type and parent', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-70' } })
    const result = await runCli(['create', '--summary', 'S', '--body-file', 'body.txt', '--type', 'Bug', '--parent', 'ESP-1'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(calls[0].body.fields.issuetype, { name: 'Bug' })
    assert.deepEqual(calls[0].body.fields.parent, { key: 'ESP-1' })
  })

  it('should use the configured type when --type is not given', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-71' } })
    const result = await runCli(['create', '--summary', 'S', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(calls[0].body.fields.issuetype, { name: 'Subtask' })
  })

  for (const [what, extra] of [['a type with a line break', ['--type', 'Bug\nTask']], ['an empty type', ['--type=']], ['an invalid parent', ['--type', 'Bug', '--parent', 'esp-1']]]) {
    it(`should exit 2 before any call with ${what}`, async (t) => {
      const { fetch, calls } = stubFetch()
      const result = await runCli(['create', '--summary', 'S', '--body-file', 'body.txt', ...extra], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
      assert.equal(result.code, 2, result.stderr)
      assert.equal(calls.length, 0)
    })
  }
})
