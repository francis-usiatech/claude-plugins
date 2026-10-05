import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

  it('should flag an untrusted field behind an index it cannot read (fail closed)', () => {
    for (const expr of [
      "github.event.commits[0 && '['].message",
      "github.event.commits[fromJSON('[0]')[0]].message",
      'github.event.commits[a[0]].author.name',
      'github.event.pages[x[0]].page_name',
      'github.event.workflow_run.pull_requests[a[0]].head.ref',
    ]) {
      const content = `on: issues\njobs:\n  a:\n    steps:\n      - run: echo \${{ ${expr} }}\n`
      assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content })), ['wf-untrusted-input:high'], expr)
    }
    const safe = "on: issues\njobs:\n  a:\n    steps:\n      - run: echo ${{ github.event.commits[fromJSON('[0]')[0]].id }}\n"
    assert.deepEqual(checkWorkflow({ file: '.github/workflows/x.yml', content: safe }), [])
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
    const base = fixture('perms-base.yml')
    // \r? because Windows checkouts can give the fixture CRLF line endings.
    const content = base.replace(/    permissions:\r?\n      contents: read\r?\n/, '')
    assert.notEqual(content, base)
    assert.deepEqual(rules(checkWorkflow({ file: '.github/workflows/x.yml', content, base })), ['wf-permissions-widened:warning'])
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

// One table of "does a quote open here?" answers. Comment stripping and flow splitting must both follow it. `before` is
// the text in front of the quote on its line (for flow splitting, in front of it inside the [ ]). A quote only opens a
// quoted scalar at the start of a value; inside a plain word it is just a character. `item` rows are block-sequence
// items, which have no flow form. A row that opens a quote must also parse with no problems.
const QUOTE_TABLE = [
  { where: 'at the start of a line', before: '', opens: true },
  { where: 'after a colon', before: 'a: ', opens: true },
  { where: 'after a comma', before: 'a, ', opens: true },
  { where: 'after [', before: '[', opens: true },
  { where: 'after {', before: '{', opens: true },
  { where: 'after "- " in a block sequence', before: '- ', opens: true, item: true },
  // YAML has no sequence entries inside [ ] / { }; "[- " is a syntax error there, not the start of a quoted scalar.
  { where: 'after "- " inside a flow collection', before: '[- ', opens: false },
  { where: 'inside a plain word', before: 'it', opens: false },
  { where: 'after a space inside a plain scalar', before: 'a ', opens: false },
  { where: 'after a dash inside a plain word', before: 'a-', opens: false },
  // Not quote logic: a "#" after a space starts a comment before any quote after it is looked at.
  { where: 'after a "#" comment (the comment takes precedence)', before: 'a # ', opens: false },
]
const CLOSERS = { '[': ']', '{': '}' }
// What closes the collections `before` opens; a { } entry also needs a value to be a key: value pair.
const closing = (before) => (before.includes('{') ? ': 1' : '') + (CLOSERS[before[0]] ?? '')
// { opens, problems }; problems are only kept when the quote opened, since only those rows must parse cleanly.
const parsed = (text, marker) => {
  const { doc, problems } = parseWorkflowYaml(text)
  const opens = JSON.stringify(doc).includes(marker)
  return { opens, problems: opens ? problems : [] }
}
// Comment stripping: a quote that opens hides the "#" inside it, so "# y" survives in the parsed value.
const stripOpens = ({ before, item }, q) => {
  const text = item ? `k:\n  - ${q}x # y${q}\n` : before === '' ? `${q}x # y${q}: 1\n` : `k: ${before}${q}x # y${q}${closing(before)}\n`
  return parsed(text, '# y')
}
// Flow splitting: a quote that opens hides the "," inside it, so "x, y" stays in one piece.
const flowOpens = ({ before }, q) => parsed(`k: [${before}${q}x, y${q}${closing(before)}]\n`, 'x, y')
const expectedFor = (row) => ({ opens: row.opens, problems: [] })

describe('quote opening: comment stripping and flow splitting', () => {
  for (const q of ['"', "'"]) {
    for (const row of QUOTE_TABLE) {
      const verb = row.opens ? 'open' : 'not open'
      it(`should ${verb} a ${q} quote ${row.where} when stripping comments`, () => {
        assert.deepEqual(stripOpens(row, q), expectedFor(row))
      })
      if (!row.item) {
        it(`should ${verb} a ${q} quote ${row.where} when splitting a flow collection`, () => {
          assert.deepEqual(flowOpens(row, q), expectedFor(row))
        })
      }
    }
  }

  it('should give comment stripping and flow splitting the same answer on every row, for both quotes', () => {
    const disagree = ['"', "'"].flatMap((q) => QUOTE_TABLE
      .filter((row) => !row.item && stripOpens(row, q).opens !== flowOpens(row, q).opens)
      .map((row) => `${q} ${row.where}`))
    assert.deepEqual(disagree, [])
  })
})

