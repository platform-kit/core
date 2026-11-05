import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveUsageUnit } from '../src/lib/usage-unit.js'

test('a configured offer unit takes precedence over a recorded event unit', () => {
  assert.equal(resolveUsageUnit('minutes', 'tokens'), 'minutes')
})

test('a recorded event unit is used when the offer unit is blank', () => {
  assert.equal(resolveUsageUnit('  ', ' tokens '), 'tokens')
})

test('credits is the final fallback when neither source has a unit', () => {
  for (const [offerUnit, eventUnit] of [[undefined, undefined], ['', null], ['  ', '  ']]) {
    assert.equal(resolveUsageUnit(offerUnit, eventUnit), 'credits')
  }
})
