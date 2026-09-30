import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dependencyKind, parseDependencies, diffDependencies, checkDependencies } from '../templates/github/scripts/supply-chain-rules.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'deps')
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
// The {name, version} pairs AC1 asks for, in a stable order.
const pairs = (changes) => changes.map((c) => `${c.name}@${c.version}`).sort()
const diff = (file, before, after) => {
  const result = diffDependencies({ file, content: fixture(after), base: before ? fixture(before) : null })
  assert.deepEqual(result.problems, [], `${after}: unexpected parse problems`)
  return result.changes
}

describe('dependencyKind (R1; D8)', () => {
  it('should recognise manifests and the three lockfile formats in any directory', () => {
    assert.equal(dependencyKind('package.json'), 'manifest')
    assert.equal(dependencyKind('apps/web/package.json'), 'manifest')
    assert.equal(dependencyKind('package-lock.json'), 'npm-lock')
    assert.equal(dependencyKind('pnpm-lock.yaml'), 'pnpm-lock')
    assert.equal(dependencyKind('packages/a/yarn.lock'), 'yarn-lock')
  })

  it('should ignore node_modules, other files and look-alike names', () => {
    assert.equal(dependencyKind('node_modules/express/package.json'), null)
    assert.equal(dependencyKind('apps/web/node_modules/x/package.json'), null)
    assert.equal(dependencyKind('package.json.bak'), null)
    assert.equal(dependencyKind('my-package.json'), null)
    assert.equal(dependencyKind('npm-shrinkwrap.json'), null)
    assert.equal(dependencyKind('src/index.js'), null)
  })

  it('should match file names case-insensitively, as the case-insensitive checkouts the gate allows for do', () => {
    assert.equal(dependencyKind('Package.JSON'), 'manifest')
    assert.equal(dependencyKind('Yarn.lock'), 'yarn-lock')
  })
})

describe('diffDependencies: package.json (R1; AC1)', () => {
  it('should list added and changed entries from all four dependency sections', () => {
    assert.deepEqual(pairs(diff('package.json', 'package.before.json', 'package.after.json')),
      ['@scope/util@2.0.0', 'express@^4.19.0', 'fsevents@^2.3.3', 'react@>=18', 'vitest@^1.6.0'])
  })

  it('should give the previous range for a changed entry and null for an added one', () => {
    const changes = diff('package.json', 'package.before.json', 'package.after.json')
    assert.equal(changes.find((c) => c.name === 'express').previous, '^4.18.2')
    assert.equal(changes.find((c) => c.name === 'vitest').previous, null)
    assert.equal(changes.find((c) => c.name === 'react').section, 'peerDependencies')
  })

  it('should give an empty list for a change that does not touch dependencies', () => {
    assert.deepEqual(diff('package.json', 'package.before.json', 'package.scripts-only.json'), [])
  })

  it('should treat every dependency as added when there is no base (a new file)', () => {
    assert.deepEqual(pairs(diff('package.json', null, 'package.before.json')), ['express@^4.18.2', 'lodash@^4.17.21', 'typescript@~5.4.0'])
  })
})

describe('diffDependencies: package-lock.json (R1; AC1)', () => {
  it('should list added and changed packages from a v2/v3 packages map, using the real name of an alias and skipping links', () => {
    assert.deepEqual(pairs(diff('package-lock.json', 'package-lock.before.json', 'package-lock.after.json')),
      ['@scope/util@2.0.0', 'express@4.19.2', 'lodash@4.17.21'])
    const changes = diff('package-lock.json', 'package-lock.before.json', 'package-lock.after.json')
    assert.equal(changes.find((c) => c.name === 'express').previous, '4.18.2')
  })

  it('should read the nested v1 dependencies tree', () => {
    assert.deepEqual(pairs(diff('package-lock.json', 'package-lock-v1.before.json', 'package-lock-v1.after.json')),
      ['@scope/util@2.0.0', 'ms@2.0.0'])
  })

  it('should give an empty list when the lockfile is unchanged', () => {
    assert.deepEqual(diff('package-lock.json', 'package-lock.before.json', 'package-lock.before.json'), [])
  })
})

describe('diffDependencies: pnpm-lock.yaml (R1; AC1)', () => {
  it('should read v9 package keys, including quoted scoped names, and drop peer suffixes', () => {
    assert.deepEqual(pairs(diff('pnpm-lock.yaml', 'pnpm-lock-v9.before.yaml', 'pnpm-lock-v9.after.yaml')),
      ['@scope/util@2.0.0', 'express@4.19.2', 'react-dom@18.3.1'])
  })

  it('should read v6 keys with a leading slash', () => {
    assert.deepEqual(pairs(diff('pnpm-lock.yaml', 'pnpm-lock-v6.before.yaml', 'pnpm-lock-v6.after.yaml')),
      ['@scope/util@2.0.0', 'react-dom@18.3.1'])
  })

  it('should read v5 name/version keys', () => {
    assert.deepEqual(pairs(diff('pnpm-lock.yaml', null, 'pnpm-lock-v5.after.yaml')),
      ['@scope/util@2.0.0', 'express@4.18.2', 'react-dom@18.3.1'])
  })

  it('should read CRLF line endings the same way', () => {
    const crlf = fixture('pnpm-lock-v9.after.yaml').replace(/\r?\n/g, '\r\n')
    const result = diffDependencies({ file: 'pnpm-lock.yaml', content: crlf, base: fixture('pnpm-lock-v9.before.yaml') })
    assert.deepEqual(result.problems, [])
    assert.deepEqual(pairs(result.changes), ['@scope/util@2.0.0', 'express@4.19.2', 'react-dom@18.3.1'])
  })
})

describe('diffDependencies: yarn.lock (R1; AC1)', () => {
  it('should read classic entries with several descriptors on one line', () => {
    assert.deepEqual(pairs(diff('yarn.lock', 'yarn-classic.before.lock', 'yarn-classic.after.lock')),
      ['@scope/util@2.0.0', 'express@4.19.2'])
  })

  it('should read classic entries whose descriptors are each quoted', () => {
    const content = '"@scope/util@^2.0.0", "@scope/util@^2.1.0":\n  version "2.1.0"\n'
    assert.deepEqual(pairs(diffDependencies({ file: 'yarn.lock', content }).changes), ['@scope/util@2.1.0'])
  })

  it('should read berry entries and skip the metadata block and workspace entries', () => {
    assert.deepEqual(pairs(diff('yarn.lock', 'yarn-berry.before.lock', 'yarn-berry.after.lock')),
      ['@scope/util@2.0.0', 'express@4.19.2'])
  })
})

