// ESP-144: the audit scripts attribute forks to their skills and price each call at its model's rates.
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir, cleanupTempDirs, writeFiles } from '../../../plugins/usiatech-engineering/tests/helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { callCost } = createRequire(import.meta.url)('./audit-common.cjs')
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5'
const FROM = '2026-10-17', TO = '2026-10-24'
const IN_WEEK = new Date('2026-10-20T12:00:00').toISOString()
const SKILL_ROOT = 'Base directory for this skill: C:/plugins/usiatech-engineering/0.19.3/skills/'

const user = (text, extra = {}) => ({ type: 'user', timestamp: IN_WEEK, message: { content: text }, ...extra })
const skillText = (skill) => user(SKILL_ROOT + skill, { isMeta: true })
const assistant = (id, model, usage, content = [], extra = {}) => ({ type: 'assistant', timestamp: IN_WEEK, message: { id, model, usage, content }, ...extra })
const tool = (name, input = {}) => ({ type: 'tool_use', id: 'tool-' + name, name, input })
const skillCall = (skill, args) => tool('Skill', { skill: 'usiatech-engineering:' + skill, args })
const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const run = (script, args) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { encoding: 'utf8' })

const subagent = (type, firstUser, model, usage) => ({
  jsonl: jsonl([user(firstUser), assistant('sub-' + type + firstUser.length, model, usage)]),
  meta: JSON.stringify({ agentType: type }),
})

// A week worth exactly $100: release $32 (fixing $20, overhead $12), verify $8, other main $48, subagents $12.
const usageFixture = () => {
  const root = tempDir('audit-usage-')
  const subs = {
    a: subagent('general-purpose', SKILL_ROOT + 'release-steps', SONNET, { input_tokens: 1e6 }),
    b: subagent('general-purpose', SKILL_ROOT + 'verify', OPUS, { input_tokens: 1e6 }),
    c: subagent('usiatech-engineering:governance-reviewer', 'Review the diff', OPUS, { input_tokens: 1e6 }),
    d: subagent('Explore', 'Find the file', SONNET, { input_tokens: 1e6 }),
  }
  const files = {
    's1.jsonl': jsonl([
      user('release this'),
      skillText('release'),
      assistant('read', OPUS, { input_tokens: 1e6 }, [tool('Read')]),
      // the same call across two records: the Edit and the final output count are only in the second
      assistant('edit', OPUS, { output_tokens: 3 }, [{ type: 'text', text: 'fixing' }]),
      assistant('edit', OPUS, { output_tokens: 1e6 }, [tool('Edit')]),
      assistant('steps', OPUS, { input_tokens: 1e6 }, [skillCall('release-steps')]),
      assistant('verify-call', OPUS, { input_tokens: 1e6 }, [skillCall('verify')]),
      skillText('verify'),
      assistant('verify-main', OPUS, { input_tokens: 2e6 }),
      user('thanks'),
      assistant('other', OPUS, { input_tokens: 12e6 }),
      assistant('synthetic', '<synthetic>', { input_tokens: 0 }),
    ]),
  }
  for (const [k, s] of Object.entries(subs)) {
    files[`s1/subagents/agent-${k}.jsonl`] = s.jsonl
    files[`s1/subagents/agent-${k}.meta.json`] = s.meta
  }
  writeFiles(root, files)
  return root
}

