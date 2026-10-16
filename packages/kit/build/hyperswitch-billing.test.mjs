import assert from 'node:assert/strict'
import {
  meteredUsageAmountMinor,
  paymentPeriodEnd,
} from '../supabase/functions/_shared/hyperswitch-billing.mjs'

const seconds = (value) => Math.floor(Date.parse(value) / 1000)
const iso = (value) => new Date(value * 1000).toISOString()

assert.equal(
  iso(paymentPeriodEnd(seconds('2026-01-31T12:00:00.000Z'))),
  '2026-02-28T12:00:00.000Z',
)
assert.equal(
  iso(paymentPeriodEnd(seconds('2024-01-31T12:00:00.000Z'))),
  '2024-02-29T12:00:00.000Z',
)
assert.equal(
  iso(paymentPeriodEnd(seconds('2024-02-29T12:00:00.000Z'), 'year')),
  '2025-02-28T12:00:00.000Z',
)
assert.equal(
  iso(paymentPeriodEnd(seconds('2026-01-01T00:00:00.000Z'), 'week')),
  '2026-01-08T00:00:00.000Z',
)
assert.throws(() => paymentPeriodEnd(-1), /non-negative epoch second/)
assert.throws(() => paymentPeriodEnd(1, 'quarter'), /unsupported payment billing interval/)
assert.equal(meteredUsageAmountMinor('30000000000', 'USD'), 3)
assert.equal(meteredUsageAmountMinor('5000000000', 'USD'), 1, 'fractional minor units round once per billing period')
assert.equal(meteredUsageAmountMinor('1000000000000', 'JPY'), 1)
assert.throws(() => meteredUsageAmountMinor('-1', 'USD'), /non-negative integer/)
assert.throws(() => meteredUsageAmountMinor('1', 'NOT-A-CURRENCY'), /minor-unit scale/)

console.log('hyperswitch billing: calendar periods and metered-usage amount rounding passed')