describe('parseDependencies: unreadable files (fail closed)', () => {
  it('should report a problem, not an empty list, for invalid JSON', () => {
    assert.ok(parseDependencies({ file: 'package.json', content: '{ "dependencies": ' }).problems.length > 0)
    assert.ok(parseDependencies({ file: 'package-lock.json', content: 'not json' }).problems.length > 0)
  })

  it('should report a problem for a package-lock.json with neither packages nor dependencies', () => {
    assert.ok(parseDependencies({ file: 'package-lock.json', content: '{ "lockfileVersion": 3 }' }).problems.length > 0)
  })

  it('should report a problem for a pnpm-lock.yaml without a lockfileVersion', () => {
    assert.ok(parseDependencies({ file: 'pnpm-lock.yaml', content: 'packages:\n\n  express@4.18.2:\n    resolution: {}\n' }).problems.length > 0)
  })

  it('should report a problem for a yarn.lock entry with no version line', () => {
    assert.ok(parseDependencies({ file: 'yarn.lock', content: 'express@^4.18.2:\n  resolved "x"\n' }).problems.length > 0)
  })

  it('should report a problem for a dependency section that is not an object of strings', () => {
    assert.ok(parseDependencies({ file: 'package.json', content: '{ "dependencies": ["express"] }' }).problems.length > 0)
    assert.ok(parseDependencies({ file: 'package.json', content: '{ "dependencies": { "express": 4 } }' }).problems.length > 0)
  })

  it('should report base-version problems too, so a broken base cannot hide added dependencies', () => {
    const result = diffDependencies({ file: 'package.json', content: fixture('package.after.json'), base: '{ broken' })
    assert.ok(result.problems.length > 0)
  })
})

// Offline rules (T2). `check` runs a fixture pair; `rules` gives the sorted rule:tier list.
const check = (file, before, after, opts = {}) =>
  checkDependencies({ file, content: fixture(after), base: before ? fixture(before) : null, ...opts })
const rules = (findings) => findings.map((f) => `${f.rule}:${f.tier}`).sort()
const manifest = (deps) => JSON.stringify({ name: 'x', dependencies: deps }, null, 2) + '\n'
const checkManifest = (before, after) => checkDependencies({ file: 'package.json', content: manifest(after), base: manifest(before) })

describe('checkDependencies: typosquats (R2; AC2)', () => {
  it('should give a high-risk finding for expresss and lodahs', () => {
    for (const name of ['expresss', 'lodahs']) {
      const findings = check('package.json', 'package.before.json', `package.typosquat-${name}.json`)
      assert.deepEqual(rules(findings), ['sc-typosquat:high'], name)
      assert.equal(findings[0].package, name)
      assert.match(findings[0].detail, name === 'expresss' ? /express\b/ : /lodash/)
      assert.equal(findings[0].file, 'package.json')
      assert.equal(findings[0].line, fixture(`package.typosquat-${name}.json`).split('\n').findIndex((l) => l.includes(`"${name}"`)) + 1)
    }
  })

  it('should give none for express or lodash themselves', () => {
    assert.deepEqual(checkManifest({}, { express: '^4.19.0' }), [])
    assert.deepEqual(checkManifest({}, { lodash: '^4.17.21' }), [])
  })

  it('should give none for names shorter than 5 characters, scoped names, or names two edits away', () => {
    assert.deepEqual(checkManifest({}, { reac: '1.0.0' }), [])
    assert.deepEqual(checkManifest({}, { '@evil/express': '1.0.0' }), [])
    assert.deepEqual(checkManifest({}, { expreszz: '1.0.0' }), [])
  })

  it('should check names a lockfile adds, not only the manifest', () => {
    const lock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...pkgs } })
    const findings = checkDependencies({ file: 'package-lock.json', content: lock({ 'node_modules/lodahs': { version: '1.0.0' } }), base: lock({}), manifestChanged: true })
    assert.deepEqual(rules(findings), ['sc-typosquat:high'])
  })

  it('should only flag added names, not an existing dependency whose range changes', () => {
    assert.deepEqual(checkManifest({ lodahs: '1.0.0' }, { lodahs: '1.0.1' }), [])
  })
})

describe('checkDependencies: lockfile drift and range widening (R6; AC5)', () => {
  it('should warn about a lockfile change with no matching manifest change', () => {
    assert.deepEqual(rules(check('package-lock.json', 'package-lock.before.json', 'package-lock.after.json', { manifestChanged: false })), ['sc-alias:warning', 'sc-lockfile-drift:warning'])
    assert.deepEqual(rules(check('yarn.lock', 'yarn-classic.before.lock', 'yarn-classic.after.lock')), ['sc-lockfile-drift:warning'])
  })

  it('should not warn about drift when the manifest changed too, or when the lockfile has no dependency change', () => {
    assert.deepEqual(rules(check('package-lock.json', 'package-lock.before.json', 'package-lock.after.json', { manifestChanged: true })), ['sc-alias:warning'])
    assert.deepEqual(check('package-lock.json', 'package-lock.before.json', 'package-lock.before.json'), [])
  })

  it('should warn when ^1.2.3 becomes *', () => {
    const findings = checkManifest({ lib: '^1.2.3' }, { lib: '*' })
    assert.deepEqual(rules(findings), ['sc-range-widened:warning'])
    assert.match(findings[0].detail, /\^1\.2\.3/)
    assert.deepEqual(rules(check('package.json', 'package.before.json', 'package.range-widened.json')), ['sc-range-widened:warning'])
  })

  it('should warn for latest, x, an empty range and an open lower bound', () => {
    for (const range of ['latest', 'x', '', '>=1', '> 1.0.0', '1.x || >=2']) {
      assert.deepEqual(rules(checkManifest({ lib: '^1.2.3' }, { lib: range })), ['sc-range-widened:warning'], JSON.stringify(range))
    }
  })

  it('should not warn for a bounded change, an unchanged open range, or a new dependency', () => {
    assert.deepEqual(checkManifest({ lib: '^1.2.3' }, { lib: '^1.3.0' }), [])
    assert.deepEqual(checkManifest({ lib: '^1.2.3' }, { lib: '>=1.2.3 <2' }), [])
    assert.deepEqual(checkManifest({ lib: '*' }, { lib: 'latest' }), [])
    assert.deepEqual(checkManifest({}, { lib: '*' }), [])
  })
})

describe('checkDependencies: non-registry specifiers (D9)', () => {
  it('should warn about an added workspace:, file:, link:, git, GitHub, URL or npm: alias specifier', () => {
    assert.deepEqual(rules(check('package.json', 'package.before.json', 'package.non-registry.json')), ['sc-non-registry:warning'])
    for (const spec of ['file:../lib', 'link:../lib', 'git+https://example.com/a.git', 'github:owner/repo', 'owner/repo', 'https://example.com/a.tgz', 'npm:lodash@^4.17.21']) {
      assert.deepEqual(rules(checkManifest({}, { lib: spec })), ['sc-non-registry:warning'], spec)
    }
  })

  it('should say which specifiers are left out of the lookups', () => {
    const [f] = check('package.json', 'package.before.json', 'package.non-registry.json')
    assert.equal(f.package, 'local-lib')
    assert.match(f.detail, /workspace:\*/)
  })
})

