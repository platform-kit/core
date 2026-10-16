export async function loadOwnedIncrementalSettlement({
  admin,
  providerId,
  userId,
  subscriptionId,
  periodStart,
  settlementKey,
}) {
  const { data: subscription, error: subscriptionError } = await admin.from('subscriptions')
    .select('id, key')
    .eq('id', subscriptionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (subscriptionError) {
    throw new Error(`incremental usage subscription could not be verified: ${subscriptionError.message}`)
  }
  if (!subscription) return { subscription: null, settlement: null }

  const { data: settlement, error: settlementError } = await admin.from('usage_incremental_settlements')
    .select('subscription_id, period_start, settlement_key, status, payment_intent_id')
    .eq('provider', providerId)
    .eq('subscription_id', subscriptionId)
    .eq('period_start', periodStart)
    .eq('settlement_key', settlementKey)
    .maybeSingle()
  if (settlementError) {
    throw new Error(`incremental usage payment could not be loaded: ${settlementError.message}`)
  }
  return { subscription, settlement }
}
