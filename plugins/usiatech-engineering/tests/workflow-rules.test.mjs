import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseYamlSubset, parseWorkflowYaml, lineOf, checkWorkflow, isWorkflowPath, TIER, AI_ACTIONS,
} from '../templates/github/scripts/workflow-rules.mjs'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'workflows')
const fixture = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
const check = (name, opts = {}) => checkWorkflow({ file: `.github/workflows/${name}`, content: fixture(name), ...opts })
const rules = (findings) => findings.map((f) => `${f.rule}:${f.tier}`).sort()
// A "no findings" result only means something if the parser actually read the jobs and their steps.
const assertParsed = (name) => {
  const { doc, problems } = parseWorkflowYaml(fixture(name))
  assert.deepEqual(problems, [], name)
  const jobs = Object.values(doc.jobs ?? {})
  assert.ok(jobs.length > 0, `${name}: no jobs parsed`)
  for (const job of jobs) assert.ok(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.every((s) => s && typeof s === 'object'), `${name}: steps not parsed`)
}

describe('parseYamlSubset', () => {
  it('should parse nested mappings and sequences of mappings', () => {
    const doc = parseYamlSubset('jobs:\n  build:\n    steps:\n      - uses: a/b@v1\n        with:\n          ref: main\n      - run: echo hi\n')
    assert.deepEqual(doc, { jobs: { build: { steps: [{ uses: 'a/b@v1', with: { ref: 'main' } }, { run: 'echo hi' }] } } })
  })

  it('should keep literal block scalars verbatim, including # characters', () => {
    const doc = parseYamlSubset('run: |\n  # not a comment\n  echo "$X"\nnext: 1\n')
    assert.equal(doc.run, '# not a comment\necho "$X"\n')
    assert.equal(doc.next, '1')
  })

  it('should strip comments outside quotes and unquote scalars', () => {
    const doc = parseYamlSubset(`a: "x # y" # note\nb: 'it''s'\nc: plain # note\n`)
    assert.deepEqual(doc, { a: 'x # y', b: "it's", c: 'plain' })
  })

  it('should parse flow sequences and flow mappings', () => {
    const doc = parseYamlSubset('on: [push, pull_request_target]\nperms: { contents: read, issues: write }\n')
    assert.deepEqual(doc, { on: ['push', 'pull_request_target'], perms: { contents: 'read', issues: 'write' } })
  })

  it('should accept a sequence at the same indent as its parent key', () => {
    const doc = parseYamlSubset('steps:\n- run: a\n- run: b\n')
    assert.deepEqual(doc, { steps: [{ run: 'a' }, { run: 'b' }] })
  })

  it('should join indented continuation lines of a plain scalar', () => {
    const doc = parseYamlSubset('if: github.event_name == \'push\' &&\n  github.ref == \'refs/heads/main\'\n')
    assert.equal(doc.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'")
  })

  it('should record 1-based line numbers for keys and sequence items', () => {
    const doc = parseYamlSubset('# header\njobs:\n  build:\n    steps:\n      - run: a\n      - run: b\n')
    assert.equal(lineOf(doc, 'jobs'), 2)
    assert.equal(lineOf(doc.jobs, 'build'), 3)
    assert.equal(lineOf(doc.jobs.build.steps, 1), 6)
    assert.equal(lineOf(doc.jobs.build.steps[1], 'run'), 6)
  })

  it('should not throw on malformed input', () => {
    assert.doesNotThrow(() => parseYamlSubset('a: [unclosed\n  - : :\n\t- x\n'))
    assert.deepEqual(parseYamlSubset(''), {})
  })

  it('should parse quoted keys in sequence items as mappings', () => {
    assert.deepEqual(parseYamlSubset(`steps:\n  - "run": a\n  - 'uses': b\n  - "not: a key"\n`), { steps: [{ run: 'a' }, { uses: 'b' }, 'not: a key'] })
  })

  it('should keep __proto__ as an ordinary own key', () => {
    const doc = parseYamlSubset('jobs:\n  __proto__:\n    runs-on: x\n')
    assert.ok(Object.hasOwn(doc.jobs, '__proto__'))
    assert.equal(Object.getPrototypeOf(doc.jobs), Object.prototype)
    assert.deepEqual(Object.keys(doc.jobs), ['__proto__'])
  })

  it('should accept a leading document marker', () => {
    assert.deepEqual(parseYamlSubset('---\non: push\n'), { on: 'push' })
  })
})

describe('checkWorkflow: fails closed on YAML it cannot read', () => {
  const INJECT = 'echo "${{ github.event.issue.title }}"'
  const unparsed = (content) => checkWorkflow({ file: '.github/workflows/x.yml', content }).filter((f) => f.rule === 'wf-unparsed')
  const cases = [
    ['an anchor', `on: issues\njobs:\n  a:\n    steps: &s\n      - run: ${INJECT}\n`, 4],
    ['an alias', `on: issues\nx: &cmd ${INJECT}\njobs:\n  a:\n    steps:\n      - run: *cmd\n`, 2],
    ['a merge key', `on: issues\njobs:\n  a:\n    <<: {}\n    steps:\n      - run: echo ok\n`, 4],
    ['a tag', `on: issues\njobs:\n  a:\n    steps:\n      - run: !!str ${INJECT}\n`, 5],
    ['an explicit key', `on: issues\njobs:\n  a:\n    steps:\n      - ? run\n        : ${INJECT}\n`, 5],
    ['jobs that are not a mapping', 'on: issues\njobs: [a, b]\n', 2],
    ['a job that is not a mapping', 'on: issues\njobs:\n  a: build\n', 3],
    ['steps that are not a list', 'on: issues\njobs:\n  a:\n    steps: run it\n', 4],
    ['a step that is not a mapping', 'on: issues\njobs:\n  a:\n    steps:\n      - echo hi\n', 5],
    ['content the parser skipped', `on: issues\njobs:\n  a:\n    steps:\n      - run: echo ok\n   bad indent: x\n`, 6],
    ['a flow mapping entry it cannot read', 'on: issues\njobs:\n  a:\n    with: { nope }\n', 4],
  ]
  for (const [name, content, line] of cases) {
    it(`should report wf-unparsed (high) for ${name}`, () => {
      const f = unparsed(content)
      assert.equal(f.length >= 1, true, JSON.stringify(checkWorkflow({ file: '.github/workflows/x.yml', content })))
      assert.equal(f[0].tier, TIER.HIGH)
      assert.equal(f[0].line, line)
    })
  }

  it('should report wf-unparsed when the parser gives up on deep nesting', () => {
    const content = Array.from({ length: 6000 }, (_, n) => `${' '.repeat(n)}k:`).join('\n') + '\n'
    assert.equal(unparsed(content).length, 1)
  })

  it('should still check a job named __proto__', () => {
    const content = `on: issues\njobs:\n  __proto__:\n    steps:\n      - run: ${INJECT}\n`
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'])
  })

  it('should check steps written with quoted keys', () => {
    const content = `on: issues\njobs:\n  a:\n    steps:\n      - "run": ${INJECT}\n`
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'])
  })

  it('should report escapes GitHub would decode into something the rules cannot see (G1)', () => {
    const body = '{{ github.event.issue.body }}'
    for (const content of [
      String.raw`on: issues` + `\njobs:\n  a:\n    steps:\n      - run: "echo ` + String.raw`\x24` + body + `"\n`,
      `on: issues\njobs:\n  a:\n    steps:\n      - run: "echo ` + String.raw`\u0024` + body + `"\n`,
      `on: issues\njobs:\n  a:\n    steps:\n      - run: "echo ` + String.raw`\U00000024` + body + `"\n`,
      `on: issues\njobs:\n  a:\n    steps:\n      - "r` + String.raw`\x75` + `n": echo \$${body}\n`,
      `on: "pull_request_` + String.raw`\x74` + `arget"\njobs:\n  a:\n    steps:\n      - run: echo ok\n`,
    ]) {
      assert.ok(unparsed(content).length >= 1, content)
    }
  })

  it('should accept the common double-quoted escapes', () => {
    const content = 'on: push\njobs:\n  a:\n    steps:\n      - run: ' + String.raw`"echo \"hi\" \\ \t a\/b\n"` + '\n'
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content }), [])
  })

  it("should keep text after an escaped '' quote instead of treating # as a comment (G2)", () => {
    const content = `on: issues\njobs:\n  a:\n    steps:\n      - run: 'echo it''s # \${{ github.event.issue.body }}'\n`
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'])
  })

  it('should report quoted strings that span lines or never close (G2)', () => {
    // Continuations are indented past the key (column 10), so they reach the multi-line check itself.
    for (const content of [
      'on: issues\njobs:\n  a:\n    steps:\n      - run: "echo a\n          # ${{ github.event.issue.body }}\n          end"\n',
      'on: issues\njobs:\n  a:\n    steps:\n      - run: "echo a\n          x # ${{ github.event.issue.body }}\n          end"\n',
      'on: issues\njobs:\n  a:\n    steps:\n      - run: "echo ${' + '\\' + '\n          { github.event.issue.body }}"\n',
      "on: issues\njobs:\n  a:\n    steps:\n      - run: 'echo a\n          b'\n",
    ]) {
      assert.ok(unparsed(content).some((f) => /span lines/.test(f.detail)), content)
    }
    assert.ok(unparsed('on: issues\njobs:\n  a:\n    steps:\n      - run: "echo ok\n').some((f) => /not closed/.test(f.detail)))
  })

  it('should keep flow entries apart when a plain word contains a quote (H1)', () => {
    const head = '${{ github.event.pull_request.head.sha }}'
    const cases = [
      ['on: issues\njobs:\n  a:\n    steps:\n      - { name: it\'s, run: "echo ${{ github.event.issue.title }}" }\n', 'wf-untrusted-input:high'],
      ['on: issues\njobs:\n  a:\n    steps: [{name: it\'s}, {run: "echo ${{ github.event.issue.title }}"}]\n', 'wf-untrusted-input:high'],
      ['on: issues\njobs:\n  a:\n    steps:\n      - {name: a"b, run: "echo ${{ github.event.issue.title }}"}\n', 'wf-untrusted-input:high'],
      [`on: { push: { branches: [it's] }, pull_request_target: null }\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${head}\n`, 'wf-privileged-checkout:high'],
      [`on: pull_request_target\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with: { path: it's, ref: "${head}" }\n`, 'wf-privileged-checkout:high'],
    ]
    for (const [content, rule] of cases) {
      assert.ok(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })).includes(rule), content)
    }
  })

  it('should report an unclosed quote or bracket inside a flow collection (H1)', () => {
    for (const content of [
      'on: issues\njobs:\n  a:\n    steps:\n      - { run: "echo x }\n',
      'on: issues\njobs:\n  a:\n    steps: [{ run: echo x }\n',
    ]) {
      assert.ok(unparsed(content).length >= 1, content)
    }
  })

  it('should report a flow collection that spans lines (H2)', () => {
    const content = 'on: issue_comment\njobs:\n  a:\n    steps:\n      - uses: actions/github-script@v7\n        with: { script: "x(\n          # ${{ github.event.issue.body }}\n          )" }\n'
    assert.ok(unparsed(content).some((f) => /span lines/.test(f.detail)))
  })

  it('should count a "#" last line as part of a spanning value, and report an unclosed collection (H2)', () => {
    const trigger = 'on: { workflow_dispatch: { inputs: { a: { description: "x\n    # y" } } }, pull_request_target: null }\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n'
    const prompt = 'on: issues\njobs:\n  a:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n        with: { prompt: "hi\n          # ${{ github.event.issue.title }}" }\n'
    for (const content of [trigger, prompt]) {
      assert.ok(unparsed(content).some((f) => /span lines/.test(f.detail)), content)
    }
    assert.ok(unparsed('on: issues\njobs:\n  a:\n    with: { a: b\n').some((f) => /not closed/.test(f.detail)))
  })

  it('should ignore a leading byte-order mark (H5)', () => {
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content: '\uFEFFon: push\njobs:\n  a:\n    steps:\n      - run: echo ok\n' }), [])
  })

  it('should not hide a document written on the --- line (G3)', () => {
    const content = '--- {on: pull_request_target, jobs: {a: {steps: [{uses: actions/checkout@v4, with: {ref: "${{ github.event.pull_request.head.sha }}"}}]}}}\n'
    assert.ok(checkWorkflow({ file: '.github/workflows/x.yml', content }).some((f) => f.tier === TIER.HIGH))
  })

  it('should not report problems in the base version', () => {
    const content = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ok\n'
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content, base: 'jobs: &x [a]\n' }), [])
  })
})