describe('checkDependencies: fail closed and scope', () => {
  it('should give a high-risk sc-unparsed finding when the file or its base cannot be read', () => {
    assert.deepEqual(rules(checkDependencies({ file: 'package-lock.json', content: 'not json', base: null })), ['sc-unparsed:high'])
    assert.deepEqual(rules(checkDependencies({ file: 'package.json', content: fixture('package.after.json'), base: '{ broken' })), ['sc-unparsed:high'])
  })

  it('should give nothing for a file that is not a dependency file', () => {
    assert.deepEqual(checkDependencies({ file: 'src/index.js', content: 'lodahs', base: null }), [])
  })

  it('should give every finding the shared { rule, tier, file, line, detail, package } shape', () => {
    for (const f of check('package.json', 'package.before.json', 'package.typosquat-lodahs.json')) {
      assert.deepEqual(Object.keys(f).sort(), ['detail', 'file', 'line', 'package', 'rule', 'tier'])
    }
  })
})

// Release review fixes: layouts the parsers can't read are problems, never an empty list (F1).
describe('parseDependencies: layouts the parser does not expect fail closed (F1)', () => {
  const pnpm = fixture('pnpm-lock-v9.after.yaml')
  const problems = (file, content) => parseDependencies({ file, content }).problems

  it('should read a pnpm packages: line that carries a comment', () => {
    const result = parseDependencies({ file: 'pnpm-lock.yaml', content: pnpm.replace(/^packages:\s*$/m, 'packages: # note') })
    assert.deepEqual(result.problems, [])
    assert.equal(result.entries.length, 4)
  })

  it('should report a pnpm packages map in a form or indentation it does not read', () => {
    assert.ok(problems('pnpm-lock.yaml', pnpm.replace(/^packages:\s*$/m, 'packages: {express@4.19.2: {}}')).length > 0, 'flow map')
    const indented = pnpm.replace(/^packages:\s*\n([\s\S]*?)\nsnapshots:/m, (_, body) => `packages:\n${body.replace(/^(?=\S)/gm, '    ').replace(/^ {2}(?=\S)/gm, '      ')}\nsnapshots:`)
    assert.ok(problems('pnpm-lock.yaml', indented).length > 0, 'indented 4')
    assert.ok(problems('pnpm-lock.yaml', pnpm.replace('  debug@2.6.9:', '   debug@2.6.9:')).length > 0, '3-space key')
  })

  it('should report a pnpm package entry without a resolution', () => {
    assert.ok(problems('pnpm-lock.yaml', pnpm.replace('    resolution: {integrity: sha512-bbb}\n', '')).length > 0)
  })

  it('should report a yarn.lock whose entries are all indented', () => {
    const yarn = fixture('yarn-berry.after.lock').replace(/^(?=\S)(?!#)/gm, '  ')
    assert.ok(problems('yarn.lock', yarn).length > 0)
  })

  it('should report a package-lock.json packages entry that is not an object', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/evil': '1.0.0' } })
    assert.ok(problems('package-lock.json', lock).length > 0)
  })
})

// F4: where a lockfile entry comes from.
describe('checkDependencies: lockfile resolved and integrity (sc-resolved; F4)', () => {
  const npmLock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...pkgs } }, null, 2)
  const npmPkg = (name, version, over = {}) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`, integrity: 'sha512-aaa', ...over })
  const checkLock = (file, before, after) => rules(checkDependencies({ file, content: after, base: before, manifestChanged: true }))

  it('should give nothing for entries resolved from the public registry under their own name', () => {
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21'), 'node_modules/@scope/util': npmPkg('@scope/util', '2.0.0') })), [])
  })

  it('should flag an entry resolved from another host as high risk', () => {
    const after = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21', { resolved: 'https://evil.example/x.tgz' }) })
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), after), ['sc-resolved:high'])
  })

  it('should flag a changed resolved host for an unchanged version as high risk', () => {
    const before = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21') })
    const after = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21', { resolved: 'https://evil.example/x.tgz' }) })
    assert.deepEqual(checkLock('package-lock.json', before, after), ['sc-resolved:high'])
  })

  it('should warn when the integrity changes for an unchanged version', () => {
    const before = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21') })
    const after = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21', { integrity: 'sha512-bbb' }) })
    assert.deepEqual(checkLock('package-lock.json', before, after), ['sc-resolved:warning'])
  })

  it('should flag a registry tarball that belongs to another package as high risk', () => {
    const after = npmLock({ 'node_modules/evil': npmPkg('lodash', '4.17.21', { name: 'lodash', resolved: 'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz' }) })
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), after), ['sc-alias:warning', 'sc-resolved:high'])
  })

  it('should check the install-path name for typosquats even when the entry names another package', () => {
    const after = npmLock({ 'node_modules/expresss': npmPkg('express', '4.19.2', { name: 'express' }) })
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), after), ['sc-alias:warning', 'sc-typosquat:high'])
  })

  it('should flag a pnpm tarball, a yarn classic resolved and a yarn berry resolution from another host', () => {
    const pnpm = fixture('pnpm-lock-v9.after.yaml').replace('resolution: {integrity: sha512-bbb}', 'resolution: {tarball: https://evil.example/debug.tgz}')
    assert.deepEqual(checkLock('pnpm-lock.yaml', fixture('pnpm-lock-v9.after.yaml'), pnpm), ['sc-resolved:high'])
    const classic = fixture('yarn-classic.after.lock').replace('https://registry.yarnpkg.com/debug/-/debug-2.6.9.tgz#bbb', 'https://evil.example/debug.tgz')
    assert.deepEqual(checkLock('yarn.lock', fixture('yarn-classic.after.lock'), classic), ['sc-resolved:high'])
    const berry = fixture('yarn-berry.after.lock').replace('resolution: "express@npm:4.19.2"', 'resolution: "express@https://evil.example/express.tgz"')
    assert.deepEqual(checkLock('yarn.lock', fixture('yarn-berry.after.lock'), berry), ['sc-resolved:high'])
  })

  it('should flag a registry tarball whose file name is another package or version as high risk (D)', () => {
    const other = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21', { resolved: 'https://registry.npmjs.org/lodash/-/evil-1.0.0.tgz' }) })
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), other), ['sc-resolved:high'])
    const version = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21', { resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz' }) })
    assert.deepEqual(checkLock('package-lock.json', npmLock({}), version), ['sc-resolved:high'])
    const classic = fixture('yarn-classic.after.lock').replace('debug/-/debug-2.6.9.tgz', 'debug/-/debug-9.9.9.tgz')
    assert.deepEqual(checkLock('yarn.lock', fixture('yarn-classic.before.lock'), classic), ['sc-resolved:high'])
  })
})

// B: a lockfile entry that installs under one name but fetches another package.
describe('checkDependencies: npm-lock aliases (sc-alias; B)', () => {
  const npmLock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...pkgs } }, null, 2)
  const npmPkg = (name, version, over = {}) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`, integrity: 'sha512-aaa', ...over })
  const checkLock = (before, after) => rules(checkDependencies({ file: 'package-lock.json', content: after, base: before, manifestChanged: true }))

  it('should warn when a popular install path now fetches another package', () => {
    const before = npmLock({ 'node_modules/lodash': npmPkg('lodash', '4.17.21') })
    const after = npmLock({ 'node_modules/lodash': npmPkg('evil-pkg', '1.0.0', { name: 'evil-pkg' }) })
    assert.deepEqual(checkLock(before, after), ['sc-alias:warning'])
  })

  it('should warn about a new alias in v3 and v1 lockfiles', () => {
    assert.deepEqual(checkLock(npmLock({}), npmLock({ 'node_modules/my-lodash': npmPkg('lodash', '4.17.21', { name: 'lodash' }) })), ['sc-alias:warning'])
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { 'my-lodash': { version: 'npm:lodash@4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' } } })
    assert.deepEqual(checkLock(JSON.stringify({ lockfileVersion: 1, dependencies: {} }), v1), ['sc-alias:warning'])
  })

  it('should not warn when the base had the same alias', () => {
    const before = npmLock({ 'node_modules/my-lodash': npmPkg('lodash', '4.17.20', { name: 'lodash' }) })
    const after = npmLock({ 'node_modules/my-lodash': npmPkg('lodash', '4.17.21', { name: 'lodash' }) })
    assert.deepEqual(checkLock(before, after), [])
  })
})

