import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bump, largestLevel, validateGitSection } from '../scripts/next-version.mjs'
import { PLUGIN_ROOT, tempDir, cleanupTempDirs, git } from './helpers.mjs'

after(cleanupTempDirs)

const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'next-version.mjs')
const OPTED_IN = { git: { tagFormat: 'vX.Y.Z', versionFiles: ['version.txt'], changelogFile: 'CHANGES.md' } }

const write = (repo, file, text) => {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  writeFileSync(path.join(repo, file), text)
}

const commit = (repo, message, file = 'work.txt') => {
  write(repo, file, `${message}\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', message)
}

const commitVersion = (repo, text, message) => {
  write(repo, 'version.txt', text)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', message)
}

// A repo on develop with a tagged release: config, version file and changelog, all committed before the tag.
const makeRepo = ({ config = OPTED_IN, version = '1.2.3', tag = `v${version}` } = {}) => {
  const repo = tempDir('usiatech-next-version-')
  git(repo, 'init', '-q', '-b', 'develop')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  if (config !== null) write(repo, '.claude/engineering.json', typeof config === 'string' ? config : JSON.stringify(config))
  write(repo, 'version.txt', `version ${version}\n`)
  write(repo, 'CHANGES.md', `| ${version} | first |\n`)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'chore: start')
  if (tag) git(repo, 'tag', tag)
  return repo
}

const run = (repo, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' })

const plan = (repo, ...args) => {
  const r = run(repo, ...args)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// The stderr of a refused run: exit 2 with no plan on stdout.
const refusal = (repo, args = []) => {
  const r = run(repo, ...args)
  assert.equal(r.status, 2, `stdout: ${r.stdout} stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'a refused run prints no plan')
  return r.stderr
}

describe('next-version: level rules (AC1)', () => {
  it('should give patch for fixes, docs, chores and subjects that are not conventional', () => {
    assert.equal(largestLevel(['fix: a', 'docs(readme): b', 'chore: c', 'tidy things up']), 'patch')
  })

  it('should give minor for any feat', () => {
    assert.equal(largestLevel(['fix: a', 'feat(release): b']), 'minor')
    assert.equal(largestLevel(['FEAT: a']), 'minor')
  })

  it('should not read feat in the middle of a subject as a feature', () => {
    assert.equal(largestLevel(['fix: feat: wording']), 'patch')
    assert.equal(largestLevel(['feature: not the feat type']), 'patch')
  })

  it('should give major for a ! after the type', () => {
    assert.equal(largestLevel(['fix!: a']), 'major')
    assert.equal(largestLevel(['feat(api)!: b']), 'major')
  })

  it('should give major for a breaking-change footer in the body', () => {
    assert.equal(largestLevel(['fix: a\n\nWhy it changed.\n\nBREAKING CHANGE: gone']), 'major')
    assert.equal(largestLevel(['fix: a\n\nBREAKING-CHANGE: gone']), 'major')
  })

  it('should not read a mention of breaking change in prose as a footer', () => {
    assert.equal(largestLevel(['fix: a\n\nThis is not a BREAKING CHANGE: really']), 'patch')
  })

  it('should take the largest level across commits', () => {
    assert.equal(largestLevel(['feat: a', 'fix!: b', 'fix: c']), 'major')
  })

  it('should reset the lower numbers when it bumps', () => {
    assert.equal(bump('1.2.3', 'patch'), '1.2.4')
    assert.equal(bump('1.2.3', 'minor'), '1.3.0')
    assert.equal(bump('1.2.3', 'major'), '2.0.0')
    assert.equal(bump('0.9.9', 'patch'), '0.9.10')
  })
})