describe('isWorkflowPath', () => {
  it('should match .yml and .yaml files directly under .github/workflows', () => {
    assert.ok(isWorkflowPath('.github/workflows/ci.yml'))
    assert.ok(isWorkflowPath('.github/workflows/ci.yaml'))
    assert.ok(!isWorkflowPath('.github/workflows/nested/ci.yml'))
    assert.ok(!isWorkflowPath('.github/actions/x/action.yml'))
    assert.ok(!isWorkflowPath('docs/.github/workflows/ci.yml'))
  })
})

describe('checkWorkflow: privileged trigger with PR checkout (R7, R9; AC6)', () => {
  it('should flag pull_request_target checking out the PR head as high risk', () => {
    const f = check('prt-checkout-head.yml')
    assert.deepEqual(rules(f), ['wf-privileged-checkout:high'])
    assert.equal(f[0].line, 11)
    assert.equal(f[0].file, '.github/workflows/prt-checkout-head.yml')
    assert.match(f[0].detail, /pull_request_target/)
  })

  it('should also flag secrets reachable by the job that runs PR code', () => {
    assert.deepEqual(rules(check('prt-checkout-secrets.yml')), ['wf-privileged-checkout:high', 'wf-privileged-secrets:high'])
  })

  it('should flag workflow_run checking out the triggering head sha', () => {
    const content = 'on:\n  workflow_run:\n    workflows: [CI]\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.workflow_run.head_sha }}\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-privileged-checkout:high'])
  })

  it('should flag gh pr checkout in a run step under a privileged trigger', () => {
    const content = 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: gh pr checkout ${{ github.event.number }}\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-privileged-checkout:high'])
  })

  it('should flag a PR head ref written with other casing or bracket notation', () => {
    for (const ref of ['${{ GITHUB.EVENT.PULL_REQUEST.HEAD.SHA }}', "${{ github.event['pull_request']['head']['sha'] }}", 'REFS/PULL/1/merge']) {
      const content = `on: pull_request_target\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${ref}\n`
      assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-privileged-checkout:high'], ref)
    }
    const run = 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: git fetch origin ${{ GitHub.Head_Ref }}\n'
    assert.ok(rules(checkWorkflow({ file: '.github/workflows/x.yml', content: run })).includes('wf-privileged-checkout:high'))
  })

  it('should flag fetching the PR by number and checking out the head repository (G4)', () => {
    const run = 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: git fetch origin pull/${{ github.event.number }}/head:pr && git checkout pr && make\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content: run })), ['wf-privileged-checkout:high'])
    const repo = 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          repository: ${{ github.event.pull_request.head.repo.full_name }}\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content: repo })), ['wf-privileged-checkout:high'])
  })

  it('should give no finding for the same workflow on pull_request', () => {
    const content = fixture('prt-checkout-secrets.yml').replace('pull_request_target', 'pull_request')
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content }), [])
  })

  it('should give no finding for pull_request_target that checks out the base code', () => {
    const content = 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo ${{ secrets.X }}\n'
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content }), [])
  })
})

