/*
 * The balance is a derived view over append-only records, not a mutable number.
 * This checks the real database boundary: retries, exhaustion, and two readers
 * who must never see or write each other's usage.
 */
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { localStack, loadDotEnv, serviceKey, supabaseUrl } from './tts/storage.mjs'

const note = (message) => console.log('usage-db: ' + message)
loadDotEnv()
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !localStack() || !anonKey) {
  note('skipped — local Supabase credentials are unavailable; usage grants, balances, and reader policies were not covered')
  process.exit(0)
}
try {
  if (!(await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok) throw new Error('health check failed')
} catch {
  note('skipped — local Supabase is not running; usage grants, balances, and reader policies were not covered')
  process.exit(0)
}

const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const { error: schemaError } = await admin.from('usage_events').select('id').limit(0)
if (schemaError) {
  note(`skipped — usage schema is not applied (${schemaError.message}); run the local database reset to test it`)
  process.exit(0)
}

const suffix = crypto.randomUUID()
const operationSuffix = suffix.replaceAll('-', '').slice(0, 8)
const readerOperationId = `agent.game.${operationSuffix}`
const siteOperationId = `agent.staff.${operationSuffix}`
const pass = crypto.randomUUID()
const offerKey = 'usage_probe_' + suffix.replaceAll('-', '').slice(0, 16)
const inferenceOfferKey = suffix.replaceAll('-', '').slice(0, 8)
const users = []
const signedIn = async (id, email) => {
  const reader = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await reader.auth.signInWithPassword({ email, password: pass })
  if (error) throw new Error(`sign in test reader: ${error.message}`)
  return reader
}

try {
  for (const n of [1, 2]) {
    const email = `usage-${suffix}-${n}@example.invalid`
    const { data, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    if (error) throw new Error(`create temporary test reader: ${error.message}`)
    users.push({ id: data.user.id, email })
  }
  const source = `usage-db:${suffix}`
  const grant = (userId, amount) => admin.rpc('usage_grant', {
    p_user_id: userId, p_offer_key: offerKey, p_source: 'purchase',
    p_source_id: `checkout:${suffix}:${userId}`, p_units_micros: amount,
    p_period_start: null, p_expires_at: null,
  })
  const firstGrant = await grant(users[0].id, 5_000_000)
  assert.equal(firstGrant.error, null, firstGrant.error?.message)
  assert.equal(firstGrant.data, true, 'first purchase grant is recorded')
  const replayGrant = await grant(users[0].id, 5_000_000)
  assert.equal(replayGrant.error, null, replayGrant.error?.message)
  assert.equal(replayGrant.data, false, 'a replayed Checkout reference grants nothing twice')
  assert.equal((await grant(users[1].id, 8_000_000)).error, null)
  const inferenceGrant = await admin.rpc('usage_grant', {
    p_user_id: users[0].id, p_offer_key: inferenceOfferKey, p_source: 'purchase',
    p_source_id: `inference-pack:${suffix}`, p_units_micros: 2_000_000,
    p_period_start: null, p_expires_at: null, p_usage_unit: 'token',
    p_rate_micros: 1_000, p_speech_cost_per_second_micros: 0,
  })
  assert.equal(inferenceGrant.error, null, inferenceGrant.error?.message)
  assert.equal(inferenceGrant.data, true, 'the reader has balance for the isolated inference operation')
  const invoiceSource = `invoice:${suffix}`
  const periodStart = new Date(Date.now() - 60_000).toISOString()
  const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const invoiceGrant = await admin.rpc('usage_grant', {
    p_user_id: users[0].id, p_offer_key: offerKey, p_source: 'subscription',
    p_source_id: invoiceSource, p_units_micros: 1_000_000,
    p_period_start: periodStart, p_expires_at: periodEnd,
  })
  assert.equal(invoiceGrant.error, null, invoiceGrant.error?.message)
  const invoiceReplay = await admin.rpc('usage_grant', {
    p_user_id: users[0].id, p_offer_key: offerKey, p_source: 'subscription',
    p_source_id: invoiceSource, p_units_micros: 1_000_000,
    p_period_start: periodStart, p_expires_at: periodEnd,
  })
  assert.equal(invoiceReplay.error, null, invoiceReplay.error?.message)
  assert.equal(invoiceReplay.data, false, 'replaying an invoice grants its period allowance once')

  const firstAdmission = await admin.rpc('usage_admit', { p_user_id: users[0].id, p_offer_key: offerKey })
  assert.equal(firstAdmission.data?.admitted, true, 'a reader with prepaid units is admitted')
  const record = async (userId, sourceRef, units, botId = 'usage-probe') => {
    const authorization = await admin.rpc('usage_authorize', {
      p_user_id: userId, p_offer_key: offerKey, p_reservation_ref: sourceRef,
      p_max_units_micros: units,
      p_usage_unit: 'minute', p_rate_micros: 10_000,
      p_speech_cost_per_second_micros: 200,
    })
    assert.equal(authorization.error, null, authorization.error?.message)
    if (authorization.data?.reason === 'reservation_already_closed') {
      return admin.rpc('usage_settle', {
        p_reservation_ref: sourceRef, p_kind: 'model', p_cost_micros: 250,
        p_seconds_micros: 0, p_units_micros: units, p_bot_id: botId,
      })
    }
    assert.equal(authorization.data?.admitted, true, 'usage is reserved before work')
    return admin.rpc('usage_settle', {
      p_reservation_ref: sourceRef, p_kind: 'model', p_cost_micros: 250,
      p_seconds_micros: 0, p_units_micros: units, p_bot_id: botId,
    })
  }
  const initial = await record(users[0].id, `${source}:step-1`, 2_000_000)
  assert.equal(initial.error, null, initial.error?.message)
  assert.equal(initial.data?.duplicate, false)
  const replay = await record(users[0].id, `${source}:step-1`, 2_000_000)
  assert.equal(replay.error, null, replay.error?.message)
  assert.equal(replay.data?.duplicate, true, 'replaying a completed step creates no usage')
  const telemetryRef = `${source}:tts-telemetry`
  const telemetryAuthorization = await admin.rpc('usage_authorize', {
    p_user_id: users[0].id, p_offer_key: offerKey, p_reservation_ref: telemetryRef,
    p_max_units_micros: 1, p_usage_unit: 'minute', p_rate_micros: 10_000,
    p_speech_cost_per_second_micros: 0,
  })
  assert.equal(telemetryAuthorization.error, null, telemetryAuthorization.error?.message)
  assert.equal(telemetryAuthorization.data?.admitted, true)
  const telemetry = await admin.rpc('usage_settle', {
    p_reservation_ref: telemetryRef, p_kind: 'tts', p_cost_micros: 0,
    p_seconds_micros: 500_000, p_units_micros: 0,
  })
  assert.equal(telemetry.error, null, telemetry.error?.message)
  assert.equal(telemetry.data?.admitted, true, 'zero-cost TTS duration is recorded through an authorized reservation')
  const telemetryReplay = await admin.rpc('usage_settle', {
    p_reservation_ref: telemetryRef, p_kind: 'tts', p_cost_micros: 0,
    p_seconds_micros: 500_000, p_units_micros: 0,
  })
  assert.equal(telemetryReplay.error, null, telemetryReplay.error?.message)
  assert.equal(telemetryReplay.data?.duplicate, true, 'TTS settlement retries remain idempotent')
  const balanceAfterReplay = await admin.from('usage_balances').select('*')
    .eq('user_id', users[0].id).eq('offer_key', offerKey).is('period_start', null).single()
  assert.equal(balanceAfterReplay.error, null, balanceAfterReplay.error?.message)
  assert.equal(balanceAfterReplay.data.granted_micros, 5_000_000)
  assert.equal(balanceAfterReplay.data.used_micros, 2_000_000)
  assert.equal(balanceAfterReplay.data.remaining_micros, 3_000_000)

  let unauthorizedProviderCalls = 0
  const unpricedOperation = await admin.rpc('usage_authorize_inference', {
    p_user_id: users[1].id,
    p_offer_key: inferenceOfferKey,
    p_reservation_ref: `${source}:inference:unfunded`,
    p_max_units_micros: 1_000_000,
    p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    p_usage_unit: 'token',
    p_rate_micros: 1_000,
    p_speech_cost_per_second_micros: 0,
    p_meter: null,
    p_overage_price_micros: null,
    p_operation_id: 'agent.game',
    p_markup_micros: 1_500_000,
  })
  assert.equal(unpricedOperation.error, null, unpricedOperation.error?.message)
  if (unpricedOperation.data?.admitted) unauthorizedProviderCalls += 1
  assert.equal(unpricedOperation.data?.admitted, false, 'a reader without the operation offer cannot reserve paid inference')
  assert.equal(unauthorizedProviderCalls, 0, 'insufficient operation authorization prevents provider work')

  const inferenceRef = `${source}:inference:game`
  const inferenceAuthorization = await admin.rpc('usage_authorize_inference', {
    p_user_id: users[0].id,
    p_offer_key: inferenceOfferKey,
    p_reservation_ref: inferenceRef,
    p_max_units_micros: 1_000_000,
    p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    p_usage_unit: 'token',
    p_rate_micros: 1_000,
    p_speech_cost_per_second_micros: 0,
    p_meter: null,
    p_overage_price_micros: null,
    p_operation_id: readerOperationId,
    p_markup_micros: 1_500_000,
  })
  assert.equal(inferenceAuthorization.error, null, inferenceAuthorization.error?.message)
  assert.equal(inferenceAuthorization.data?.admitted, true, 'the paid operation is reserved before provider work')
  const inferenceAttempt = {
    p_invocation_ref: inferenceRef,
    p_attempt_no: 1,
    p_user_id: users[0].id,
    p_operation_id: readerOperationId,
    p_bot_id: 'game',
    p_offer_key: inferenceOfferKey,
    p_sponsor: 'reader',
    p_provider_id: 'primary',
    p_model: 'model-a',
    p_protocol: 'openai-chat',
    p_outcome: 'succeeded',
    p_measurement_status: 'measured',
    p_usage_dimensions: { input: 10, output: 5 },
    p_provider_cost_micros: 400,
    p_markup_micros: 1_500_000,
    p_customer_cost_micros: 600,
    p_customer_units_micros: 600_000,
    p_retail_value_micros: 600,
    p_retail_currency: 'usd',
    p_http_status: 200,
  }
  const recordedInferenceAttempt = await admin.rpc('usage_inference_attempt_record', inferenceAttempt)
  assert.equal(recordedInferenceAttempt.error, null, recordedInferenceAttempt.error?.message)
  assert.equal(recordedInferenceAttempt.data?.duplicate, false)
  const replayInferenceAttempt = await admin.rpc('usage_inference_attempt_record', inferenceAttempt)
  assert.equal(replayInferenceAttempt.error, null, replayInferenceAttempt.error?.message)
  assert.equal(replayInferenceAttempt.data?.duplicate, true, 'attempt evidence is idempotent')
  const conflictingInferenceAttempt = await admin.rpc('usage_inference_attempt_record', {
    ...inferenceAttempt, p_provider_cost_micros: 401,
  })
  assert.ok(conflictingInferenceAttempt.error, 'an attempt replay cannot change its cost evidence')
  const estimatedFallbackAttempt = await admin.rpc('usage_inference_attempt_record', {
    ...inferenceAttempt,
    p_attempt_no: 2,
    p_provider_id: 'backup',
    p_model: 'model-b',
    p_outcome: 'failed',
    p_measurement_status: 'estimated',
    p_usage_dimensions: {},
    p_provider_cost_micros: 200,
    p_customer_cost_micros: 300,
    p_customer_units_micros: 300_000,
    p_retail_value_micros: 300,
    p_http_status: 503,
  })
  assert.equal(estimatedFallbackAttempt.error, null, estimatedFallbackAttempt.error?.message)
  assert.equal(estimatedFallbackAttempt.data?.recorded, true,
    'a possibly processed fallback with missing usage is retained as estimated')
  const inferenceSettlement = await admin.rpc('usage_settle_inference', {
    p_reservation_ref: inferenceRef,
    p_operation_id: readerOperationId,
    p_kind: 'model',
    p_provider_cost_micros: 600,
    p_seconds_micros: 0,
    p_units_micros: 900_000,
    p_bot_id: 'game',
    p_markup_micros: 1_500_000,
    p_customer_cost_micros: 900,
    p_retail_value_micros: 900,
    p_retail_currency: 'usd',
    p_measurement_status: 'estimated',
  })
  assert.equal(inferenceSettlement.error, null, inferenceSettlement.error?.message)
  assert.equal(inferenceSettlement.data?.admitted, true)
  const inferenceSettlementReplay = await admin.rpc('usage_settle_inference', {
    p_reservation_ref: inferenceRef,
    p_operation_id: readerOperationId,
    p_kind: 'model',
    p_provider_cost_micros: 600,
    p_seconds_micros: 0,
    p_units_micros: 900_000,
    p_bot_id: 'game',
    p_markup_micros: 1_500_000,
    p_customer_cost_micros: 900,
    p_retail_value_micros: 900,
    p_retail_currency: 'usd',
    p_measurement_status: 'estimated',
  })
  assert.equal(inferenceSettlementReplay.error, null, inferenceSettlementReplay.error?.message)
  assert.equal(inferenceSettlementReplay.data?.duplicate, true, 'inference settlement retries do not charge twice')
  const siteAttemptRef = `${source}:inference:staff`
  const siteAttempt = await admin.rpc('usage_inference_attempt_record', {
    ...inferenceAttempt,
    p_invocation_ref: siteAttemptRef,
    p_user_id: null,
    p_operation_id: siteOperationId,
    p_offer_key: null,
    p_sponsor: 'site',
    p_markup_micros: null,
    p_customer_cost_micros: 0,
    p_customer_units_micros: 0,
    p_retail_value_micros: null,
    p_retail_currency: null,
    p_provider_cost_micros: 250,
  })
  assert.equal(siteAttempt.error, null, siteAttempt.error?.message)
  assert.equal(siteAttempt.data?.recorded, true, 'site-funded provider cost is recorded without a reader reservation')

  const finalUse = await record(users[0].id, `${source}:step-2`, 3_000_000, null)
  assert.equal(finalUse.error, null, finalUse.error?.message)
  const exhausted = await admin.rpc('usage_admit', { p_user_id: users[0].id, p_offer_key: offerKey })
  assert.equal(exhausted.data?.admitted, false, 'the last prepaid unit exhausts access')
  assert.equal(exhausted.data?.reason, 'usage_balance_exhausted')

  const topupConsent = new Date().toISOString()
  const preference = await admin.rpc('usage_topup_save', {
    p_user_id: users[0].id, p_enabled: true, p_offer_key: offerKey,
    p_threshold_micros: 25_000_000, p_monthly_cap_minor: 500,
    p_currency: 'usd', p_consent_at: topupConsent,
  })
  assert.equal(preference.error, null, preference.error?.message)
  assert.equal(preference.data, true, 'the server saves the reader-owned top-up preference')
  const topupInput = (attemptRef, siteEnabled, amountMinor = 500) => admin.rpc('usage_topup_begin', {
    p_user_id: users[0].id, p_attempt_ref: attemptRef, p_offer_key: offerKey,
    p_currency: 'usd', p_amount_minor: amountMinor, p_units_micros: 25_000_000,
    p_site_enabled: siteEnabled, p_usage_unit: 'minute', p_rate_micros: 10_000,
    p_speech_cost_per_second_micros: 200,
  })
  const siteDisabled = await topupInput(`${source}:topup-disabled`, false)
  assert.equal(siteDisabled.error, null, siteDisabled.error?.message)
  assert.equal(siteDisabled.data?.reason, 'topup_disabled', 'the database fails closed when the site switch is off')
  const topupRefs = [`${source}:topup-first`, `${source}:topup-race`]
  const concurrentTopups = await Promise.all([
    topupInput(topupRefs[0], true),
    topupInput(topupRefs[1], true),
  ])
  for (const result of concurrentTopups) assert.equal(result.error, null, result.error?.message)
  assert.equal(concurrentTopups.filter((result) => result.data?.started).length, 2,
    'racing low-balance requests join the same pending Stripe payment')
  const topupRef = concurrentTopups[0].data?.attempt?.attempt_ref
  assert.ok(topupRefs.includes(topupRef), 'the winning concurrent request owns the shared pending attempt')
  assert.equal(concurrentTopups[1].data?.attempt?.attempt_ref, topupRef)
  const attemptCount = await admin.from('usage_topup_attempts').select('id', { count: 'exact', head: true })
    .eq('user_id', users[0].id).eq('offer_key', offerKey)
  assert.equal(attemptCount.error, null, attemptCount.error?.message)
  assert.equal(attemptCount.count, 1, 'concurrent invocations create one monthly top-up attempt')
  const paymentRecorded = await admin.rpc('usage_topup_finish', {
    p_attempt_ref: topupRef, p_status: 'succeeded', p_payment_intent_id: `pi_${suffix}`,
    p_error: null,
  })
  assert.equal(paymentRecorded.error, null, paymentRecorded.error?.message)
  assert.equal(paymentRecorded.data, true, 'only a confirmed payment moves the attempt to succeeded')
  const topupGrant = await admin.rpc('usage_grant', {
    p_user_id: users[0].id, p_offer_key: offerKey, p_source: 'purchase',
    p_source_id: `topup:pi_${suffix}`, p_units_micros: 25_000_000,
    p_period_start: null, p_expires_at: null, p_usage_unit: 'minute',
    p_rate_micros: 10_000, p_speech_cost_per_second_micros: 200,
  })
  assert.equal(topupGrant.error, null, topupGrant.error?.message)
  assert.equal(topupGrant.data, true, 'the confirmed payment creates its usage grant')
  const grantReplay = await admin.rpc('usage_grant', {
    p_user_id: users[0].id, p_offer_key: offerKey, p_source: 'purchase',
    p_source_id: `topup:pi_${suffix}`, p_units_micros: 25_000_000,
    p_period_start: null, p_expires_at: null, p_usage_unit: 'minute',
    p_rate_micros: 10_000, p_speech_cost_per_second_micros: 200,
  })
  assert.equal(grantReplay.error, null, grantReplay.error?.message)
  assert.equal(grantReplay.data, false, 'a replayed PaymentIntent grants the pack only once')
  const attemptGranted = await admin.rpc('usage_topup_finish', {
    p_attempt_ref: topupRef, p_status: 'granted', p_payment_intent_id: `pi_${suffix}`,
    p_error: null,
  })
  assert.equal(attemptGranted.error, null, attemptGranted.error?.message)
  assert.equal(attemptGranted.data, true)
  const overCap = await topupInput(`${source}:topup-over-cap`, true, 1)
  assert.equal(overCap.error, null, overCap.error?.message)
  assert.equal(overCap.data?.reason, 'topup_monthly_cap', 'the reader’s own calendar-month cap blocks another charge')
  const preferenceDisabled = await admin.rpc('usage_topup_save', {
    p_user_id: users[0].id, p_enabled: false, p_offer_key: offerKey,
    p_threshold_micros: 25_000_000, p_monthly_cap_minor: 500,
    p_currency: 'usd', p_consent_at: null,
  })
  assert.equal(preferenceDisabled.error, null, preferenceDisabled.error?.message)
  const consentCleared = await admin.from('usage_topup_preferences')
    .select('enabled,off_session_consent_at').eq('user_id', users[0].id).single()
  assert.equal(consentCleared.error, null, consentCleared.error?.message)
  assert.equal(consentCleared.data.enabled, false)
  assert.equal(consentCleared.data.off_session_consent_at, null, 'opting out clears off-session consent')
  const missingConsent = await admin.rpc('usage_topup_save', {
    p_user_id: users[0].id, p_enabled: true, p_offer_key: offerKey,
    p_threshold_micros: 25_000_000, p_monthly_cap_minor: 500,
    p_currency: 'usd', p_consent_at: null,
  })
  assert.ok(missingConsent.error, 'automatic top-up cannot be re-enabled without fresh payment consent')

  const competing = await Promise.all([
    admin.rpc('usage_authorize', {
      p_user_id: users[1].id, p_offer_key: offerKey,
      p_reservation_ref: `${source}:race-a`, p_max_units_micros: 5_000_000,
    }),
    admin.rpc('usage_authorize', {
      p_user_id: users[1].id, p_offer_key: offerKey,
      p_reservation_ref: `${source}:race-b`, p_max_units_micros: 5_000_000,
    }),
  ])
  for (const result of competing) assert.equal(result.error, null, result.error?.message)
  assert.equal(competing.filter((result) => result.data?.admitted).length, 1,
    'concurrent reservations cannot spend the same prepaid units')
  const heldIndex = competing.findIndex((result) => result.data?.admitted)
  const held = competing[heldIndex]
  assert.equal(held?.data?.mode, 'prepaid')
  const heldRef = `${source}:race-${heldIndex === 0 ? 'a' : 'b'}`
  const heldBalance = await admin.from('usage_balances').select('remaining_micros,reserved_micros')
    .eq('user_id', users[1].id).eq('offer_key', offerKey).is('period_start', null).single()
  assert.equal(heldBalance.error, null, heldBalance.error?.message)
  assert.equal(heldBalance.data.remaining_micros, 3_000_000)
  assert.equal(heldBalance.data.reserved_micros, 5_000_000)
  const released = await admin.rpc('usage_release', { p_reservation_ref: heldRef })
  assert.equal(released.error, null, released.error?.message)
  assert.equal(released.data, true, 'unused authorization can be released')
  const replayRelease = await admin.rpc('usage_release', { p_reservation_ref: heldRef })
  assert.equal(replayRelease.data, false, 'releasing a closed reservation is idempotent')

  const meteredKey = `metered_${suffix.replaceAll('-', '').slice(0, 16)}`
  const meteredStart = new Date(Date.now() - 60_000).toISOString()
  const meteredEnd = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const customerSaved = await admin.from('profiles').update({ stripe_customer_id: `cus_usage_${suffix}` })
    .eq('id', users[1].id)
  assert.equal(customerSaved.error, null, customerSaved.error?.message)
  const activeSubscription = await admin.from('subscriptions').insert({
    id: `sub_usage_${suffix}`, user_id: users[1].id, status: 'active', key: meteredKey,
    current_period_start: meteredStart, current_period_end: meteredEnd,
    usage_meter: 'usage_db_probe', usage_unit: 'minute', usage_rate_micros: 10_000,
    usage_included_micros: 2_000_000, usage_overage_price_micros: 30_000,
    usage_speech_cost_per_second_micros: 200,
  })
  assert.equal(activeSubscription.error, null, activeSubscription.error?.message)
  const meterAllowance = await admin.rpc('usage_grant', {
    p_user_id: users[1].id, p_offer_key: meteredKey, p_source: 'subscription',
    p_source_id: `invoice:sub_usage_${suffix}`, p_units_micros: 2_000_000,
    p_period_start: meteredStart, p_expires_at: meteredEnd,
    p_usage_unit: 'minute', p_rate_micros: 10_000,
    p_meter: 'usage_db_probe', p_overage_price_micros: 30_000,
    p_speech_cost_per_second_micros: 200,
  })
  assert.equal(meterAllowance.error, null, meterAllowance.error?.message)
  const meteredRef = `${source}:metered`
  const meteredAuthorization = await admin.rpc('usage_authorize', {
    p_user_id: users[1].id, p_offer_key: meteredKey, p_reservation_ref: meteredRef,
    p_max_units_micros: 4_000_000,
  })
  assert.equal(meteredAuthorization.error, null, meteredAuthorization.error?.message)
  assert.equal(meteredAuthorization.data?.admitted, true, 'an active matching subscription authorizes metered work')
  assert.equal(meteredAuthorization.data?.mode, 'metered')
  const meteredSettlement = await admin.rpc('usage_settle', {
    p_reservation_ref: meteredRef, p_kind: 'model', p_cost_micros: 500,
    p_seconds_micros: 0, p_units_micros: 3_000_000, p_bot_id: null,
  })
  assert.equal(meteredSettlement.error, null, meteredSettlement.error?.message)
  assert.equal(meteredSettlement.data?.included_micros, 2_000_000)
  assert.equal(meteredSettlement.data?.metered_micros, 1_000_000)
  const report = await admin.from('usage_meter_reports').select('identifier,event_name,value_micros')
    .eq('usage_event_id', meteredSettlement.data.usage_event_id).single()
  assert.equal(report.error, null, report.error?.message)
  assert.equal(report.data.event_name, 'usage_db_probe')
  assert.equal(report.data.value_micros, 1_000_000)
  const meteredReplay = await admin.rpc('usage_settle', {
    p_reservation_ref: meteredRef, p_kind: 'model', p_cost_micros: 500,
    p_seconds_micros: 0, p_units_micros: 3_000_000, p_bot_id: null,
  })
  assert.equal(meteredReplay.error, null, meteredReplay.error?.message)
  assert.equal(meteredReplay.data?.duplicate, true, 'a metered settlement replay does not create a second report')
  const expiredKey = `expired_${suffix.replaceAll('-', '').slice(0, 16)}`
  const expireSubscription = await admin.from('subscriptions').update({
    key: expiredKey, current_period_start: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    current_period_end: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  }).eq('id', `sub_usage_${suffix}`)
  assert.equal(expireSubscription.error, null, expireSubscription.error?.message)
  const expiredAuthorization = await admin.rpc('usage_authorize', {
    p_user_id: users[1].id, p_offer_key: expiredKey,
    p_reservation_ref: `${source}:expired`, p_max_units_micros: 1_000_000,
  })
  assert.equal(expiredAuthorization.error, null, expiredAuthorization.error?.message)
  assert.equal(expiredAuthorization.data?.admitted, false, 'an expired matching subscription authorizes no new work')

  const storedEvents = await admin.from('usage_events').select('source_ref,bot_id,usage_unit,rate_micros')
    .eq('user_id', users[0].id).eq('offer_key', offerKey)
  assert.equal(storedEvents.error, null, storedEvents.error?.message)
  assert.equal(storedEvents.data.find((event) => event.source_ref === `${source}:step-2`)?.bot_id, null,
    'non-bot operations can record usage without bot provenance')
  assert.equal(storedEvents.data.find((event) => event.source_ref === `${source}:step-1`)?.usage_unit, 'minute',
    'usage rows retain the unit snapshot resolved by the server-side offer')
  assert.equal(storedEvents.data.find((event) => event.source_ref === `${source}:step-1`)?.rate_micros, 10_000)

  const readers = await Promise.all(users.map((user) => signedIn(user.id, user.email)))
  const hiddenInferenceAttempts = await readers[0].from('usage_inference_attempts').select('invocation_ref')
  assert.ok(hiddenInferenceAttempts.error, 'provider attempt evidence is inaccessible to reader clients')
  const storedInferenceAttempts = await admin.from('usage_inference_attempts')
    .select('invocation_ref, sponsor, provider_cost_micros, customer_units_micros')
    .in('invocation_ref', [inferenceRef, siteAttemptRef])
  assert.equal(storedInferenceAttempts.error, null, storedInferenceAttempts.error?.message)
  assert.equal(storedInferenceAttempts.data.length, 3,
    'site-funded, measured reader, and estimated fallback attempts are retained for administrators')
  assert.equal(storedInferenceAttempts.data.find((row) => row.invocation_ref === siteAttemptRef)?.sponsor, 'site')
  const ownEvents = await readers[0].from('usage_events').select('source_ref').eq('offer_key', offerKey)
  assert.equal(ownEvents.error, null, ownEvents.error?.message)
  assert.deepEqual(
    ownEvents.data.map((event) => event.source_ref).sort(),
    [`${source}:step-1`, `${source}:step-2`, telemetryRef].sort(),
  )
  const otherEvents = await readers[1].from('usage_events').select('source_ref').eq('offer_key', offerKey)
  assert.equal(otherEvents.error, null, otherEvents.error?.message)
  assert.deepEqual(otherEvents.data, [], 'another reader sees none of the first reader’s records')
  const ownGrants = await readers[1].from('usage_grants').select('source_id').eq('offer_key', offerKey)
  assert.equal(ownGrants.error, null, ownGrants.error?.message)
  assert.equal(ownGrants.data.length, 1, 'the second reader sees only their own grant')
  const ownReservations = await readers[0].from('usage_reservations').select('reservation_ref')
  assert.equal(ownReservations.error, null, ownReservations.error?.message)
  assert.ok(ownReservations.data.every((reservation) => reservation.reservation_ref.startsWith(source)),
    'a reader sees only their reservations')
  const hiddenTopups = await readers[1].from('usage_topup_attempts').select('attempt_ref')
  assert.equal(hiddenTopups.error, null, hiddenTopups.error?.message)
  assert.deepEqual(hiddenTopups.data, [], 'a reader sees no other reader’s top-up attempts')
  const hiddenPreference = await readers[1].from('usage_topup_preferences').select('user_id')
    .eq('user_id', users[0].id)
  assert.equal(hiddenPreference.error, null, hiddenPreference.error?.message)
  assert.deepEqual(hiddenPreference.data, [], 'another reader cannot read a top-up preference')

  const attemptedInsert = await readers[0].from('usage_events').insert({
    source_ref: `${source}:forged`, user_id: users[0].id, bot_id: 'usage-probe',
    offer_key: offerKey, kind: 'model', cost_micros: 0, seconds_micros: 0,
    units_micros: 0, included_micros: 0, metered_micros: 0,
  })
  assert.ok(attemptedInsert.error, 'an authenticated reader cannot forge usage')
  const attemptedUpdate = await readers[0].from('usage_grants').update({ units_micros: 99_000_000 })
    .eq('offer_key', offerKey)
  assert.ok(attemptedUpdate.error, 'an authenticated reader cannot change a grant')
  const attemptedReservation = await readers[0].from('usage_reservations').insert({
    reservation_ref: `${source}:forged`, user_id: users[0].id, offer_key: offerKey,
    reserved_micros: 1_000_000, mode: 'prepaid',
  })
  assert.ok(attemptedReservation.error, 'an authenticated reader cannot create reservations')
  const attemptedPreference = await readers[0].from('usage_topup_preferences').upsert({
    user_id: users[0].id, enabled: false,
  })
  assert.ok(attemptedPreference.error, 'reader preferences are changed only through the validated server API')

  const promoted = await admin.from('profiles').update({ roles: ['admin'] }).eq('id', users[1].id)
  assert.equal(promoted.error, null, promoted.error?.message)
  const usageReport = await readers[1].rpc('admin_usage', { p_days: 30 })
  assert.equal(usageReport.error, null, usageReport.error?.message)
  const reportRows = usageReport.data.inference.filter((row) =>
    row.operation_id === readerOperationId || row.operation_id === siteOperationId)
  const readerRows = reportRows.filter((row) => row.operation_id === readerOperationId)
  assert.equal(readerRows.length, 2, 'the report keeps distinct provider attempts as separate rows')
  const measuredRow = readerRows.find((row) => row.provider_id === 'primary')
  assert.deepEqual({
    attempts: measuredRow?.attempts,
    providerCost: measuredRow?.provider_cost_micros,
    markup: measuredRow?.markup_micros,
    customerCost: measuredRow?.customer_cost_micros,
    customerUnits: measuredRow?.customer_units_micros,
    retailValue: measuredRow?.retail_value_micros,
    estimatedAttempts: measuredRow?.estimated_attempts,
  }, {
    attempts: 1, providerCost: 400, markup: 1_500_000,
    customerCost: 600, customerUnits: 600_000, retailValue: 600, estimatedAttempts: 0,
  }, 'measured provider cost, markup, customer usage, and retail value remain distinct')
  const estimatedRow = readerRows.find((row) => row.provider_id === 'backup')
  assert.equal(estimatedRow?.estimated_attempts, 1, 'the report surfaces estimated attempt counts')
  assert.deepEqual({
    providerCost: estimatedRow?.provider_cost_micros,
    markup: estimatedRow?.markup_micros,
    customerCost: estimatedRow?.customer_cost_micros,
    customerUnits: estimatedRow?.customer_units_micros,
    retailValue: estimatedRow?.retail_value_micros,
  }, {
    providerCost: 200, markup: 1_500_000,
    customerCost: 300, customerUnits: 300_000, retailValue: 300,
  })
  const siteRow = reportRows.find((row) => row.operation_id === siteOperationId)
  assert.deepEqual({
    sponsor: siteRow?.sponsor,
    providerCost: siteRow?.provider_cost_micros,
    customerCost: siteRow?.customer_cost_micros,
    customerUnits: siteRow?.customer_units_micros,
    retailValue: siteRow?.retail_value_micros,
  }, {
    sponsor: 'site', providerCost: 250, customerCost: 0, customerUnits: 0, retailValue: 0,
  }, 'site-funded spend is reported without reader charges')

  const deletedReader = await admin.auth.admin.deleteUser(users[0].id)
  assert.equal(deletedReader.error, null, deletedReader.error?.message)
  users[0].deleted = true
  const retainedAttempts = await admin.from('usage_inference_attempts')
    .select('user_id, sponsor, provider_cost_micros, measurement_status')
    .eq('invocation_ref', inferenceRef)
  assert.equal(retainedAttempts.error, null, retainedAttempts.error?.message)
  assert.equal(retainedAttempts.data.length, 2, 'reader deletion retains measured and estimated attempt evidence')
  assert.ok(retainedAttempts.data.every((row) => row.user_id === null && row.sponsor === 'reader'),
    'reader deletion removes identity while preserving the accounting sponsor')

  note('passed — usage authorization, attempt/settlement replay, reader isolation, write denial, and measured/estimated admin reporting')
} finally {
  const cleanupErrors = []
  for (const user of users) {
    if (user.deleted) continue
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) cleanupErrors.push(`${user.email}: ${error.message}`)
  }
  if (cleanupErrors.length) throw new Error(`cleanup failed for temporary readers: ${cleanupErrors.join('; ')}`)
}