describe('next-version: commits in a repo (AC1)', () => {
  it('should compute the plan from the commit subjects and bodies since the tag', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a', 'a.txt')
    commit(repo, 'feat(x): b', 'b.txt')
    const p = plan(repo)
    assert.equal(p.computedLevel, 'minor')
    assert.equal(p.next, '1.3.0')
    assert.equal(p.nextTag, 'v1.3.0')
    assert.equal(p.commitCount, 2)
    assert.equal(p.bumpMerged, false)
  })

  it('should read a breaking-change footer from a commit body', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a\n\nBREAKING CHANGE: gone')
    assert.equal(plan(repo).next, '2.0.0')
  })

  it('should not count merge commits', () => {
    const repo = makeRepo()
    git(repo, 'checkout', '-q', '-b', 'side')
    commit(repo, 'fix: on side')
    git(repo, 'checkout', '-q', 'develop')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'feat: merge subject is not a change', 'side')
    const p = plan(repo)
    assert.equal(p.commitCount, 1)
    assert.equal(p.computedLevel, 'patch')
  })

  it('should read commits from the base branch, not the checked-out branch', () => {
    const repo = makeRepo()
    commit(repo, 'fix: on develop')
    git(repo, 'checkout', '-q', '-b', 'feat/x')
    commit(repo, 'feat: not on develop yet', 'other.txt')
    assert.equal(plan(repo).computedLevel, 'patch')
  })
})

describe('next-version: last tag (AC2)', () => {
  it('should compare tags as versions, not text', () => {
    const repo = makeRepo({ version: '0.10.0' })
    git(repo, 'tag', 'v0.9.0')
    commit(repo, 'fix: a')
    const p = plan(repo)
    assert.equal(p.previousTag, 'v0.10.0')
    assert.equal(p.next, '0.10.1')
  })

  it('should find the newest tag when the base branch cannot reach it', () => {
    const repo = makeRepo({ tag: 'v1.2.2' })
    git(repo, 'checkout', '-q', '-b', 'main')
    commit(repo, 'chore: promotion merge', 'promote.txt')
    git(repo, 'tag', 'v1.2.3')
    git(repo, 'checkout', '-q', 'develop')
    commit(repo, 'fix: after the release')
    const p = plan(repo)
    assert.equal(p.previousTag, 'v1.2.3')
    assert.equal(p.next, '1.2.4')
  })

  it('should ignore tags that are not vX.Y.Z', () => {
    const repo = makeRepo()
    for (const t of ['04NOV2026-01', 'v9.9', 'v9.9.9-rc1', '9.9.9']) git(repo, 'tag', t)
    commit(repo, 'fix: a')
    assert.equal(plan(repo).previousTag, 'v1.2.3')
  })
})

describe('next-version: override (AC3)', () => {
  it('should apply --level and report both levels', () => {
    const repo = makeRepo()
    commit(repo, 'feat: a')
    const p = plan(repo, '--level', 'patch')
    assert.equal(p.computedLevel, 'minor')
    assert.equal(p.level, 'patch')
    assert.equal(p.override, true)
    assert.equal(p.next, '1.2.4')
  })

  it('should not mark a run with no --level as an override', () => {
    const repo = makeRepo()
    commit(repo, 'feat: a')
    const p = plan(repo)
    assert.equal(p.level, 'minor')
    assert.equal(p.override, false)
  })

  it('should refuse a bad level, a missing value and an unknown argument', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a')
    assert.match(refusal(repo, ['--level', 'huge']), /--level/)
    assert.match(refusal(repo, ['--level']), /--level/)
    assert.match(refusal(repo, ['--bump']), /--bump/)
  })
})