describe('checkWorkflow: untrusted input (R8; AC7)', () => {
  it('should flag an untrusted event field inside a run step as high risk', () => {
    const f = check('run-injection.yml')
    assert.deepEqual(rules(f), ['wf-untrusted-input:high'])
    assert.equal(f[0].line, 10)
    assert.match(f[0].detail, /github\.event\.issue\.title/)
  })

  it('should flag an untrusted event field passed into an AI action input', () => {
    const f = check('ai-prompt-injection.yml')
    assert.deepEqual(rules(f), ['wf-untrusted-input:high'])
    assert.match(f[0].detail, /anthropics\/claude-code-action/)
    assert.match(f[0].detail, /github\.event\.comment\.body/)
  })

  it('should give no finding when the value goes through env and is quoted in the shell', () => {
    assertParsed('env-quoted-safe.yml')
    assert.deepEqual(check('env-quoted-safe.yml'), [])
  })

  it('should flag github.head_ref and PR branch names in run steps', () => {
    for (const expr of ['github.head_ref', 'github.event.pull_request.head.ref', 'github.event.pull_request.body', 'github.event.head_commit.message']) {
      const content = `on: pull_request\njobs:\n  a:\n    steps:\n      - run: echo \${{ ${expr} }}\n`
      assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'], expr)
    }
  })

  it('should flag untrusted input in an actions/github-script script', () => {
    const content = 'on: issues\njobs:\n  a:\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: console.log("${{ github.event.issue.body }}")\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'])
  })

  it('should not flag trusted expressions in run steps', () => {
    const content = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ${{ github.sha }} ${{ github.event.pull_request.number }}\n'
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content }), [])
  })

  it('should flag untrusted fields written with other casing, bracket notation or spacing', () => {
    for (const expr of [
      'GitHub.Event.Issue.Title',
      "github.event['issue']['title']",
      'github.event["pull_request"].body',
      'github . event . comment . body',
      "github['head_ref']",
    ]) {
      const content = `on: issues\njobs:\n  a:\n    steps:\n      - run: echo \${{ ${expr} }}\n`
      assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'], expr)
    }
  })

  it('should flag a whole event object passed into a run step, script or AI input', () => {
    for (const expr of [
      'toJSON(github.event)', 'toJSON(github.event.pull_request)', 'github.event.issue', 'toJSON(github)', "toJSON(github['event'])",
      'toJSON(github.event.commits)', 'toJSON(github.event.pull_request.head.repo)', 'toJSON(github.event.pages)',
      'join(github.event.*.title)', 'join(github.event.issue.*)', 'toJSON(github.*)',
    ]) {
      const run = `on: issues\njobs:\n  a:\n    steps:\n      - run: echo '\${{ ${expr} }}'\n`
      assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content: run })), ['wf-untrusted-input:high'], expr)
    }
    const ai = 'on: issue_comment\njobs:\n  a:\n    steps:\n      - uses: anthropics/claude-code-action@v1\n        with:\n          prompt: ${{ github.event.comment }}\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content: ai })), ['wf-unpinned-action:warning', 'wf-untrusted-input:high'])
  })

  it('should not flag safe fields of event objects', () => {
    const content = 'on: pull_request\njobs:\n  a:\n    steps:\n      - run: echo ${{ github.event.pull_request.number }} ${{ github.event_name }} ${{ github.event.issue.number }} ${{ github.repository }}\n'
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content }), [])
  })

  it('should list known AI actions', () => {
    assert.ok(AI_ACTIONS.includes('anthropics/claude-code-action'))
  })
})

