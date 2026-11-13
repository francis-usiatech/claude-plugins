// Plugin structure: every skill and agent has valid frontmatter, reviewers edit no project file,
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
  return {
    name: field('name'), description: field('description'), tools: field('tools'), model: field('model'),
    context: field('context'), agent: field('agent'), background: field('background'),
  }
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

// ESP-119: routine reviewers run on Sonnet; governance and security stay on Opus.
const AGENT_MODELS = {
  'convention-reviewer': 'sonnet',
  'governance-reviewer': 'opus',
  'security-reviewer': 'opus',
  'silent-failure-reviewer': 'sonnet',
  'supply-chain-reviewer': 'sonnet',
  'workflow-reviewer': 'sonnet',
}

describe('plugin structure: agents', () => {
  for (const a of agents) {
    it(`should give agent "${a}" a matching name, its model and no edit tools`, () => {
      const fm = frontmatter(read('agents', `${a}.md`))
      assert.equal(fm.name, a)
      assert.equal(fm.model, AGENT_MODELS[a], `${a} model`)
      // ESP-122: Write is only for the report file in the scratchpad (instruction-only limit).
      assert.match(fm.tools || '', /"Write"/, `${a} needs Write for its report file`)
      for (const t of ['Edit', 'MultiEdit', 'NotebookEdit']) {
        assert.ok(!new RegExp(`"${t}"`).test(fm.tools || ''), `${a} must not have ${t}`)
      }
    })

    it(`should cap agent "${a}" replies and send the full report to the scratchpad`, () => {
      const text = body(read('agents', `${a}.md`))
      assert.match(text, /\*\*Reply size:\*\*/)
      assert.match(text, /session scratchpad/)
      assert.match(text, /at most 30 lines and under 3 KB/i)
      assert.match(text, /Write no other file/)
      // ESP-124: the agent has no clock, so it asks the shell for the report name's timestamp.
      assert.match(text, /`date -u \+%Y%m%dT%H%M%S`/)
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

  it('should pick each reviewer model from base-branch reviewerModels, then the agent file (ESP-119)', () => {
    const release = body(read('skills', 'release', 'SKILL.md'))
    assert.match(release, /\*\*Models:\*\*/)
    assert.match(release, /`reviewerModels\[<agent>\]` from the base-branch `\.claude\/engineering\.json`/)
    assert.match(release, /agent file's `model`/)
    assert.match(release, /5 files or fewer, counting every file, runs `governance-reviewer` on `sonnet`/)
    const plan = body(read('skills', 'approve-plan', 'SKILL.md'))
    assert.match(plan, /`governance-reviewer` on `sonnet` when the plan's \*\*Files\*\* section lists 5 paths or fewer/)
    assert.match(plan, /`reviewerModels`/)
    const cfg = JSON.parse(read('templates', 'engineering.json'))
    assert.ok(cfg.reviewerModels && typeof cfg.reviewerModels === 'object', 'template documents reviewerModels')
  })

  // ESP-118: a forked skill runs as a subagent without session history; background: false keeps every tool.
  for (const s of ['verify', 'release-steps']) {
    it(`should run "${s}" as a forked foreground subagent that returns decisions as a list`, () => {
      const text = read('skills', s, 'SKILL.md')
      const fm = frontmatter(text)
      assert.equal(fm.context, 'fork')
      assert.equal(fm.agent, 'general-purpose')
      assert.equal(fm.background, 'false')
      assert.match(body(text), /no session history/)
      assert.match(body(text), /open decisions as a list/i)
      assert.match(body(text), /never ask the user yourself/i)
    })
  }

  // ESP-144: release-steps is mechanical; verify judges acceptance criteria, so it stays on the session model.
  it('should run release-steps on sonnet and leave verify on the session model', () => {
    assert.equal(frontmatter(read('skills', 'release-steps', 'SKILL.md')).model, 'sonnet')
    assert.equal(frontmatter(read('skills', 'verify', 'SKILL.md')).model, undefined)
    assert.match(read('README.md'), /`verify` stays on the session model because it judges acceptance criteria/)
  })

  // security-guidance reviews commits and pushes only when they run through the Bash tool.
  it('should tell release-steps to commit and push through the Bash tool', () => {
    assert.match(read('skills', 'release-steps', 'SKILL.md'), /`git commit` and `git push` through the Bash tool/)
  })

  it('should take AC evidence the repo cannot show from the verify arguments (ESP-118)', () => {
    const text = read('skills', 'verify', 'SKILL.md')
    assert.match(frontmatter(text).description, /pass.*evidence/i)
    assert.match(body(text), /evidence list passed in the arguments/)
    assert.doesNotMatch(body(text), /evidence produced in this session/)
  })

  it('should keep reviews in release and hand the mechanical steps to release-steps (ESP-118, ESP-122)', () => {
    const release = body(read('skills', 'release', 'SKILL.md'))
    assert.match(release, /`release-steps`/)
    assert.match(release, /nits for the PR from the report files/)
    assert.doesNotMatch(release, /git push origin --delete/, 'clean-up lives in release-steps')
    const steps = body(read('skills', 'release-steps', 'SKILL.md'))
    for (const s of ['Commit once', 'Pull request into the base branch', 'Tag with the configured format', 'git push origin --delete']) {
      assert.ok(steps.includes(s), s)
    }
  })

  it('should run session-check first in release and approve-plan, as advice only (ESP-120, ESP-121)', () => {
    const release = body(read('skills', 'release', 'SKILL.md'))
    const check = release.indexOf('## 0. Session check')
    assert.ok(check > -1 && check < release.indexOf('## 1. Commit'), 'release runs the check before step 1')
    const plan = body(read('skills', 'approve-plan', 'SKILL.md'))
    assert.ok(plan.indexOf('session-check.mjs') > -1 && plan.indexOf('session-check.mjs') < plan.indexOf('## Route'), 'approve-plan runs it before routing')
    assert.match(plan, /already closed a plan/)
    for (const t of [release, plan]) {
      assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/session-check\.mjs"/)
      assert.match(t, /Don't block/)
    }
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
    assert.match(text, /5 production-code files or fewer/)
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
    assert.match(text, /decided by the commands and the fake-pass check only/)
  })

  it('should make verify use the fake-pass check the runner ran first and fail the gate on a fail finding (AC8, ESP-158)', () => {
    const text = body(read('skills', 'verify', 'SKILL.md'))
    const step = text.match(/^\d+\. \*\*Check test content \(fp-\*\)\*\*[\s\S]*?(?=^\d+\. \*\*)/m)?.[0]
    assert.ok(step, 'verify has no "Check test content (fp-*)" step')
    assert.match(step, /the runner already ran this check, first/)
    assert.match(step, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/templates\/github\/scripts\/fake-pass-check\.mjs"/)
    assert.match(step, /\*\*Gate: FAIL\*\*/)
    assert.match(step, /list every finding/i)
    assert.ok(text.indexOf('Check test content (fp-*)') < text.indexOf('Check acceptance criteria'), 'fp step comes before the acceptance criteria')
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
  // Positions of first and second in text; each test asserts the order itself so the fp-no-assert check sees it.
  const positions = (text, first, second) => [text.indexOf(first), text.indexOf(second)]

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
    const [check, route] = positions(approve(), 'already exists and is unfinished', '## Route')
    assert.ok(check !== -1 && route !== -1 && check < route, `unfinished-plan check at ${check}, route at ${route}`)
  })

  it('should check GitHub access before confirming and look labels up by exact name (M7)', () => {
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    const [auth, confirm] = positions(text, 'gh auth status', 'ask the user once to confirm before filing')
    assert.ok(auth !== -1 && confirm !== -1 && auth < confirm, `gh auth status at ${auth}, confirm at ${confirm}`)
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
    assert.deepEqual(parseAllowlist(sample), { entries: [{ rule: 'wf-unpinned-action', path: '.github/workflows/pr-governance.yml', reason: 'major tag kept on purpose' }], problems: [] })
    assert.match(read('README.md'), /"rule": "wf-unpinned-action", "path": "\.github\/workflows\/pr-governance\.yml"/)
  })
})

describe('plugin structure: step-4 supply-chain checks (B9; AC15)', () => {
  it('should ship a supply-chain-reviewer agent that edits no project file and covers the sc-* findings', () => {
    assert.ok(agents.includes('supply-chain-reviewer'))
    const text = body(read('agents', 'supply-chain-reviewer.md'))
    for (const rule of ['sc-typosquat', 'sc-advisory', 'sc-lockfile-drift', 'sc-install-script']) assert.match(text, new RegExp(`\`${rule}\``), rule)
    assert.match(text, /Never edit project files/)
  })

  it('should run supply-chain-reviewer in release stage 2 only when a manifest or lockfile changes', () => {
    const text = body(read('skills', 'release', 'SKILL.md'))
    const line = text.slice(text.indexOf('Stage 2')).split('\n')[0]
    assert.match(line, /`supply-chain-reviewer`/)
    for (const f of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) assert.ok(line.includes(`\`${f}\``), f)
  })

  it('should point security-reviewer at supply-chain-reviewer for depth', () => {
    assert.match(body(read('agents', 'security-reviewer.md')), /`supply-chain-reviewer`/)
  })

  it('should show a package allowlist entry in the config template that parseAllowlist accepts', async () => {
    const { parseAllowlist } = await import('../templates/github/scripts/governance-rules.mjs')
    const comment = JSON.parse(read('templates', 'engineering.json')).governance.$comment
    const sample = comment.match(/\{"rule": "sc-[^}]*"package"[^}]*\}/)?.[0]
    assert.ok(sample, 'no sc-* package example in governance.$comment')
    const parsed = parseAllowlist([JSON.parse(sample)])
    assert.deepEqual(parsed.problems, [])
    assert.ok(parsed.entries[0].package && !parsed.entries[0].path)
  })

  it('should record the guard network lookups in ADR 0001 and resolve the spec questions it answers', () => {
    const repo = path.join(PLUGIN_ROOT, '..', '..')
    const adr = readFileSync(path.join(repo, 'docs', 'adr', '0001-guard-network-lookups.md'), 'utf8')
    assert.match(adr, /^Status: (Proposed|Accepted)/m)
    assert.match(adr, /registry\.npmjs\.org/)
    const spec = readFileSync(path.join(repo, 'docs', 'specs', '2026-09-28-security-supply-chain.md'), 'utf8')
    const open = spec.slice(spec.indexOf('## Open questions'), spec.indexOf('## Tickets'))
    for (const q of ['advisory source', 'popular-package list']) assert.match(open, new RegExp(`${q}[^\\n]*Resolved`, 'i'), q)
    assert.match(spec, /0001-guard-network-lookups\.md/)
  })

  it('should make governance-reviewer count dependency findings and lookup fail-opens', () => {
    const text = body(read('agents', 'governance-reviewer.md'))
    assert.match(text, /`sc-\*`/)
    assert.match(text, /lookup failed open/)
  })
})

describe('plugin structure: shipped CI kit hardening (#13)', () => {
  const WORKFLOW = path.join('templates', 'github', 'workflows', 'pr-governance.yml')
  const aiReview = async () => {
    const { parseWorkflowYaml } = await import('../templates/github/scripts/workflow-rules.mjs')
    const job = parseWorkflowYaml(read(WORKFLOW)).doc.jobs['ai-governance-review']
    const action = job.steps.find((s) => String(s.uses).startsWith('anthropics/claude-code-action@'))
    assert.ok(action, 'no claude-code-action step')
    return { job, action }
  }

  it('should pass its own workflow rules with no unpinned action and no parse problem (AC1)', async () => {
    const { checkWorkflow } = await import('../templates/github/scripts/workflow-rules.mjs')
    const findings = checkWorkflow({ file: '.github/workflows/pr-governance.yml', content: read(WORKFLOW) })
    assert.deepEqual(findings.filter((f) => ['wf-unpinned-action', 'wf-unparsed'].includes(f.rule)), [])
    const { action } = await aiReview()
    assert.match(action.uses, /^anthropics\/claude-code-action@[0-9a-f]{40}$/)
  })

  it('should pin every container image to a digest and never use :latest (AC2)', () => {
    const images = read(WORKFLOW).match(/\b(?:ghcr\.io|docker\.io|quay\.io)\/\S+/g) ?? []
    assert.ok(images.length > 0, 'no container image found')
    for (const image of images) {
      assert.match(image, /@sha256:[0-9a-f]{64}$/, image)
      assert.doesNotMatch(image, /:latest\b/, image)
    }
  })

  it('should keep the PR\'s own .claude settings, hooks and MCP servers out of the AI review (AC3)', async () => {
    const { action } = await aiReview()
    assert.match(action.with.claude_args, /--setting-sources user\b/)
  })

  it('should give the AI review no Bash tool and hand it a pre-generated diff and log instead (AC4)', async () => {
    const { job, action } = await aiReview()
    const tools = action.with.claude_args.match(/--allowedTools "([^"]*)"/)?.[1]
    assert.ok(tools, 'no --allowedTools')
    assert.doesNotMatch(tools, /Bash/)
    const before = job.steps.slice(0, job.steps.indexOf(action)).map((s) => s.run ?? '').join('\n')
    for (const file of ['.pr-diff.patch', '.pr-log.txt']) {
      assert.ok(before.includes(`> ${file}`), `${file} not written before the review`)
      assert.ok(action.with.prompt.includes(`\`${file}\``), `${file} not named in the prompt`)
    }
  })

  it('should ship a governance ruleset template and apply it only after approval (AC5)', () => {
    const ruleset = JSON.parse(read('templates', 'ruleset-governance.json'))
    const rule = (type) => ruleset.rules.find((r) => r.type === type)
    assert.deepEqual(rule('required_status_checks').parameters.required_status_checks.map((c) => c.context), ['governance-gate'])
    assert.equal(rule('pull_request').parameters.require_code_owner_review, true)
    const setup = body(read('skills', 'setup-engineering', 'SKILL.md'))
    assert.match(setup, /`templates\/ruleset-governance\.json`[^\n]*after the user approves/)
    const readme = read('README.md')
    assert.match(readme, /`templates\/ruleset-governance\.json`/)
    assert.match(readme, /required status check alone does not stop/i)
  })

  it('should keep review on for solo owners and let the admin bypass each PR on the record (fix A)', () => {
    const ruleset = JSON.parse(read('templates', 'ruleset-governance.json'))
    assert.deepEqual(ruleset.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }])
    const setup = body(read('skills', 'setup-engineering', 'SKILL.md'))
    assert.doesNotMatch(setup, /require_code_owner_review` to `false/)
    assert.match(setup, /unprotected/)
    assert.doesNotMatch(read('templates', 'github', 'CODEOWNERS'), /keep that setting OFF/)
  })

  it('should refuse to apply the ruleset while CODEOWNERS or the ruleset still hold placeholders (fix B)', () => {
    const setup = body(read('skills', 'setup-engineering', 'SKILL.md'))
    const step = setup.split('\n').find((l) => l.includes('ruleset-governance.json'))
    for (const placeholder of ['@OWNER', '<baseBranch>', '<releaseBranch>']) assert.ok(step.includes(`\`${placeholder}\``), placeholder)
    assert.match(step, /before the POST/)
  })

  it('should stop the AI review reading the runner\'s credentials and environment (fix C)', async () => {
    const { job, action } = await aiReview()
    for (const step of job.steps.filter((s) => String(s.uses).startsWith('actions/checkout@'))) {
      assert.equal(String(step.with['persist-credentials']), 'false', JSON.stringify(step.with))
    }
    const denied = action.with.claude_args.match(/--disallowedTools "([^"]*)"/)?.[1] ?? ''
    for (const rule of ['Read(//proc/**)', 'Read(~/.claude/**)', 'Read(//home/runner/work/_temp/**)', 'Read(./.git/**)']) assert.ok(denied.split(',').includes(rule), rule)
  })

  it('should never deny a read inside the workspace, which sits under the runner home folder', async () => {
    const { action } = await aiReview()
    const denied = action.with.claude_args.match(/--disallowedTools "([^"]*)"/)?.[1] ?? ''
    const workspaceFile = '/home/runner/work/repo/repo/.pr-diff.patch'
    for (const rule of denied.split(',')) {
      const prefix = rule.replace(/^Read\((.*)\)$/, '$1').replace(/^~/, '/home/runner').replace(/^\/\//, '/').replace(/\*\*$/, '')
      assert.ok(!workspaceFile.startsWith(prefix), `${rule} denies ${workspaceFile}`)
    }
  })

  it('should diff every file as text so .gitattributes cannot hide it from the review (fix D)', async () => {
    const { job } = await aiReview()
    const diff = job.steps.map((s) => s.run ?? '').join('\n').split('\n').find((l) => l.includes('> .pr-diff.patch'))
    assert.match(diff, /git diff --text --no-ext-diff /)
  })
})

describe('plugin structure: step-4.2 fake-pass docs (#21, R18)', () => {
  const readme = () => read('README.md')

  it('should document every fp-* rule with its tier in a README rule table', async () => {
    const { checkFakePasses } = await import('../templates/github/scripts/fake-pass-rules.mjs')
    const tiers = { 'fp-only': 'high', 'fp-skip': 'high', 'fp-empty-test': 'high', 'fp-no-assert': 'high', 'fp-unreadable': 'high', 'fp-placeholder': 'warning' }
    for (const [rule, tier] of Object.entries(tiers)) assert.match(readme(), new RegExp(`^\\| \`${rule}\` \\| ${tier} \\| `, 'm'), rule)
    // The table's tiers are the module's: a focused test is high, a placeholder a warning.
    assert.equal(checkFakePasses({ file: 'a.test.mjs', content: "it.only('x', () => { assert.ok(1) })\n" })[0].tier, tiers['fp-only'])
    // The marker is built from pieces so this file doesn't trip fp-placeholder itself (#26).
    assert.equal(checkFakePasses({ file: 'a.mjs', content: `// ${'TO' + 'DO'}\n` })[0].tier, tiers['fp-placeholder'])
  })

  it('should document an fp allowlist entry that parseAllowlist accepts, the limits and the upgrade step', async () => {
    const { parseAllowlist } = await import('../templates/github/scripts/governance-rules.mjs')
    const sample = [{ rule: 'fp-no-assert', path: 'tests/helpers-assert.test.mjs', reason: 'assertions live in a helper' }]
    assert.deepEqual(parseAllowlist(sample).problems, [])
    assert.match(readme(), /"rule": "fp-no-assert", "path": "tests\/helpers-assert\.test\.mjs"/)
    assert.match(readme(), /`fake-pass-check\.mjs`/)
    assert.match(readme(), /pattern based/i)
    assert.match(readme(), /re-copy `templates\/github\/scripts\/`[^\n]*fake-pass/)
  })
})

describe('plugin structure: step-4.2 mutation-test (#22, AC14, R18)', () => {
  const skill = () => read('skills', 'mutation-test', 'SKILL.md')

  it('should describe mutation-test with its triggers and the runner it ships', () => {
    const fm = frontmatter(skill())
    assert.match(fm.description, /mutation/i)
    assert.match(fm.description, /"mutation test"|"mutate"/)
    assert.match(body(skill()), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/mutation-test\/mutation-runner\.mjs" --list /)
  })

  it('should document the mutation list format and every status the runner reports', () => {
    for (const key of ['label', 'file', 'find', 'replace', 'command', 'timeoutMs']) assert.match(skill(), new RegExp(`"${key}"`), key)
    for (const status of ['CAUGHT', 'SURVIVED', 'NOT-FOUND', 'TIMEOUT', 'ERROR']) assert.match(skill(), new RegExp(`\`${status}\``), status)
    assert.match(skill(), /baseline failed/i)
  })

  it('should have the user confirm the list commands before the run and say how to recover from a killed run', () => {
    assert.match(skill(), /shell with the user's privileges/i)
    assert.match(skill(), /show the user[^\n]*distinct `"command"`[^\n]*confirm/i)
    assert.match(skill(), /git checkout -- <file>/)
  })

  it('should report each survivor as a missing test, ask the user and never block', () => {
    assert.match(skill(), /`SURVIVED`[^\n]*missing test/)
    assert.match(skill(), /ask the user whether to add/i)
    assert.match(skill(), /never block/i)
  })

  it('should have release stage 2 suggest mutation-test for guard, rule, check and policy paths, not gate on it', () => {
    const release = read('skills', 'release', 'SKILL.md')
    const line = release.split('\n').find((l) => l.includes('`mutation-test`'))
    assert.ok(line, 'release must mention `mutation-test`')
    for (const p of ['*rules*.mjs', '*checks*.mjs', '*policy*.mjs', '*guard*.mjs', 'governance.askPaths']) assert.ok(line.includes(p), p)
    assert.match(line, /suggest/i)
    assert.match(line, /not a gate/i)
  })

  it('should document the runner report and exit codes in the README', () => {
    const readme = read('README.md')
    assert.match(readme, /`mutation-runner\.mjs`/)
    assert.match(readme, /`CAUGHT`[^\n]*`SURVIVED`[^\n]*`NOT-FOUND`[^\n]*`TIMEOUT`[^\n]*`ERROR`/)
    assert.match(readme, /exit[^\n]*0[^\n]*1[^\n]*baseline[^\n]*2[^\n]*invalid[^\n]*3[^\n]*restore failed/i)
  })
})

describe('plugin structure: pre-flight reviewers (ESP-67; spec R10, R11, AC9)', () => {
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))

  it('should run each planning.preflightReviewers entry on the draft in design mode, in parallel with governance-reviewer (a)', () => {
    assert.match(approve(), /`planning\.preflightReviewers`[^\n]*design mode[^\n]*in parallel with `governance-reviewer`/)
  })

  it('should match a reviewer\'s when prefixes against the plan\'s Files section, and always run one without when (b)', () => {
    assert.match(approve(), /`when`[^\n]*prefix[^\n]*\*\*Files\*\*/)
    assert.match(approve(), /without `when` always runs/)
  })

  it('should merge every BLOCK and FLAG into the one batched decision, labelled with the reviewer that raised it (c)', () => {
    assert.match(approve(), /BLOCK[^\n]*FLAG[^\n]*every pre-flight reviewer, each labelled with the reviewer that raised it[^\n]*one question/i)
  })

  it('should require a BLOCK from any pre-flight reviewer to be fixed (d)', () => {
    assert.match(approve(), /`BLOCK` from any pre-flight reviewer must be fixed/)
  })

  it('should report a reviewer that fails or is not installed by name, not as a pass (e)', () => {
    assert.match(approve(), /fails or isn't installed[^\n]*by name[^\n]*not (count as )?a pass/)
  })

  it('should skip an invalid entry and name it in the pre-flight report (f)', () => {
    assert.match(approve(), /invalid entry[^\n]*skip[^\n]*pre-flight report/i)
  })

  it('should treat an agent outside the name pattern as invalid and name a skipped entry by its index, not its name (ESP-72, ESP-73)', () => {
    assert.match(approve(), /invalid entry[^\n]*an `agent` that doesn't match `\^\[A-Za-z0-9\._:-\]\+\$`/)
    assert.match(approve(), /by its index, `planning\.preflightReviewers\[i\]`, never by its `agent` value/)
  })

  it('should give each pre-flight reviewer only the draft plan (ESP-72)', () => {
    assert.match(approve(), /Give each one only the draft plan/)
  })
})

describe('plugin structure: pre-plan checklist (ESP-66; spec R6, R7, R8, AC6, AC7)', () => {
  const template = () => read('templates', 'plan.md')
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))
  const reviewer = () => body(read('agents', 'governance-reviewer.md'))

  it('should give the plan template a Pre-plan checklist section between Requirement references and Acceptance criteria (plan AC1 / spec AC6)', () => {
    const text = template()
    const at = (h) => text.indexOf(h)
    assert.ok(at('## Requirement references') > -1, 'missing Requirement references section')
    assert.ok(at('## Pre-plan checklist') > -1, 'missing Pre-plan checklist section')
    assert.ok(at('## Requirement references') < at('## Pre-plan checklist'), 'checklist after requirement references')
    assert.ok(at('## Pre-plan checklist') < at('## Acceptance criteria'), 'checklist before acceptance criteria')
  })

  it('should list items (a)–(c) in the template and allow n/a with a reason (plan AC1 / spec AC6)', () => {
    const text = template()
    assert.match(text, /^- \(a\) [^\n]*validation[^\n]*callers[^\n]*fixtures/im)
    assert.match(text, /^- \(b\) [^\n]*database or infrastructure[^\n]*spike/im)
    assert.match(text, /^- \(c\) [^\n]*docs and ADRs/im)
    assert.match(text, /`n\/a: <reason>`/)
  })

  it('should tell Claude to fill the checklist before drafting the rest of the plan (plan AC2 / spec AC6)', () => {
    assert.match(approve(), /\*\*Pre-plan checklist:\*\*[^\n]*before drafting the rest of the plan/)
  })

  it('should describe items (a)–(c) in approve-plan (plan AC2 / spec AC6)', () => {
    const text = approve()
    assert.match(text, /\(a\)[^\n]*validation rule or format check[^\n]*callers and test fixtures/)
    assert.match(text, /\(b\)[^\n]*database or infrastructure mechanism[^\n]*throwaway spike[^\n]*why none is needed/)
    assert.match(text, /\(c\)[^\n]*docs and ADRs/)
  })

  it('should allow n/a with a reason but not a bare n/a (plan AC2 / spec AC6)', () => {
    assert.match(approve(), /`n\/a: <reason>`[^\n]*bare `n\/a`/)
  })

  it('should answer (c) from a search before pre-flight, then add a configured docs reviewer\'s findings (plan AC2 / spec AC6)', () => {
    const text = approve()
    assert.match(text, /\(c\)[^\n]*from a search[^\n]*before pre-flight/)
    assert.match(text, /docs reviewer[^\n]*`planning\.preflightReviewers`[^\n]*description says it reviews docs[^\n]*add its findings to \(c\)/)
    assert.match(text, /name which reviewer was treated as the docs reviewer/)
  })

  it('should keep (c) from widening scope (plan AC2 / spec AC6)', () => {
    assert.match(approve(), /Paths named in \(c\) don't widen scope: only the \*\*Files\*\* section does/)
  })

  it('should not write active.md while a checklist item is empty, a placeholder or a bare n/a (plan AC2 / spec AC6)', () => {
    assert.match(approve(), /^3\. [^\n]*Don't write `\.claude\/plans\/active\.md` while a Pre-plan checklist item is empty, still the template placeholder or a bare `n\/a`/m)
  })

  it('should make the governance-reviewer pre-flight FLAG a missing checklist section (plan AC3 / spec AC7)', () => {
    assert.match(reviewer(), /\*\*Pre-plan checklist\*\* \(pre-flight only[^\n]*`FLAG`[^\n]*no `## Pre-plan checklist` section/)
  })

  it('should FLAG an item that is missing, empty, still the placeholder or a bare n/a (plan AC3 / spec AC7)', () => {
    const text = reviewer()
    assert.match(text, /\*\*Pre-plan checklist\*\*[^\n]*missing, empty or still the template placeholder/)
    assert.match(text, /\*\*Pre-plan checklist\*\*[^\n]*bare `n\/a` with no reason/)
  })

  it('should not check the checklist in change reviews (plan AC3 / spec AC7)', () => {
    assert.match(reviewer(), /\*\*Pre-plan checklist\*\*[^\n]*Change reviews don't check it/)
  })

  it('should document the pre-plan checklist in the README approve-plan row and the 0.18.0 row (plan AC4 / spec AC14)', () => {
    const readme = read('README.md')
    assert.match(readme, /^\| Skill \| `approve-plan` \|[^\n]*pre-plan checklist/im)
    assert.match(readme, /^\| 0\.18\.0 \|[^\n]*pre-plan checklist/im)
    assert.match(readme, /^\| 0\.18\.0 \|[^\n]*\*\*Upgrade:\*\*[^\n]*pre-plan checklist needs no opt-in/im)
  })
})

describe('plugin structure: batch decisions (ESP-33; spec AC1–AC5)', () => {
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))
  const release = () => body(read('skills', 'release', 'SKILL.md'))

  it('should batch pre-flight decisions in approve-plan with a recommended default, unless decisions.batch is false (AC1)', () => {
    assert.match(approve(), /one question/i)
    assert.match(approve(), /recommended default/i)
    assert.match(approve(), /`decisions\.batch`[^\n]*`false`/)
  })

  it('should stop after stage 1 only on a FLAG and otherwise ask once after stage 2, blocking findings excluded (AC2)', () => {
    const text = release()
    assert.match(text, /\*\*Stage 1[^\n]*FLAG[^\n]*one question/i)
    assert.match(text, /after stage 2[^\n]*one question[^\n]*recommended default/i)
    assert.match(text, /\*\*Decisions:\*\*[^\n]*the `mutation-test` suggestion/)
    assert.match(text, /blocking findings[^\n]*(not|never)[^\n]*(batch|decision)/i)
    assert.match(text, /`decisions\.batch`[^\n]*`false`/)
  })

  it('should record FLAG decisions in the plan change log in both skills (AC3)', () => {
    assert.match(approve(), /FLAG[^\n]*decision[^\n]*change log/i)
    assert.match(release(), /FLAG[^\n]*decision[^\n]*change log[^\n]*one question/i)
  })

  it('should say nits listed in the PR need no decision unless decisions.nitsNeedDecision is true (AC4)', () => {
    assert.match(release(), /nits[^\n]*PR[^\n]*no decision[^\n]*`decisions\.nitsNeedDecision`[^\n]*`true`/i)
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

  it('should keep the version bump steps in the release skill, in order (ESP-23 AC6)', () => {
    const release = body(read('skills', 'release', 'SKILL.md'))
    const steps = [/scripts\/next-version\.mjs/, /wait for the user to confirm or override the level/, /runs the `verify` gate with no reviewer round/, /`chore\(release\): <next>` PR into the base branch/, /Once that PR has merged, promote and tag/, /phase `release`/]
    let from = release.indexOf('## 3. Release')
    assert.notEqual(from, -1, 'release section')
    for (const step of steps) {
      const at = release.slice(from).search(step)
      assert.notEqual(at, -1, `missing or out of order: ${step}`)
      from += at
    }
    assert.match(release, /`"bumpMerged":true`[^\n]*go on to promote, and don't bump again/, 'a merged bump is promoted, not bumped twice')
    assert.match(release, /`commitsAfterBump` is above zero[^\n]*ask the user before promoting/, 'commits after the bump need a decision')
    assert.match(release, /record the computed level, the chosen level and the reason in the commit body/, 'an override is recorded')
    assert.match(release, /only the listed version files and the changelog row runs the `verify` gate with no reviewer round/, 'bump PR review path')
    assert.match(release, /each changed line in a version file differs by the version string alone and the changelog change is one added row/, 'the review skip is scoped by content, not only by file')
  })

  it('should assign the docs-set version before promotion, with the verify-only bump path (ESP-153; AC7)', () => {
    const release = body(read('skills', 'release', 'SKILL.md'))
    const docs = release.slice(release.indexOf('**Docs-set version'), release.indexOf('Run `release-steps` with phase `release`'))
    assert.match(docs, /scripts\/doc-versions\.mjs/)
    assert.match(docs, /`after` command/)
    assert.match(docs, /runs the `verify` gate with no reviewer round/)
    assert.match(docs, /any other diff gets the full review/)
    const reviewer = body(read('agents', 'governance-reviewer.md'))
    assert.match(reviewer, /\*\*Docs-set version\*\*[^\n]*return `FLAG` when a PR that isn't a docs-set bump PR changes the version/)
  })

  it('should pick the pre-flight model from planning.sensitivePaths (ESP-152; AC5)', () => {
    const plan = body(read('skills', 'approve-plan', 'SKILL.md'))
    assert.match(plan, /With `planning\.sensitivePaths` set[^\n]*`sonnet`[^\n]*\*\*light pre-flight\*\*/)
    assert.match(plan, /Without `planning\.sensitivePaths`:\*\* run `governance-reviewer` on `sonnet` when the plan's \*\*Files\*\* section lists 5 paths or fewer/)
    assert.match(plan, /`Pre-flight: sonnet, light`/)
    assert.match(body(read('agents', 'governance-reviewer.md')), /\*\*Light pre-flight:\*\*/)
    assert.match(read('templates', 'plan.md'), /- Pre-flight: <model>, <light \| full>/)
  })

  it('should tag vX.Y.Z from the version files in release-steps (ESP-23 AC6)', () => {
    assert.match(body(read('skills', 'release-steps', 'SKILL.md')), /For `vX\.Y\.Z`, use the version the merged bump PR wrote to the files in `git\.versionFiles`/)
  })

  it('should take the previous vX.Y.Z tag from next-version, not git describe (ESP-23)', () => {
    assert.match(body(read('skills', 'release-steps', 'SKILL.md')), /`vX\.Y\.Z`:\*\*[^\n]*`previousTag`[^\n]*next-version\.mjs/)
  })
})

describe('plugin structure: verify --iterate and one full gate (ESP-69 AC3)', () => {
  const verify = () => body(read('skills', 'verify', 'SKILL.md'))
  const iteratePart = () => verify().match(/\*\*When the arguments are `--iterate`:\*\*[\s\S]*?(?=^1\. \*\*)/m)?.[0]

  it('should say an --iterate run writes no evidence, makes no Jira move and reports as partial', () => {
    const part = iteratePart()
    assert.ok(part, 'verify has no --iterate section')
    assert.match(part, /gate\.mjs" --iterate/)
    assert.match(part, /no AC evidence/)
    assert.match(part, /no Jira move/)
    assert.match(part, /say the run is partial/)
    assert.match(part, /never counts as the done gate/)
  })

  it('should say the AGENTS.md path has no iterate mode', () => {
    assert.match(iteratePart(), /`AGENTS\.md` path has no iterate mode/)
    assert.match(iteratePart(), /exit 2/)
  })

  // ESP-159: the full gate runs alongside the review round, and any code change after it, tests included, reruns it.
  for (const [skill, together, rerun] of [
    ['verify', /full gate runs once per PR, alongside the `release` review round/, /tests-only included, needs the full gate again before the commit/],
    ['release', /full gate runs once per PR, alongside the review round/, /A review fix that changes code discards that gate run[^\n]*Tests-only fixes count as code/],
  ]) {
    it(`should state the one-full-gate rule in ${skill}`, () => {
      const text = body(read('skills', skill, 'SKILL.md'))
      assert.match(text, /--iterate` while building/)
      assert.match(text, together)
      assert.match(text, rerun)
    })
  }
})

describe('plugin structure: gate runner (ESP-44 AC7)', () => {
  const verify = () => body(read('skills', 'verify', 'SKILL.md'))
  const step = (title) => verify().match(new RegExp(`^\\d+\\. \\*\\*${title}[\\s\\S]*?(?=^\\d+\\. \\*\\*)`, 'm'))?.[0]

  it('should ship the runner the verify skill names', () => {
    assert.match(verify(), /node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/verify\/gate\.mjs"/)
    assert.match(read('skills', 'verify', 'gate.mjs'), /^#!\/usr\/bin\/env node/)
  })

  it('should run the gate with one runner call when the repo has a verify list, without piping or filtering it', () => {
    const run = step('Run the gate')
    assert.ok(run, 'verify has no "Run the gate" step')
    assert.match(run, /`\.claude\/engineering\.json` has a `verify` list/)
    assert.match(run, /one call/i)
    assert.match(run, /don't pipe or filter/i)
    assert.match(run, /exit code 2/i)
  })

  it('should keep the AGENTS.md and ask-the-user path, run one command at a time, for a repo with no verify list', () => {
    const load = step('Load the gate')
    assert.match(load, /"Definition of done" section of `AGENTS\.md`/)
    assert.match(load, /stop and ask the user/)
    const run = step('Run the gate')
    assert.match(run, /no `verify` list/)
    assert.match(run, /one at a time/)
    assert.match(run, /Stop at the first failure/)
  })

  it('should not run the fake-pass check a second time after the runner ran it', () => {
    assert.match(step('Check test content \\(fp-\\*\\)'), /the runner already ran this check/i)
  })
})

describe('plugin structure: review and release efficiency (ESP-11, 39, 42, 43, 45)', () => {
  const release = () => body(read('skills', 'release', 'SKILL.md'))
  const approve = () => body(read('skills', 'approve-plan', 'SKILL.md'))
  const readme = () => read('README.md')
  // The working copy may have CRLF line endings, so compare on LF.
  const section = (raw, heading) => {
    const text = raw.replace(/\r\n/g, '\n')
    const start = text.indexOf(`\n${heading}\n`)
    assert.ok(start > -1, `missing section "${heading}"`)
    const next = text.indexOf('\n## ', start + 1)
    return text.slice(start, next === -1 ? undefined : next)
  }
  const ASK_PATHS = /the guard's ask paths \(the defaults plus `governance\.askPaths`\)/

  // One release rule: the bullet that starts with the bold label.
  const rule = (label) => {
    const line = release().split('\n').find((l) => l.includes(`**${label}:**`))
    assert.ok(line, `release must have a "${label}" rule`)
    return line
  }
  const CODE_FOLDERS = ['skills/', 'agents/', 'commands/', 'hooks/', 'templates/', '.github/']

  it('should give each PR one full review round and a governance-only re-review of a later fix (AC1)', () => {
    const line = rule('One round per PR')
    assert.match(line, /one full review round[^\n]*one full `governance-reviewer` pass[^\n]*one full stage-2 pass/i)
    assert.match(line, /fix made after that round, whether it fixes a blocking finding or one the user decided on/)
    assert.match(line, /one reviewer, `governance-reviewer`, on the fix diff only[^\n]*one checklist/)
    assert.match(line, /say in the PR that the fix had a governance-only re-review/i)
    assert.match(line, /`reviewers` doesn't include `governance-reviewer`[^\n]*the reviewer that raised the finding/)
  })

  it('should say exactly when a fix gets a full round again (AC1)', () => {
    const line = rule('One round per PR')
    assert.match(line, /full round again only when/i)
    assert.match(line, /outside the plan's \*\*Files\*\* list/)
    for (const p of ['*rules*.mjs', '*checks*.mjs', '*policy*.mjs', '*guard*.mjs', '.github/workflows/', 'package.json']) assert.ok(line.includes(`\`${p}\``), p)
    const code = line.match(/any file that is not Markdown under a ([^(]*) folder at any depth/)
    assert.ok(code, 'a non-Markdown file in a code folder must trigger a full round')
    for (const d of CODE_FOLDERS) assert.ok(code[1].includes(`\`${d}\``), d)
    assert.match(line, /lockfile/)
    assert.match(line, ASK_PATHS)
  })

  it('should let stage 1 run in parallel only for a small in-plan diff, with BLOCK and FLAG unchanged (AC2)', () => {
    const line = rule('In parallel')
    assert.match(line, /5 files or fewer[^\n]*every changed file is in the plan's \*\*Files\*\* list/)
    assert.match(line, /otherwise[^\n]*stage 1 runs first/i)
    assert.match(line, /`BLOCK` still stops the commit[^\n]*`FLAG` still needs the user's[^\n]*decision/)
  })

  it('should define a docs-only diff that leaves out instruction, rule and ask-path files (AC3)', () => {
    const line = rule('Docs-only diff')
    assert.match(line, /every changed file is Markdown \(`\.md`\)/)
    assert.doesNotMatch(line, /plain text/)
    assert.match(line, /none is a `CLAUDE\.md`, `CLAUDE\.local\.md`, `AGENTS\.md` or `REVIEW\.md` at any depth, is the `governance\.rulesFile`, a `git\.versionFiles` entry or the `git\.changelogFile`/)
    assert.match(line, /`scripts\/`, `output-styles\/`, `\.github\/` or `\.claude\/` folder/)
    for (const d of CODE_FOLDERS) assert.ok(line.includes(`\`${d}\``), d)
    assert.match(line, /at any depth/)
    assert.match(line, ASK_PATHS)
  })

  it('should skip the reviewer round and the gate commands on a docs-only diff and say so in the PR (AC3)', () => {
    const line = rule('Docs-only diff')
    assert.match(line, /On a docs-only diff, run no reviewer round[^\n]*say so in the PR/)
    assert.match(line, /`verify` skips the gate commands/)
    assert.doesNotMatch(line, /`sonnet` model/)
    assert.match(readme(), /\| `reviewers` \|[^\n]*docs-only diff[^\n]*`release` skill/)
    assert.match(line, /no reviewer round \(no stage 1, no stage 2, no `\/code-review`\)/)
    const verify = read('skills', 'verify', 'SKILL.md')
    assert.match(verify, /docs-only diff[^\n]*don't run the gate commands[^\n]*`Gate: SKIPPED \(docs-only diff\)`/)
    assert.match(verify, /whole branch diff, not the step-2 list[^\n]*merge-base[^\n]*An empty list is not docs-only/)
    assert.match(verify, /only after the commands pass or step 3 skipped them on a docs-only diff/)
  })

  it('should archive the plan in release as the last step before the commit, not at clean-up (AC4)', () => {
    const commit = section(release(), '## 1. Commit (feature branch off the base branch)')
    const steps = commit.split('\n').filter((l) => /^\d+\. /.test(l))
    const archive = steps.findIndex((l) => /archive the plan with the `approve-plan` skill/.test(l))
    assert.ok(archive > -1, 'section 1 must have an archive step')
    assert.match(steps[archive], /last step before the commit[^\n]*after the review round and any fix re-review/)
    assert.match(steps[archive], /`\.claude\/plans\/active\.md`/)
    assert.match(steps[archive], /same commit/)
    assert.match(steps[archive], /record the final status as shipped/)
    // ESP-118: after the archive come only the commit message and the forked commit run.
    assert.equal(archive + 3, steps.length, 'only the commit message and the commit run follow the archive')
    assert.match(steps[archive + 1], /^\d+\. Write the commit message/)
    assert.match(steps[archive + 2], /^\d+\. Run the `release-steps` skill with phase `commit`/)
    const rules = section(read('skills', 'release-steps', 'SKILL.md'), '## Rules')
    assert.doesNotMatch(rules, /Close the plan with the `approve-plan` skill/)
    assert.match(rules, /already archived/)
  })

  it('should have approve-plan close the plan in the same PR as the work (AC4)', () => {
    const close = section(approve(), '## Close (work shipped or abandoned)')
    assert.match(close, /same PR as the work/)
    assert.match(close, /not known before the merge \(PR number, tag, Jira status\)[^\n]*later PR only if/)
  })

  it('should document three ways to keep sessions cheap, without depending on context-mode (AC5)', () => {
    const cheap = section(readme(), '## Keeping sessions cheap')
    assert.match(cheap, /large[^\n]*output[^\n]*to a file[^\n]*print only[^\n]*summary/i)
    assert.match(cheap, /Jira[^\n]*only the fields/i)
    assert.match(cheap, /context-mode[^\n]*when it is installed/i)
    assert.match(cheap, /doesn't depend on/i)
  })

  it('should document how to find and remove a duplicate install (AC6)', () => {
    const dup = section(readme(), '## Checking for duplicate installs')
    assert.match(dup, /`claude plugin list`/)
    assert.match(dup, /Scope: project/)
    assert.match(dup, /`usiatech-engineering@synced`/)
    assert.match(dup, /`claude plugin uninstall usiatech-engineering@usiatech --scope project`/)
    assert.match(dup, /check first that each of them has a user-scope install/)
  })
})

describe('plugin structure: fewer approval rounds (spec 2026-11-07-permission-prompts)', () => {
  const skill = (s) => body(read('skills', s, 'SKILL.md'))
  const BATCH_OFF = /`decisions\.batch`[^\n]*`false`[^\n]*on its own/

  it('should confirm the understanding note once, with all corrections in one answer (AC1, R1, R4)', () => {
    const text = skill('clarify')
    assert.match(text, /once to confirm the note, giving all corrections in one answer/)
    assert.match(text, /again only when a correction changes it/)
    assert.match(text, BATCH_OFF)
  })

  it('should approve the spec and the ticket list together before filing (AC1, R2, R4)', () => {
    const spec = skill('to-spec')
    assert.match(spec, /Hand the draft to `to-tickets`/)
    assert.match(spec, /one approval of both/)
    assert.match(spec, /joint approval sets `Status: approved`/)
    assert.match(spec, BATCH_OFF)
    const tickets = skill('to-tickets')
    assert.match(tickets, /draft `to-spec` just handed over for the joint approval/)
    assert.match(tickets, /One approval then covers the spec and the ticket list together/)
    assert.match(tickets, BATCH_OFF)
  })

  it('should show the plan with its pre-flight result and ask once (AC1, R3, R4)', () => {
    const text = skill('approve-plan')
    assert.match(text, /Show the draft with its pre-flight result and ask once[^\n]*every open pre-flight decision go into that same question/)
    assert.match(text, /`decisions\.batch` is `false`, ask about the plan and each decision on its own/)
  })

  it('should describe standing decisions, the cap of 10 and the fixed never-settles list in governance-reviewer (AC2)', () => {
    const text = body(read('agents', 'governance-reviewer.md'))
    assert.match(text, /## Standing decisions/)
    assert.match(text, /`governance\.rulesFile`[^\n]*default `\.claude\/governance\.md`/)
    assert.match(text, /SD-1, SD-2[^\n]*owner and a date/)
    assert.match(text, /at most 10 entries[^\n]*say in the output how many were ignored/)
    assert.match(text, /"FLAG, settled by SD-n"[^\n]*needs no user decision/)
    assert.match(text, /never settles a `BLOCK`, an Important finding, a must-never or needs-approval rule, a guard error or missing AC evidence/)
    assert.match(text, /fixed here; repo config and the rules file can't change it/)
  })

  it('should log settled FLAGs with their SD number and leave them out of the decision (AC2)', () => {
    assert.match(skill('approve-plan'), /settled by SD-n"[^\n]*Change log with its SD number[^\n]*leave it out of the batched decision/)
    assert.match(skill('release'), /settled by SD-n"[^\n]*Change log with its SD number[^\n]*leave it out of the question/)
  })

  it('should ship SD-1, the wording-only rule, in the template and in this repo (AC2)', () => {
    const SD1 = /- SD-1: A pre-flight fix that only makes wording more precise \(no new file, AC, task, command or action\) is applied with one dated Change log line and shown with the plan, without a separate decision\./
    const template = read('templates', 'governance.md')
    assert.match(template, /## Standing decisions/)
    assert.match(template, SD1)
    const repo = readFileSync(path.join(PLUGIN_ROOT, '..', '..', '.claude', 'governance.md'), 'utf8')
    assert.match(repo, /## Standing decisions/)
    assert.match(repo, SD1)
    assert.match(repo, /SD-1:[^\n]*Owner: Francis · Date: 2026-11-07/)
  })

  it('should count production code only on the small route (AC3, R6, R7)', () => {
    const text = skill('approve-plan')
    assert.match(text, /5 production-code files or fewer\. The count is production code only: tests, QA catalogue entries, docs and generated files don't count/)
    assert.match(text, /generated file is one a tool regenerates and nobody edits by hand/)
    assert.match(text, /doc is a Markdown or text file that only people read\. Skills, agent files and rules files[^\n]*not docs/)
    assert.match(text, /Everything else counts, including config, migrations, CI workflows, hook and gate scripts, `infra\/`, `AGENTS\.md`, `CLAUDE\.md`, `REVIEW\.md` and `\.claude\/\*\*`/)
    assert.match(text, /other Small conditions and both overrides are unchanged/)
  })

  it('should say what every 5-files or 5-paths rule counts (AC4, R8)', () => {
    for (const s of ['release', 'approve-plan']) {
      const lines = skill(s).split('\n').filter((l) => /\b5 (production-code )?(files|paths)\b/.test(l))
      assert.ok(lines.length > 0, s)
      for (const l of lines) assert.match(l, /count/i, `${s}: ${l.slice(0, 60)}`)
    }
    assert.match(skill('release'), /\*\*In parallel:\*\*[^\n]*counting every file/)
    assert.match(skill('release'), /\*\*Models:\*\*[^\n]*counting every file/)
    // ESP-152: the file-count rule moved to the "Without planning.sensitivePaths" bullet under **Model:**.
    assert.match(skill('approve-plan'), /\*\*Without `planning\.sensitivePaths`:\*\*[^\n]*counting every path/)
  })

  it('should state the pre-flight reviewer agent name rule (R16, AC13)', () => {
    assert.match(skill('approve-plan'), /an `agent` that doesn't match `\^\[A-Za-z0-9\._:-\]\+\$`[^\n]*is skipped/)
  })
})

describe('plugin structure: Jira events and transport (spec 2026-11-09-speed-batch AC2, AC4, AC5, AC6, AC17)', () => {
  const skill = (s) => body(read('skills', s, 'SKILL.md'))
  const moves = () => read('scripts', 'jira-moves.md').replace(/\r\n/g, '\n')
  const SCRIPT_WRITE = /jira-tracker\.mjs" (transition|comment|create|link|find-transition)\b/
  const MCP_CALL = /\b(transitionJiraIssue|getJiraIssue|addCommentToJiraIssue|createJiraIssue|createIssueLink|getTransitionsForJiraIssue)\b/
  // Every bullet that starts with **`<transport>`:**, with the lines indented deeper than it.
  const transportPart = (text, transport) => {
    const start = String.raw`^([ \t]*)- \*\*` + '`' + transport + '`' + String.raw`:\*\*.*(?:\n\1[ \t]+.*)*`
    const m = text.replace(/\r\n/g, '\n').match(new RegExp(start, 'gm'))
    assert.ok(m && m.length, `no ${transport} part`)
    return m.join('\n')
  }

  it('should keep the connector path free of script writes and the api path free of MCP calls (AC2)', () => {
    for (const text of [moves(), skill('to-tickets')]) {
      assert.doesNotMatch(transportPart(text, 'connector'), SCRIPT_WRITE)
      assert.doesNotMatch(transportPart(text, 'api'), MCP_CALL)
    }
    assert.match(moves(), /never quietly|don't switch to the script/)
    assert.match(moves(), /`api`:\*\*[^\n]*script only, even when the connector is available/)
  })

  it('should send every move and comment through the shared procedure (AC2)', () => {
    for (const s of ['approve-plan', 'verify', 'release-steps', 'clarify', 'to-spec', 'to-tickets']) {
      assert.match(skill(s), /scripts\/jira-moves\.md/, s)
    }
    for (const s of ['approve-plan', 'verify', 'release-steps']) {
      assert.doesNotMatch(skill(s), SCRIPT_WRITE, s)
      assert.doesNotMatch(skill(s), MCP_CALL, s)
    }
  })

  it('should fire started from clarify, to-spec, to-tickets and approve-plan (AC4)', () => {
    assert.match(skill('clarify'), /fire `started`[^\n]*jira-moves\.md/)
    assert.match(skill('to-spec'), /fire `started`[^\n]*jira-moves\.md/)
    assert.match(skill('to-tickets'), /already exist[^\n]*fire `started`/)
    const plan = skill('approve-plan')
    const route = plan.indexOf('## Route (before drafting)')
    const draft = plan.indexOf('1. Draft the plan')
    const planning = plan.search(/\*\*Jira tracker only, planning mode:\*\*[^\n]*fire `started`/)
    assert.ok(planning > route && planning < draft, 'planning-mode started comes before the draft')
    assert.match(plan, /4\. \*\*Jira tracker only:\*\*[^\n]*fire `started` again/)
  })

  it('should fire devComplete and testingStarted before the gate runs, testingComplete only on a pass (AC4)', () => {
    const verify = skill('verify')
    const start = verify.search(/^0\. \*\*Jira tracker only: mark testing started\*\*/m)
    const gate = verify.indexOf('3. **Run the gate.**')
    assert.ok(start > -1 && start < gate, 'step 0 comes before the gate run')
    const step0 = verify.slice(start, gate)
    assert.match(step0, /fire `devComplete`[^\n]*then `testingStarted`/)
    // Code review 2026-11-09: no ticket moves into testing for a gate that can't start.
    assert.ok(step0.search(/gate\.mjs" --check/) > -1 && step0.search(/gate\.mjs" --check/) < step0.search(/fire `devComplete`/), '--check comes before the moves')
    assert.match(step0, /On exit 2, move no ticket/)
    // R4: testingComplete waits for the reviews too, so verify only reports the ready keys and release fires it.
    assert.match(verify, /8\. \*\*Jira tracker only:\*\* make no `testingComplete` move here/)
    assert.match(verify, /ready for it: only when step 3's result is \*\*Gate: PASS\*\*[^\n]*every AC `shown`/)
    const release = body(read('skills', 'release', 'SKILL.md'))
    const round = release.indexOf('**Decisions:** after stage 2')
    const fired = release.search(/\*\*Jira tracker only, after the review round and the final evidence check:\*\* fire `testingComplete`[^\n]*no blocking finding is open/)
    assert.ok(round > -1 && fired > round && fired < release.indexOf('5. Close and archive the plan'), 'release fires testingComplete after the review round, before the commit')
    assert.doesNotMatch(verify, /`verified`|event verified/)
  })

  it('should fire merged after the merge and released only after the user confirms (AC4)', () => {
    const steps = skill('release-steps')
    assert.match(steps, /merged into the base branch[\s\S]*?fire `merged`/)
    const released = steps.slice(steps.indexOf('## Released tickets (phase `release-jira`'))
    assert.match(released, /each key the arguments confirm, fire `released`/)
    assert.doesNotMatch(steps.slice(0, steps.indexOf('## Released tickets')), /fire `released`/)
    assert.match(skill('release'), /Ask the user once to confirm the list, then run phase `release-jira`/)
  })

  it('should tell the connector path the walk order and the no-backwards rule (AC5)', () => {
    const connector = transportPart(moves(), 'connector')
    assert.match(moves(), /never takes a ticket backwards/)
    assert.match(moves(), /at a later one in the configured order, is left alone/)
    assert.match(connector, /jira-tracker\.mjs" steps --event <event> --from/)
    assert.match(connector, /in order/)
    assert.match(connector, /failed step stops the walk for that key/)
    // Code review 2026-11-09: a closed ticket the config doesn't list is never reopened, and a shared status is looked up.
    assert.match(moves(), /status the config doesn't list whose Jira category is Done[^\n]*left alone|left alone\. So is a ticket in a status the config doesn't list whose Jira category is Done/)
    assert.match(connector, /--from-category <category key>/)
    assert.match(connector, /more than one event, has that status[^\n]*getTransitionsForJiraIssue/)
  })

  it('should read each ticket type and parent with the config as default, checked before filing (AC6)', () => {
    const tickets = skill('to-tickets')
    assert.match(tickets, /own issue type and parent[^\n]*config[^\n]*default/i)
    assert.match(tickets, /--type '<type>' --parent <KEY>/)
    assert.match(tickets, /before the first ticket is created/)
  })

  it('should stop a docs-only ticket at devComplete until the user approves it (AC17)', () => {
    const docs = moves().slice(moves().indexOf('## 5. Docs-only tickets'))
    assert.match(docs, /stops at `devComplete`/)
    assert.match(docs, /Don't fire `testingStarted`, `testingComplete`, `merged` or `released`[^\n]*say so/)
    assert.match(docs, /ends only when the user approves/)
    for (const s of ['verify', 'release-steps']) {
      assert.match(skill(s), /docs-only ticket[^\n]*(approval line|approved)[^\n]*/, s)
      assert.match(skill(s), /docs-only[^\n]*say /, s)
    }
    assert.match(skill('approve-plan'), /`\(docs-only\)`/)
  })
})

describe('plugin structure: setup warning and spec code names (spec 2026-11-09-speed-batch AC8, AC9)', () => {
  const skill = (s) => body(read('skills', s, 'SKILL.md'))

  it('should warn in setup-engineering that no tickets section means no Jira steps (AC8)', () => {
    assert.match(skill('setup-engineering'), /no `tickets` section[^\n]*Jira steps[^\n]*(won't|will not) run/)
  })

  it('should tell to-spec to read the code before naming functions or files (AC9)', () => {
    assert.match(skill('to-spec'), /read the code[^\n]*before naming[^\n]*function[^\n]*file[^\n]*behaviour level/)
  })
})

describe('plugin structure: fewer prompts (ESP-154, ESP-155, ESP-156)', () => {
  it('should ship the review-page procedure and skeleton with a dark-mode block (ESP-154; AC2)', () => {
    const procedure = read('templates', 'review-page.md')
    for (const part of [/recommended/i, /`D1\.1`/, /Each file once/, /decisions\.batch/, /Re-show only the items a correction changed/, /AskUserQuestion/,
      /Escape `&`, `<`, `>`, `"` and `'`/, /no `<script>`/, /no remote URLs/]) {
      assert.match(procedure, part)
    }
    const page = read('templates', 'review-page.html')
    // The skeleton is static: no scripts, event attributes or remote resources.
    assert.doesNotMatch(page, /<script|\son[a-z]+\s*=|javascript:|(?:src|href)\s*=\s*["']?(?:https?:)?\/\/|@import|url\(\s*["']?(?:https?:)?\/\//i)
    assert.match(page, /prefers-color-scheme: dark/)
    assert.match(page, /class="rec"/)
    assert.match(page, /accept all except/)
  })

  it('should point every approval step at the review page (ESP-154; AC1)', () => {
    // to-spec asks nothing: to-tickets shows the spec and its tickets on one page.
    for (const s of ['clarify', 'approve-plan', 'to-tickets', 'release']) {
      assert.match(read('skills', s, 'SKILL.md'), /templates\/review-page\.md/, s)
    }
  })

  it('should default to trusted plan edits and this session\'s scratchpad (ESP-155, ESP-156)', () => {
    const gov = JSON.parse(read('templates', 'engineering.json')).governance
    assert.equal(gov.planEdits, 'all')
    assert.ok(gov.trustedWritePaths.includes('$TMP/claude/*/{session}/scratchpad/**'))
    const setup = read('skills', 'setup-engineering', 'SKILL.md')
    assert.match(setup, /`Edit\(\/\.claude\/plans\/active\.md\)`/)
    assert.match(setup, /`Edit\(\/\.claude\/plans\/archive\/\*\*\)`/)
  })
})
