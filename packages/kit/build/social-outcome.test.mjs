import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveSocialOutcome } from '../supabase/functions/_shared/social/outcome.mjs'

const knownFailure = (failure) => ({
  status: failure.disposition?.kind === 'after-delay' ? 'retry_wait' : 'failed',
  errorCode: failure.code,
})

let reconcileCalls = 0
const rejected = async () => {
  reconcileCalls++
  return { outcome: 'not-found' }
}
let publishCalls = 0
let publishError
try {
  publishCalls++
  throw new Error('connection closed after provider acceptance')
} catch (error) {
  publishError = error
}
const acceptedButResponseLost = await resolveSocialOutcome({
  publishError,
  reconcile: async (providerPostId) => {
    reconcileCalls++
    assert.equal(providerPostId, undefined)
    return { outcome: 'published', providerPostId: 'post-accepted', publishedAt: '2030-01-01T00:00:00Z' }
  },
  onKnownFailure: knownFailure,
})
assert.deepEqual(acceptedButResponseLost, { status: 'published', providerPostId: 'post-accepted' })
assert.equal(publishCalls, 1, 'an accepted publication is reconciled, never submitted again')
assert.equal(reconcileCalls, 1)

reconcileCalls = 0
const transient = await resolveSocialOutcome({
  publishResult: {
    outcome: 'failed',
    code: 'rate_limited',
    retryDisposition: { kind: 'after-delay', delayMs: 30_000 },
  },
  reconcile: rejected,
  onKnownFailure: knownFailure,
})
assert.deepEqual(transient, { status: 'retry_wait', errorCode: 'rate_limited' })
assert.equal(reconcileCalls, 0, 'a known transient does not need ambiguous-outcome reconciliation')

const terminal = await resolveSocialOutcome({
  publishResult: { outcome: 'failed', code: 'media_rejected' },
  reconcile: rejected,
  onKnownFailure: knownFailure,
})
assert.deepEqual(terminal, { status: 'failed', errorCode: 'media_rejected' })

const ambiguous = await resolveSocialOutcome({
  publishResult: { outcome: 'accepted', providerPostId: 'post-maybe' },
  reconcile: async () => ({ outcome: 'unknown' }),
  onKnownFailure: knownFailure,
})
assert.equal(ambiguous.status, 'review_required')
assert.equal(ambiguous.errorCode, 'provider_outcome_uncertain')

const lostResponse = await resolveSocialOutcome({
  publishError: new Error('connection closed after submission'),
  reconcile: async () => ({ outcome: 'unknown' }),
  onKnownFailure: knownFailure,
})
assert.equal(lostResponse.status, 'review_required')
assert.equal(lostResponse.errorCode, 'provider_outcome_uncertain')

const publishSource = fs.readFileSync(new URL('../supabase/functions/social-publish/index.ts', import.meta.url), 'utf8')
assert.match(publishSource, /resolveSocialOutcome/)
assert.doesNotMatch(publishSource, /adapter\.publish\([\s\S]*?adapter\.publish\(/, 'the delivery path must not retry publication inside one invocation')

console.log('social-outcome: accepted, transient, terminal, and ambiguous provider outcomes passed')
