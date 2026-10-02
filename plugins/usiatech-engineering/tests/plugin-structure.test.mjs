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
    assert.match(text, /decided by the commands and the fake-pass check only/)
  })

  it('should make verify run the fake-pass check after the commands pass and fail the gate on a fail finding (AC8)', () => {
    const text = body(read('skills', 'verify', 'SKILL.md'))
    const step = text.match(/^\d+\. \*\*Check test content \(fp-\*\)\*\*[\s\S]*?(?=^\d+\. \*\*)/m)?.[0]
    assert.ok(step, 'verify has no "Check test content (fp-*)" step')
    assert.match(step, /only after the commands pass/)
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
  it('should ship a read-only supply-chain-reviewer agent that covers the sc-* findings', () => {
    assert.ok(agents.includes('supply-chain-reviewer'))
    const text = body(read('agents', 'supply-chain-reviewer.md'))
    for (const rule of ['sc-typosquat', 'sc-advisory', 'sc-lockfile-drift', 'sc-install-script']) assert.match(text, new RegExp(`\`${rule}\``), rule)
    assert.match(text, /Never edit files/)
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