// Regexes with nested or lazy repetition backtrack badly on input that almost matches. Each 1 MB input below makes
// one pattern try every start position and scan to the end: KEY_RE and the flow mapping entry (spaces and no colon,
// or spaces before a value cut by U+2028), exprSpans ("${{" never closed), UNTRUSTED_EXPR ("[" never closed),
// runChecksOutPr ("${{" never closed after "git fetch", or "git fetch" repeated, under pull_request_target so the
// checkout rule runs) and normalizeExpr (spaces with no "." or "[" after them). They run in a worker so that a
// pattern that is still quadratic fails after TIMING_CAP_MS instead of hanging the suite. Each test also checks the
// findings, so a parser that gives up early can't pass by being fast.
const MEGABYTE = 1024 * 1024
const TIME_LIMIT_MS = 1000
const TIMING_CAP_MS = 3000
const RULES_URL = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'github', 'scripts', 'workflow-rules.mjs')).href
const WORKER_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads')
import(workerData.rulesUrl).then(({ checkWorkflow }) => {
  const start = performance.now()
  const findings = checkWorkflow({ file: '.github/workflows/x.yml', content: workerData.content })
  parentPort.postMessage({ ms: performance.now() - start, rules: findings.map((f) => f.rule + ':' + f.tier).sort() })
})
`
// { ms, rules } from checkWorkflow on content, or null when it has not finished after TIMING_CAP_MS.
const timeCheckWorkflow = (content) => new Promise((resolve, reject) => {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { rulesUrl: RULES_URL, content } })
  let settled = false
  const settle = (fn, value) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    worker.terminate()
    fn(value)
  }
  const timer = setTimeout(() => settle(resolve, null), TIMING_CAP_MS)
  worker.once('message', (result) => settle(resolve, result))
  worker.once('error', (e) => settle(reject, e))
  worker.once('exit', (code) => settle(reject, new Error(`worker exited ${code} without a result`)))
})
const stepRun = (command, trigger = 'push') => `on: ${trigger}\njobs:\n  a:\n    steps:\n      - run: ${command}\n`
// Why checkWorkflow on content is too slow or gives other findings than expectedRules, or null when it finishes
// within TIME_LIMIT_MS with those findings. Each test asserts on it directly, so the fake-pass check sees the
// assertion in the test.
const slowCheckReason = async (content, expectedRules) => {
  const kb = content.length >> 10
  if (content.length < MEGABYTE) return `the input is ${kb} KB, not at least 1 MB`
  const result = await timeCheckWorkflow(content)
  if (result === null) return `checkWorkflow had not finished after ${TIMING_CAP_MS} ms on ${kb} KB`
  if (result.ms >= TIME_LIMIT_MS) return `checkWorkflow took ${Math.round(result.ms)} ms on ${kb} KB, limit ${TIME_LIMIT_MS} ms`
  const got = JSON.stringify(result.rules), want = JSON.stringify([...expectedRules].sort())
  return got === want ? null : `checkWorkflow gave ${got}, expected ${want}`
}
const UNPARSED = ['wf-unparsed:high']

describe('checkWorkflow: worst-case input size', () => {
  it('should check a 1 MB key line of spaces with no colon in under 1 s (KEY_RE)', async () => {
    assert.equal(await slowCheckReason(`on: push\nk${' '.repeat(MEGABYTE)}x\n`, UNPARSED), null)
  })

  it('should check a 1 MB key line of spaces before a value cut by U+2028 in under 1 s (KEY_RE)', async () => {
    assert.equal(await slowCheckReason(`on: push\na:${' '.repeat(MEGABYTE)}x\u2028y\n`, UNPARSED), null)
  })

  it('should check 1 MB of unclosed "${{" in under 1 s (exprSpans)', async () => {
    assert.equal(await slowCheckReason(stepRun('${{ '.repeat(MEGABYTE / 4)), []), null)
  })

  it('should check 1 MB of unclosed "[" after a context name in under 1 s (UNTRUSTED_EXPR)', async () => {
    assert.equal(await slowCheckReason(stepRun(`\${{ ${'github.event.commits['.repeat(MEGABYTE / 21)} }}`), []), null)
  })

  it('should check 1 MB of unclosed "${{" after "git fetch" in under 1 s (runChecksOutPr)', async () => {
    assert.equal(await slowCheckReason(stepRun(`git fetch ${'${{ '.repeat(MEGABYTE / 4)}`, 'pull_request_target'), []), null)
  })

  it('should check 1 MB of "git fetch" repeated on one line in under 1 s (runChecksOutPr)', async () => {
    assert.equal(await slowCheckReason(stepRun('git fetch '.repeat(MEGABYTE / 10 + 1), 'pull_request_target'), []), null)
  })

  it('should check a 1 MB flow mapping entry of spaces with no colon in under 1 s (flow mapping entry)', async () => {
    assert.equal(await slowCheckReason(`on: push\nk: {k${' '.repeat(MEGABYTE)}x}\n`, UNPARSED), null)
  })

  it('should check a 1 MB flow mapping entry of spaces before a value cut by U+2028 in under 1 s (flow mapping entry)', async () => {
    assert.equal(await slowCheckReason(`on: push\nk:\n  - {run:${' '.repeat(MEGABYTE)}x\u2028y}\n`, UNPARSED), null)
  })

  it('should check a 1 MB expression of spaces between two names in under 1 s (normalizeExpr)', async () => {
    assert.equal(await slowCheckReason(stepRun(`\${{ a${' '.repeat(MEGABYTE)}b }}`), []), null)
  })
})
