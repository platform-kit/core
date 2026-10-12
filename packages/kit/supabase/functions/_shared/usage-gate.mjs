export function resolveUsageOperation(operations, operationId) {
  if (typeof operationId !== 'string' || !/^[a-z][a-z0-9_.:-]{0,95}$/.test(operationId)) {
    throw new Error('usage operation must be a stable server identifier')
  }
  const policy = operations?.[operationId]
  if (!policy) throw new Error(`usage operation "${operationId}" has no site policy`)
  if (policy.mode === 'site-funded') return { operationId, mode: 'site-funded', offerKey: null }
  if (policy.mode === 'offer' && /^[0-9a-f]{8}$/.test(String(policy.offerKey || ''))) {
    return { operationId, mode: 'offer', offerKey: policy.offerKey }
  }
  throw new Error(`usage operation "${operationId}" has an invalid site policy`)
}

export function createUsageGate({ resolveOffer, reserve, autoTopUp, settle, release }) {
  return async ({ userId, offerKey, invocationRef, maxUnitsMicros, botId = null, expiresAt = null, operationId = null, markupMicros = null }) => {
    if (!userId || !offerKey || !invocationRef || !Number.isSafeInteger(maxUnitsMicros) || maxUnitsMicros <= 0) {
      throw new Error('usage authorization needs a verified reader, stable offer, invocation reference, and positive bounded maximum')
    }
    if ((operationId != null && (typeof operationId !== 'string' || !/^[a-z][a-z0-9_.:-]{0,95}$/.test(operationId) ||
        !Number.isSafeInteger(markupMicros) || markupMicros < 1)) ||
        (operationId == null && markupMicros != null)) {
      throw new Error('inference usage authorization needs a stable operation and positive markup snapshot')
    }
    const offer = await resolveOffer(offerKey)
    if (!offer) return { admitted: false, reason: 'usage_offer_unavailable' }
    const request = { userId, offerKey, invocationRef, maxUnitsMicros, botId, expiresAt, operationId, markupMicros }
    let authorization = await reserve({ ...request, offer })
    if (!authorization?.admitted && authorization?.reason === 'usage_balance_exhausted') {
      const refill = await autoTopUp({ userId, invocationRef, offer })
      if (refill?.granted) authorization = await reserve({ ...request, offer })
      else if (refill?.reason && refill.reason !== 'topup_disabled') {
        return { admitted: false, reason: refill.reason, remainingMicros: authorization.remaining_micros ?? 0 }
      }
    }
    if (!authorization?.admitted) {
      return {
        admitted: false,
        reason: authorization?.reason || 'usage_not_authorized',
        remainingMicros: authorization?.remaining_micros ?? 0,
      }
    }

    let settled = false
    let released = false
    return {
      admitted: true,
      mode: authorization.mode,
      remainingMicros: authorization.remaining_micros ?? null,
      reservationRef: invocationRef,
      async settle(measurement) {
        if (settled || released) throw new Error('usage authorization is already closed')
        const result = await settle({
          ...request,
          kind: measurement?.kind,
          costMicros: measurement?.costMicros,
          secondsMicros: measurement?.secondsMicros ?? 0,
          unitsMicros: measurement?.unitsMicros,
          customerCostMicros: measurement?.customerCostMicros,
          retailValueMicros: measurement?.retailValueMicros,
          retailCurrency: measurement?.retailCurrency,
          measurementStatus: measurement?.measurementStatus,
          botId,
          offer,
        })
        settled = true
        return result
      },
      async release() {
        if (settled || released) return false
        const result = await release(request)
        released = result === true
        return released
      },
    }
  }
}