describe('next-version: one bump per release (AC4)', () => {
  it('should report a merged bump, not compute another', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a')
    commitVersion(repo, 'version 1.2.4\n', 'chore(release): 1.2.4 (ESP-1)')
    const p = plan(repo)
    assert.equal(p.enabled, true)
    assert.equal(p.bumpMerged, true)
    assert.equal(p.version, '1.2.4')
    assert.equal(p.nextTag, 'v1.2.4')
    assert.equal(p.next, undefined)
  })

  it('should count no commits after a bump that is the newest change', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a')
    commitVersion(repo, 'version 1.2.4\n', 'chore(release): 1.2.4')
    assert.equal(plan(repo).commitsAfterBump, 0)
  })

  it('should count a commit written before the bump but merged after it', () => {
    const repo = makeRepo()
    git(repo, 'checkout', '-q', '-b', 'side')
    commit(repo, 'feat: written first, merged last', 'side.txt')
    git(repo, 'checkout', '-q', 'develop')
    commitVersion(repo, 'version 1.2.4\n', 'chore(release): 1.2.4')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side')
    commit(repo, 'fix: after', 'after.txt')
    const p = plan(repo)
    assert.equal(p.bumpMerged, true)
    assert.equal(p.commitsAfterBump, 2)
  })

  it('should see a merged bump even when the version file still holds the old version in other text', () => {
    const repo = makeRepo()
    commitVersion(repo, 'version 1.2.4\ndependency 1.2.3\n', 'chore(release): 1.2.4')
    assert.equal(plan(repo).bumpMerged, true)
  })

  it('should refuse a merged bump that missed a version file, naming the file', () => {
    const repo = makeRepo()
    commit(repo, 'chore(release): 1.2.4', 'unrelated.txt')
    const stderr = refusal(repo)
    assert.match(stderr, /version\.txt.*1\.2\.4/s)
    assert.doesNotMatch(stderr, /promote/i)
  })

  it('should not treat a chore(release) commit with no newer version as a bump', () => {
    const repo = makeRepo()
    commit(repo, 'chore(release): tidy the notes', 'a.txt')
    commit(repo, 'chore(release): 1.2.3', 'b.txt')
    commit(repo, 'chore(release): 1.2.4.5', 'c.txt')
    const p = plan(repo)
    assert.equal(p.bumpMerged, false)
    assert.equal(p.next, '1.2.4')
  })

  it('should refuse a version file that lost the tag version with no bump, and not advise promoting', () => {
    const repo = makeRepo()
    commitVersion(repo, 'version 9.9.9\n', 'fix: hand edit')
    const stderr = refusal(repo)
    assert.match(stderr, /version\.txt.*1\.2\.3/s)
    assert.doesNotMatch(stderr, /promote/i)
  })

  it('should not take a longer version as containing the tag version', () => {
    for (const text of ['version 11.2.3\n', 'version 1.2.34\n', 'version 1.2.3.4\n']) {
      const repo = makeRepo()
      commitVersion(repo, text, 'fix: a')
      assert.match(refusal(repo), /version\.txt/)
    }
  })

  it('should read the version file from the base branch, not the working copy', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a')
    write(repo, 'version.txt', 'version 7.7.7\n')
    assert.equal(plan(repo).next, '1.2.4')
  })

  it('should refuse a listed file the base branch does not have', () => {
    const repo = makeRepo({ config: { git: { tagFormat: 'vX.Y.Z', versionFiles: ['missing.txt'] } } })
    commit(repo, 'fix: a')
    assert.match(refusal(repo), /missing\.txt/)
  })

  it('should refuse a release with no commits since the tag', () => {
    assert.match(refusal(makeRepo()), /no commits/i)
  })

  it('should refuse when there is no vX.Y.Z tag', () => {
    const repo = makeRepo({ tag: null })
    commit(repo, 'fix: a')
    assert.match(refusal(repo), /no vX\.Y\.Z tag/)
  })
})

describe('next-version: git config rules (AC5)', () => {
  it('should read no version files as not opted in', () => {
    assert.equal(validateGitSection({}), null)
    assert.equal(validateGitSection({ tagFormat: 'DDMMMYYYY-XX' }), null)
    assert.equal(validateGitSection({ tagFormat: 'DDMMMYYYY-XX', versionFiles: [] }), null)
  })

  it('should refuse version files with any tag format other than vX.Y.Z', () => {
    assert.throws(() => validateGitSection({ tagFormat: 'DDMMMYYYY-XX', versionFiles: ['version.txt'] }), /tagFormat/)
    assert.throws(() => validateGitSection({ versionFiles: ['version.txt'] }), /tagFormat/)
  })

  it('should refuse the vX.Y.Z format with no version files', () => {
    assert.throws(() => validateGitSection({ tagFormat: 'vX.Y.Z' }), /versionFiles/)
    assert.throws(() => validateGitSection({ tagFormat: 'vX.Y.Z', versionFiles: [] }), /versionFiles/)
  })

  it('should refuse bad versionFiles and changelogFile values', () => {
    for (const versionFiles of ['version.txt', [1], [''], ['../outside.txt'], ['/etc/passwd'], ['C:\\outside.txt']]) {
      assert.throws(() => validateGitSection({ tagFormat: 'vX.Y.Z', versionFiles }), /versionFiles/, JSON.stringify(versionFiles))
    }
    for (const changelogFile of [1, '', null, '../outside.md']) {
      assert.throws(() => validateGitSection({ tagFormat: 'vX.Y.Z', versionFiles: ['version.txt'], changelogFile }), /changelogFile/, JSON.stringify(changelogFile))
    }
  })

  it('should refuse a bad base branch', () => {
    assert.throws(() => validateGitSection({ tagFormat: 'vX.Y.Z', versionFiles: ['version.txt'], baseBranch: ' ' }), /baseBranch/)
  })

  it('should return the files with the documented defaults', () => {
    assert.deepEqual(validateGitSection({ tagFormat: 'vX.Y.Z', versionFiles: ['version.txt'] }), {
      versionFiles: ['version.txt'], changelogFile: null, baseBranch: 'develop',
    })
  })
})