// A: pnpm and yarn lockfiles are read only in the layout the tools write; any other spelling is a problem.
describe('parseDependencies: strict lockfile layout (A)', () => {
  const pnpm = fixture('pnpm-lock-v9.after.yaml')
  const berry = fixture('yarn-berry.after.lock')
  const classic = fixture('yarn-classic.after.lock')
  const problems = (file, content) => parseDependencies({ file, content }).problems
  const rejects = (file, content, label) => assert.ok(problems(file, content).length > 0, label)

  it('should report a pnpm packages key spelled any other way', () => {
    rejects('pnpm-lock.yaml', pnpm.replace(/^packages:/m, '"packages":'), 'double-quoted')
    rejects('pnpm-lock.yaml', pnpm.replace(/^packages:/m, "'packages':"), 'single-quoted')
    rejects('pnpm-lock.yaml', pnpm.replace(/^packages:/m, 'packages :'), 'space before colon')
    rejects('pnpm-lock.yaml', `${pnpm}\npackages: {}\n`, 'repeated')
    rejects('pnpm-lock.yaml', `${pnpm}\n? packages\n: {}\n`, 'explicit key')
  })

  it('should report a pnpm resolution that is not a one-line flow map of plain fields', () => {
    const r = '    resolution: {integrity: sha512-bbb}'
    rejects('pnpm-lock.yaml', pnpm.replace(r, '    resolution:\n        integrity: sha512-bbb\n        tarball: https://evil.example/d.tgz'), 'block')
    rejects('pnpm-lock.yaml', pnpm.replace(r, "    resolution: {integrity: sha512-bbb, 'tarball': https://evil.example/d.tgz}"), 'quoted tarball key')
    rejects('pnpm-lock.yaml', pnpm.replace(r, '    resolution: {integrity: sha512-bbb,\n      tarball: https://evil.example/d.tgz}'), 'multi-line flow map')
    rejects('pnpm-lock.yaml', pnpm.replace(r, "    'resolution': {integrity: sha512-bbb}"), 'quoted field key')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    resolution: {tarball: https://evil.example/d.tgz}`), 'repeated field')
    rejects('pnpm-lock.yaml', pnpm.replace(r, '     resolution: {integrity: sha512-bbb}'), '5-space field')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    'dev': false`), 'quoted field after a resolution')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n      tarball: https://evil.example/d.tgz`), 'deeper line under a one-line field')
  })

  it('should read pnpm block fields such as peerDependencies', () => {
    const peers = pnpm.replace('    resolution: {integrity: sha512-eee}', "    resolution: {integrity: sha512-eee}\n    peerDependencies:\n      react: ^18.3.1\n    peerDependenciesMeta:\n      react:\n        optional: true")
    assert.deepEqual(problems('pnpm-lock.yaml', peers), [])
  })

  it('should report yarn fields with quoted keys, odd indentation or repeats', () => {
    rejects('yarn.lock', classic.replace('  resolved "https://registry.yarnpkg.com/debug', '  "resolved" "https://registry.yarnpkg.com/debug'), 'quoted classic key')
    rejects('yarn.lock', berry.replace('  resolution: "express@npm:4.19.2"', '  "resolution": "express@npm:4.19.2"'), 'quoted berry key')
    rejects('yarn.lock', classic.replace('  version "2.6.9"', '   version "2.6.9"'), '3-space field')
    rejects('yarn.lock', classic.replace('  version "2.6.9"', '  version "2.6.9"\n    resolved "https://evil.example/d.tgz"'), 'nested under a scalar field')
    rejects('yarn.lock', classic.replace('  version "2.6.9"', '  version "2.6.9"\n  resolved "https://evil.example/d.tgz"'), 'repeated field')
    rejects('yarn.lock', classic.replace('debug@2.6.9:', 'debug@2.6.9'), 'entry line without a colon')
  })

  it('should split lines on a lone CR as YAML and yarn do, so entries hidden behind one are still checked (E)', () => {
    const section = pnpm.replace('        version: 4.19.2', '        version: 4.19.2\rpackages:\r  evil@6.6.6:\r    resolution: {integrity: sha512-x, tarball: https://evil.example/e.tgz}')
    rejects('pnpm-lock.yaml', section, 'a packages section hidden in an importers line')
    const inPackage = pnpm.replace('    resolution: {integrity: sha512-ccc}', '    resolution: {integrity: sha512-ccc}\n    dependencies:\n      debug: 2.6.9\r  evil@6.6.6:\r    resolution: {integrity: sha512-x, tarball: https://evil.example/e.tgz}')
    assert.deepEqual(rules(checkDependencies({ file: 'pnpm-lock.yaml', content: inPackage, base: pnpm, manifestChanged: true })), ['sc-resolved:high'])
    const yarn = classic.replace('    debug "2.6.9"', '    debug "2.6.9"\revil@^6:\r  version "6.6.6"\r  resolved "https://evil.example/e.tgz"')
    assert.deepEqual(rules(checkDependencies({ file: 'yarn.lock', content: yarn, base: classic, manifestChanged: true })), ['sc-resolved:high'])
  })

  it('should report the other Unicode line breaks (NEL, LS, PS) in a lockfile (E)', () => {
    for (const ch of ['\u0085', '\u2028', '\u2029']) {
      rejects('pnpm-lock.yaml', pnpm.replace('        version: 4.19.2', `        version: 4.19.2${ch}x`), `pnpm ${ch.charCodeAt(0)}`)
      rejects('yarn.lock', classic.replace('  version "2.6.9"', `  version "2.6.9"${ch}x`), `yarn ${ch.charCodeAt(0)}`)
    }
  })

  it('should read a yarn berry resolution locator: another name is an alias, another version a problem (F)', () => {
    const entry = (resolution, version = '1.3.0') => `${berry}\n"left-pad@npm:^1.3.0":\n  version: ${version}\n  resolution: "${resolution}"\n  languageName: node\n  linkType: hard\n`
    rejects('yarn.lock', entry('left-pad@npm:6.6.6'), 'version disagrees with the locator')
    const swapped = parseDependencies({ file: 'yarn.lock', content: entry('evil-pkg@npm:6.6.6', '6.6.6') })
    assert.deepEqual(swapped.problems, [])
    assert.ok(swapped.entries.some((e) => e.name === 'evil-pkg' && e.version === '6.6.6' && e.installName === 'left-pad'))
    assert.deepEqual(rules(checkDependencies({ file: 'yarn.lock', content: entry('evil-pkg@npm:6.6.6', '6.6.6'), base: berry, manifestChanged: true })), ['sc-alias:warning'])
  })

  it('should read yarn npm: aliases as the real package installed under the alias', () => {
    const classicAlias = `${classic}\n"my-lodash@npm:lodash@^4.17.21":\n  version "4.17.21"\n  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#fff"\n`
    assert.ok(parseDependencies({ file: 'yarn.lock', content: classicAlias }).entries.some((e) => e.name === 'lodash' && e.installName === 'my-lodash'))
    assert.deepEqual(rules(checkDependencies({ file: 'yarn.lock', content: classicAlias, base: classic, manifestChanged: true })), ['sc-alias:warning'])
    const berryAlias = `${berry}\n"my-lodash@npm:lodash@^4.17.21":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n  languageName: node\n  linkType: hard\n`
    assert.ok(parseDependencies({ file: 'yarn.lock', content: berryAlias }).entries.some((e) => e.name === 'lodash' && e.installName === 'my-lodash'))
    assert.deepEqual(rules(checkDependencies({ file: 'yarn.lock', content: berryAlias, base: berry, manifestChanged: true })), ['sc-alias:warning'])
  })

  it('should read pnpm v5 scoped names that contain an underscore (G)', () => {
    const v5 = fixture('pnpm-lock-v5.after.yaml').replace('  /@scope/util/2.0.0:', '  /@scope/evil_pkg/6.6.6:')
    const result = parseDependencies({ file: 'pnpm-lock.yaml', content: v5 })
    assert.deepEqual(result.problems, [])
    assert.ok(result.entries.some((e) => e.name === '@scope/evil_pkg' && e.version === '6.6.6'))
    assert.ok(result.entries.some((e) => e.name === 'react-dom' && e.version === '18.3.1'), 'peer suffix still dropped')
  })

  it('should report pnpm name: or version: fields that disagree with the key (H)', () => {
    const r = '    resolution: {integrity: sha512-bbb}'
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    name: evil-pkg`), 'name')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    version: 6.6.6`), 'version')
    assert.deepEqual(problems('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    name: debug\n    version: 2.6.9`)), [])
  })

  it('should read pnpm git dependencies as non-registry entries rather than unreadable keys', () => {
    const v9 = pnpm.replace('snapshots:', "  gh@git+https://github.com/a/b.git#abc123:\n    resolution: {commit: abc123, repo: https://github.com/a/b.git, type: git}\n    version: 1.0.0\n\nsnapshots:")
    const r9 = parseDependencies({ file: 'pnpm-lock.yaml', content: v9 })
    assert.deepEqual(r9.problems, [])
    assert.ok(r9.entries.some((e) => e.name === 'gh' && e.resolved === 'https://github.com/a/b.git'))
    assert.deepEqual(rules(checkDependencies({ file: 'pnpm-lock.yaml', content: v9, base: pnpm, manifestChanged: true })), ['sc-resolved:high'])
    const v6 = fixture('pnpm-lock-v6.after.yaml').trimEnd() + '\n\n  github.com/a/b/abc123:\n    resolution: {tarball: https://codeload.github.com/a/b/tar.gz/abc123}\n    name: b\n    version: 1.0.0\n    dev: false\n'
    const r6 = parseDependencies({ file: 'pnpm-lock.yaml', content: v6 })
    assert.deepEqual(r6.problems, [])
    assert.ok(r6.entries.some((e) => e.name === 'b' && e.version === '1.0.0'))
    rejects('pnpm-lock.yaml', v6.replace('    name: b\n', ''), 'a hosted-git key without a name field')
  })

  it('should read yarn block fields such as dependencies and peerDependenciesMeta', () => {
    const meta = berry.replace('  linkType: hard\n', '  peerDependenciesMeta:\n    react:\n      optional: true\n  linkType: hard\n')
    assert.deepEqual(problems('yarn.lock', meta), [])
    assert.deepEqual(problems('yarn.lock', classic), [])
  })
})

