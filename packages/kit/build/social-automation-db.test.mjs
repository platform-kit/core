import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (message) => console.log('social-automation-db: ' + message)
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
const auth = client(anon)
const publisherClient = client(anon)
const expectNoError = (label, result) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}
const publisherEmail = `social-automation-${randomUUID()}@example.com`
const publisherPassword = randomUUID()
const publisherAccountId = randomUUID()
const hiddenAccountId = randomUUID()
const automationIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const eventIds = [randomUUID(), randomUUID()]
const responseIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const botSlug = `social-auto-${randomUUID().replaceAll('-', '')}`
let publisherId
let grantId

try {
  const admin = expectNoError('sign in administrator', await auth.auth.signInWithPassword({
    email: 'admin@example.com',
    password: 'password123',
  }))
  const created = expectNoError('create publisher fixture', await service.auth.admin.createUser({
    email: publisherEmail,
    password: publisherPassword,
    email_confirm: true,
  }))
  publisherId = created.user.id
  expectNoError('sign in publisher fixture', await publisherClient.auth.signInWithPassword({
    email: publisherEmail,
    password: publisherPassword,
  }))
  const ungranted = client(anon)
  expectNoError('sign in ungranted reader', await ungranted.auth.signInWithPassword({
    email: 'member@example.com',
    password: 'password123',
  }))
  expectNoError('create anonymous Social bot fixture', await service.from('bots').insert({
    slug: botSlug,
    name: 'Social automation test bot',
    prompt: 'Answer the triggering message briefly.',
    surfaces: ['social'],
    audience: [],
    serves: [],
    published: true,
  }))
  const grant = expectNoError('create active publisher grant', await service.from('social_publisher_grants').insert({
    email: publisherEmail,
    user_id: publisherId,
    status: 'active',
    invited_by: admin.user.id,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: new Date().toISOString(),
  }).select('id').single())
  grantId = grant.id

  for (const [id, name] of [
    [publisherAccountId, 'Social Automation Test Account'],
    [hiddenAccountId, 'Hidden Social Automation Test Account'],
  ]) {
    expectNoError('create Social account fixture', await service.from('social_accounts').insert({
      id,
      backend_id: 'default',
      provider_id: 'instagram',
      external_id: `automation-${id}`,
      name,
      username: `automation-${id.slice(0, 8)}`,
      connected_by: admin.user.id,
    }))
  }
  expectNoError('grant only results access for the first account', await service.from('social_publisher_account_permissions').insert({
    grant_id: grantId,
    account_id: publisherAccountId,
    view_results: true,
  }))

  for (let i = 0; i < 2; i++) {
    const accountId = i === 0 ? publisherAccountId : hiddenAccountId
    const automation = expectNoError('create automation record', await service.from('social_automations').insert({
      id: automationIds[i],
      account_id: accountId,
      event_kind: 'comment',
      keyword: 'guide',
      bot_slug: botSlug,
      destinations: ['public_reply'],
      mode: 'draft',
      authorized_by: publisherId,
    }).select('id').single())
    assert.equal(automation.id, automationIds[i])
    const event = expectNoError('persist normalized inbound event', await service.from('social_inbound_events').insert({
      id: eventIds[i],
      account_id: accountId,
      backend_id: 'default',
      provider_id: 'instagram',
      provider_event_id: `event-${eventIds[i]}`,
      event_kind: 'comment',
      provider_author_id: `author-${eventIds[i]}`,
      item_id: `comment-${eventIds[i]}`,
      post_id: `post-${eventIds[i]}`,
      comment_id: `comment-${eventIds[i]}`,
      body: 'Send me the guide',
      context: [],
    }).select('id').single())
    assert.equal(event.id, eventIds[i])
  }
  expectNoError('create a reviewable public reply', await service.from('social_automation_responses').insert({
    id: responseIds[0],
    account_id: publisherAccountId,
    automation_id: automationIds[0],
    event_id: eventIds[0],
    destination: 'public_reply',
    mode: 'draft',
    status: 'draft',
    body: 'Here is the guide.',
  }))

  const duplicateEvent = await service.from('social_inbound_events').insert({
    account_id: publisherAccountId,
    backend_id: 'default',
    provider_id: 'instagram',
    provider_event_id: `event-${eventIds[0]}`,
    event_kind: 'comment',
    provider_author_id: 'duplicate-author',
    item_id: `comment-${eventIds[0]}`,
    body: 'Send me the guide',
    context: [],
  })
  assert.equal(duplicateEvent.error?.code, '23505', 'a duplicate provider event cannot be inserted')

  const duplicateResponse = await service.from('social_automation_responses').insert({
    account_id: publisherAccountId,
    automation_id: automationIds[0],
    event_id: eventIds[0],
    destination: 'public_reply',
    mode: 'draft',
    status: 'draft',
    body: 'A second copy.',
  })
  assert.equal(duplicateResponse.error?.code, '23505', 'one response per event, rule and destination is enforced')

  const invalidDm = await service.from('social_automations').insert({
    account_id: publisherAccountId,
    event_kind: 'dm',
    keyword: 'guide',
    bot_slug: botSlug,
    destinations: ['public_reply'],
    mode: 'draft',
    authorized_by: publisherId,
  })
  assert.equal(invalidDm.error?.code, '23514', 'DM automations cannot configure a public response')

  const automationRows = expectNoError('publisher reads account automations', await publisherClient
    .from('social_automations').select('id, account_id').order('account_id'))
  assert.deepEqual(automationRows, [{ id: automationIds[0], account_id: publisherAccountId }])
  assert.deepEqual(
    expectNoError('publisher reads account events', await publisherClient.from('social_inbound_events').select('id')),
    [{ id: eventIds[0] }],
  )
  assert.deepEqual(
    expectNoError('publisher reads account responses', await publisherClient.from('social_automation_responses').select('id')),
    [{ id: responseIds[0] }],
  )
  assert.deepEqual(
    expectNoError('ungranted reader cannot read automation rules', await ungranted.from('social_automations').select('id')),
    [],
  )
  assert.deepEqual(
    expectNoError('ungranted reader cannot read provider events', await ungranted.from('social_inbound_events').select('id')),
    [],
  )
  assert.deepEqual(
    expectNoError('ungranted reader cannot read response history', await ungranted.from('social_automation_responses').select('id')),
    [],
  )
  const directRuleWrite = await publisherClient.from('social_automations')
    .update({ enabled: false }).eq('id', automationIds[0]).select('id')
  const unchangedRule = expectNoError('confirm direct rule write was blocked', await service.from('social_automations')
    .select('enabled').eq('id', automationIds[0]).single())
  assert.ok(directRuleWrite.error || !(directRuleWrite.data || []).length,
    'publishers cannot bypass server-side management authorization with direct table writes')
  assert.equal(unchangedRule.enabled, true, 'the unapproved direct write leaves the rule unchanged')

  expectNoError('grant publisher response permissions', await service
    .from('social_publisher_account_permissions')
    .update({ publish_now: true })
    .eq('grant_id', grantId)
    .eq('account_id', publisherAccountId))
  const sending = expectNoError('atomically begin one manual response send', await service.rpc(
    'social_begin_automation_send',
    { p_response_id: responseIds[0], p_actor_id: publisherId },
  ))
  assert.equal(sending.id, responseIds[0])
  assert.equal(sending.destination, 'public_reply')
  const uncertainSaved = expectNoError('record uncertain provider outcome', await service.rpc(
    'social_finish_automation_send',
    {
      p_response_id: responseIds[0],
      p_status: 'uncertain',
      p_error: 'provider_outcome_uncertain',
    },
  ))
  assert.equal(uncertainSaved, true)
  const noBlindRetry = expectNoError('refuse retry of an uncertain response', await service.rpc(
    'social_begin_automation_send',
    { p_response_id: responseIds[0], p_actor_id: publisherId },
  ))
  assert.equal(noBlindRetry.error, 'response_unavailable')
  const uncertain = expectNoError('read uncertain response outcome', await service
    .from('social_automation_responses').select('status, attempts').eq('id', responseIds[0]).single())
  assert.deepEqual(uncertain, { status: 'uncertain', attempts: 1 })

  expectNoError('configure an explicitly automatic rule', await service.from('social_automations')
    .update({ mode: 'automatic', destinations: ['public_reply', 'private_dm'] })
    .eq('id', automationIds[0]))
  expectNoError('create automatic private delivery fixture', await service.from('social_automation_responses')
    .insert({
      id: responseIds[1],
      account_id: publisherAccountId,
      automation_id: automationIds[0],
      event_id: eventIds[0],
      destination: 'private_dm',
      mode: 'automatic',
      status: 'draft',
      body: 'A private follow-up.',
    }))
  const automaticSend = expectNoError('atomically begin an authorized automatic delivery', await service.rpc(
    'social_begin_automation_send',
    { p_response_id: responseIds[1], p_actor_id: null },
  ))
  assert.equal(automaticSend.destination, 'private_dm')
  assert.equal(automaticSend.mode, 'automatic')
  const rejectedSaved = expectNoError('record definitive provider rejection', await service.rpc(
    'social_finish_automation_send',
    {
      p_response_id: responseIds[1],
      p_status: 'failed',
      p_error: 'provider_rejected_reply',
    },
  ))
  assert.equal(rejectedSaved, true)
  const failed = expectNoError('read failed provider outcome', await service
    .from('social_automation_responses').select('status, attempts').eq('id', responseIds[1]).single())
  assert.deepEqual(failed, { status: 'failed', attempts: 1 })

  expectNoError('create another authorized automatic rule', await service.from('social_automations')
    .insert({
      id: automationIds[2],
      account_id: publisherAccountId,
      event_kind: 'comment',
      keyword: 'again',
      bot_slug: botSlug,
      destinations: ['public_reply'],
      mode: 'automatic',
      enabled: true,
      authorized_by: publisherId,
    }))
  expectNoError('create another queued automatic response', await service.from('social_automation_responses')
    .insert({
      id: responseIds[2],
      account_id: publisherAccountId,
      automation_id: automationIds[2],
      event_id: eventIds[0],
      destination: 'public_reply',
      mode: 'automatic',
      status: 'draft',
      body: 'This must not be sent after revocation.',
    }))
  expectNoError('revoke the authorizing publisher before the queued send', await service
    .from('social_publisher_account_permissions')
    .update({ publish_now: false })
    .eq('grant_id', grantId)
    .eq('account_id', publisherAccountId))
  const revokedSend = expectNoError('recheck authorizing publisher before automatic send', await service.rpc(
    'social_begin_automation_send',
    { p_response_id: responseIds[2], p_actor_id: null },
  ))
  assert.equal(revokedSend.error, 'publisher_permission_revoked')
  const pausedAutomation = expectNoError('pause automation after publisher revocation', await service
    .from('social_automations').select('enabled').eq('id', automationIds[2]).single())
  const heldResponse = expectNoError('keep queued response unsent after publisher revocation', await service
    .from('social_automation_responses').select('status, attempts').eq('id', responseIds[2]).single())
  assert.equal(pausedAutomation.enabled, false)
  assert.deepEqual(heldResponse, { status: 'draft', attempts: 0 })

  expectNoError('create automatic rule for route revocation', await service.from('social_automations')
    .insert({
      id: automationIds[3],
      account_id: publisherAccountId,
      event_kind: 'comment',
      keyword: 'offline',
      bot_slug: botSlug,
      destinations: ['private_dm'],
      mode: 'automatic',
      enabled: true,
      authorized_by: publisherId,
    }))
  expectNoError('queue automatic response before account disconnect', await service.from('social_automation_responses')
    .insert({
      id: responseIds[3],
      account_id: publisherAccountId,
      automation_id: automationIds[3],
      event_id: eventIds[0],
      destination: 'private_dm',
      mode: 'automatic',
      status: 'draft',
      body: 'This must not be sent after disconnect.',
    }))
  expectNoError('disconnect account before automatic send', await service.from('social_accounts')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('id', publisherAccountId))
  const disconnectedSend = expectNoError('recheck connected account before automatic send', await service.rpc(
    'social_begin_automation_send',
    { p_response_id: responseIds[3], p_actor_id: null },
  ))
  assert.equal(disconnectedSend.error, 'account_unavailable')
  const disconnectedAutomation = expectNoError('pause automatic rule on disconnected account', await service
    .from('social_automations').select('enabled').eq('id', automationIds[3]).single())
  assert.equal(disconnectedAutomation.enabled, false)
  note('passed — private account reads, duplicate protection, publisher revocation, account disconnection, and terminal provider outcomes')
} finally {
  await service.from('social_automation_responses').delete().in('id', responseIds)
  await service.from('social_inbound_events').delete().in('id', eventIds)
  await service.from('social_automations').delete().in('id', automationIds)
  if (grantId) await service.from('social_publisher_account_permissions').delete().eq('grant_id', grantId)
  await service.from('social_accounts').delete().in('id', [publisherAccountId, hiddenAccountId])
  if (grantId) await service.from('social_publisher_grants').delete().eq('id', grantId)
  await service.from('bots').delete().eq('slug', botSlug)
  if (publisherId) await service.auth.admin.deleteUser(publisherId)
}