const windowFixture = () => {
  const root = tempDir('audit-window-')
  const ctx = (n) => ({ cache_read_input_tokens: n })
  writeFiles(root, {
    'aaaaaaaa.jsonl': jsonl([
      user('release this'),
      skillText('release'),
      assistant('a1', OPUS, ctx(400000)),
      // the Skill tool use is in a later record of the call
      assistant('a2', OPUS, ctx(401000), [{ type: 'text', text: 'committing' }]),
      assistant('a2', OPUS, ctx(401000), [skillCall('release-steps', 'phase=commit; files=a')]),
      assistant('a3', OPUS, ctx(404000)),
      // a user answer ends the window's turn, but the next phase still belongs to this release
      user('yes, merge'),
      assistant('a4', OPUS, ctx(404000), [skillCall('release-steps', 'phase merge. pr=1')]),
      assistant('a5', OPUS, ctx(406000)),
    ]),
    'bbbbbbbb.jsonl': jsonl([
      user('release this'),
      skillText('release'),
      assistant('b1', OPUS, ctx(100000), [skillCall('release-steps', 'merge pr=2')]),
      assistant('b2', OPUS, ctx(101500)),
    ]),
    // a retried commit is the same release; a commit after a later phase, in the same window, is the next one
    'cccccccc.jsonl': jsonl([
      user('release both'),
      skillText('release'),
      assistant('c1', OPUS, ctx(350000), [skillCall('release-steps', 'phase=commit')]),
      assistant('c2', OPUS, ctx(351000), [skillCall('release-steps', 'phase=commit')]),
      assistant('c3', OPUS, ctx(352000), [skillCall('release-steps', 'phase=merge')]),
      assistant('c4', OPUS, ctx(353000), [skillCall('release-steps', 'phase=commit')]),
      assistant('c5', OPUS, ctx(354500)),
    ]),
    // the user's next message, not the fork, is what changed the context here
    'dddddddd.jsonl': jsonl([
      skillText('release'),
      assistant('d1', OPUS, ctx(100000), [skillCall('release-steps', 'phase=commit')]),
      user('a long pasted message'),
      assistant('d2', OPUS, ctx(190000)),
    ]),
  })
  return root
}

const near = (actual, expected) => Math.abs(actual - expected) < 1e-9

afterEach(cleanupTempDirs)

describe('callCost', () => {
  const unpriced = () => ({})

  it('should price a million tokens of each kind at the published rate', () => {
    const cases = [
      [OPUS, { input_tokens: 1e6 }, 4],
      [OPUS, { cache_read_input_tokens: 1e6 }, 0.2],
      [OPUS, { output_tokens: 1e6 }, 20],
      [SONNET, { input_tokens: 1e6 }, 2],
      [SONNET, { cache_read_input_tokens: 1e6 }, 0.1],
      [SONNET, { output_tokens: 1e6 }, 10],
      ['claude-fable-5-1', { input_tokens: 1e6 }, 10],
      ['claude-fable-5-1', { cache_read_input_tokens: 1e6 }, 0.25],
      ['claude-fable-5-1', { output_tokens: 1e6 }, 50],
    ]
    for (const [model, usage, dollars] of cases) assert.ok(near(callCost(usage, model, unpriced()), dollars), `${model} ${JSON.stringify(usage)}`)
  })

  it('should price Haiku 5.5 by prompt length, counting cached tokens in the prompt', () => {
    assert.ok(near(callCost({ input_tokens: 1e5, output_tokens: 1e6 }, 'claude-haiku-5-5', unpriced()), 0.01 + 0.5))
    assert.ok(near(callCost({ input_tokens: 1, cache_read_input_tokens: 1e5, output_tokens: 1e6 }, 'claude-haiku-5-5', unpriced()), 0.5e-6 + 0.005 + 2.5))
  })

  it('should charge 5m and 1h cache writes at their own rates, and never both', () => {
    assert.ok(near(callCost({ cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 1e6 } }, OPUS, unpriced()), 5))
    assert.ok(near(callCost({ cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }, OPUS, unpriced()), 8))
    assert.ok(near(callCost({ cache_creation_input_tokens: 1e6 }, OPUS, unpriced()), 8))
  })

  it('should accept a dated model id', () => {
    assert.ok(near(callCost({ input_tokens: 1e6 }, 'claude-opus-5-5-20261001', unpriced()), 4))
  })

  it('should count a model with no price instead of pricing it as Opus', () => {
    const counts = {}
    assert.equal(callCost({ input_tokens: 1e6 }, 'claude-opus-4-1', counts), 0)
    assert.equal(callCost({ input_tokens: 1e6 }, undefined, counts), 0)
    assert.deepEqual(counts, { 'claude-opus-4-1': 1, unknown: 1 })
  })

  it('should count a fast-mode call instead of pricing it at standard rates', () => {
    const counts = {}
    assert.equal(callCost({ input_tokens: 1e6, speed: 'fast' }, OPUS, counts), 0)
    assert.deepEqual(counts, { [OPUS + ' fast']: 1 })
    assert.ok(near(callCost({ input_tokens: 1e6, speed: 'standard' }, OPUS, counts), 4))
  })
})

