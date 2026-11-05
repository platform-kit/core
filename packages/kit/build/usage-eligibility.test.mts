import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPublishedMeteredUsagePlan, isPublishedMeteredUsageOffer } from '../theme/src/lib/usage-eligibility.js'

test('a published metered subscription qualifies', () => {
  assert.equal(isPublishedMeteredUsageOffer({
    published: true,
    billing: 'subscription',
    usage: { meter: 'tokens' },
  }), true)
})

test('an omitted published flag retains the catalog default', () => {
  assert.equal(isPublishedMeteredUsageOffer({
    billing: 'subscription',
    usage: { meter: 'tokens' },
  }), true)
})

test('an unpublished metered subscription does not qualify', () => {
  assert.equal(isPublishedMeteredUsageOffer({
    published: false,
    billing: 'subscription',
    usage: { meter: 'tokens' },
  }), false)
})

test('a prepaid pack does not qualify', () => {
  assert.equal(isPublishedMeteredUsageOffer({
    published: true,
    billing: 'once',
    usage: { grant: 100, unit: 'credits' },
  }), false)
})

test('a subscription without a non-empty meter does not qualify', () => {
  for (const meter of [undefined, '', '   ']) {
    assert.equal(isPublishedMeteredUsageOffer({
      published: true,
      billing: 'subscription',
      usage: { meter },
    }), false)
  }
})

test('a site qualifies when any published metered subscription is available', () => {
  assert.equal(hasPublishedMeteredUsagePlan([
    { published: true, billing: 'once', usage: { grant: 100 } },
    { published: true, billing: 'subscription', usage: { meter: 'tokens' } },
  ]), true)
  assert.equal(hasPublishedMeteredUsagePlan([]), false)
  assert.equal(hasPublishedMeteredUsagePlan(null), false)
})
