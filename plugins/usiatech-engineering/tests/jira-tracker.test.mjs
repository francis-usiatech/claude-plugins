import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateTicketsConfig, findJiraKeys, createJiraClient, credentialsFromEnv, runCli } from '../scripts/jira-tracker.mjs'

const jira = (over = {}) => ({
  tracker: 'jira',
  jira: {
    site: 'https://usiatech.atlassian.net',
    project: 'ESP',
    issueType: 'Subtask',
    parent: 'ESP-27',
    statuses: { started: 'In Progress', merged: 'Ready for Release', released: 'Released' },
    ...over,
  },
})

describe('validateTicketsConfig (R1; AC1)', () => {
  it('should default to the GitHub tracker when there is no tickets section', () => {
    assert.deepEqual(validateTicketsConfig(undefined), { tickets: { tracker: 'github' }, problems: [] })
  })

  it('should accept a valid Jira section and keep its values', () => {
    const { tickets, problems } = validateTicketsConfig(jira())
    assert.deepEqual(problems, [])
    assert.equal(tickets.tracker, 'jira')
    assert.equal(tickets.jira.project, 'ESP')
    assert.equal(tickets.jira.parent, 'ESP-27')
    assert.deepEqual(tickets.jira.statuses, { started: 'In Progress', merged: 'Ready for Release', released: 'Released' })
  })

  it('should default to the GitHub tracker when a section with Jira settings names no tracker', () => {
    assert.deepEqual(validateTicketsConfig({ jira: jira().jira }), { tickets: { tracker: 'github' }, problems: [] })
  })

  it('should drop trailing slashes from the site', () => {
    assert.equal(validateTicketsConfig(jira({ site: 'https://usiatech.atlassian.net//' })).tickets.jira.site, 'https://usiatech.atlassian.net')
  })

  it('should accept a Jira section without a parent or with only some events', () => {
    const { tickets, problems } = validateTicketsConfig(jira({ parent: undefined, statuses: { released: 'Done' } }))
    assert.deepEqual(problems, [])
    assert.equal(tickets.jira.parent, null)
    assert.deepEqual(tickets.jira.statuses, { released: 'Done' })
  })

  for (const [name, over, key] of [
    ['missing site', { site: undefined }, 'tickets.jira.site'],
    ['a non-https site', { site: 'http://usiatech.atlassian.net' }, 'tickets.jira.site'],
    ['missing project', { project: undefined }, 'tickets.jira.project'],
    ['a lower-case project', { project: 'esp' }, 'tickets.jira.project'],
    ['missing issue type', { issueType: '' }, 'tickets.jira.issueType'],
    ['a malformed parent', { parent: 'ESP27' }, 'tickets.jira.parent'],
    ['a non-string status name', { statuses: { merged: 41 } }, 'tickets.jira.statuses.merged'],
    ['an unknown event', { statuses: { shipped: 'Released' } }, 'tickets.jira.statuses.shipped'],
  ]) {
    it(`should report ${name} as a problem naming ${key}`, () => {
      const { problems } = validateTicketsConfig(jira(over))
      assert.equal(problems.length, 1, problems.join('; '))
      assert.match(problems[0], new RegExp(`"${key.replace(/\./g, '\\.')}"`))
    })
  }

  it('should accept a verified status and keep it in the loaded statuses (ESP-64)', () => {
    const { tickets, problems } = validateTicketsConfig(jira({ statuses: { started: 'In Progress', verified: 'In Testing', merged: 'Ready for Release' } }))
    assert.deepEqual(problems, [])
    assert.equal(tickets.jira.statuses.verified, 'In Testing')
  })

  it('should list verified among the events when an event name is unknown (ESP-64)', () => {
    const { problems } = validateTicketsConfig(jira({ statuses: { shipped: 'Released' } }))
    assert.equal(problems.length, 1, problems.join('; '))
    assert.match(problems[0], /verified/)
  })

  it('should report an unknown tracker and a non-object section', () => {
    assert.match(validateTicketsConfig({ tracker: 'linear' }).problems[0], /"tickets\.tracker" must be "github" or "jira"/)
    assert.match(validateTicketsConfig('jira').problems[0], /"tickets" must be an object/)
    assert.match(validateTicketsConfig({ tracker: 'jira' }).problems[0], /"tickets\.jira" must be an object/)
  })

  it('should return no usable tickets config when there is a problem', () => {
    assert.equal(validateTicketsConfig(jira({ project: undefined })).tickets, null)
  })
})

