import { providerScopedId } from './payment-provider.mjs'

const stableRef = async (userId, invocationRef, offerKey) => {
  const input = new TextEncoder().encode(`${userId}\n${offerKey}\n${invocationRef}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  const hash = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('')
  return `ut_${hash}`
}

const paymentState = (intent) => {
  if (intent?.status === 'succeeded') return 'succeeded'
  if (intent?.status === 'requires_action' || intent?.status === 'requires_confirmation') return 'requires_action'
  return 'failed'
}

export function createUsageTopUp({
  config,
  preference,
  paymentMethod,
  begin,
  finish,
  grant,
  provider,
  mock = false,
}) {
  return async ({ userId, invocationRef }) => {
    if (!config?.enabled) return { granted: false, reason: 'topup_disabled' }
    if (!userId || !invocationRef) return { granted: false, reason: 'topup_identity_required' }

    const pref = await preference(userId)
    if (!pref?.enabled || !pref.off_session_consent_at) return { granted: false, reason: 'topup_disabled' }
    const pack = (config.packs || []).find(({ key }) => key === pref.offer_key)
    if (!pack || pack.currency !== pref.currency) return { granted: false, reason: 'topup_offer_unavailable' }

    const saved = await paymentMethod(userId)
    if (!mock && (!saved?.customerId || !saved?.paymentMethodId)) {
      return { granted: false, reason: 'topup_payment_method_required' }
    }

    const attemptRef = await stableRef(userId, invocationRef, pack.key)
    const started = await begin({
      userId,
      attemptRef,
      offerKey: pack.key,
      currency: pack.currency,
      amountMinor: pack.unit_amount,
      unitsMicros: pack.units_micros,
      usageUnit: pack.unit,
      rateMicros: pack.rate_micros,
      speechCostPerSecondMicros: pack.speech_cost_per_second_micros || 0,
      siteEnabled: config.enabled,
    })
    const attempt = started?.attempt || started
    if (!started?.started && !['succeeded', 'granted'].includes(attempt?.status)) {
      return { granted: false, reason: started?.reason || attempt?.reason || 'topup_not_started' }
    }
    if (attempt?.status === 'granted') return { granted: true, duplicate: true, attemptRef: attempt.attempt_ref }

    const effectiveRef = attempt?.attempt_ref || attemptRef
    let intent
    try {
      const paymentIntentId = attempt?.provider_payment_intent_id ||
        (provider.id === 'stripe' ? attempt?.stripe_payment_intent_id : undefined)
      if (attempt?.status === 'succeeded' && paymentIntentId) {
        intent = await provider.retrievePaymentIntent(paymentIntentId)
      } else if (mock) {
        intent = { paymentIntentId: `pi_mock_${effectiveRef}`, status: 'succeeded' }
      } else {
        intent = await provider.createPaymentIntent({
          amountMinor: Number(attempt?.amount_minor ?? pack.unit_amount),
          currency: attempt?.currency || pack.currency,
          customerId: saved.customerId,
          paymentMethodId: saved.paymentMethodId,
          description: `Automatic usage top-up — ${pack.title}`,
          metadata: {
            kind: 'usage_topup',
            usage_topup_attempt: effectiveRef,
            usage_offer_key: pack.key,
            usage_pack_key: pack.key,
            usage_pack_sku: pack.sku,
          },
          idempotencyKey: `usage-topup:${effectiveRef}`,
        })
      }
    } catch (error) {
      const failedIntent = error?.raw?.payment_intent || error?.payment_intent || null
      const status = paymentState(failedIntent)
      if (failedIntent) {
        const savedFailure = await finish({
          attemptRef: effectiveRef,
          status,
          paymentIntentId: failedIntent.paymentIntentId ?? failedIntent.id,
          error: error?.message || 'payment did not complete',
        })
        if (!savedFailure) throw new Error('automatic top-up failed and its payment state could not be saved')
      } else {
        const savedFailure = await finish({
          attemptRef: effectiveRef,
          status: 'failed',
          error: error?.message || 'payment did not complete',
        })
        if (!savedFailure) throw new Error('automatic top-up failed and its retry state could not be saved')
      }
      return { granted: false, reason: status === 'requires_action' ? 'topup_requires_action' : 'topup_payment_failed' }
    }

    const status = paymentState(intent)
    if (status !== 'succeeded') {
      const savedResult = await finish({
        attemptRef: effectiveRef,
        status,
        paymentIntentId: intent?.paymentIntentId,
        error: status === 'requires_action' ? 'reader authentication is required' : 'payment was not confirmed',
      })
      if (!savedResult) throw new Error('automatic top-up result could not be saved')
      return { granted: false, reason: status === 'requires_action' ? 'topup_requires_action' : 'topup_payment_failed' }
    }

    const savedPayment = await finish({
      attemptRef: effectiveRef,
      status: 'succeeded',
      paymentIntentId: intent.paymentIntentId,
    })
    if (!savedPayment) throw new Error('confirmed top-up payment could not be recorded')
    const granted = await grant({
      userId,
      offerKey: pack.key,
      sourceId: `topup:${providerScopedId(provider.id, intent.paymentIntentId)}`,
      unitsMicros: Number(attempt?.units_micros ?? pack.units_micros),
      usageUnit: attempt?.usage_unit ?? pack.unit,
      rateMicros: Number(attempt?.rate_micros ?? pack.rate_micros),
      speechCostPerSecondMicros: Number(attempt?.speech_cost_per_second_micros ?? pack.speech_cost_per_second_micros ?? 0),
    })
    if (granted !== true) throw new Error('confirmed top-up payment did not create its usage grant')
    const finished = await finish({
      attemptRef: effectiveRef,
      status: 'granted',
      paymentIntentId: intent.paymentIntentId,
    })
    if (!finished) throw new Error('usage grant was recorded but the top-up attempt could not be closed')
    return { granted: true, duplicate: attempt?.status === 'succeeded', attemptRef: effectiveRef }
  }
}