describe('parseDependencies: allowlisted lockfile fields and versions (fix set 3)', () => {
  const pnpm = fixture('pnpm-lock-v9.after.yaml')
  const berry = fixture('yarn-berry.after.lock')
  const classic = fixture('yarn-classic.after.lock')
  const problems = (file, content) => parseDependencies({ file, content }).problems
  const rejects = (file, content, label) => assert.ok(problems(file, content).length > 0, label)
  const pnpmEntry = (body) => pnpm.replace('snapshots:', `${body}\n\nsnapshots:`)
  const berryEntry = (descriptor, fields) => `${berry}\n"${descriptor}":\n${fields}\n  languageName: node\n  linkType: hard\n`

  it('should report a pnpm URL or git key with no tarball, repo or directory source', () => {
    rejects('pnpm-lock.yaml', pnpmEntry('  lodash@https://example.com/x.tgz:\n    resolution: {integrity: sha512-x}\n    version: 4.17.20'), 'URL key, integrity only')
    rejects('pnpm-lock.yaml', pnpmEntry('  lodash@4.17.20/x:\n    resolution: {integrity: sha512-x}\n    version: 4.17.20'), 'slash key, integrity only')
    const tarball = pnpmEntry('  lodash@https://example.com/x.tgz:\n    resolution: {integrity: sha512-x, tarball: https://example.com/x.tgz}\n    version: 4.17.20')
    assert.deepEqual(rules(checkDependencies({ file: 'pnpm-lock.yaml', content: tarball, base: pnpm, manifestChanged: true })), ['sc-resolved:high'])
  })

  it('should report pnpm name, version or resolution values placed on the next line', () => {
    const r = '    resolution: {integrity: sha512-bbb}'
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    version:\n      6.6.6`), 'version')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    name:\n      evil-pkg`), 'name')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    version: >-\n      6.6.6`), 'block scalar version')
    rejects('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    tarball:\n      https://evil.example/d.tgz`), 'unknown field opening a block')
  })

  it('should report pnpm registry versions that are not strict semver', () => {
    rejects('pnpm-lock.yaml', "lockfileVersion: '6.0'\n\npackages:\n\n  /lodash@4.17.20_x:\n    resolution: {integrity: sha512-x}\n", 'v6 key with an underscore suffix')
    rejects('pnpm-lock.yaml', pnpmEntry('  lodash@4.17:\n    resolution: {integrity: sha512-x}'), 'partial key version')
    rejects('pnpm-lock.yaml', pnpmEntry('  gh@git+https://github.com/a/b.git#abc:\n    resolution: {commit: abc, repo: https://github.com/a/b.git, type: git}\n    version: 1.0.0_x'), 'version field')
  })

  it('should report a pnpm directory resolution as a file: source, and an unknown resolution type as a problem', () => {
    const dir = pnpm.replace('    resolution: {integrity: sha512-bbb}', '    resolution: {type: directory, directory: vendor/evil}')
    const parsed = parseDependencies({ file: 'pnpm-lock.yaml', content: dir })
    assert.deepEqual(parsed.problems, [])
    assert.ok(parsed.entries.some((e) => e.resolved === 'file:vendor/evil'))
    assert.ok(rules(checkDependencies({ file: 'pnpm-lock.yaml', content: dir, base: pnpm, manifestChanged: true })).includes('sc-resolved:high'))
    const unknown = problems('pnpm-lock.yaml', pnpm.replace('    resolution: {integrity: sha512-bbb}', '    resolution: {integrity: sha512-bbb, type: variations}'))
    assert.ok(unknown.some((p) => p.includes('unknown type "variations"')), 'unknown type')
  })

  it('should report yarn fields that open a block unless they are known block fields', () => {
    rejects('yarn.lock', berry.replace('  resolution: "express@npm:4.19.2"', '  resolution:\n    "express@npm:4.17.0"'), 'berry resolution on the next line')
    rejects('yarn.lock', berry.replace('  resolution: "express@npm:4.19.2"', '  resolution: >-\n    express@npm:4.17.0'), 'berry resolution block scalar')
    rejects('yarn.lock', classic.replace('  version "2.6.9"', '  version "2.6.9"\n  checksum:\n    abc'), 'unknown block field')
  })

  it('should report a yarn berry entry with no resolution', () => {
    rejects('yarn.lock', berryEntry('lodash@npm:^4', '  version: 4.17.21\n  checksum: 10c0/abc'), 'no resolution')
    assert.deepEqual(problems('yarn.lock', classic), [], 'classic entries need no resolution')
  })

  it('should report yarn npm: locator versions that are not strict semver (::__archiveUrl)', () => {
    const encoded = '4.17.21::__archiveUrl=https%3A%2F%2Fevil.example%2Fl.tgz'
    rejects('yarn.lock', berryEntry('lodash@npm:^4', `  version: ${encoded}\n  resolution: "lodash@npm:${encoded}"`), 'encoded archiveUrl')
    const plain = '4.17.21::__archiveUrl=https://evil.example/l.tgz'
    rejects('yarn.lock', berryEntry('lodash@npm:^4', `  version: "${plain}"\n  resolution: "lodash@npm:${plain}"`), 'plain archiveUrl')
  })

  it('should unwrap yarn patch: locators and compare their version with version:', () => {
    const patch = (inner, version) => berryEntry('lodash@patch:lodash@npm%3A^4#~/.yarn/patches/l.patch', `  version: ${version}\n  resolution: "lodash@patch:lodash@npm%3A${inner}#~/.yarn/patches/l.patch::version=${inner}&hash=abc"`)
    rejects('yarn.lock', patch('4.17.20', '4.17.21'), 'patched version disagrees')
    const same = parseDependencies({ file: 'yarn.lock', content: patch('4.17.21', '4.17.21') })
    assert.deepEqual(same.problems, [])
    assert.ok(same.entries.some((e) => e.name === 'lodash' && e.version === '4.17.21'))
    const compat = berryEntry('typescript@patch:typescript@npm%3A^5#optional!builtin<compat/typescript>', '  version: 5.4.5\n  resolution: "typescript@patch:typescript@npm%3A5.4.5#optional!builtin<compat/typescript>::version=5.4.5&hash=5adc0c"\n  bin:\n    tsc: bin/tsc\n  checksum: 10c0/x')
    assert.deepEqual(problems('yarn.lock', compat), [])
  })

  it('should treat other yarn berry locators as the entry source for sc-resolved', () => {
    const local = berryEntry('evil@file:./vendor/evil', '  version: 1.0.0\n  resolution: "evil@file:./vendor/evil#./vendor/evil::hash=abc"')
    const parsed = parseDependencies({ file: 'yarn.lock', content: local })
    assert.deepEqual(parsed.problems, [])
    assert.ok(parsed.entries.some((e) => e.name === 'evil' && e.resolved === 'file:./vendor/evil#./vendor/evil::hash=abc'))
    assert.ok(rules(checkDependencies({ file: 'yarn.lock', content: local, base: berry, manifestChanged: true })).includes('sc-resolved:high'))
  })
})