describe('validateTicketsConfig unknown keys (R1; ESP-62)', () => {
  for (const [name, raw, key] of [
    ['a misspelt tracker with no tracker set', { trackr: 'jira' }, 'tickets.trackr'],
    ['an unknown key beside the GitHub tracker', { tracker: 'github', jirra: {} }, 'tickets.jirra'],
    ['an unknown key beside the Jira tracker', { ...jira(), extra: true }, 'tickets.extra'],
    ['a misspelt statuses', jira({ statuses: undefined, statues: { started: 'In Progress' } }), 'tickets.jira.statues'],
    ['an unknown event', jira({ statuses: { begun: 'In Progress' } }), 'tickets.jira.statuses.begun'],
  ]) {
    it(`should report ${name} as a problem naming ${key}`, () => {
      const { tickets, problems } = validateTicketsConfig(raw)
      assert.equal(tickets, null)
      assert.equal(problems.length, 1, problems.join('; '))
      assert.match(problems[0], new RegExp(`"${key.replace(/\./g, '\\.')}"`))
    })
  }

  it('should accept $comment in tickets, tickets.jira and tickets.jira.statuses', () => {
    const raw = jira({ $comment: 'jira note', statuses: { $comment: 'status note', started: 'In Progress' } })
    raw.$comment = 'tickets note'
    const { tickets, problems } = validateTicketsConfig(raw)
    assert.deepEqual(problems, [])
    assert.deepEqual(tickets.jira.statuses, { started: 'In Progress' })
  })

  for (const [name, raw, keys] of [
    ['a misspelt tracker beside a bad tracker', { trackr: 'jira', tracker: 'linear' }, ['tickets.trackr', 'tickets.tracker']],
    ['an unknown tickets key beside a Jira problem', { ...jira({ statues: {} }), extra: true }, ['tickets.extra', 'tickets.jira.statues']],
  ]) {
    it(`should report every level in one run for ${name}`, () => {
      const { tickets, problems } = validateTicketsConfig(raw)
      assert.equal(tickets, null)
      assert.equal(problems.length, keys.length, problems.join('; '))
      keys.forEach((key, i) => assert.match(problems[i], new RegExp(`"${key.replace(/\./g, '\\.')}"`)))
    })
  }

  it('should accept $comment beside the GitHub tracker', () => {
    assert.deepEqual(validateTicketsConfig({ $comment: 'note', tracker: 'github' }), { tickets: { tracker: 'github' }, problems: [] })
  })
})

// A fetch stub that records each request and answers from a queue of { status, body } replies.
const stubFetch = (...replies) => {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body == null ? null : JSON.parse(init.body), redirect: init.redirect, signal: init.signal })
    const reply = replies.shift() ?? { status: 500, body: { errorMessages: ['no stub reply left'] } }
    return new Response(reply.body == null ? null : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, calls }
}
const client = (fetch) => createJiraClient({ site: 'https://usiatech.atlassian.net', email: 'me@example.test', token: 'tok-123', fetch })
const API = 'https://usiatech.atlassian.net/rest/api/2'
const TRANSITIONS = { transitions: [
  { id: '21', name: 'Start work', to: { name: 'In Progress' } },
  { id: '41', name: 'Ship it', to: { name: 'Ready for Release' } },
] }

describe('findJiraKeys (R7; AC7)', () => {
  it('should return the unique keys of the project in the order first seen', () => {
    const text = 'feat: add the helper (ESP-30)\n\nRefs ESP-27, ESP-30.\nfix: ESP-12 again\n'
    assert.deepEqual(findJiraKeys(text, 'ESP'), ['ESP-30', 'ESP-27', 'ESP-12'])
  })

  it('should ignore the keys of other projects', () => {
    assert.deepEqual(findJiraKeys('ABC-1 ESP-2 ESPX-3 XYZ-4', 'ESP'), ['ESP-2'])
  })

  it('should ignore a key inside a longer word', () => {
    assert.deepEqual(findJiraKeys('XESP-1 ESP-1a foo_ESP-2 2ESP-3 bar-ESP-4 ESP-5', 'ESP'), ['ESP-5'])
  })

  it('should find a key next to punctuation, a slash or a line end', () => {
    assert.deepEqual(findJiraKeys('(ESP-1) [ESP-2], feature/ESP-3-x "ESP-4"\nESP-5', 'ESP'), ['ESP-1', 'ESP-2', 'ESP-3', 'ESP-4', 'ESP-5'])
  })

  it('should not match a project whose key is a prefix of another project key', () => {
    assert.deepEqual(findJiraKeys('ESP-1 ES-2', 'ES'), ['ES-2'])
  })

  it('should return no keys for text without any', () => {
    assert.deepEqual(findJiraKeys('', 'ESP'), [])
    assert.deepEqual(findJiraKeys('chore: tidy up\nesp-1 is lower case', 'ESP'), [])
  })

  it('should refuse a project that is not a project key and text that is not a string', () => {
    for (const project of ['esp', 'E.P', 'ESP|ABC', '', undefined]) {
      assert.throws(() => findJiraKeys('ESP-1', project), /project key/, String(project))
    }
    assert.throws(() => findJiraKeys(undefined, 'ESP'), /text must be a string/)
  })
})

