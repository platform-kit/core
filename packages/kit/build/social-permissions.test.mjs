import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (message) => console.log('social-permissions: ' + message)
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) {
  note('skipped — no local Supabase stack in .env')
  leave(0)
}
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* local stack is unavailable */ }
if (!up) {
  note('skipped — the local Supabase stack is not up')
  process.exit(0)
}

const client = (key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const service = client(serviceKey())
const admin = client(anon)
const email = `social-permissions-${randomUUID()}@example.com`
const password = randomUUID()
const accountId = randomUUID()
const otherAccountId = randomUUID()
let userId
let deniedActorId
let grantId
const postIds = []
const deliveryIds = []

const expectNoError = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

try {
  const created = expectNoError('create publisher fixture', await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  }))
  userId = created.user.id
  const deniedActor = expectNoError('create ungranted reviewer fixture', await service.auth.admin.createUser({
    email: `social-denied-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  }))
  deniedActorId = deniedActor.user.id
  const publisher = client(anon)
  const signedIn = expectNoError('sign in publisher fixture', await publisher.auth.signInWithPassword({ email, password }))
  assert.equal(signedIn.user.id, userId)

  const adminUser = expectNoError('sign in administrator', await admin.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'password123',
  }))
  const grant = expectNoError('create active publisher grant without permissions', await service.from('social_publisher_grants').insert({
    email,
    user_id: userId,
    status: 'active',
    invited_by: adminUser.user.id,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: new Date().toISOString(),
  }).select('id, can_manage_accounts').single())
  grantId = grant.id
  assert.equal(grant.can_manage_accounts, false)

  for (const [id, name] of [
    [accountId, 'Permission Test Account'],
    [otherAccountId, 'Other Permission Test Account'],
  ]) {
    expectNoError('create permission test account', await service.from('social_accounts').insert({
      id,
      provider_id: 'fixture',
      external_id: `account-${id}`,
      name,
      username: `permission-test-${id.slice(0, 8)}`,
      connected_by: adminUser.user.id,
    }))
  }

  assert.equal(expectNoError('read empty permissions', await service.from('social_publisher_account_permissions').select('*').eq('grant_id', grantId)).length, 0)
  assert.equal(expectNoError('check publisher account access', await publisher.rpc('social_can', {
    p_account_id: accountId,
    p_permission: 'read_posts',
  })), false)
  assert.equal(expectNoError('check publisher management access', await publisher.rpc('social_can_manage_accounts')), false)
  assert.equal(expectNoError('check publisher aggregate access', await publisher.rpc('social_has_access')), false)
  assert.equal(expectNoError('check service authorization', await service.rpc('social_user_can', {
    p_user_id: userId,
    p_account_id: accountId,
    p_permission: 'read_posts',
  })), false)

  const deniedAccountRead = await publisher.from('social_accounts').select('id').eq('id', accountId)
  assert.deepEqual(expectNoError('read accounts as ungranted publisher', deniedAccountRead), [])

  expectNoError('assign one account read permission', await service.from('social_publisher_account_permissions').insert({
    grant_id: grantId,
    account_id: accountId,
    read_posts: true,
  }))
  assert.equal(expectNoError('check granted account read access', await publisher.rpc('social_can', {
    p_account_id: accountId,
    p_permission: 'read_posts',
  })), true)
  assert.equal(expectNoError('check other account read access', await publisher.rpc('social_can', {
    p_account_id: otherAccountId,
    p_permission: 'read_posts',
  })), false)
  assert.equal(expectNoError('check ungranted account create access', await publisher.rpc('social_can', {
    p_account_id: accountId,
    p_permission: 'create_posts',
  })), false)
  assert.equal(expectNoError('check account permission does not grant management', await publisher.rpc('social_can_manage_accounts')), false)
  assert.equal(expectNoError('check explicit grant provides Social access', await publisher.rpc('social_has_access')), true)
  assert.deepEqual(
    expectNoError('list only the granted account', await publisher.from('social_accounts').select('id')),
    [{ id: accountId }],
  )

  expectNoError('configure approval requirement', await service.rpc('social_set_account_approval', {
    p_account_id: accountId,
    p_actor_id: adminUser.user.id,
    p_required: true,
  }))
  const unauthorizedSetting = await service.rpc('social_set_account_approval', {
    p_account_id: accountId,
    p_actor_id: deniedActorId,
    p_required: false,
  })
  assert.ok(unauthorizedSetting.error, 'account-level approval settings require Manage accounts')
  expectNoError('grant scheduling and approval actions', await service.from('social_publisher_account_permissions')
    .update({ schedule_posts: true, edit_posts: true, approve_posts: true })
    .eq('grant_id', grantId).eq('account_id', accountId))
  const postId = randomUUID()
  postIds.push(postId)
  const post = expectNoError('create approval test post', await service.from('social_posts').insert({
    id: postId,
    body: 'Approval-gated post',
    timezone: 'UTC',
    created_by: userId,
  }).select('id, updated_at').single())
  const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const scheduled = expectNoError('schedule approval test post', await service.rpc('social_schedule_post', {
    p_post_id: postId,
    p_body: 'Approval-gated post',
    p_timezone: 'UTC',
    p_account_ids: [accountId],
    p_scheduled_at: scheduledAt,
    p_expected_updated_at: post.updated_at,
    p_actor_id: userId,
  }))
  const pendingDelivery = scheduled[0]
  deliveryIds.push(pendingDelivery.id)
  assert.equal(pendingDelivery.approval_state, 'pending')
  assert.equal(pendingDelivery.approval_intent, 'scheduled')
  const approvalQueue = expectNoError('list granted publisher approval queue', await service.rpc('social_user_approval_queue', {
    p_user_id: userId,
  }))
  assert.ok(approvalQueue.some((delivery) => delivery.id === pendingDelivery.id))

  const unauthorizedReview = await service.rpc('social_review_delivery', {
    p_delivery_id: pendingDelivery.id,
    p_actor_id: deniedActorId,
    p_decision: 'approve',
  })
  assert.ok(unauthorizedReview.error, 'an actor without the account approval grant cannot approve a target')

  const approved = expectNoError('approve target with account grant', await service.rpc('social_review_delivery', {
    p_delivery_id: pendingDelivery.id,
    p_actor_id: userId,
    p_decision: 'approve',
  }))
  assert.equal(approved.approval_state, 'approved')
  assert.equal(approved.approved_by, userId)
  assert.equal(approved.status, 'scheduled')

  const editedPost = expectNoError('edit approved post', await service.rpc('social_save_draft', {
    p_post_id: postId,
    p_body: 'Edited after approval',
    p_timezone: 'UTC',
    p_actor_id: userId,
  }))
  assert.equal(editedPost.body, 'Edited after approval')
  const invalidatedApproval = expectNoError('read approval after content edit', await service.from('social_deliveries')
    .select('approval_state, approved_by, approved_at').eq('id', pendingDelivery.id).single())
  assert.equal(invalidatedApproval.approval_state, 'pending')
  assert.equal(invalidatedApproval.approved_by, null)
  assert.equal(invalidatedApproval.approved_at, null)

  const returned = expectNoError('return target to draft', await service.rpc('social_review_delivery', {
    p_delivery_id: pendingDelivery.id,
    p_actor_id: userId,
    p_decision: 'return',
  }))
  assert.equal(returned.approval_state, 'returned')
  assert.equal(returned.status, 'draft')
  assert.equal(returned.returned_by, userId)

  const latestPost = expectNoError('read updated approval test post', await service.from('social_posts')
    .select('updated_at').eq('id', postId).single())
  const resubmitted = expectNoError('resubmit approved target for review', await service.rpc('social_schedule_post', {
    p_post_id: postId,
    p_body: editedPost.body,
    p_timezone: 'UTC',
    p_account_ids: [accountId],
    p_scheduled_at: scheduledAt,
    p_expected_updated_at: latestPost.updated_at,
    p_actor_id: userId,
  }))
  deliveryIds.push(resubmitted[0].id)
  const released = expectNoError('disable approval for future target', await service.rpc('social_set_account_approval', {
    p_account_id: accountId,
    p_actor_id: adminUser.user.id,
    p_required: false,
  }))
  assert.equal(released.approval_required, false)
  const releasedDelivery = expectNoError('read released future target', await service.from('social_deliveries')
    .select('status, approval_state').eq('id', resubmitted[0].id).single())
  assert.equal(releasedDelivery.status, 'scheduled')
  assert.equal(releasedDelivery.approval_state, 'not_required')
  expectNoError('re-enable approval requirement', await service.rpc('social_set_account_approval', {
    p_account_id: accountId,
    p_actor_id: adminUser.user.id,
    p_required: true,
  }))

  expectNoError('expire pending target schedule', await service.from('social_deliveries')
    .update({ scheduled_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', resubmitted[0].id))
  const overdueApproval = expectNoError('review overdue target', await service.rpc('social_review_delivery', {
    p_delivery_id: resubmitted[0].id,
    p_actor_id: userId,
    p_decision: 'approve',
  }))
  assert.equal(overdueApproval.status, 'blocked')
  assert.equal(overdueApproval.approval_state, 'reschedule_required')

  expectNoError('revoke the active publisher grant', await service.from('social_publisher_grants')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', grantId))
  assert.equal(expectNoError('check revoked account permission', await publisher.rpc('social_can', {
    p_account_id: accountId,
    p_permission: 'read_posts',
  })), false)
  assert.equal(expectNoError('check revoked aggregate access', await publisher.rpc('social_has_access')), false)
  assert.deepEqual(
    expectNoError('read accounts after revocation', await publisher.from('social_accounts').select('id')),
    [],
  )
  note('invitation eligibility, explicit account grants, account isolation, approval transitions, and immediate revocation passed')
} finally {
  for (const deliveryId of deliveryIds) {
    const { error } = await service.from('social_deliveries').delete().eq('id', deliveryId)
    if (error) throw new Error(`remove approval delivery fixture: ${error.message}`)
  }
  for (const postId of postIds) {
    const { error } = await service.from('social_posts').delete().eq('id', postId)
    if (error) throw new Error(`remove approval post fixture: ${error.message}`)
  }
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId)
    if (error) throw new Error(`remove publisher fixture: ${error.message}`)
  }
  if (deniedActorId) {
    const { error } = await service.auth.admin.deleteUser(deniedActorId)
    if (error) throw new Error(`remove ungranted reviewer fixture: ${error.message}`)
  }
  const { error: accountError } = await service.from('social_accounts').delete().eq('id', accountId)
  if (accountError) throw new Error(`remove account fixture: ${accountError.message}`)
  const { error: otherAccountError } = await service.from('social_accounts').delete().eq('id', otherAccountId)
  if (otherAccountError) throw new Error(`remove other account fixture: ${otherAccountError.message}`)
  if (grantId) {
    const { error: grantError } = await service.from('social_publisher_grants').delete().eq('id', grantId)
    if (grantError) throw new Error(`remove publisher grant fixture: ${grantError.message}`)
  }
}
