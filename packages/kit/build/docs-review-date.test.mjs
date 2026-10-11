import assert from 'node:assert/strict'
import test from 'node:test'
import { isReviewedForCurrentDate } from './docs-review-date.mjs'

test('accepts a human review date through the UTC midnight boundary', () => {
  const now = new Date('2026-10-08T00:23:00Z')
  assert.equal(isReviewedForCurrentDate('2026-10-07', now, 0), true)
  assert.equal(isReviewedForCurrentDate('2026-10-06', now, 0), false)
})

test('bounds UTC fallback dates to the world time-zone range', () => {
  assert.equal(isReviewedForCurrentDate('2026-10-07', new Date('2026-10-08T11:59:00Z'), 0), true)
  assert.equal(isReviewedForCurrentDate('2026-10-07', new Date('2026-10-08T12:00:00Z'), 0), false)
  assert.equal(isReviewedForCurrentDate('2026-10-09', new Date('2026-10-08T09:59:00Z'), 0), false)
  assert.equal(isReviewedForCurrentDate('2026-10-09', new Date('2026-10-08T10:00:00Z'), 0), true)
  assert.equal(isReviewedForCurrentDate('2026-10-09', new Date('2026-10-08T23:59:00Z'), 0), true)
})

test('uses the process-local date without extending the review window', () => {
  const now = new Date('2026-10-08T00:23:00Z')
  assert.equal(isReviewedForCurrentDate('2026-10-07', now, 420), true)
  assert.equal(isReviewedForCurrentDate('2026-10-06', now, 420), false)
})
