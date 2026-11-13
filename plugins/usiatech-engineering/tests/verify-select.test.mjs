import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { skipReason } from '../templates/github/scripts/verify-select.mjs'

const step = (when, unless) => ({ name: 'e2e', run: 'x', when, ...(unless && { unless }) })

describe('verify-select: skipReason (ESP-160)', () => {
  it('should select a step when a changed file is under a when prefix and there is no unless (AC8)', () => {
    assert.equal(skipReason(step(['apps/web/src/']), ['apps/web/src/page.tsx']), null)
  })

  it('should skip a step no changed file is under, with the old reason (AC8)', () => {
    assert.equal(skipReason(step(['apps/web/src/', 'packages/ui/']), ['docs/a.md']), 'no changed file under apps/web/src/, packages/ui/')
  })

  it('should skip a step when every matching file is excluded by unless, and say so (AC6)', () => {
    const s = step(['apps/web/src/'], ['apps/web/src/**/*.live.tsx', 'apps/web/src/components/**/live/**'])
    const changed = ['apps/web/src/a.live.tsx', 'apps/web/src/components/x/live/b.tsx', 'docs/c.md']
    assert.equal(skipReason(s, changed), 'every changed file under apps/web/src/ matches unless apps/web/src/**/*.live.tsx, apps/web/src/components/**/live/**')
  })

  it('should select a step when one matching file is not excluded (AC7)', () => {
    const s = step(['apps/web/src/'], ['apps/web/src/**/*.live.tsx'])
    assert.equal(skipReason(s, ['apps/web/src/a.live.tsx', 'apps/web/src/b.tsx']), null)
  })

  it('should name a non-list unless instead of failing with a TypeError (CI runner)', () => {
    assert.throws(() => skipReason(step(['src/'], 'src/**'), ['src/a.ts']), /The "unless" of verify step "e2e" must be a list of globs\./)
  })

  it('should match unless globs exactly, case included, as the when prefixes do', () => {
    const s = step(['src/'], ['src/**/*.live.tsx'])
    assert.equal(skipReason(s, ['src/A.LIVE.tsx']), null)
  })

  it('should not let an unless glob for files outside when select or skip anything else', () => {
    const s = step(['src/'], ['docs/**'])
    assert.equal(skipReason(s, ['src/a.ts', 'docs/b.md']), null)
    assert.equal(skipReason(s, ['docs/b.md']), 'no changed file under src/')
  })

  it('should treat a missing when as matching nothing, as the CI runner always has', () => {
    assert.equal(skipReason({ name: 'x', run: 'x' }, ['src/a.ts']), 'no changed file under (none)')
  })
})