describe('checkWorkflow: pinning and permissions (R10; AC8)', () => {
  it('should warn on a third-party action pinned to a tag', () => {
    const f = check('unpinned-action.yml')
    assert.deepEqual(rules(f), ['wf-unpinned-action:warning'])
    assert.match(f[0].detail, /some-org\/action@v1/)
  })

  it('should not warn on a SHA-pinned, first-party or local action', () => {
    assertParsed('pinned-action.yml')
    assert.deepEqual(check('pinned-action.yml'), [])
  })

  it('should warn on a job-level reusable workflow that is not SHA-pinned', () => {
    const content = 'on: push\njobs:\n  a:\n    uses: other/repo/.github/workflows/ci.yml@main\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-unpinned-action:warning'])
  })

  it('should warn on permissions: write-all', () => {
    assert.deepEqual(rules(check('write-all.yml')), ['wf-write-all:warning'])
  })

  it('should warn when a job permission widens compared with the base version', () => {
    const f = check('perms-widened.yml', { base: fixture('perms-base.yml') })
    assert.deepEqual(rules(f), ['wf-permissions-widened:warning'])
    assert.match(f[0].detail, /contents: read → write/)
  })

  it('should warn when an explicit permission block is removed', () => {
    const content = fixture('perms-base.yml').replace('    permissions:\n      contents: read\n', '')
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content, base: fixture('perms-base.yml') })), ['wf-permissions-widened:warning'])
  })

  it('should not warn when permissions stay the same or narrow, or when there is no base', () => {
    assertParsed('perms-base.yml')
    assertParsed('perms-widened.yml')
    assert.deepEqual(check('perms-base.yml', { base: fixture('perms-base.yml') }), [])
    assert.deepEqual(check('perms-base.yml', { base: fixture('perms-widened.yml') }), [])
    assert.deepEqual(check('perms-widened.yml'), [])
  })

  it('should treat a scope missing from an explicit block as none', () => {
    const base = 'on: push\npermissions:\n  contents: read\njobs: {}\n'
    const content = 'on: push\npermissions:\n  contents: read\n  issues: write\njobs: {}\n'
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content, base })), ['wf-permissions-widened:warning'])
  })
})

describe('checkWorkflow: tiers', () => {
  it('should only use the two documented tiers', () => {
    assert.deepEqual(Object.values(TIER).sort(), ['high', 'warning'])
  })
})
