export function incrementalUsageAmount(events, currency, toMinorUnits) {
  const numerator = events.reduce((sum, event) => {
    const units = String(event.metered_micros)
    const price = String(event.overage_price_micros)
    if (!/^[1-9]\d*$/.test(units) || !/^[1-9]\d*$/.test(price)) {
      throw new Error(`metered usage event ${event.id} has invalid billing terms`)
    }
    return sum + BigInt(units) * BigInt(price)
  }, 0n)
  return toMinorUnits(numerator.toString(), currency)
}

export function incrementalUsagePlan(amountMinor, thresholdMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 ||
      !Number.isSafeInteger(thresholdMinor) || thresholdMinor <= 0) {
    throw new TypeError('incremental usage amounts must be non-negative and the threshold must be positive safe integers')
  }
  const thresholdCount = Math.floor(amountMinor / thresholdMinor)
  return { thresholdCount, remainderMinor: amountMinor - thresholdCount * thresholdMinor }
}

export function createIncrementalUsageSettler({
  admin,
  offerByKey,
  toMinorUnits,
  findProviderExternalIds,
  linkProviderEntity,
}) {
  const checked = (data, error, context) => {
    if (error) throw new Error(`${context}: ${error.message}`)
    return data
  }

  return async function settleIncrementalUsage(provider, {
    subscriptionId,
    periodStart,
    periodEnd = null,
    finalize = false,
  }) {
    const { data: subscriptionRow, error: subscriptionError } = await admin.from('subscriptions')
      .select('user_id, key')
      .eq('id', subscriptionId)
      .maybeSingle()
    const subscription = checked(subscriptionRow, subscriptionError, 'incremental usage subscription could not be loaded')
    if (!subscription) return { amountMinor: 0, chargedMinor: 0 }
    if (!provider.createPaymentIntent) {
      throw new Error(`payment provider "${provider.id}" cannot collect incremental usage charges`)
    }

    const period = new Date(periodStart)
    if (!Number.isFinite(period.getTime())) throw new Error(`subscription ${subscriptionId} has an invalid usage period start`)
    const periodStartIso = period.toISOString()
    const { data: events, error: eventsError } = await admin.from('usage_events')
      .select('id, metered_micros, overage_price_micros, usage_incremental_charge_minor, usage_incremental_charge_currency')
      .eq('subscription_id', subscriptionId)
      .eq('period_start', periodStartIso)
      .gt('metered_micros', 0)
      .gt('usage_incremental_charge_minor', 0)
    if (eventsError) throw new Error(`incremental usage events could not be loaded for ${subscriptionId}: ${eventsError.message}`)
    const offer = subscription.key ? offerByKey(subscription.key) : null
    const snapshots = [...new Map((events ?? []).map((event) => [
      `${event.usage_incremental_charge_minor}:${event.usage_incremental_charge_currency}`,
      {
        threshold: Number(event.usage_incremental_charge_minor),
        currency: String(event.usage_incremental_charge_currency ?? '').toLowerCase(),
      },
    ])).values()]
    if (!snapshots.length) return { amountMinor: 0, chargedMinor: 0 }
    if (snapshots.length !== 1 ||
        !Number.isSafeInteger(snapshots[0].threshold) || snapshots[0].threshold <= 0 ||
        !/^[a-z]{3}$/.test(snapshots[0].currency)) {
      throw new Error(`subscription ${subscriptionId} has inconsistent incremental usage terms within period ${periodStartIso}`)
    }
    const { threshold, currency } = snapshots[0]
    const amountMinor = incrementalUsageAmount(events ?? [], currency, toMinorUnits)
    if (amountMinor <= 0) return { amountMinor, chargedMinor: 0 }

    const periodSecond = Math.floor(period.getTime() / 1000)
    const periodEndSecond = periodEnd == null ? null : Math.floor(new Date(periodEnd).getTime() / 1000)
    let customerId
    let paymentMethodId

    const getSavedPaymentDetails = async () => {
      if (customerId && paymentMethodId) return { customerId, paymentMethodId }
      let customerIds = await findProviderExternalIds(provider.id, 'customer', 'profiles', subscription.user_id)
      if (!customerIds.length && provider.id === 'stripe') {
        const { data: profileRow, error: profileError } = await admin.from('profiles')
          .select('stripe_customer_id')
          .eq('id', subscription.user_id)
          .maybeSingle()
        const profile = checked(profileRow, profileError, 'legacy Stripe customer could not be loaded')
        if (profile?.stripe_customer_id) {
          await linkProviderEntity(provider.id, 'customer', profile.stripe_customer_id, 'profiles', subscription.user_id)
          customerIds = [profile.stripe_customer_id]
        }
      }
      if (customerIds.length !== 1) {
        throw new Error(`subscription ${subscriptionId} must have exactly one ${provider.id} customer reference for incremental usage`)
      }
      customerId = customerIds[0]
      const methods = await findProviderExternalIds(provider.id, 'payment_method', 'subscriptions', subscriptionId)
      if (methods.length > 1) {
        throw new Error(`subscription ${subscriptionId} has multiple saved ${provider.id} payment methods for incremental usage`)
      }
      if (provider.getDefaultPaymentMethod) {
        const method = await provider.getDefaultPaymentMethod(customerId)
        paymentMethodId = method.paymentMethodId ?? methods[0]
      } else {
        paymentMethodId = methods[0]
      }
      if (!paymentMethodId) {
        throw new Error(`subscription ${subscriptionId} has no saved ${provider.id} payment method for incremental usage`)
      }
      return { customerId, paymentMethodId }
    }

    const charge = async (settlementKey, chargeMinor) => {
      const key = {
        provider: provider.id,
        subscription_id: subscriptionId,
        period_start: periodStartIso,
        settlement_key: settlementKey,
      }
      const { error: insertError } = await admin.from('usage_incremental_settlements')
        .upsert({
          ...key,
          amount_minor: chargeMinor,
          currency,
          status: 'pending',
          attempt_number: 1,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'provider,subscription_id,period_start,settlement_key',
          ignoreDuplicates: true,
        })
      if (insertError) throw new Error(`incremental usage charge could not be reserved: ${insertError.message}`)
      const { data: existingRow, error: readError } = await admin.from('usage_incremental_settlements')
        .select('amount_minor, currency, status, attempt_number, payment_intent_id')
        .match(key)
        .single()
      let existing = checked(existingRow, readError, 'incremental usage charge could not be verified')
      if (Number(existing.amount_minor) !== chargeMinor || existing.currency !== currency) {
        throw new Error(`incremental usage charge ${settlementKey} changed amount or currency after it was reserved`)
      }
      if (existing.status === 'succeeded') return existing.payment_intent_id

      try {
        if (existing.status === 'failed') {
          const attemptNumber = Number(existing.attempt_number)
          if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
            throw new Error(`incremental usage charge ${settlementKey} has an invalid attempt number`)
          }
          const { data: retriedRows, error: retryError } = await admin.from('usage_incremental_settlements')
            .update({
              status: 'pending',
              attempt_number: attemptNumber + 1,
              payment_intent_id: null,
              last_error: null,
              updated_at: new Date().toISOString(),
            })
            .match(key)
            .eq('status', 'failed')
            .select('amount_minor, currency, status, attempt_number, payment_intent_id')
          if (retryError) throw new Error(`incremental usage charge retry could not be reserved: ${retryError.message}`)
          if (retriedRows?.length) {
            existing = retriedRows[0]
          } else {
            const { data: currentRow, error: currentError } = await admin.from('usage_incremental_settlements')
              .select('amount_minor, currency, status, attempt_number, payment_intent_id')
              .match(key)
              .single()
            existing = checked(currentRow, currentError, 'incremental usage charge retry could not be verified')
          }
        }
        let result
        if (['requires_action', 'pending'].includes(existing.status) && existing.payment_intent_id) {
          if (!provider.retrievePaymentIntent) {
            if (existing.status === 'requires_action') {
              throw new Error(`payment provider "${provider.id}" cannot retrieve an action-required incremental usage payment`)
            }
          } else {
            result = await provider.retrievePaymentIntent(existing.payment_intent_id)
          }
        }
        if (!result) {
          const saved = await getSavedPaymentDetails()
          result = await provider.createPaymentIntent({
            amountMinor: chargeMinor,
            currency,
            customerId: saved.customerId,
            paymentMethodId: saved.paymentMethodId,
            description: `Metered usage for ${offer?.title ?? subscription.key}`,
            metadata: {
              platformkit_usage_incremental: '1',
              platformkit_subscription_local_id: subscriptionId,
              platformkit_period_start: String(periodSecond),
              ...(periodEndSecond == null ? {} : { platformkit_period_end: String(periodEndSecond) }),
              platformkit_usage_settlement: settlementKey,
              platformkit_usage_attempt: String(existing.attempt_number),
            },
            idempotencyKey: `subscription-usage-increment:${subscriptionId}:${periodSecond}:${settlementKey}:${existing.attempt_number}`,
          })
        }
        const status = result.status.toLowerCase()
        if (status !== 'succeeded') {
          const settlementStatus = status.includes('action') || status.includes('authentication')
            ? 'requires_action'
            : status === 'processing' ? 'pending' : 'failed'
          const { error: updateError } = await admin.from('usage_incremental_settlements').update({
            status: settlementStatus,
            payment_intent_id: result.paymentIntentId,
            last_error: `payment returned status "${result.status}"`,
            updated_at: new Date().toISOString(),
          }).match(key)
          if (updateError) throw new Error(`incremental usage payment failed and its status could not be saved: ${updateError.message}`)
          throw new Error(`incremental usage payment ${result.paymentIntentId} returned status "${result.status}"`)
        }
        await linkProviderEntity(provider.id, 'payment', result.paymentIntentId, 'subscriptions', subscriptionId)
        const { error: successError } = await admin.from('usage_incremental_settlements').update({
          status: 'succeeded',
          payment_intent_id: result.paymentIntentId,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).match(key)
        if (successError) throw new Error(`incremental usage payment succeeded but its settlement could not be recorded: ${successError.message}`)
        return result.paymentIntentId
      } catch (cause) {
        const message = String(cause instanceof Error ? cause.message : cause)
        const { error: failureError } = await admin.from('usage_incremental_settlements')
          .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
          .match(key)
          .eq('status', 'pending')
        if (failureError) throw new Error(`incremental usage payment failed and its retry state could not be saved: ${failureError.message}`)
        throw cause
      }
    }

    const { thresholdCount, remainderMinor } = incrementalUsagePlan(amountMinor, threshold)
    let chargedMinor = 0
    for (let index = 1; index <= thresholdCount; index++) {
      await charge(`threshold:${index}`, threshold)
      chargedMinor += threshold
    }
    if (finalize) {
      if (remainderMinor > 0) {
        await charge('period-close', remainderMinor)
        chargedMinor += remainderMinor
      }
    }
    return { amountMinor, chargedMinor }
  }
}
