import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { advisoryFindings, registryFindings, lookupTargets, runLookups, createLookups, LOOKUP } from '../templates/github/scripts/supply-chain-lookups.mjs'

const NOW = Date.parse('2026-09-29T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const yearsAgo = (years, days = 0) => {
  const d = new Date(NOW)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return new Date(d.getTime() - days * DAY).toISOString()
}

const target = (over = {}) => ({ name: 'left-pad', version: '1.3.0', direct: true, file: 'package.json', line: 4, ...over })
const manifest = (deps) => JSON.stringify({ name: 'app', dependencies: deps }, null, 2)
const found = (over = {}) => ({ found: true, version: '1.3.0', deprecated: null, latestTime: yearsAgo(0, 30), scripts: {}, ...over })
const rules = (findings) => findings.map((f) => `${f.rule}:${f.tier}`).sort()

describe('advisoryFindings (R3; AC3)', () => {
  const advisories = (severity) => ({ 'left-pad': [{ id: 1, severity, title: `A ${severity} issue`, url: 'https://example.test/1', vulnerable_versions: '<2.0.0' }] })

  it('should give a high-risk finding for a critical or high advisory', () => {
    assert.deepEqual(rules(advisoryFindings({ targets: [target()], advisories: advisories('critical') })), ['sc-advisory:high'])
    assert.deepEqual(rules(advisoryFindings({ targets: [target()], advisories: advisories('high') })), ['sc-advisory:high'])
  })

  it('should give a warning for a moderate or low advisory', () => {
    assert.deepEqual(rules(advisoryFindings({ targets: [target()], advisories: advisories('moderate') })), ['sc-advisory:warning'])
    assert.deepEqual(rules(advisoryFindings({ targets: [target()], advisories: advisories('low') })), ['sc-advisory:warning'])
  })

  it('should give no finding when there are no advisories', () => {
    assert.deepEqual(advisoryFindings({ targets: [target()], advisories: {} }), [])
    assert.deepEqual(advisoryFindings({ targets: [target()], advisories: { 'left-pad': [] } }), [])
  })

  it('should use the most severe advisory, and name the package, file and line', () => {
    const mixed = { 'left-pad': [{ id: 1, severity: 'low', title: 'Minor' }, { id: 2, severity: 'critical', title: 'Remote code execution' }] }
    const [f] = advisoryFindings({ targets: [target()], advisories: mixed })
    assert.equal(f.tier, 'high')
    assert.equal(f.package, 'left-pad')
    assert.equal(f.file, 'package.json')
    assert.equal(f.line, 4)
    assert.match(f.detail, /2 known advisories/)
    assert.match(f.detail, /Remote code execution/)
  })
})

describe('registryFindings (R4, R5, D9; AC4)', () => {
  it('should warn about a deprecated version', () => {
    assert.deepEqual(rules(registryFindings({ target: target(), result: found({ deprecated: 'use something else' }), now: NOW })), ['sc-deprecated:warning'])
  })

  it('should warn when the latest release is 2 years and 1 day old, and not at 2 years minus 1 day', () => {
    assert.deepEqual(rules(registryFindings({ target: target(), result: found({ latestTime: yearsAgo(2, 1) }), now: NOW })), ['sc-stale:warning'])
    assert.deepEqual(registryFindings({ target: target(), result: found({ latestTime: yearsAgo(2, -1) }), now: NOW }), [])
  })

  it('should warn when the latest release date is missing or unreadable instead of skipping the staleness check', () => {
    for (const latestTime of [null, undefined, 'not a date']) {
      const findings = registryFindings({ target: target(), result: found({ latestTime }), now: NOW })
      assert.deepEqual(rules(findings), ['sc-stale:warning'], String(latestTime))
      assert.match(findings[0].detail, /release date is unknown/)
    }
  })

  it('should warn about preinstall, install or postinstall scripts', () => {
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      const [f, ...rest] = registryFindings({ target: target(), result: found({ scripts: { [hook]: 'node build.js', test: 'jest' } }), now: NOW })
      assert.equal(rest.length, 0)
      assert.equal(`${f.rule}:${f.tier}`, 'sc-install-script:warning')
      assert.match(f.detail, new RegExp(hook))
    }
    assert.deepEqual(registryFindings({ target: target(), result: found({ scripts: { test: 'jest', prepare: 'tsc' } }), now: NOW }), [])
  })

  it('should warn that a package missing from the registry may be dependency confusion', () => {
    const [f] = registryFindings({ target: target({ name: 'acme-internal-utils' }), result: { found: false }, now: NOW })
    assert.equal(`${f.rule}:${f.tier}`, 'sc-not-found:warning')
    assert.match(f.detail, /dependency confusion/)
  })

  it('should give no finding for a current, maintained package without install scripts', () => {
    assert.deepEqual(registryFindings({ target: target(), result: found(), now: NOW }), [])
  })
})