describe('createJiraClient requests (R3; AC3)', () => {
  it('should create an issue under a parent and return its key', async () => {
    const { fetch, calls } = stubFetch({ status: 201, body: { id: '1', key: 'ESP-40' } })
    const key = await client(fetch).createIssue({ project: 'ESP', issueType: 'Subtask', parent: 'ESP-27', summary: 'Do a thing', description: 'Body' })
    assert.equal(key, 'ESP-40')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${API}/issue`)
    assert.deepEqual(calls[0].body, { fields: { project: { key: 'ESP' }, issuetype: { name: 'Subtask' }, summary: 'Do a thing', description: 'Body', parent: { key: 'ESP-27' } } })
    assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('me@example.test:tok-123').toString('base64')}`)
  })

  it('should create an issue without a parent field when there is no parent', async () => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-41' } })
    assert.equal(await client(fetch).createIssue({ project: 'ESP', issueType: 'Task', summary: 'S', description: 'D' }), 'ESP-41')
    assert.equal('parent' in calls[0].body.fields, false)
  })

  it('should link a blocker to the issue it blocks', async () => {
    const { fetch, calls } = stubFetch({ status: 201 })
    await client(fetch).linkBlocks('ESP-28', 'ESP-29')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${API}/issueLink`)
    assert.deepEqual(calls[0].body, { type: { name: 'Blocks' }, inwardIssue: { key: 'ESP-28' }, outwardIssue: { key: 'ESP-29' } })
  })

  it('should add a comment', async () => {
    const { fetch, calls } = stubFetch({ status: 201, body: { id: '9' } })
    await client(fetch).addComment('ESP-28', 'Merged in PR #80')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${API}/issue/ESP-28/comment`)
    assert.deepEqual(calls[0].body, { body: 'Merged in PR #80' })
  })

  it('should find the transition by its target status name, ignoring case, without changing the issue', async () => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS })
    assert.equal(await client(fetch).findTransition('ESP-22', 'ready for release'), '41')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].url, `${API}/issue/ESP-22/transitions`)
  })

  it('should move an issue to a status through the matching transition', async () => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS }, { status: 204 })
    await client(fetch).transitionTo('ESP-28', 'In Progress')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].method, 'POST')
    assert.equal(calls[1].url, `${API}/issue/ESP-28/transitions`)
    assert.deepEqual(calls[1].body, { transition: { id: '21' } })
  })

  it('should encode the issue key in paths', async () => {
    const { fetch, calls } = stubFetch({ status: 201 })
    await client(fetch).addComment('ESP-1/../x', 'c')
    assert.equal(calls[0].url, `${API}/issue/ESP-1%2F..%2Fx/comment`)
  })
})

describe('credentialsFromEnv (R2)', () => {
  it('should read the email, token and trusted site from JIRA_EMAIL, JIRA_API_TOKEN and JIRA_SITE', () => {
    assert.deepEqual(
      credentialsFromEnv({ JIRA_EMAIL: 'me@example.test', JIRA_API_TOKEN: 'tok', JIRA_SITE: 'https://jira.example.test', OTHER: 'x' }),
      { email: 'me@example.test', token: 'tok', trustedSite: 'https://jira.example.test' })
  })

  it('should leave unset values undefined so the client can report them', () => {
    assert.deepEqual(credentialsFromEnv({}), { email: undefined, token: undefined, trustedSite: undefined })
  })
})

// Runs `fn`, expects it to reject, and returns the error message.
const failure = async (fn) => {
  const err = await fn().then(() => null, (e) => e)
  assert.ok(err instanceof Error, 'expected a rejection')
  return err.message
}