describe('parseDependencies: descriptor order, pnpm v5 local keys and escapes (fix set 4)', () => {
  const pnpm = fixture('pnpm-lock-v9.after.yaml')
  const v5 = fixture('pnpm-lock-v5.after.yaml')
  const berry = fixture('yarn-berry.after.lock')
  const classic = fixture('yarn-classic.after.lock')
  const problems = (file, content) => parseDependencies({ file, content }).problems
  const rejects = (file, content, label) => assert.ok(problems(file, content).length > 0, label)
  const checkLock = (file, content, base) => rules(checkDependencies({ file, content, base, manifestChanged: true }))

  it('should check a yarn entry whose first descriptor is a workspace, link or portal descriptor', () => {
    for (const first of ['workspace:x', 'link:./x', 'portal:./x']) {
      const reordered = `${berry}\n"lodash@${first}, lodash@npm:^4.17.0":\n  version: 4.17.20\n  resolution: "lodash@https://evil.example/x.tgz"\n  languageName: node\n  linkType: hard\n`
      assert.ok(checkLock('yarn.lock', reordered, berry).includes('sc-resolved:high'), `berry ${first}`)
    }
    const classicLink = `${classic}\n"lodash@link:./x", lodash@^4.17.0:\n  version "4.17.20"\n  resolved "https://evil.example/lodash-4.17.20.tgz"\n`
    assert.ok(checkLock('yarn.lock', classicLink, classic).includes('sc-resolved:high'), 'classic link')
  })

  it('should still skip berry entries whose resolution is a workspace, link or portal locator', () => {
    const local = `${berry}\n"shared@link:../shared::locator=demo-app%40workspace%3A.":\n  version: 0.0.0-use.local\n  resolution: "shared@link:../shared::locator=demo-app%40workspace%3A."\n  languageName: node\n  linkType: soft\n`
    const parsed = parseDependencies({ file: 'yarn.lock', content: local })
    assert.deepEqual(parsed.problems, [])
    assert.ok(!parsed.entries.some((e) => e.name === 'shared' || e.name === 'demo-app'))
  })

  it('should read pnpm v5 local keys from their name and version fields', () => {
    const dir = v5.trimEnd() + '\n\n  file:packages/foo:\n    resolution: {directory: packages/foo, type: directory}\n    name: foo\n    version: 1.0.0\n    dev: false\n'
    const parsed = parseDependencies({ file: 'pnpm-lock.yaml', content: dir })
    assert.deepEqual(parsed.problems, [])
    assert.ok(parsed.entries.some((e) => e.name === 'foo' && e.version === '1.0.0' && e.resolved === 'file:packages/foo'))
    const tgz = v5.trimEnd() + '\n\n  file:../foo-1.0.0.tgz:\n    resolution: {integrity: sha512-x, tarball: file:../foo-1.0.0.tgz}\n    name: foo\n    version: 1.0.0\n    dev: false\n'
    assert.deepEqual(problems('pnpm-lock.yaml', tgz), [])
    rejects('pnpm-lock.yaml', tgz.replace('    name: foo\n', ''), 'a local key without a name field')
    const v6 = fixture('pnpm-lock-v6.after.yaml').trimEnd() + '\n\n  file:packages/@scope/foo:\n    resolution: {directory: packages/@scope/foo, type: directory}\n    name: \'@scope/foo\'\n    version: 1.0.0\n    dev: false\n'
    assert.deepEqual(problems('pnpm-lock.yaml', v6), [], 'v6 scoped file key')
  })

  it('should read a multi-line pnpm deprecated message', () => {
    const r = '    resolution: {integrity: sha512-bbb}'
    assert.deepEqual(problems('pnpm-lock.yaml', pnpm.replace(r, `${r}\n    deprecated: |-\n      Use x instead.\n      See the notes.`)), [])
  })

  it('should report double-quoted values with backslash escapes in the fields the checks read', () => {
    const r = '    resolution: {integrity: sha512-bbb}'
    const escaped = (content) => problems('pnpm-lock.yaml', content).some((p) => p.includes('holds an escaped string'))
    assert.ok(escaped(pnpm.replace(r, '    resolution: {integrity: sha512-bbb, tarball: "https://registry.npmjs.org/debug/-/debug-2.6.9.tgz\\x"}')), 'pnpm resolution')
    assert.ok(escaped(pnpm.replace(r, `${r}\n    version: "2.6.\\x39"`)), 'pnpm version')
    assert.ok(escaped(pnpm.replace(r, `${r}\n    name: "deb\\x75g"`)), 'pnpm name')
    rejects('yarn.lock', classic.replace('  version "2.6.9"', '  version "2.6.\\x39"'), 'classic version')
    rejects('yarn.lock', berry.replace('  resolution: "express@npm:4.19.2"', '  resolution: "express@npm:4.19.\\x32"'), 'berry resolution')
    rejects('yarn.lock', `${classic}\n"evil\\x40pkg@^1":\n  version "1.0.0"\n`, 'classic descriptor')
  })
})

