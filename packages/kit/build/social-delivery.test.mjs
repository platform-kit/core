import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
const key = serviceKey()
if (!url || !anonKey || !key || !localStack()) {
  console.log('social-delivery: skipped — local Supabase credentials are unavailable')
  leave(0)
}

const health = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2_000) })
if (!health.ok) {
  console.log('social-delivery: skipped — the local Supabase stack is not up')
  process.exit(0)
}

const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const browser = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: users, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 100 })
if (usersError) throw new Error(`social delivery test could not list local users: ${usersError.message}`)
const adminUser = users.users.find((user) => user.email?.toLowerCase() === 'admin@example.com')
if (!adminUser) throw new Error('social delivery test requires the seeded admin@example.com account')
const { error: loginError } = await browser.auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'password123',
})
if (loginError) throw new Error(`social delivery test admin sign-in failed: ${loginError.message}`)

const testPosts = []
const testAccounts = []
const createdPost = async (body) => {
  const id = randomUUID()
  const { data, error } = await service.from('social_posts')
    .insert({ id, body, timezone: 'UTC', created_by: adminUser.id })
    .select('id, updated_at').single()
  if (error) throw new Error(`social delivery test post creation failed: ${error.message}`)
  testPosts.push(id)
  return data
}
const createdAccount = async () => {
  const id = randomUUID()
  const { error } = await service.from('social_accounts').insert({
    id,
    provider_id: 'unsupported-test',
    external_id: `test-${id}`,
    name: 'Delivery test account',
    username: `test-${id.slice(0, 8)}`,
    credential_secret_id: randomUUID(),
    connected_by: adminUser.id,
  })
  if (error) throw new Error(`social delivery test account creation failed: ${error.message}`)
  testAccounts.push(id)
  return id
}
const claimDue = async () => {
  const { data, error } = await service.rpc('social_claim_due', {
    p_limit: 1,
    p_lease_seconds: 30,
  })
  if (error) throw new Error(`social due claim failed: ${error.message}`)
  return data || []
}
const invokeSocial = async (body) => {
  const { data, error } = await browser.auth.getSession()
  if (error || !data.session) throw new Error('social delivery lifecycle requires an admin session')
  const response = await fetch(url + '/functions/v1/social', {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${data.session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let result = {}
  try { result = await response.json() } catch { /* retain status for non-JSON responses */ }
  return { status: response.status, ...result }
}
const invokeWorker = async () => {
  const response = await fetch(url + '/functions/v1/social-publish', {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'deliver_due' }),
  })
  return { status: response.status, ...(await response.json()) }
}

let failure
const cleanupErrors = []
try {
  const schedulePost = await createdPost('A scheduled post.')
  const scheduleAccounts = await Promise.all([createdAccount(), createdAccount(), createdAccount()])
  const initialScheduleAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const { data: initialDeliveries, error: initialScheduleError } = await service.rpc('social_schedule_post', {
    p_post_id: schedulePost.id,
    p_body: 'A scheduled post.',
    p_timezone: 'America/New_York',
    p_account_ids: scheduleAccounts,
    p_scheduled_at: initialScheduleAt,
    p_expected_updated_at: schedulePost.updated_at,
    p_actor_id: adminUser.id,
  })
  assert.equal(initialScheduleError, null, initialScheduleError?.message)
  assert.equal(initialDeliveries.length, 3, 'one schedule creates an independent target per account')
  assert.ok(initialDeliveries.every((delivery) => delivery.status === 'scheduled'))

  const { data: latestPost, error: latestPostError } = await service.from('social_posts')
    .select('updated_at').eq('id', schedulePost.id).single()
  assert.equal(latestPostError, null, latestPostError?.message)
  const rescheduleAt = new Date(Date.now() + 10 * 60_000).toISOString()
  const { data: rescheduled, error: rescheduleError } = await service.rpc('social_schedule_post', {
    p_post_id: schedulePost.id,
    p_body: 'A rescheduled post.',
    p_timezone: 'Europe/London',
    p_account_ids: scheduleAccounts.slice(0, 2),
    p_scheduled_at: rescheduleAt,
    p_expected_updated_at: latestPost.updated_at,
    p_actor_id: adminUser.id,
  })
  assert.equal(rescheduleError, null, rescheduleError?.message)
  assert.equal(rescheduled.length, 2, 'rescheduling keeps only selected account targets')
  const { data: rescheduledStates, error: statesError } = await service.from('social_deliveries')
    .select('account_id, scheduled_at, status').eq('post_id', schedulePost.id)
  assert.equal(statesError, null, statesError?.message)
  assert.equal(rescheduledStates.length, 3)
  assert.equal(rescheduledStates.find((item) => item.account_id === scheduleAccounts[2]).status, 'cancelled')
  assert.ok(rescheduledStates.filter((item) => item.status === 'scheduled')
    .every((item) => Date.parse(item.scheduled_at) === Date.parse(rescheduleAt)))

  const edited = await invokeSocial({
    action: 'save_draft',
    postId: schedulePost.id,
    text: 'Edited before delivery.',
    timezone: 'Europe/London',
  })
  assert.equal(edited.status, 200, JSON.stringify(edited))
  assert.equal(edited.post.body, 'Edited before delivery.')
  const cancelled = await invokeSocial({ action: 'cancel_schedule', postId: schedulePost.id })
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled))
  const { data: cancelledTargets, error: cancelledError } = await service.from('social_deliveries')
    .select('status').eq('post_id', schedulePost.id)
  assert.equal(cancelledError, null, cancelledError?.message)
  assert.ok(cancelledTargets.every((delivery) => delivery.status === 'cancelled'))

  const concurrentPost = await createdPost('Concurrency test.')
  const concurrentAccount = await createdAccount()
  const { data: concurrentDelivery, error: concurrentInsertError } = await service.from('social_deliveries')
    .insert({
      post_id: concurrentPost.id,
      account_id: concurrentAccount,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
    }).select('id').single()
  assert.equal(concurrentInsertError, null, concurrentInsertError?.message)

  const [firstClaims, secondClaims] = await Promise.all([claimDue(), claimDue()])
  const concurrentClaims = [...firstClaims, ...secondClaims]
    .filter((delivery) => delivery.id === concurrentDelivery.id)
  assert.equal(concurrentClaims.length, 1, 'concurrent workers cannot claim the same due target')
  const originalLease = concurrentClaims[0]
  const { error: expireClaimError } = await service.from('social_deliveries')
    .update({ lease_until: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', originalLease.id).eq('status', 'claimed')
  assert.equal(expireClaimError, null, expireClaimError?.message)
  const reclaimed = (await claimDue()).find((delivery) => delivery.id === originalLease.id)
  assert.ok(reclaimed, 'an expired pre-publish claim can be leased by another worker')
  assert.notEqual(reclaimed.lease_token, originalLease.lease_token)

  const { data: attemptNumber, error: startError } = await service.rpc('social_start_delivery', {
    p_delivery_id: reclaimed.id,
    p_lease_token: reclaimed.lease_token,
  })
  assert.equal(startError, null, startError?.message)
  assert.equal(attemptNumber, 1)
  const { error: expirePublishError } = await service.from('social_deliveries')
    .update({ lease_until: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', reclaimed.id).eq('status', 'publishing')
  assert.equal(expirePublishError, null, expirePublishError?.message)
  assert.deepEqual(await claimDue(), [], 'an expired publish lease is held for review, not blindly retried')
  const { data: expiredDelivery, error: expiredDeliveryError } = await service.from('social_deliveries')
    .select('status, lease_token, last_error_code').eq('id', reclaimed.id).single()
  assert.equal(expiredDeliveryError, null, expiredDeliveryError?.message)
  assert.equal(expiredDelivery.status, 'review_required')
  assert.equal(expiredDelivery.lease_token, null)
  assert.equal(expiredDelivery.last_error_code, 'delivery_lease_expired')
  const { data: expiredAttempt, error: expiredAttemptError } = await service.from('social_delivery_attempts')
    .select('status, error_code').eq('delivery_id', reclaimed.id).single()
  assert.equal(expiredAttemptError, null, expiredAttemptError?.message)
  assert.equal(expiredAttempt.status, 'unknown')
  assert.equal(expiredAttempt.error_code, 'delivery_lease_expired')

  const workerPost = await createdPost('Worker test.')
  const workerAccount = await createdAccount()
  const { data: workerDelivery, error: workerInsertError } = await service.from('social_deliveries')
    .insert({
      post_id: workerPost.id,
      account_id: workerAccount,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      status: 'scheduled',
    }).select('id').single()
  assert.equal(workerInsertError, null, workerInsertError?.message)
  const workerResult = await invokeWorker()
  assert.equal(workerResult.status, 200, JSON.stringify(workerResult))
  assert.equal(workerResult.claimed, 1)
  assert.equal(workerResult.processed, 1)
  const { data: workerState, error: workerStateError } = await service.from('social_deliveries')
    .select('status, last_error_code').eq('id', workerDelivery.id).single()
  assert.equal(workerStateError, null, workerStateError?.message)
  assert.equal(workerState.status, 'blocked')
  assert.equal(workerState.last_error_code, 'provider_unsupported')
  const repeatedWorker = await invokeWorker()
  assert.equal(repeatedWorker.claimed, 0, 'repeated worker invocations do not reclaim terminal targets')

  const approvalPost = await createdPost('Approval-gated immediate post.')
  const approvalAccount = await createdAccount()
  const { error: approvalSettingError } = await service.from('social_accounts')
    .update({ approval_required: true }).eq('id', approvalAccount)
  assert.equal(approvalSettingError, null, approvalSettingError?.message)
  const { data: approvalTargets, error: approvalScheduleError } = await service.rpc('social_schedule_post', {
    p_post_id: approvalPost.id,
    p_body: 'Approval-gated immediate post.',
    p_timezone: 'UTC',
    p_account_ids: [approvalAccount],
    p_scheduled_at: new Date().toISOString(),
    p_expected_updated_at: approvalPost.updated_at,
    p_actor_id: adminUser.id,
    p_publish_now: true,
  })
  assert.equal(approvalScheduleError, null, approvalScheduleError?.message)
  const approvalTarget = approvalTargets[0]
  assert.equal(approvalTarget.approval_state, 'pending', 'publish-now cannot bypass a required approval')
  assert.equal(approvalTarget.approval_intent, 'immediate')

  const { data: otherDueTargets, error: otherDueError } = await service.from('social_deliveries')
    .select('id')
    .in('status', ['scheduled', 'retry_wait', 'remote_scheduled'])
    .lte('scheduled_at', new Date().toISOString())
    .neq('id', approvalTarget.id)
  assert.equal(otherDueError, null, otherDueError?.message)
  const { data: expiredClaims, error: expiredClaimsError } = await service.from('social_deliveries')
    .select('id')
    .eq('status', 'claimed')
    .lt('lease_until', new Date().toISOString())
  assert.equal(expiredClaimsError, null, expiredClaimsError?.message)
  if (!otherDueTargets.length && !expiredClaims.length) {
    assert.equal(
      (await claimDue()).some((delivery) => delivery.id === approvalTarget.id),
      false,
      'the delivery worker does not claim a pending immediate target',
    )
  } else {
    console.log('social-delivery: worker approval claim assertion skipped — unrelated due work exists in the local stack')
  }

  console.log('social-delivery: schedule edits/cancellation, concurrent claims, lease recovery, worker invocation, and approval gating passed')
} catch (error) {
  failure = error
} finally {
  for (const postId of testPosts) {
    const { error } = await service.from('social_posts').delete().eq('id', postId)
    if (error) cleanupErrors.push(`delete test post ${postId}: ${error.message}`)
  }
  for (const accountId of testAccounts) {
    const { error } = await service.from('social_accounts').delete().eq('id', accountId)
    if (error) cleanupErrors.push(`delete test account ${accountId}: ${error.message}`)
  }
}

if (failure) throw failure
if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '))