describe('createJiraClient failures (R4; AC4)', () => {
  for (const [name, opts, cause] of [
    ['a missing email', { email: undefined }, /JIRA_EMAIL is not set/],
    ['an empty token', { token: '' }, /JIRA_API_TOKEN is not set/],
  ]) {
    it(`should fail on ${name} naming the issue and the variable, sending nothing`, async () => {
      const { fetch, calls } = stubFetch()
      const jiraClient = createJiraClient({ site: 'https://usiatech.atlassian.net', email: 'me@example.test', token: 'tok-123', fetch, ...opts })
      const message = await failure(() => jiraClient.addComment('ESP-28', 'c'))
      assert.match(message, /ESP-28/)
      assert.match(message, cause)
      assert.equal(calls.length, 0)
    })
  }

  it('should name the ticket title when creating an issue fails', async () => {
    const { fetch } = stubFetch({ status: 400, body: { errorMessages: [], errors: { summary: 'Summary is required' } } })
    const message = await failure(() => client(fetch).createIssue({ project: 'ESP', issueType: 'Task', summary: 'Add the CLI', description: '' }))
    assert.match(message, /"Add the CLI"/)
    assert.match(message, /HTTP 400/)
    assert.match(message, /summary: Summary is required/)
  })

  it('should fail when a created issue has no key in the response', async () => {
    const { fetch } = stubFetch({ status: 201, body: { id: '1' } })
    const message = await failure(() => client(fetch).createIssue({ project: 'ESP', issueType: 'Task', summary: 'S', description: 'D' }))
    assert.match(message, /"S"/)
    assert.match(message, /no issue key/)
  })

  it('should report a network error with its cause', async () => {
    const calls = []
    // Node's fetch says only "fetch failed" and keeps the reason in `cause`.
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })
    const fetch = async (url) => { calls.push(url); throw new TypeError('fetch failed', { cause: refused }) }
    const message = await failure(() => client(fetch).addComment('ESP-28', 'c'))
    assert.match(message, /ESP-28/)
    assert.match(message, /network error: fetch failed \(ECONNREFUSED\)/)
    assert.equal(calls.length, 1)
  })

  it('should give the cause message when a network error cause has no code', async () => {
    const fetch = async () => { throw new TypeError('fetch failed', { cause: new Error('certificate has expired') }) }
    assert.match(await failure(() => client(fetch).addComment('ESP-28', 'c')), /network error: fetch failed \(certificate has expired\)/)
  })

  it('should time out a response whose body stalls after the headers', { timeout: 5000 }, async () => {
    // The body never ends; like Node's fetch, it errors when the request's signal aborts.
    const fetch = async (url, init) => new Response(new ReadableStream({
      start: (controller) => init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))),
    }), { status: 200 })
    const jiraClient = createJiraClient({ site: 'https://usiatech.atlassian.net', email: 'me@example.test', token: 'tok-123', fetch, timeoutMs: 20 })
    const message = await failure(() => jiraClient.addComment('ESP-28', 'c'))
    assert.match(message, /comment on ESP-28 failed: timed out after 20 ms/)
  })

  it('should report a body that fails to read as a network error', async () => {
    const fetch = async () => new Response(new ReadableStream({ start: (controller) => controller.error(new Error('socket hang up')) }), { status: 201 })
    assert.match(await failure(() => client(fetch).addComment('ESP-28', 'c')), /comment on ESP-28 failed: network error: socket hang up/)
  })

  it('should abort a request that takes longer than the timeout', async () => {
    const calls = []
    const fetch = (url, init) => {
      calls.push(url)
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    const jiraClient = createJiraClient({ site: 'https://usiatech.atlassian.net', email: 'me@example.test', token: 'tok-123', fetch, timeoutMs: 20 })
    const message = await failure(() => jiraClient.transitionTo('ESP-28', 'In Progress'))
    assert.match(message, /ESP-28/)
    assert.match(message, /timed out after 20 ms/)
    assert.equal(calls.length, 1)
  })

  for (const [status, body, cause] of [
    [401, null, /HTTP 401$/],
    [404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] }, /HTTP 404: Issue does not exist/],
    [500, { errorMessages: ['Internal server error'] }, /HTTP 500: Internal server error/],
  ]) {
    it(`should report HTTP ${status} with the issue key and Jira's message, sending nothing more`, async () => {
      const { fetch, calls } = stubFetch({ status, body }, { body: TRANSITIONS })
      const message = await failure(() => client(fetch).transitionTo('ESP-28', 'In Progress'))
      assert.match(message, /ESP-28/)
      assert.match(message, cause)
      assert.equal(calls.length, 1)
    })
  }

  it('should fail on an unmatched status name before sending a transition', async () => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS }, { status: 204 })
    const message = await failure(() => client(fetch).transitionTo('ESP-28', 'Shipped'))
    assert.match(message, /ESP-28/)
    assert.match(message, /no transition to status "Shipped"/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
  })

  it('should never put the token in an error message', async () => {
    const { fetch } = stubFetch({ status: 401 })
    assert.doesNotMatch(await failure(() => client(fetch).addComment('ESP-28', 'c')), /tok-123/)
  })
})

describe('createJiraClient trusted site (R11; AC12)', () => {
  const siteClient = (site, fetch, trustedSite) => createJiraClient({ site, email: 'me@example.test', token: 'tok-123', trustedSite, fetch })

  for (const [name, site, trustedSite, cause] of [
    ['another host', 'https://evil.example.com', undefined, /host "evil\.example\.com" is not trusted/],
    ['a look-alike host', 'https://usiatech.atlassian.net.evil.com', undefined, /is not trusted/],
    ['the bare atlassian.net host', 'https://atlassian.net', undefined, /is not trusted/],
    ['a host that only ends in the letters atlassian.net', 'https://evilatlassian.net', undefined, /host "evilatlassian\.net" is not trusted/],
    ['a user name', 'https://me@usiatech.atlassian.net', undefined, /user name, password, port, path, query or fragment/],
    ['a port', 'https://usiatech.atlassian.net:8443', undefined, /user name, password, port, path, query or fragment/],
    ['a path', 'https://usiatech.atlassian.net/jira', undefined, /user name, password, port, path, query or fragment/],
    ['a plain-http site', 'http://usiatech.atlassian.net', undefined, /https/],
    ['a host other than JIRA_SITE', 'https://usiatech.atlassian.net', 'https://jira.example.test', /does not match JIRA_SITE/],
  ]) {
    it(`should refuse ${name} and send nothing`, async () => {
      const { fetch, calls } = stubFetch({ status: 201 })
      const message = await failure(() => siteClient(site, fetch, trustedSite).addComment('ESP-28', 'c'))
      assert.match(message, /ESP-28/)
      assert.match(message, cause)
      assert.equal(calls.length, 0)
    })
  }

  it('should accept a site on the JIRA_SITE host, ignoring case and a trailing slash', async () => {
    const { fetch, calls } = stubFetch({ status: 201 })
    await siteClient('https://Jira.Example.test/', fetch, 'https://jira.example.test').addComment('ESP-28', 'c')
    assert.equal(calls[0].url, 'https://jira.example.test/rest/api/2/issue/ESP-28/comment')
  })

  it('should send every request without following redirects and with an abort signal', async () => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS }, { status: 204 })
    await client(fetch).transitionTo('ESP-28', 'In Progress')
    assert.deepEqual(calls.map((c) => c.redirect), ['manual', 'manual'])
    assert.ok(calls.every((c) => c.signal instanceof AbortSignal))
  })

  it('should treat a redirect response as a failure', async () => {
    const { fetch, calls } = stubFetch({ status: 302 })
    const message = await failure(() => client(fetch).addComment('ESP-28', 'c'))
    assert.match(message, /HTTP 302/)
    assert.match(message, /redirects are not followed/)
    assert.equal(calls.length, 1)
  })
})