describe('parseDependencies: per-format yarn fields and the pnpm lockfileVersion (fix set 5)', () => {
  const pnpm = fixture('pnpm-lock-v9.after.yaml')
  const berry = fixture('yarn-berry.after.lock')
  const classic = fixture('yarn-classic.after.lock')
  const problems = (file, content) => parseDependencies({ file, content }).problems
  const rejects = (file, content, label) => assert.ok(problems(file, content).length > 0, label)
  const berryEntry = (fields) => `${berry}\n"lodash@npm:^4.17.0":\n  version: 4.17.21\n  resolution: "lodash@https://evil.example/x.tgz"\n${fields}  languageName: node\n  linkType: hard\n`

  it('should report yarn berry fields that only yarn classic writes (A)', () => {
    rejects('yarn.lock', berryEntry('  resolved: "workspace:x"\n'), 'resolved naming a workspace')
    rejects('yarn.lock', berryEntry('  resolved: "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"\n'), 'resolved naming the registry')
    rejects('yarn.lock', berryEntry('  integrity: sha512-x\n'), 'integrity')
    rejects('yarn.lock', berry.replace('  cacheKey: 10c0', '  cacheKey: 10c0\n  resolved: x'), 'unknown __metadata field')
  })

  it('should read every field yarn berry writes (A)', () => {
    const full = `${berry}\n"fsevents@npm:^2.3.2":\n  version: 2.3.3\n  resolution: "fsevents@npm:2.3.3"\n  dependencies:\n    node-gyp: "npm:latest"\n  optionalDependencies:\n    x: "npm:1.0.0"\n  peerDependencies:\n    react: "*"\n  dependenciesMeta:\n    x:\n      optional: true\n  peerDependenciesMeta:\n    react:\n      optional: true\n  bin:\n    fse: bin/fse\n  checksum: 10c0/abc\n  conditions: os=darwin\n  languageName: node\n  linkType: hard\n`
    assert.deepEqual(problems('yarn.lock', full), [])
  })

  it('should report yarn classic fields that only yarn berry writes (B)', () => {
    const entry = (fields) => `${classic}\nlodash@^4.17.0:\n  version "4.17.21"\n  resolved "https://evil.example/x.tgz"\n${fields}`
    rejects('yarn.lock', entry('  resolution "lodash@https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"\n'), 'resolution')
    rejects('yarn.lock', entry('  checksum "abc"\n'), 'checksum')
    rejects('yarn.lock', entry('  languageName "node"\n'), 'languageName')
  })

  it('should read every field yarn classic writes (B)', () => {
    const full = `${classic}\nfsevents@^2.3.2:\n  version "2.3.3"\n  resolved "https://registry.yarnpkg.com/fsevents/-/fsevents-2.3.3.tgz#abc"\n  integrity sha512-x\n  uid ""\n  dependencies:\n    node-gyp "^9"\n  optionalDependencies:\n    x "1.0.0"\n`
    assert.deepEqual(problems('yarn.lock', full), [])
  })

  it('should read only an exact __metadata key as the berry header (fix set 6)', () => {
    rejects('yarn.lock', `${classic}\n"__metadata", "lodash@^4":\n  version "4.17.20"\n`, 'classic, __metadata first')
    rejects('yarn.lock', `${berry}\n"__metadata, lodash@npm:^4":\n  version: 4.17.20\n  resolution: "lodash@npm:4.17.20"\n`, 'berry, __metadata first')
    assert.deepEqual(problems('yarn.lock', berry), [])
  })

  it('should read the fields yarn 1.22 writes, with name as the installed package (fix set 6)', () => {
    const extra = `${classic}\nfsevents@^2.3.2:\n  version "2.3.3"\n  resolved "https://registry.yarnpkg.com/fsevents/-/fsevents-2.3.3.tgz#abc"\n  registry yarn\n  permissions:\n    x true\n  prebuiltVariants:\n    darwin abc\n`
    assert.deepEqual(problems('yarn.lock', extra), [])
    const renamed = `${classic}\nmy-lib@^1.0.0:\n  name evil-pkg\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/evil-pkg/-/evil-pkg-1.0.0.tgz#abc"\n`
    const parsed = parseDependencies({ file: 'yarn.lock', content: renamed })
    assert.deepEqual(parsed.problems, [])
    assert.ok(parsed.entries.some((e) => e.name === 'evil-pkg' && e.installName === 'my-lib'))
    assert.deepEqual(rules(checkDependencies({ file: 'yarn.lock', content: renamed, base: classic, manifestChanged: true })), ['sc-alias:warning'])
    rejects('yarn.lock', `${classic}\n"my-lodash@npm:lodash@^4":\n  name evil-pkg\n  version "4.17.21"\n`, 'name disagrees with the npm: alias')
    rejects('yarn.lock', `${classic}\nmy-lib@^1.0.0:\n  name "evil\\x2dpkg"\n  version "1.0.0"\n`, 'escaped name')
  })

  it('should report a pnpm lockfileVersion that is not a number (C)', () => {
    for (const bad of ["'abc'", "''", '-1', '9.0.0', "'9.0' x"]) rejects('pnpm-lock.yaml', pnpm.replace("lockfileVersion: '9.0'", `lockfileVersion: ${bad}`), bad)
    assert.deepEqual(problems('pnpm-lock.yaml', pnpm.replace("lockfileVersion: '9.0'", 'lockfileVersion: "9.0"')), [])
    assert.deepEqual(problems('pnpm-lock.yaml', fixture('pnpm-lock-v5.after.yaml')), [])
  })
})