describe('usage.cjs', () => {
  it('should list forks under their skill names with counts next to Skill calls', () => {
    const r = run('usage.cjs', [FROM, TO, usageFixture()])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /release-steps \(fork\) 1 2\.0%/)
    assert.match(r.stdout, /verify \(fork\) 1 4\.0%/)
    assert.doesNotMatch(r.stdout, /general-purpose/)
    assert.match(r.stdout, /usiatech-engineering:release-steps 1 /)
    assert.match(r.stdout, /usiatech-engineering:verify 1 /)
  })

  it('should print a plugin share of release, verify, reviewers and forks', () => {
    const r = run('usage.cjs', [FROM, TO, usageFixture()])
    assert.match(r.stdout, /sessions 1 total \$100\.00/)
    assert.match(r.stdout, /plugin share \(release \+ verify \+ reviewers \+ forks\): 50\.0% \$50\.00/)
  })

  it('should split the release window, counting an Edit in a later record of the call', () => {
    const r = run('usage.cjs', [FROM, TO, usageFixture()])
    assert.match(r.stdout, /release window: fixing work 20\.0% \$20\.00, overhead 12\.0% \$12\.00/)
    assert.match(r.stdout, /Edit or Write tool use/)
  })

  it('should count the release flow\'s own scratchpad and plan writes as overhead', () => {
    const root = tempDir('audit-split-')
    const write = (id, file_path) => assistant(id, OPUS, { input_tokens: 1e6 }, [tool('Write', { file_path })])
    writeFiles(root, { 's.jsonl': jsonl([
      skillText('release'),
      write('w1', 'C:\\Users\\me\\AppData\\Local\\Temp\\claude\\x\\commit-msg.txt'),
      write('w2', '/home/me/.claude/plans/active.md'),
      write('w3', 'C:\\repo\\.claude\\plans\\archive\\done.md'),
      write('w4', 'C:\\repo\\src\\fixed.js'),
    ]) })
    assert.match(run('usage.cjs', [FROM, TO, root]).stdout, /release window: fixing work 25\.0% \$4\.00, overhead 75\.0% \$12\.00/)
  })

  it('should not count a subagent whose prompt only names a plugin skill path as a fork', () => {
    const root = tempDir('audit-not-fork-')
    const s = subagent('Explore', 'Read C:/plugins/usiatech-engineering/0.19.3/skills/release/SKILL.md', OPUS, { input_tokens: 1e6 })
    writeFiles(root, { 's.jsonl': jsonl([assistant('m', OPUS, { input_tokens: 1e6 })]), 's/subagents/agent-a.jsonl': s.jsonl, 's/subagents/agent-a.meta.json': s.meta })
    const out = run('usage.cjs', [FROM, TO, root]).stdout
    assert.match(out, /Explore 1 /)
    assert.doesNotMatch(out, /\(fork\)/)
  })

  it('should report unreadable transcript lines', () => {
    const root = tempDir('audit-unreadable-')
    writeFiles(root, { 's.jsonl': jsonl([assistant('m', OPUS, { input_tokens: 1e6 })]) + '{"truncated\n' })
    assert.match(run('usage.cjs', [FROM, TO, root]).stdout, /unreadable transcript lines \(left out\): 1/)
  })

  it('should price skill text carried in the main thread at each call\'s read price', () => {
    const root = tempDir('audit-carry-')
    // 4,000,000 chars is 1M tokens, re-read by one Opus call ($0.20) and one Sonnet call ($0.10), in a $10 week
    writeFiles(root, { 's.jsonl': jsonl([
      user(SKILL_ROOT + 'release' + ' '.repeat(4e6 - (SKILL_ROOT + 'release').length)),
      assistant('o', OPUS, { input_tokens: 2.5e6 }),
      assistant('s', SONNET, { input_tokens: 0 }),
    ]) })
    const r = run('usage.cjs', [FROM, TO, root])
    assert.match(r.stdout, /skill text carried in main ctx 3\.0%/)
  })

  it('should report unpriced models and skip synthetic calls', () => {
    const root = usageFixture()
    assert.doesNotMatch(run('usage.cjs', [FROM, TO, root]).stdout, /unpriced/)
    writeFiles(root, { 's2.jsonl': jsonl([assistant('old', 'claude-opus-4-1', { input_tokens: 1e6 })]) })
    assert.match(run('usage.cjs', [FROM, TO, root]).stdout, /unpriced calls \(cost left out\): claude-opus-4-1 1/)
  })
})