const SCRIPT = fileURLToPath(new URL('../scripts/jira-tracker.mjs', import.meta.url))
// 16 characters or more: shorter tokens are not redacted (ESP-78 F17).
const CLI_TOKEN = 'tok-SECRET-123456'
const CLI_ENV = { JIRA_EMAIL: 'me@example.test', JIRA_API_TOKEN: CLI_TOKEN }
const CLI_BASIC = Buffer.from(`${CLI_ENV.JIRA_EMAIL}:${CLI_TOKEN}`).toString('base64')

// A temp repo with a tickets config and a body file; removed after the test.
const cliRepo = (t, tickets = jira()) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jira-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, '.claude'))
  writeFileSync(path.join(dir, '.claude', 'engineering.json'), JSON.stringify({ tickets }))
  writeFileSync(path.join(dir, 'body.txt'), 'Body text\n')
  writeFileSync(path.join(dir, 'messages.txt'), 'feat: helper (ESP-30)\n\nRefs ESP-27 and ABC-9\n')
  return dir
}

// Every file under `dir` with its content, to show what a run wrote.
const filesIn = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true })
  .map((rel) => String(rel).replace(/\\/g, '/'))
  .filter((rel) => statSync(path.join(dir, rel)).isFile())
  .sort()
  .map((rel) => [rel, readFileSync(path.join(dir, rel), 'utf8')]))