describe('parseDependencies: every yarn descriptor and package-lock shapes (fix set 7)', () => {
  const berry = fixture('yarn-berry.after.lock')
  const classic = fixture('yarn-classic.after.lock')
  const problems = (file, content) => parseDependencies({ file, content }).problems
  const rejects = (file, content, label) => assert.ok(problems(file, content).length > 0, label)
  const checkLock = (file, content, base) => rules(checkDependencies({ file, content, base, manifestChanged: true }))
  const berryEntry = (key, name, version) => `${berry}\n"${key}":\n  version: ${version}\n  resolution: "${name}@npm:${version}"\n  languageName: node\n  linkType: hard\n`
  const classicEntry = (key, name, version) => `${classic}\n${key}:\n  version "${version}"\n  resolved "https://registry.yarnpkg.com/${name}/-/${name}-${version}.tgz#abc"\n`

  it('should flag a later descriptor that installs another package (A)', () => {
    const berryBase = berryEntry('lodash@npm:^4.17.0', 'lodash', '4.17.21')
    const berrySwap = berryEntry('evilpkg@npm:^1.0.0, lodash@npm:^4.17.0', 'evilpkg', '1.0.0')
    assert.ok(checkLock('yarn.lock', berrySwap, berryBase).includes('sc-alias:warning'), 'berry swap')
    const classicBase = classicEntry('lodash@^4.17.0', 'lodash', '4.17.21')
    const classicSwap = classicEntry('evilpkg@^1.0.0, lodash@^4.17.0', 'evilpkg', '1.0.0')
    assert.ok(checkLock('yarn.lock', classicSwap, classicBase).includes('sc-alias:warning'), 'classic swap')
    const squat = classicEntry('lodash@^4.17.0, lodahs@^4.17.0', 'lodash', '4.17.21')
    assert.ok(checkLock('yarn.lock', squat, classic).includes('sc-typosquat:high'), 'typosquat in a later descriptor')
  })

  it('should read several descriptors of one package as one entry with no findings (A)', () => {
    assert.deepEqual(parseDependencies({ file: 'yarn.lock', content: berry }).entries.filter((e) => e.name === 'express'), [{ name: 'express', version: '4.19.2', resolved: null, integrity: null }])
    assert.deepEqual(checkLock('yarn.lock', classic, fixture('yarn-classic.before.lock')).filter((r) => r.startsWith('sc-alias')), [])
    const aliased = classicEntry('"my-lodash@npm:lodash@^4.17.0", lodash@^4.17.0', 'lodash', '4.17.21')
    assert.deepEqual(problems('yarn.lock', aliased), [])
    assert.deepEqual(parseDependencies({ file: 'yarn.lock', content: aliased }).entries.filter((e) => e.installName).map((e) => e.installName), ['my-lodash'])
  })

  it('should report __metadata or an unreadable descriptor anywhere in the key (A)', () => {
    rejects('yarn.lock', classicEntry('lodash@^4.17.0, __metadata', 'lodash', '4.17.21'), 'classic, __metadata later')
    rejects('yarn.lock', classicEntry('lodash@^4.17.0, "__metadata"', 'lodash', '4.17.21'), 'classic, quoted __metadata later')
    rejects('yarn.lock', berryEntry('lodash@npm:^4.17.0, __metadata', 'lodash', '4.17.21'), 'berry, __metadata later')
    rejects('yarn.lock', classicEntry('lodash@^4.17.0, nonsense', 'lodash', '4.17.21'), 'unreadable later descriptor')
    rejects('yarn.lock', classicEntry('lodash@^4.17.0, ', 'lodash', '4.17.21'), 'empty later descriptor')
    rejects('yarn.lock', classicEntry(`"'lodahs@^4'"`, 'lodash', '4.17.21'), 'classic, quote left in the name')
    rejects('yarn.lock', berryEntry('"lodahs@npm:^4"', 'lodash', '4.17.21'),'berry, quote left in the name')
  })

  it('should count each package once in the drift warning, whatever its install names', () => {
    const aliased = classicEntry('lodash@^4.17.0, "my-lodash@npm:lodash@^4.17.0", "other@npm:lodash@^4.17.0"', 'lodash', '4.17.21')
    const drift = checkDependencies({ file: 'yarn.lock', content: aliased, base: classic }).find((f) => f.rule === 'sc-lockfile-drift')
    assert.match(drift.detail, /changes 1 package\(s\)/)
  })

  it('should report a package-lock whose packages or dependencies is not an object (C)', () => {
    rejects('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: null, dependencies: {} }), 'packages null')
    rejects('package-lock.json', JSON.stringify({ lockfileVersion: 2, packages: [], dependencies: {} }), 'packages an array')
    rejects('package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: [] }), 'dependencies an array')
    rejects('package-lock.json', JSON.stringify({ lockfileVersion: 2, packages: {}, dependencies: 'x' }), 'dependencies a string beside packages')
    assert.deepEqual(problems('package-lock.json', fixture('package-lock.after.json')), [])
  })
})
