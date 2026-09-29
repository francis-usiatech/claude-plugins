// Plugin structure: every skill and agent has valid frontmatter, reviewers stay read-only,
// and the README and engineering.json template only name components that exist.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './helpers.mjs'

const read = (...p) => readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8')
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const frontmatter = (text) => {
  const m = text.match(FRONTMATTER)
  assert.ok(m, 'missing frontmatter')
  const field = (k) => m[1].match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1].trim()
  return { name: field('name'), description: field('description'), tools: field('tools') }
}
const body = (text) => text.replace(FRONTMATTER, '')
const skills = readdirSync(path.join(PLUGIN_ROOT, 'skills'))
const agents = readdirSync(path.join(PLUGIN_ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
const reviewers = agents.filter((a) => a.endsWith('-reviewer'))

describe('plugin structure: skills', () => {
  for (const s of skills) {
    it(`should give skill "${s}" a matching name and a description`, () => {
      const fm = frontmatter(read('skills', s, 'SKILL.md'))
      assert.equal(fm.name, s)
      assert.ok(fm.description && fm.description.length > 40, 'description too short to trigger reliably')
    })
  }
})

describe('plugin structure: agents', () => {
  for (const a of agents) {
    it(`should give agent "${a}" a matching name and read-only tools`, () => {
      const fm = frontmatter(read('agents', `${a}.md`))
      assert.equal(fm.name, a)
      for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
        assert.ok(!new RegExp(`"${t}"`).test(fm.tools || ''), `${a} must not have ${t}`)
      }
    })
  }
})

describe('plugin structure: references', () => {
  it('should only list existing agents as template reviewers', () => {
    const cfg = JSON.parse(read('templates', 'engineering.json'))
    for (const r of cfg.reviewers) assert.ok(agents.includes(r), `unknown reviewer ${r}`)
  })

  it('should list every skill and agent in the README components table', () => {
    const readme = read('README.md')
    for (const n of [...skills, ...agents]) assert.match(readme, new RegExp(`\\| \`${n}\` \\|`), n)
  })

  it('should default to all four reviewers, governance first', () => {
    const cfg = JSON.parse(read('templates', 'engineering.json'))
    assert.deepEqual(cfg.reviewers, ['governance-reviewer', 'convention-reviewer', 'silent-failure-reviewer', 'security-reviewer'])
  })

  it('should review in two stages in release: scope first, then code quality', () => {
    const text = body(read('skills', 'release', 'SKILL.md'))
    const s1 = text.indexOf('Stage 1')
    const s2 = text.indexOf('Stage 2')
    assert.ok(s1 > -1 && s2 > s1, 'Stage 1 must come before Stage 2')
    assert.match(text, /confidence/i)
  })
})

describe('plugin structure: reviewers', () => {
  for (const r of reviewers) {
    it(`should make "${r}" score each finding's confidence`, () => {
      const text = body(read('agents', `${r}.md`))
      assert.match(text, /\*\*Confidence:\*\*/)
      assert.match(text, /Low-confidence notes/)
      assert.match(text, /\b80\b/)
    })
  }
})

describe('plugin structure: step-2 components', () => {
  for (const a of ['silent-failure-reviewer', 'security-reviewer']) {
    it(`should ship agent "${a}"`, () => assert.ok(agents.includes(a)))
  }
  for (const s of ['tdd', 'debug']) {
    it(`should ship skill "${s}"`, () => assert.ok(skills.includes(s)))
  }
})

describe('plugin structure: step-3 templates', () => {
  it('should give the plan template acceptance criteria, tasks and a route line', () => {
    const text = read('templates', 'plan.md')
    const at = (h) => text.indexOf(h)
    assert.ok(at('## Requirement references') < at('## Acceptance criteria'), 'AC after requirement references')
    assert.ok(at('## Acceptance criteria') < at('## Tasks') && at('## Tasks') < at('## Files'), 'AC, then Tasks, then Files')
    assert.match(text, /^- AC1: .+\r?\n\s+- Evidence: /m)
    assert.match(text, /^- \[ \] T1: .+\(covers AC1/m)
    assert.match(text, /^- Route: <small \| large>/m)
  })

  it('should give the spec template every required section', () => {
    const text = read('templates', 'spec.md')
    for (const h of ['## Problem', '## Goals', '## Non-goals', '## Requirements', '## Acceptance criteria',
      '## Constraints & decisions', '## Open questions', '## Tickets']) {
      assert.match(text, new RegExp(`^${h}\\b`, 'm'), h)
    }
    assert.match(text, /Status: draft \| approved/)
  })
})

describe('plugin structure: step-3 skills', () => {
  it('should ship skill "clarify" that asks one question at a time and writes nothing', () => {
    assert.ok(skills.includes('clarify'))
    const text = body(read('skills', 'clarify', 'SKILL.md'))
    assert.match(text, /one question at a time/i)
    assert.match(text, /understanding note/i)
    assert.match(text, /You said/)
    assert.match(text, /I'm assuming/)
    assert.match(text, /Write no files/)
  })
})
