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

  it('should ship skill "to-spec" that writes a numbered spec from the template', () => {
    assert.ok(skills.includes('to-spec'))
    const text = body(read('skills', 'to-spec', 'SKILL.md'))
    assert.match(text, /docs\/specs\/YYYY-MM-DD-<slug>\.md/)
    assert.match(text, /templates\/spec\.md/)
    assert.match(text, /R1, R2/)
    assert.match(text, /AC1, AC2/)
    assert.match(text, /deferred: <why>/)
  })

  it('should ship skill "to-tickets" that files blocker-aware tickets with a no-GitHub fallback', () => {
    assert.ok(skills.includes('to-tickets'))
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    assert.match(text, /gh auth status/)
    assert.match(text, /Blocked by #NN/)
    assert.match(text, /## Tickets/)
  })

  it('should confirm once before filing and never create labels', () => {
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    assert.match(text, /ask the user once to confirm before filing/i)
    assert.match(text, /Never create labels/)
  })
})

describe('plugin structure: step-3 approve-plan', () => {
  it('should route work by size and record acceptance criteria, tasks and the route', () => {
    const text = body(read('skills', 'approve-plan', 'SKILL.md'))
    for (const s of ['clarify', 'to-spec', 'to-tickets', 'governance-reviewer']) assert.ok(text.includes(`\`${s}\``), s)
    assert.match(text, /5 files or fewer/)
    assert.match(text, /treat as small/)
    assert.match(text, /Route: small/)
    assert.match(text, /\*\*Acceptance criteria:\*\*/)
    assert.match(text, /\*\*Tasks:\*\*/)
    assert.match(text, /only the \*\*Files\*\* section/i)
  })
})

describe('plugin structure: step-3 verify and reviewer', () => {
  it('should make verify report acceptance criteria without changing the gate verdict', () => {
    const text = body(read('skills', 'verify', 'SKILL.md'))
    assert.match(text, /\| AC \| Criterion \| Evidence \| Status \|/)
    assert.match(text, /only if `\.claude\/plans\/active\.md` has an `## Acceptance criteria` section/)
    assert.match(text, /Gate: PASS \(N of M criteria not shown\)/)
    assert.match(text, /decided by the commands only/)
  })

  it('should make governance-reviewer check acceptance criteria and spec consistency', () => {
    const text = body(read('agents', 'governance-reviewer.md'))
    assert.match(text, /7\. \*\*Acceptance criteria\*\* \(change review, only when the plan has an `## Acceptance criteria` section\)/)
    assert.match(text, /`not shown`/)
    assert.match(text, /Plans without the section get no acceptance-criteria findings/)
    assert.match(text, /8\. \*\*Spec consistency\*\* \(pre-flight, only when the plan references a spec\)/)
    assert.match(text, /non-goal/)
  })
})

describe('plugin structure: step-3 review fixes', () => {
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))
  const reviewer = () => body(read('agents', 'governance-reviewer.md'))

  it('should give the spec a scope home on the large route (I1)', () => {
    assert.match(approve(), /add the spec path to \*\*Files\*\*/i)
    assert.match(reviewer(), /every plan File except the referenced spec is needed by at least one task/)
  })

  it('should tick tasks in verify instead of flagging every unchecked task (I2)', () => {
    assert.match(body(read('skills', 'verify', 'SKILL.md')), /`- \[x\]`/)
    assert.doesNotMatch(reviewer(), /unchecked task whose files/)
  })

  it('should scope a large-route plan to one ticket or a listed set (I3)', () => {
    assert.match(approve(), /covers one ticket, or a set the user lists/)
    assert.match(approve(), /only the ACs those tickets cover/)
  })

  it('should record filed issues in the spec so later reviews can see them (I4)', () => {
    assert.match(body(read('skills', 'to-tickets', 'SKILL.md')), /also list each issue in the spec's `## Tickets` section/i)
  })

  it('should not return FLAG in pre-flight just because no plan is approved yet (M5)', () => {
    assert.match(reviewer(), /in pre-flight the proposed plan is the baseline/)
  })
})