describe('next-version: config source (AC5)', () => {
  it('should report not enabled with no config file', () => {
    assert.deepEqual(plan(makeRepo({ config: null, tag: null })), { enabled: false })
  })

  it('should report not enabled with a config that lists no version files', () => {
    assert.deepEqual(plan(makeRepo({ config: { git: { tagFormat: 'DDMMMYYYY-XX' } }, tag: null })), { enabled: false })
  })

  it('should refuse a config that cannot be parsed, so it never reads as opted out', () => {
    assert.match(refusal(makeRepo({ config: '{ not json' })), /engineering\.json/)
    assert.match(refusal(makeRepo({ config: '[]' })), /engineering\.json/)
    assert.match(refusal(makeRepo({ config: { git: 1 } })), /"git"/)
  })

  it('should refuse an opt-in that is only in the working copy', () => {
    const repo = makeRepo({ config: null })
    commit(repo, 'fix: a')
    write(repo, '.claude/engineering.json', JSON.stringify(OPTED_IN))
    assert.match(refusal(repo), /base branch/)
  })

  it('should refuse a working-copy config with no version files, so an unreadable base never reads as opted out', () => {
    const repo = makeRepo({ config: null, tag: null })
    write(repo, '.claude/engineering.json', '{}')
    assert.match(refusal(repo), /base branch/)
  })

  it('should refuse when the base-branch config names a different base branch', () => {
    const repo = makeRepo({ config: { git: { ...OPTED_IN.git, baseBranch: 'dev' } } })
    git(repo, 'branch', 'dev')
    commit(repo, 'fix: a')
    write(repo, '.claude/engineering.json', JSON.stringify({ git: { ...OPTED_IN.git, baseBranch: 'develop' } }))
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'fix: move the base')
    git(repo, 'checkout', '-q', 'dev')
    write(repo, '.claude/engineering.json', JSON.stringify({ git: { ...OPTED_IN.git, baseBranch: 'develop' } }))
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'fix: names develop on dev')
    git(repo, 'checkout', '-q', '-b', 'feat/x', 'dev~1')
    assert.match(refusal(repo), /baseBranch/)
  })

  it('should refuse a changelog file the base branch does not have', () => {
    const repo = makeRepo({ config: { git: { tagFormat: 'vX.Y.Z', versionFiles: ['version.txt'], changelogFile: 'NOPE.md' } } })
    commit(repo, 'fix: a')
    assert.match(refusal(repo), /NOPE\.md/)
  })

  it('should use the configured base branch', () => {
    const repo = makeRepo({ config: { git: { ...OPTED_IN.git, baseBranch: 'dev' } } })
    git(repo, 'branch', '-m', 'develop', 'dev')
    commit(repo, 'fix: a')
    git(repo, 'checkout', '-q', '-b', 'feat/x')
    commit(repo, 'feat: b', 'other.txt')
    assert.equal(plan(repo).computedLevel, 'patch')
  })

  it('should report the listed files when opted in', () => {
    const repo = makeRepo()
    commit(repo, 'fix: a')
    const p = plan(repo)
    assert.equal(p.enabled, true)
    assert.deepEqual(p.versionFiles, ['version.txt'])
    assert.equal(p.changelogFile, 'CHANGES.md')
  })
})