// The JSON a successful run printed; fails when the run printed nothing.
const printed = (result) => {
  assert.notEqual(result.stdout, '', `nothing on stdout; stderr: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

// One call of every command, with the replies it needs to succeed.
const CLI_COMMANDS = [
  { args: ['check'], replies: [] },
  { args: ['create', '--summary', 'Do a thing', '--body-file', 'body.txt'], replies: [{ status: 201, body: { key: 'ESP-61' } }] },
  { args: ['link', '--blocker', 'ESP-28', '--blocked', 'ESP-29'], replies: [{ status: 201 }] },
  { args: ['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], replies: [{ status: 201, body: { id: '9' } }] },
  { args: ['find-transition', '--issue', 'ESP-22', '--event', 'merged'], replies: [{ body: TRANSITIONS }] },
  { args: ['transition', '--issue', 'ESP-28', '--status', 'in progress'], replies: [{ body: TRANSITIONS }, { status: 204 }] },
  { args: ['keys', '--messages-file', 'messages.txt'], replies: [] },
]

// Commands that never call Jira: they succeed even when the site is not trusted.
const LOCAL_COMMANDS = ['check', 'keys']

describe('runCli commands (R3)', () => {
  it('should print the checked config for check and send nothing', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['check'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), validateTicketsConfig(jira()).tickets)
    assert.equal(calls.length, 0)
  })

  it('should create an issue from the config, the summary and the body file, and print its key', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-61' } })
    const result = await runCli(['create', '--summary', 'Do a thing', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { key: 'ESP-61' })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].body, { fields: { project: { key: 'ESP' }, issuetype: { name: 'Subtask' }, summary: 'Do a thing', description: 'Body text', parent: { key: 'ESP-27' } } })
  })

  it('should let --parent replace the configured parent', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-62' } })
    const result = await runCli(['create', '--summary', 'S', '--body-file', 'body.txt', '--parent', 'ESP-8'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].body.fields.parent, { key: 'ESP-8' })
  })

  it('should read the config from the --config path', async (t) => {
    const dir = cliRepo(t)
    writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ tickets: jira({ project: 'OPS' }) }))
    const { fetch } = stubFetch()
    const result = await runCli(['check', '--config', 'other.json'], { env: CLI_ENV, fetch, cwd: dir })
    assert.equal(printed(result).jira.project, 'OPS')
  })

  it('should link a blocker to the issue it blocks', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201 })
    const result = await runCli(['link', '--blocker', 'ESP-28', '--blocked', 'ESP-29'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { blocker: 'ESP-28', blocked: 'ESP-29' })
    assert.deepEqual(calls[0].body, { type: { name: 'Blocks' }, inwardIssue: { key: 'ESP-28' }, outwardIssue: { key: 'ESP-29' } })
  })

  it('should comment with the body file text', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { id: '9' } })
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-28', commented: true })
    assert.equal(calls[0].url, `${API}/issue/ESP-28/comment`)
    assert.deepEqual(calls[0].body, { body: 'Body text' })
  })

  it('should look up the transition for an event without changing the issue', async (t) => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS })
    const result = await runCli(['find-transition', '--issue', 'ESP-22', '--event', 'merged'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-22', status: 'Ready for Release', transitionId: '41' })
    assert.deepEqual(calls.map((c) => c.method), ['GET'])
  })

  it('should fail a transition lookup that finds no transition, naming the issue and the status', async (t) => {
    const { fetch } = stubFetch({ body: TRANSITIONS })
    const result = await runCli(['find-transition', '--issue', 'ESP-22', '--status', 'Done'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /ESP-22/)
    assert.match(result.stderr, /no transition to status "Done"/)
  })

  it('should move an issue to a status given by name', async (t) => {
    const { fetch, calls } = stubFetch({ body: TRANSITIONS }, { status: 204 })
    const result = await runCli(['transition', '--issue', 'ESP-28', '--status', 'in progress'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-28', status: 'in progress', transitioned: true })
    assert.deepEqual(calls[1].body, { transition: { id: '21' } })
  })

  it('should skip a transition for an event with no configured status, sending nothing', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['transition', '--issue', 'ESP-28', '--event', 'released'], { env: CLI_ENV, fetch, cwd: cliRepo(t, jira({ statuses: { started: 'In Progress' } })) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-28', event: 'released', transitioned: false, reason: 'no status is configured for "released"' })
    assert.equal(calls.length, 0)
  })

  it('should move an issue to the verified status through the matching transition (ESP-64)', async (t) => {
    const transitions = { transitions: [{ id: '51', name: 'Test it', to: { name: 'In Testing' } }] }
    const { fetch, calls } = stubFetch({ body: transitions }, { status: 204 })
    const config = jira({ statuses: { started: 'In Progress', verified: 'In Testing' } })
    const result = await runCli(['transition', '--issue', 'ESP-64', '--event', 'verified'], { env: CLI_ENV, fetch, cwd: cliRepo(t, config) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-64', status: 'In Testing', transitioned: true })
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST'])
    assert.deepEqual(calls[1].body, { transition: { id: '51' } })
  })

  it('should skip a transition to verified when no verified status is configured, sending nothing (ESP-64)', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['transition', '--issue', 'ESP-64', '--event', 'verified'], { env: CLI_ENV, fetch, cwd: cliRepo(t, jira({ statuses: { started: 'In Progress' } })) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { issue: 'ESP-64', event: 'verified', transitioned: false, reason: 'no status is configured for "verified"' })
    assert.equal(calls.length, 0)
  })
})

describe('runCli keys (R7; AC7)', () => {
  it('should print the project and the keys found in the messages file, and send nothing', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['keys', '--messages-file', 'messages.txt'], { env: {}, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { project: 'ESP', keys: ['ESP-30', 'ESP-27'] })
    assert.equal(calls.length, 0)
  })

  it('should take the project from the config', async (t) => {
    const result = await runCli(['keys', '--messages-file', 'messages.txt'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, jira({ project: 'ABC' })) })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { project: 'ABC', keys: ['ABC-9'] })
  })

  it('should print no keys for an empty messages file', async (t) => {
    const dir = cliRepo(t)
    writeFileSync(path.join(dir, 'none.txt'), '')
    const result = await runCli(['keys', '--messages-file', 'none.txt'], { env: {}, fetch: stubFetch().fetch, cwd: dir })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(printed(result), { project: 'ESP', keys: [] })
  })

  it('should exit 2 when --messages-file is missing or cannot be read', async (t) => {
    const dir = cliRepo(t)
    const missing = await runCli(['keys'], { env: {}, fetch: stubFetch().fetch, cwd: dir })
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /--messages-file is required/)
    const absent = await runCli(['keys', '--messages-file', 'nope.txt'], { env: {}, fetch: stubFetch().fetch, cwd: dir })
    assert.equal(absent.code, 2)
    assert.match(absent.stderr, /cannot read --messages-file nope\.txt/)
    assert.equal(absent.stdout, '')
  })

  it('should exit 2 when the tracker is not Jira', async (t) => {
    const result = await runCli(['keys', '--messages-file', 'messages.txt'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, { tracker: 'github' }) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.tracker" is "github"/)
  })
})

describe('runCli failures (R4; AC4)', () => {
  it('should exit 1 on a Jira failure with the issue and the cause on stderr and nothing on stdout', async (t) => {
    const { fetch, calls } = stubFetch({ status: 404, body: { errorMessages: ['Issue does not exist'] } })
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /comment on ESP-28 failed: HTTP 404: Issue does not exist/)
    assert.equal(calls.length, 1)
  })

  for (const [name, args, cause] of [
    ['no command', [], /usage/i],
    ['an unknown command', ['delete', '--issue', 'ESP-28'], /unknown command "delete"/],
    ['a command named like a built-in property', ['toString'], /unknown command "toString"/],
    ['an option named like a built-in property', ['check', '--constructor', 'x'], /unknown option --constructor/],
    ['an unknown option', ['check', '--token', 'x'], /--token/],
    ['a create without a summary', ['create', '--body-file', 'body.txt'], /--summary/],
    ['a create without a body file', ['create', '--summary', 'S'], /--body-file/],
    ['a body file that does not exist', ['comment', '--issue', 'ESP-28', '--body-file', 'missing.txt'], /missing\.txt/],
    ['a malformed issue key', ['comment', '--issue', 'esp28', '--body-file', 'body.txt'], /--issue/],
    ['a malformed parent', ['create', '--summary', 'S', '--body-file', 'body.txt', '--parent', 'ESP'], /--parent/],
    ['a link without the blocked issue', ['link', '--blocker', 'ESP-28'], /--blocked/],
    ['a transition with neither a status nor an event', ['transition', '--issue', 'ESP-28'], /--status or --event/],
    ['a transition with both a status and an event', ['transition', '--issue', 'ESP-28', '--status', 'Done', '--event', 'merged'], /--status or --event/],
    ['an unknown event', ['transition', '--issue', 'ESP-28', '--event', 'shipped'], /"shipped"/],
    ['a config file that does not exist', ['check', '--config', 'nowhere.json'], /nowhere\.json/],
  ]) {
    it(`should exit 2 on ${name} and send nothing`, async (t) => {
      const { fetch, calls } = stubFetch()
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: cliRepo(t) })
      assert.equal(result.code, 2)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, cause)
      assert.equal(calls.length, 0)
    })
  }

  it('should accept an option value that starts with dashes when it is given as --option=value', async (t) => {
    const { fetch, calls } = stubFetch({ status: 201, body: { key: 'ESP-63' } })
    const result = await runCli(['create', '--summary=--token is refused', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].body.fields.summary, '--token is refused')
  })

  it('should never print the value typed after an unknown option', async (t) => {
    for (const args of [['check', '--token', 'tok-typed'], ['check', '--token=tok-typed'], ['check', '--summary', 'S', '-tok-typed']]) {
      const { fetch } = stubFetch()
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: cliRepo(t) })
      assert.equal(result.code, 2, args.join(' '))
      assert.equal(result.stderr.includes('tok-typed'), false, args.join(' '))
    }
  })

  it('should exit 2 on an empty body file', async (t) => {
    const dir = cliRepo(t)
    writeFileSync(path.join(dir, 'body.txt'), ' \n')
    const { fetch, calls } = stubFetch()
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: dir })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /body\.txt.*empty/)
    assert.equal(calls.length, 0)
  })

  it('should exit 2 on a config problem, naming the key', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t, jira({ project: 'esp' })) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.jira\.project"/)
    assert.equal(calls.length, 0)
  })

  it('should exit 2 on a config that is not JSON', async (t) => {
    const dir = cliRepo(t)
    writeFileSync(path.join(dir, '.claude', 'engineering.json'), '{ nope')
    const { fetch } = stubFetch()
    const result = await runCli(['check'], { env: CLI_ENV, fetch, cwd: dir })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /engineering\.json could not be parsed/)
  })

  it('should exit 2 on check when the config has a misspelt statuses key', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['check'], { env: CLI_ENV, fetch, cwd: cliRepo(t, jira({ statuses: undefined, statues: { started: 'In Progress' } })) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.jira\.statues"/)
    assert.equal(calls.length, 0)
  })

  it('should exit 2 when the tracker is GitHub and a Jira command is asked for', async (t) => {
    const { fetch, calls } = stubFetch()
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: CLI_ENV, fetch, cwd: cliRepo(t, { tracker: 'github' }) })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.tracker" is "github"/)
    assert.equal(calls.length, 0)
  })
})

describe('runCli token handling (R2; AC2)', () => {
  it('should keep the token out of stdout, stderr and every file when each command succeeds', async (t) => {
    for (const { args, replies } of CLI_COMMANDS) {
      const dir = cliRepo(t)
      const before = filesIn(dir)
      const { fetch, calls } = stubFetch(...replies)
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: dir })
      assert.equal(result.code, 0, `${args[0]}: ${result.stderr}`)
      assert.equal(calls.length, replies.length, args[0])
      assert.equal(calls.every((c) => c.headers.Authorization === `Basic ${CLI_BASIC}`), true, args[0])
      assert.notEqual(result.stdout, '', args[0])
      for (const secret of [CLI_TOKEN, CLI_BASIC]) assert.equal((result.stdout + result.stderr).includes(secret), false, `${args[0]} printed the token`)
      assert.deepEqual(filesIn(dir), before, `${args[0]} wrote a file`)
    }
  })

  it('should keep the token out of the output when Jira echoes the credentials back in an error', async (t) => {
    for (const { args } of CLI_COMMANDS.filter((c) => c.replies.length)) {
      const { fetch } = stubFetch({ status: 401, body: { errorMessages: [`bad credentials: Basic ${CLI_BASIC} for token ${CLI_TOKEN}`] } })
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: cliRepo(t) })
      assert.equal(result.code, 1, args[0])
      assert.match(result.stderr, /HTTP 401: bad credentials/)
      for (const secret of [CLI_TOKEN, CLI_BASIC]) assert.equal((result.stdout + result.stderr).includes(secret), false, `${args[0]} printed the token`)
    }
  })

  it('should take the token from the environment only: a token in the config file is an unknown key', async (t) => {
    const { fetch, calls } = stubFetch()
    const dir = cliRepo(t, jira({ token: CLI_TOKEN, email: 'me@example.test' }))
    const result = await runCli(['comment', '--issue', 'ESP-28', '--body-file', 'body.txt'], { env: { JIRA_EMAIL: 'me@example.test' }, fetch, cwd: dir })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /"tickets\.jira\.token" is not a known key/)
    assert.equal((result.stdout + result.stderr).includes(CLI_TOKEN), false, 'printed the token')
    assert.equal(calls.length, 0)
  })

  it('should keep the token out of the output and write no file when run as a script', (t) => {
    // The site is not a trusted host, so every Jira command stops before a request: no network is touched.
    const dir = cliRepo(t, jira({ site: 'https://jira.example.test' }))
    const before = filesIn(dir)
    for (const { args } of CLI_COMMANDS) {
      const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env: { ...process.env, ...CLI_ENV, JIRA_SITE: '' }, encoding: 'utf8' })
      assert.equal(run.status, LOCAL_COMMANDS.includes(args[0]) ? 0 : 1, `${args[0]}: ${run.stderr}`)
      if (args[0] === 'check') assert.equal(printed(run).jira.site, 'https://jira.example.test')
      else if (args[0] === 'keys') assert.deepEqual(printed(run), { project: 'ESP', keys: ['ESP-30', 'ESP-27'] })
      else assert.match(run.stderr, /site host "jira\.example\.test" is not trusted/)
      for (const secret of [CLI_TOKEN, CLI_BASIC]) assert.equal((run.stdout + run.stderr).includes(secret), false, `${args[0]} printed the token`)
    }
    assert.deepEqual(filesIn(dir), before)
  })

  it('should still run when the script is reached through a linked folder', (t) => {
    const dir = cliRepo(t)
    const link = path.join(dir, 'linked')
    symlinkSync(path.dirname(SCRIPT), link, 'junction')
    try {
      const run = spawnSync(process.execPath, [path.join(link, 'jira-tracker.mjs'), 'check'], { cwd: dir, env: { ...process.env, ...CLI_ENV }, encoding: 'utf8' })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(printed(run).tracker, 'jira')
    } finally {
      unlinkSync(link)
    }
  })
})

describe('runCli audit fixes (ESP-78)', () => {
  it('should refuse in check a site with a path, port, user name, query or fragment (F13)', async (t) => {
    for (const site of ['https://x.atlassian.net/jira', 'https://x.atlassian.net:8443', 'https://me@x.atlassian.net', 'https://x.atlassian.net?a=1', 'https://x.atlassian.net#top']) {
      const result = await runCli(['check'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, jira({ site })) })
      assert.equal(result.code, 2, `${site}: ${result.stdout}${result.stderr}`)
      assert.match(result.stderr, /"tickets\.jira\.site".*user name, password, port, path, query or fragment/, site)
    }
    for (const site of ['https://x.atlassian.net', 'https://x.atlassian.net/']) {
      const result = await runCli(['check'], { env: {}, fetch: stubFetch().fetch, cwd: cliRepo(t, jira({ site })) })
      assert.equal(result.code, 0, `${site}: ${result.stderr}`)
    }
  })

  it('should refuse a UTF-16 messages or body file as a usage error, before any request (F14)', async (t) => {
    const dir = cliRepo(t)
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('feat: x (ESP-12)\n', 'utf16le')])
    writeFileSync(path.join(dir, 'utf16.txt'), utf16)
    const { fetch, calls } = stubFetch()
    for (const args of [['keys', '--messages-file', 'utf16.txt'], ['comment', '--issue', 'ESP-1', '--body-file', 'utf16.txt']]) {
      const result = await runCli(args, { env: CLI_ENV, fetch, cwd: dir })
      assert.equal(result.code, 2, `${args[0]}: ${result.stdout}${result.stderr}`)
      assert.match(result.stderr, /not UTF-8; regenerate from a POSIX shell/, args[0])
    }
    assert.equal(calls.length, 0)
  })

  it('should leave the output unchanged when the token is shorter than 16 characters (F17)', async (t) => {
    const result = await runCli(['check'], { env: { JIRA_EMAIL: 'me@example.test', JIRA_API_TOKEN: 't' }, fetch: stubFetch().fetch, cwd: cliRepo(t) })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(printed(result).tracker, 'jira')
  })
})