describe('plugin structure: step-3 deferred minors', () => {
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))
  const verify = () => body(read('skills', 'verify', 'SKILL.md'))
  const reviewer = () => body(read('agents', 'governance-reviewer.md'))
  const assertBefore = (text, first, second) => {
    const a = text.indexOf(first)
    const b = text.indexOf(second)
    assert.ok(a !== -1, `missing: ${first}`)
    assert.ok(b !== -1, `missing: ${second}`)
    assert.ok(a < b, `"${first}" comes before "${second}"`)
  }

  it('should keep the requirement-reference rule when the user overrides the route (M1)', () => {
    assert.match(approve(), /an override changes the route, not the rule that every plan needs a requirement reference/i)
  })

  it('should write all evidence and task ticks in one edit (M2)', () => {
    assert.match(verify(), /in one edit/)
  })

  it('should stamp evidence and flag stale evidence (M3)', () => {
    assert.match(verify(), /\(shown, <UTC timestamp>\)/)
    assert.match(verify(), /rewrite every evidence line/i)
    assert.match(read('templates', 'plan.md'), /\(shown \| not shown, <UTC timestamp>\)/)
    assert.match(reviewer(), /stamped before the newest modification of a changed file/)
  })

  it('should accept a spec as a reference only once approved (M4)', () => {
    assert.match(approve(), /a spec counts only if it says `Status: approved`/i)
  })

  it('should check for an unfinished plan before routing (M6)', () => {
    assertBefore(approve(), 'already exists and is unfinished', '## Route')
  })

  it('should check GitHub access before confirming and look labels up by exact name (M7)', () => {
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    assertBefore(text, 'gh auth status', 'ask the user once to confirm before filing')
    assert.match(text, /gh label list --search "spec:<slug>" --json name/)
    assert.doesNotMatch(text, /\(`gh label list`\)/)
  })

  it('should not trigger approve-plan on any work without a plan (M8)', () => {
    assert.doesNotMatch(read('skills', 'approve-plan', 'SKILL.md'), /starting work that has no plan yet/)
  })
})

describe('plugin structure: step-4 workflow checks (B10)', () => {
  it('should ship a read-only workflow-reviewer agent', () => {
    assert.ok(agents.includes('workflow-reviewer'))
    assert.match(body(read('agents', 'workflow-reviewer.md')), /pull_request_target/)
  })

  it('should run workflow-reviewer in release stage 2 only when .github/workflows/ changes', () => {
    const text = body(read('skills', 'release', 'SKILL.md'))
    const stage2 = text.slice(text.indexOf('Stage 2'))
    assert.match(stage2, /`workflow-reviewer`[^\n]*`\.github\/workflows\/`/)
  })

  it('should point security-reviewer at workflow-reviewer for depth', () => {
    assert.match(body(read('agents', 'security-reviewer.md')), /`workflow-reviewer`/)
  })

  it('should make governance-reviewer count workflow findings from the guard log', () => {
    const text = body(read('agents', 'governance-reviewer.md'))
    assert.match(text, /`finding`/)
    assert.match(text, /high-risk/)
  })

  it('should say the PR workflow file runs from the PR and how to enforce the gate', () => {
    const readme = read('README.md')
    assert.doesNotMatch(readme, /can't weaken its own gate/)
    assert.match(readme, /runs `pr-governance\.yml` from the PR/)
    assert.match(readme, /Require workflows to pass/)
  })

  it('should ship the config template with no live allowlist entries', () => {
    // A live entry would suppress a finding in every repo that copies the template.
    assert.deepEqual(JSON.parse(read('templates', 'engineering.json')).governance.allowlist, [])
  })

  it('should document an allowlist entry shape that parseAllowlist accepts', async () => {
    const { parseAllowlist } = await import('../templates/github/scripts/governance-rules.mjs')
    const sample = [{ rule: 'wf-unpinned-action', path: '.github/workflows/pr-governance.yml', reason: 'major tag kept on purpose' }]
    assert.deepEqual(parseAllowlist(sample), { entries: [{ rule: 'wf-unpinned-action', path: '.github/workflows/pr-governance.yml' }], problems: [] })
    assert.match(read('README.md'), /"rule": "wf-unpinned-action", "path": "\.github\/workflows\/pr-governance\.yml"/)
  })
})

describe('plugin structure: release metadata', () => {
  it('should keep plugin, marketplace and both README versions in step', () => {
    const version = JSON.parse(read('.claude-plugin', 'plugin.json')).version
    const repo = path.join(PLUGIN_ROOT, '..', '..')
    const market = JSON.parse(readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'))
    assert.equal(market.plugins.find((p) => p.name === 'usiatech-engineering').version, version)
    const v = version.replace(/\./g, '\\.')
    assert.match(read('README.md'), new RegExp(`^\\| ${v} \\|`, 'm'), 'plugin README version row')
    assert.match(readFileSync(path.join(repo, 'README.md'), 'utf8'), new RegExp(`\\| UsiaTech Engineering \\| ${v}\\s*\\|`), 'root README table')
    assert.match(version, /^\d+\.\d+\.\d+$/, 'plugin version is semver (M9)')
  })
})
