import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { CI_SCRIPTS, githubStub, runNode, tempDir, cleanupTempDirs } from './helpers.mjs'

after(cleanupTempDirs)

const SHA = 'abc1234def5678'
const BOT = 'github-actions[bot]'
const verdictComment = (verdict, sha = SHA, login = BOT) => ({ user: { login }, body: `## Governance review\n<!-- governance-verdict ${JSON.stringify({ verdict, sha })} -->` })
const allGreen = { 'governance-checks': { result: 'success' }, 'verify-gate': { result: 'success' }, 'ai-governance-review': { result: 'success' } }

// pages: array of comment arrays, served for page=1..n
const runGate = async ({ needs = allGreen, labels = [], pages = [[]] } = {}) => {
  const stub = await githubStub((req) => {
    const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1)
    return { json: pages[page - 1] || [] }
  })
  try {
    const r = await runNode(path.join(CI_SCRIPTS, 'governance-gate.mjs'), {
      cwd: tempDir(),
      env: {
        NEEDS_JSON: JSON.stringify(needs), PR_LABELS: JSON.stringify(labels), HEAD_SHA: SHA, PR_NUMBER: '5',
        GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't0ken', GITHUB_API_URL: stub.url, APPROVAL_LABEL: '',
      },
    })
    return { ...r, requests: stub.requests }
  } finally {
    await stub.close()
  }
}

describe('governance-gate', () => {
  it('should pass when all jobs succeed and the head commit has a PASS verdict', async () => {
    const r = await runGate({ pages: [[verdictComment('PASS')]] })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.summary, /AI verdict: \*\*PASS\*\*/)
    assert.equal(r.requests[0].url, '/repos/o/r/issues/5/comments?per_page=100&page=1')
    assert.equal(r.requests[0].auth, 'Bearer t0ken')
  })

  it('should fail on BLOCK and ERROR verdicts', async () => {
    assert.equal((await runGate({ pages: [[verdictComment('BLOCK')]] })).code, 1)
    const err = await runGate({ pages: [[verdictComment('ERROR')]] })
    assert.equal(err.code, 1)
    assert.match(err.stdout, /review errored/)
  })

  it('should fail on FLAG unless the approval label is present', async () => {
    assert.equal((await runGate({ pages: [[verdictComment('FLAG')]] })).code, 1)
    assert.equal((await runGate({ pages: [[verdictComment('FLAG')]], labels: ['governance-approved'] })).code, 0)
  })

  it('should fail when there is no verdict for the head commit', async () => {
    const r = await runGate({ pages: [[verdictComment('PASS', 'oldsha999')]] })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /No AI governance verdict for commit abc1234/)
  })

  it('should ignore verdict markers posted by other users', async () => {
    assert.equal((await runGate({ pages: [[verdictComment('PASS', SHA, 'mallory')]] })).code, 1)
  })

  it('should use the latest verdict for the head commit', async () => {
    assert.equal((await runGate({ pages: [[verdictComment('PASS'), verdictComment('BLOCK')]] })).code, 1)
  })

  it('should follow pagination to find the verdict', async () => {
    const filler = Array.from({ length: 100 }, () => ({ user: { login: 'someone' }, body: 'lgtm' }))
    const r = await runGate({ pages: [filler, [verdictComment('PASS')]] })
    assert.equal(r.code, 0, r.stdout)
    assert.equal(r.requests.length, 2)
  })

  it('should fail when deterministic checks did not succeed', async () => {
    const r = await runGate({ needs: { ...allGreen, 'governance-checks': { result: 'failure' } }, pages: [[verdictComment('PASS')]] })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /Deterministic governance checks: failure/)
  })

  it('should fail when a job result is missing', async () => {
    const { 'governance-checks': _, ...rest } = allGreen
    const r = await runGate({ needs: rest, pages: [[verdictComment('PASS')]] })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /Deterministic governance checks: missing/)
  })

  it('should accept a skipped verify gate but not a failed one', async () => {
    assert.equal((await runGate({ needs: { ...allGreen, 'verify-gate': { result: 'skipped' } }, pages: [[verdictComment('PASS')]] })).code, 0)
    assert.equal((await runGate({ needs: { ...allGreen, 'verify-gate': { result: 'failure' } }, pages: [[verdictComment('PASS')]] })).code, 1)
  })

  it('should not demand or fetch a verdict when the AI review was skipped', async () => {
    const r = await runGate({ needs: { ...allGreen, 'ai-governance-review': { result: 'skipped' } } })
    assert.equal(r.code, 0, r.stdout)
    assert.equal(r.requests.length, 0)
    assert.match(r.stdout, /AI governance review skipped/)
  })

  it('should fail when the AI review job failed or was cancelled', async () => {
    for (const result of ['failure', 'cancelled']) {
      const r = await runGate({ needs: { ...allGreen, 'ai-governance-review': { result } }, pages: [[verdictComment('PASS')]] })
      assert.equal(r.code, 1, result)
    }
  })
})

describe('governance-gate: GitHub API errors', () => {
  it('should fail with a clear message when the comments API errors', async () => {
    const stub = await githubStub(() => ({ status: 403, json: { message: 'rate limited' } }))
    try {
      const r = await runNode(path.join(CI_SCRIPTS, 'governance-gate.mjs'), {
        cwd: tempDir(),
        env: { NEEDS_JSON: JSON.stringify(allGreen), PR_LABELS: '[]', HEAD_SHA: SHA, PR_NUMBER: '5', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_API_URL: stub.url },
      })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /GitHub API returned 403/)
    } finally {
      await stub.close()
    }
  })
})