describe('window.cjs', () => {
  it('should sum context growth across a release\'s release-steps calls', () => {
    const r = run('window.cjs', [FROM, TO, windowFixture()])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /aaaaaaaa: start 401k, 2 release-steps, growth 5000 \(300k\+\)/)
    assert.match(r.stdout, /bbbbbbbb: start 100k, 1 release-steps, growth 1500\n/)
  })

  it('should start a new release at a commit after a later phase, not at a retried commit', () => {
    const { stdout } = run('window.cjs', [FROM, TO, windowFixture()])
    assert.match(stdout, /cccccccc: start 350k, 3 release-steps, growth 3000 \(300k\+\)/)
    assert.match(stdout, /cccccccc: start 353k, 1 release-steps, growth 1500 \(300k\+\)/)
  })

  it('should leave out context added by a user message before the next call', () => {
    assert.match(run('window.cjs', [FROM, TO, windowFixture()]).stdout, /dddddddd: start 100k, 1 release-steps, growth 0\n/)
  })

  it('should price each call at its own model', () => {
    const root = tempDir('audit-window-price-')
    writeFiles(root, { 's.jsonl': jsonl([
      user('go'),
      skillText('release'),
      assistant('o', OPUS, { input_tokens: 1e6 }),
      user('stop'),
      assistant('s', SONNET, { input_tokens: 2e6 }),
    ]) })
    assert.match(run('window.cjs', [FROM, TO, root]).stdout, /## release: 1 invocations, 1 API calls \(1\/inv\), 50\.0% main cost/)
  })

  it('should report unpriced models', () => {
    const root = tempDir('audit-window-unpriced-')
    writeFiles(root, { 's.jsonl': jsonl([assistant('old', 'claude-opus-4-1', { input_tokens: 1e6 })]) })
    assert.match(run('window.cjs', [FROM, TO, root]).stdout, /unpriced calls \(cost left out\): claude-opus-4-1 1/)
  })
})

for (const script of ['usage.cjs', 'window.cjs']) {
  describe(`${script} arguments`, () => {
    const bad = [
      ['an invalid date', () => ['soon', TO, tempDir('audit-args-')]],
      ['a date that does not exist', () => ['2026-02-31', TO, tempDir('audit-args-')]],
      ['a week that ends before it starts', () => [TO, FROM, tempDir('audit-args-')]],
      ['no folders', () => [FROM, TO]],
    ]
    for (const [name, args] of bad) {
      it(`should exit non-zero on ${name}`, () => {
        const r = run(script, args())
        assert.notEqual(r.status, 0)
        assert.match(r.stderr, /Usage:/)
      })
    }

    it('should read the week as local time with an exclusive end', () => {
      const session = (timestamp) => jsonl([assistant('a', OPUS, { input_tokens: 1e6 }, [], { timestamp })])
      const atEnd = tempDir('audit-end-'), beforeEnd = tempDir('audit-before-end-')
      writeFiles(atEnd, { 's.jsonl': session(new Date(TO + 'T00:00:00').toISOString()) })
      writeFiles(beforeEnd, { 's.jsonl': session(new Date(new Date(TO + 'T00:00:00').getTime() - 1).toISOString()) })
      const count = (dir) => run(script, [FROM, TO, dir]).stdout.match(/sessions (\d+)/)[1]
      assert.equal(count(atEnd), '0')
      assert.equal(count(beforeEnd), '1')
    })
  })
}