describe('lookupTargets (D4, D5, D9)', () => {
  it('should look up the exact lockfile version of a manifest dependency changed in the same change', () => {
    const targets = lookupTargets([
      { file: 'package.json', content: manifest({ express: '^4.18.0' }), base: manifest({}) },
      { file: 'package-lock.json', content: JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/express': { version: '4.21.2' } } }), base: JSON.stringify({ lockfileVersion: 3, packages: { '': {} } }) },
    ])
    assert.deepEqual(targets.map((t) => [t.name, t.version, t.direct, t.file]), [['express', '4.21.2', true, 'package.json']])
  })

  it('should fall back to the base version of a range, and to null (dist-tags.latest) for an open range', () => {
    const targets = lookupTargets([{ file: 'package.json', content: manifest({ a: '^1.2.3', b: '~2.0.1', c: '*', d: 'latest', e: '>=1.0.0' }), base: null }])
    assert.deepEqual(targets.map((t) => [t.name, t.version]), [['a', '1.2.3'], ['b', '2.0.1'], ['c', null], ['d', null], ['e', '1.0.0']])
  })

  it('should skip non-registry specifiers', () => {
    const targets = lookupTargets([{ file: 'package.json', content: manifest({ a: 'workspace:*', b: 'file:../b', c: 'github:o/r', d: '1.0.0' }), base: null }])
    assert.deepEqual(targets.map((t) => t.name), ['d'])
  })

  it('should mark only added manifest dependencies as direct, so changed ranges get advisories but not registry lookups', () => {
    const targets = lookupTargets([{ file: 'package.json', content: manifest({ kept: '^2.0.0', added: '1.0.0' }), base: manifest({ kept: '^1.0.0' }) }])
    assert.deepEqual(targets.map((t) => [t.name, t.direct]), [['added', true], ['kept', false]])
  })

  it('should include lockfile-only entries as indirect with their exact versions, and skip files that do not parse', () => {
    const targets = lookupTargets([
      { file: 'package-lock.json', content: JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/ms': { version: '2.1.3' } } }), base: null },
      { file: 'apps/x/package.json', content: '{ not json', base: null },
    ])
    assert.deepEqual(targets.map((t) => [t.name, t.version, t.direct, t.file]), [['ms', '2.1.3', false, 'package-lock.json']])
  })

  it('should skip lockfile entries whose version is a git or URL source', () => {
    const lock = "lockfileVersion: '9.0'\n\npackages:\n\n  gh@git+https://github.com/a/b.git#abc123:\n    resolution: {commit: abc123, repo: https://github.com/a/b.git, type: git}\n\n  ms@2.1.3:\n    resolution: {integrity: sha512-x}\n"
    const targets = lookupTargets([{ file: 'pnpm-lock.yaml', content: lock, base: null }])
    assert.deepEqual(targets.map((t) => t.name), ['ms'])
  })

  it('should not let a non-registry lockfile version replace the manifest lookup version (fix set 3)', () => {
    const base = "lockfileVersion: '9.0'\n\npackages:\n\n  express@4.19.2:\n    resolution: {integrity: sha512-c}\n"
    const lock = `${base}\n  lodash@https://example.com/x.tgz:\n    resolution: {integrity: sha512-x, tarball: https://example.com/x.tgz}\n    version: 4.17.20\n`
    const targets = lookupTargets([
      { file: 'package.json', content: manifest({ express: '^4.19.0', lodash: '^4.17.0' }), base: manifest({ express: '^4.19.0' }) },
      { file: 'pnpm-lock.yaml', content: lock, base },
    ])
    assert.deepEqual(targets.map((t) => `${t.name}@${t.version}`), ['lodash@4.17.0'])
  })
})

describe('runLookups (R13, R14, D5; AC3, AC11)', () => {
  const stubs = (over = {}) => ({
    registry: async (name, version) => found({ version: version ?? '9.9.9' }),
    advisories: async () => ({}),
    ...over,
  })

  it('should turn stub results into findings and report no failures', async () => {
    const { findings, failures } = await runLookups({
      targets: [target()],
      lookups: stubs({ advisories: async () => ({ 'left-pad': [{ id: 1, severity: 'high', title: 'Bad' }] }), registry: async () => found({ deprecated: 'old' }) }),
      now: NOW,
    })
    assert.deepEqual(failures, [])
    assert.deepEqual(rules(findings), ['sc-advisory:high', 'sc-deprecated:warning'])
  })

  it('should send every versioned target in one advisory request, using the registry latest for open ranges', async () => {
    const calls = []
    await runLookups({
      targets: [target({ name: 'a', version: null }), target({ name: 'b', version: '2.0.0', direct: false }), target({ name: 'b', version: '2.0.0', direct: false, file: 'yarn.lock' })],
      lookups: stubs({ advisories: async (entries) => { calls.push(entries); return {} } }),
      now: NOW,
    })
    assert.deepEqual(calls, [{ a: ['9.9.9'], b: ['2.0.0'] }])
  })

  it('should only run registry lookups for direct dependencies', async () => {
    const looked = []
    await runLookups({ targets: [target({ name: 'a' }), target({ name: 'b', direct: false })], lookups: stubs({ registry: async (name) => { looked.push(name); return found() } }), now: NOW })
    assert.deepEqual(looked, ['a'])
  })

  it('should report a failed lookup by name and still return the other lookup findings', async () => {
    const { findings, failures } = await runLookups({
      targets: [target()],
      lookups: stubs({ advisories: async () => { throw new Error('HTTP 503') }, registry: async () => found({ deprecated: 'old' }) }),
      now: NOW,
    })
    assert.deepEqual(failures.map((f) => f.lookup), [LOOKUP.ADVISORIES])
    assert.match(failures[0].reason, /HTTP 503/)
    assert.deepEqual(rules(findings), ['sc-deprecated:warning'])
  })

  it('should report one registry failure however many registry lookups fail', async () => {
    const { failures } = await runLookups({
      targets: [target({ name: 'a' }), target({ name: 'b' }), target({ name: 'c' })],
      lookups: stubs({ registry: async () => { throw new Error('ECONNRESET') } }),
      now: NOW,
    })
    assert.deepEqual(failures.map((f) => f.lookup), [LOOKUP.REGISTRY])
    assert.match(failures[0].reason, /3 of 3/)
  })

  // The test's own timeout turns a hang (no deadline) into a failure.
  it('should give up at the deadline when a lookup never resolves, and abort the signal', { timeout: 2000 }, async () => {
    let seen
    const started = Date.now()
    const { failures } = await runLookups({
      targets: [target()],
      lookups: stubs({ registry: (name, version, { signal }) => { seen = signal; return new Promise(() => {}) } }),
      deadlineMs: 50,
      now: NOW,
    })
    assert.ok(Date.now() - started < 1000, 'returned well within the hook timeout')
    assert.ok(seen.aborted, 'the lookup signal is aborted at the deadline')
    assert.deepEqual(failures.map((f) => f.lookup).sort(), [LOOKUP.ADVISORIES, LOOKUP.REGISTRY])
    assert.match(failures[0].reason, /timed out after 50 ms/)
  })

  it('should run at most 8 registry lookups at once', async () => {
    let active = 0
    let peak = 0
    const registry = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      return found()
    }
    const targets = Array.from({ length: 20 }, (_, i) => target({ name: `pkg-${i}` }))
    const { failures } = await runLookups({ targets, lookups: stubs({ registry }), now: NOW })
    assert.deepEqual(failures, [])
    assert.equal(peak, 8)
  })

  it('should make no calls when there is nothing to look up', async () => {
    const lookups = { registry: async () => assert.fail('no registry call'), advisories: async () => assert.fail('no advisory call') }
    assert.deepEqual(await runLookups({ targets: [], lookups, now: NOW }), { findings: [], failures: [] })
  })
})

describe('createLookups (D1, D2)', () => {
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

  it('should POST the bulk advisory body to the npm advisory endpoint', async () => {
    let request
    const lookups = createLookups({ fetch: async (url, init) => { request = { url, init }; return response(200, { a: [] }) } })
    assert.deepEqual(await lookups.advisories({ a: ['1.0.0'] }, { signal: new AbortController().signal }), { a: [] })
    assert.equal(request.url, 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk')
    assert.equal(request.init.method, 'POST')
    assert.deepEqual(JSON.parse(request.init.body), { a: ['1.0.0'] })
  })

  it('should read deprecation, latest release time and scripts from the full packument, encoding scoped names', async () => {
    let url
    const packument = {
      'dist-tags': { latest: '2.0.0' },
      time: { '1.0.0': '2020-01-01T00:00:00Z', '2.0.0': '2025-01-01T00:00:00Z' },
      versions: { '1.0.0': { deprecated: 'use 2', scripts: { postinstall: 'x' } }, '2.0.0': {} },
    }
    const lookups = createLookups({ fetch: async (u) => { url = u; return response(200, packument) } })
    const signal = new AbortController().signal
    assert.deepEqual(await lookups.registry('@acme/tool', '1.0.0', { signal }), { found: true, version: '1.0.0', deprecated: 'use 2', latestTime: '2025-01-01T00:00:00Z', scripts: { postinstall: 'x' } })
    assert.equal(url, 'https://registry.npmjs.org/@acme%2Ftool')
    assert.equal((await lookups.registry('@acme/tool', null, { signal })).version, '2.0.0')
  })

  it('should treat a 404 as not found, and any other error status as a failure', async () => {
    const signal = new AbortController().signal
    assert.deepEqual(await createLookups({ fetch: async () => response(404, {}) }).registry('nope-pkg', '1.0.0', { signal }), { found: false })
    await assert.rejects(createLookups({ fetch: async () => response(429, {}) }).registry('a-pkg', '1.0.0', { signal }), /HTTP 429/)
    await assert.rejects(createLookups({ fetch: async () => response(500, {}) }).advisories({ a: ['1.0.0'] }, { signal }), /HTTP 500/)
  })

  it('should refuse a name that is not a valid npm package name, without calling fetch', async () => {
    const lookups = createLookups({ fetch: async () => assert.fail('fetch must not be called') })
    await assert.rejects(lookups.registry('../../evil', '1.0.0', { signal: new AbortController().signal }), /invalid package name/)
  })

  it('should abort a request that runs past its own timeout', async () => {
    const lookups = createLookups({
      timeoutMs: 20,
      fetch: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    })
    await assert.rejects(lookups.registry('slow-pkg', '1.0.0', { signal: new AbortController().signal }), /aborted/)
  })
})

describe('lookups: package names and versions that shadow Object.prototype (F2)', () => {
  it('should look up packages named constructor and __proto__ without throwing', async () => {
    let sent
    const lookups = { registry: async () => found(), advisories: async (entries) => { sent = JSON.parse(JSON.stringify(entries)); return {} } }
    const r = await runLookups({ targets: [target({ name: 'constructor', direct: false }), target({ name: '__proto__', direct: false })], lookups, now: NOW })
    assert.deepEqual(r, { findings: [], failures: [] })
    // Built with JSON.parse: in an object literal `__proto__:` sets the prototype instead of adding a key.
    assert.deepEqual(sent, JSON.parse('{ "constructor": ["1.3.0"], "__proto__": ["1.3.0"] }'))
  })

  it('should not read a version named __proto__ from the prototype of the registry versions map', async () => {
    const body = { 'dist-tags': { latest: '2.0.0' }, time: { '2.0.0': yearsAgo(0, 1) }, versions: { '2.0.0': { scripts: { postinstall: 'x' } } } }
    const fetch = async () => ({ ok: true, status: 200, json: async () => body })
    const result = await createLookups({ fetch }).registry('left-pad', '__proto__')
    assert.equal(result.version, '2.0.0')
    assert.deepEqual(result.scripts, { postinstall: 'x' })
  })
})

describe('lookups: a changed entry widened to an open range with no lockfile (F3)', () => {
  it('should resolve the latest version so the entry is still advised, without registry findings for it', async () => {
    const targets = lookupTargets([{ file: 'package.json', content: manifest({ lodash: 'latest' }), base: manifest({ lodash: '^4.17.0' }) }])
    const registryCalls = []
    let advised
    const lookups = {
      registry: async (name, version) => { registryCalls.push(`${name}@${version}`); return found({ version: '4.17.21', deprecated: 'old' }) },
      advisories: async (entries) => { advised = entries; return {} },
    }
    const r = await runLookups({ targets, lookups, now: NOW })
    assert.deepEqual(registryCalls, ['lodash@null'])
    assert.deepEqual({ ...advised }, { lodash: ['4.17.21'] })
    assert.deepEqual(r, { findings: [], failures: [] })
  })

  it('should keep the registry findings of a direct add when a widened entry has the same name (C)', async () => {
    const targets = [target({ name: 'left-pad', version: '1.3.0', direct: true }), target({ name: 'left-pad', version: null, direct: false, file: 'apps/b/package.json' })]
    const lookups = { registry: async (name, version) => found({ version: version ?? '1.3.0', deprecated: 'old' }), advisories: async () => ({}) }
    const r = await runLookups({ targets, lookups, now: NOW })
    assert.deepEqual(rules(r.findings), ['sc-deprecated:warning'])
  })
})
