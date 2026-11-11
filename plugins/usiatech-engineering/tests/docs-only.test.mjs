import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after } from 'node:test'
import { isDocsOnly, instructionImports } from '../skills/verify/docs-only.mjs'
import { tempDir, cleanupTempDirs } from './helpers.mjs'

after(cleanupTempDirs)

const tree = (files) => {
  const root = tempDir('usiatech-docs-only-')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  return { root, files: Object.keys(files) }
}

describe('instruction imports', () => {
  it('should follow @path imports from instruction files, relative to each file, up to five levels', () => {
    const { root, files } = tree({
      'CLAUDE.md': 'See @docs/style.md and email a@b.com.\n',
      'docs/style.md': 'More: @./deep/one.md\n',
      'docs/deep/one.md': '@two.md\n',
      'docs/deep/two.md': '@three.md\n',
      'docs/deep/three.md': '@four.md\n',
      'docs/deep/four.md': '@five.md\n',
      'docs/deep/five.md': 'end\n',
      'apps/web/AGENTS.md': 'Rules in @rules/api.md, home @~/x.md, outside @../../../x.md\n',
      'apps/web/rules/api.md': 'api\n',
      'docs/plain.md': 'not imported\n'
    })
    const got = instructionImports(root, files).sort()
    assert.deepEqual(got, ['apps/web/rules/api.md', 'docs/deep/four.md', 'docs/deep/one.md', 'docs/deep/three.md', 'docs/deep/two.md', 'docs/style.md'])
  })

  it('should keep a missing import target, which a branch may have deleted, but not a folder', () => {
    const { root, files } = tree({
      'CLAUDE.md': 'See @docs/gone.md and @docs\n',
      'docs/here.md': 'x\n'
    })
    assert.deepEqual(instructionImports(root, files), ['docs/gone.md'])
  })

  it('should count an imported doc as code', () => {
    assert.equal(isDocsOnly(['docs/style.md'], {}, ['docs/style.md']), false)
    assert.equal(isDocsOnly(['docs/other.md'], {}, ['docs/style.md']), true)
  })
})

describe('docs-only diff rule', () => {
  it('should count plain Markdown files as docs-only', () => {
    assert.equal(isDocsOnly(['README.md', 'docs/adr/0005-x.md', 'docs/guide/Intro.MD'], {}), true)
  })

  it('should not count an empty list as docs-only', () => {
    assert.equal(isDocsOnly([], {}), false)
  })

  it('should not count a diff with any non-Markdown file', () => {
    assert.equal(isDocsOnly(['README.md', 'src/app.mjs'], {}), false)
    assert.equal(isDocsOnly(['notes.txt'], {}), false)
  })

  it('should not count CLAUDE.md or AGENTS.md at any depth, any case', () => {
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'apps/web/CLAUDE.md', 'pkg/agents.md']) {
      assert.equal(isDocsOnly([f], {}), false, f)
    }
  })

  it('should not count Markdown under an instruction folder at any depth', () => {
    for (const f of ['skills/x/SKILL.md', 'plugins/p/agents/r.md', 'commands/c.md', 'a/hooks/h.md', 'templates/t.md', '.github/PULL_REQUEST_TEMPLATE.md', 'plugins/p/Skills/y.md']) {
      assert.equal(isDocsOnly([f], {}), false, f)
    }
  })

  it('should not count the governance rules file, default or configured', () => {
    assert.equal(isDocsOnly(['.claude/governance.md'], {}), false)
    assert.equal(isDocsOnly(['docs/rules.md'], { governance: { rulesFile: 'docs/rules.md' } }), false)
    assert.equal(isDocsOnly(['docs/rules.md'], {}), true)
  })

  it('should not count a default or configured ask path', () => {
    assert.equal(isDocsOnly(['REVIEW.md'], {}), false)
    assert.equal(isDocsOnly(['.claude/plans/active.md'], {}), false)
    assert.equal(isDocsOnly(['docs/security/policy.md'], { governance: { askPaths: ['docs/security/**'] } }), false)
  })

  it('should not count other instruction files and folders at any depth', () => {
    for (const f of ['CLAUDE.local.md', 'a/REVIEW.md', 'output-styles/terse.md', 'apps/web/.claude/notes.md']) {
      assert.equal(isDocsOnly([f], {}), false, f)
    }
  })

  it('should not count version or changelog files, which tests read', () => {
    const cfg = { git: { versionFiles: ['README.md'], changelogFile: 'plugins/p/README.md' } }
    assert.equal(isDocsOnly(['README.md'], cfg), false)
    assert.equal(isDocsOnly(['plugins/p/README.md'], cfg), false)
    assert.equal(isDocsOnly(['docs/guide.md'], cfg), true)
  })

  it('should match a rules file or ask path written with ./, // or backslashes', () => {
    assert.equal(isDocsOnly(['docs/RULES.md'], { governance: { rulesFile: './docs/rules.md' } }), false)
    assert.equal(isDocsOnly(['docs/R.md'], { governance: { rulesFile: 'docs//R.md' } }), false)
    assert.equal(isDocsOnly(['docs/sec/a.md'], { governance: { askPaths: ['docs\\sec\\**'] } }), false)
    assert.equal(isDocsOnly(['docs/sec/a.md'], { governance: { askPaths: ['./docs/sec/**'] } }), false)
  })

  it('should not count Markdown under scripts/ or a docVersions version file, but keep the docVersions changelog a doc', () => {
    assert.equal(isDocsOnly(['plugins/p/scripts/jira-moves.md'], {}), false)
    const cfg = { docVersions: [{ changelog: 'intent/CHANGELOG.md', versionFiles: [{ path: 'intent/README.md', pattern: 'v(.*)' }] }] }
    assert.equal(isDocsOnly(['intent/README.md'], cfg), false)
    assert.equal(isDocsOnly(['intent/CHANGELOG.md', 'intent/goals.md'], cfg), true)
  })

  it('should throw on a wrong config type rather than skip the gate', () => {
    assert.throws(() => isDocsOnly(['README.md'], { governance: [] }), /"governance" is not an object/)
    assert.throws(() => isDocsOnly(['README.md'], { governance: { askPaths: 'docs/**' } }), /askPaths/)
    assert.throws(() => isDocsOnly(['README.md'], { governance: { rulesFile: 3 } }), /rulesFile/)
  })
})
