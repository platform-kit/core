import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { normalizeSocialAutomationEvents } from '../supabase/functions/_shared/social/automation-events.mjs'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const threadBody = (accountId, commentId, text = 'Please send the guide') => Buffer.from(JSON.stringify({
  values: {
    field: 'replies',
    value: {
      id: commentId,
      text,
      from: { id: 'external-author' },
      root_post: { id: 'post-1', owner_id: accountId },
    },
  },
}))

const sampleBody = threadBody('thread-account', 'comment-1')
const normalized = normalizeSocialAutomationEvents({
  backend: 'default',
  provider: 'threads',
  decoded: {
    id: 'verified-event',
    type: 'comment.received',
    accountIds: ['thread-account'],
  },
  body: sampleBody,
})
assert.deepEqual(normalized, [{
  externalAccountId: 'thread-account',
  providerEventId: 'verified-event',
  providerId: 'threads',
  eventKind: 'comment',
  itemId: 'comment-1',
  authorId: 'external-author',
  body: 'Please send the guide',
  postId: 'post-1',
  commentId: 'comment-1',
}])
assert.deepEqual(normalizeSocialAutomationEvents({
  backend: 'default',
  provider: 'threads',
  decoded: { id: 'unrecognized-event', type: 'unknown', accountIds: ['thread-account'] },
  body: Buffer.from('{"values":{"field":"likes"}}'),
}), [], 'unrecognized provider events do not become actionable')
assert.deepEqual(normalizeSocialAutomationEvents({
  backend: 'zernio',
  provider: 'zernio',
  decoded: { id: 'unrecognized-managed', type: 'account.updated', accountIds: ['managed-account'] },
  body: Buffer.from('{"event":"account.updated"}'),
}), [], 'managed non-conversation events do not become actionable')

const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) {
  console.log('social-webhooks: integration skipped — no local Supabase stack credentials')
  leave(0)
}

const health = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2_000) })
if (!health.ok) {
  console.log('social-webhooks: integration skipped — the local Supabase stack is not up')
  leave(0)
}
const functionHealth = await fetch(url + '/functions/v1/social-webhook', {
  method: 'OPTIONS',
  signal: AbortSignal.timeout(2_000),
})
if (functionHealth.status >= 500) {
  console.log('social-webhooks: integration skipped — social-webhook is not served')
  process.exit(0)
}

const client = (key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const service = client(serviceKey())
const anonymous = client(anonKey)
const { data: login, error: loginError } = await anonymous.auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'password123',
})
if (loginError || !login.user)
  throw new Error(`social-webhooks: could not sign in to the local admin account: ${loginError?.message}`)

const fixtureId = randomUUID()
const providerSecret = `social-webhook-secret-${fixtureId}`
const accountCredential = JSON.stringify({
  accessToken: `social-webhook-token-${fixtureId}`,
  scopes: ['threads_basic', 'threads_read_replies', 'threads_manage_replies'],
})
const secretIds = []
const accountId = randomUUID()
const externalAccountId = `threads-${fixtureId}`
const clientId = `threads-client-${fixtureId}`
let previousConfig
let configSaved = false

async function vaultPut(secret, name) {
  const { data, error } = await service.rpc('social_vault_put', {
    p_secret: secret,
    p_name: name,
    p_description: 'Social webhook integration test fixture',
  })
  if (error || typeof data !== 'string')
    throw new Error(`social-webhooks: could not create Vault fixture: ${error?.message}`)
  secretIds.push(data)
  return data
}

async function sendWebhook(body, secret = providerSecret) {
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  const response = await fetch(`${url}/functions/v1/social-webhook?provider=threads`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  })
  let result = {}
  try { result = await response.json() } catch { /* retain the status for assertions */ }
  return { status: response.status, ...result }
}

try {
  const { data: prior, error: priorError } = await service
    .from('social_provider_configs')
    .select('provider_id, client_id, client_secret_id, scopes, enabled, updated_by, updated_at')
    .eq('provider_id', 'threads')
    .maybeSingle()
  if (priorError) throw new Error(`social-webhooks: could not read previous Threads configuration: ${priorError.message}`)
  previousConfig = prior

  const clientSecretId = await vaultPut(providerSecret, `social-webhooks-client-${fixtureId}`)
  const credentialSecretId = await vaultPut(accountCredential, `social-webhooks-account-${fixtureId}`)
  const { error: configError } = await service.from('social_provider_configs').upsert({
    provider_id: 'threads',
    client_id: clientId,
    client_secret_id: clientSecretId,
    scopes: ['threads_basic', 'threads_read_replies', 'threads_manage_replies'],
    enabled: true,
    updated_by: login.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider_id' })
  if (configError) throw new Error(`social-webhooks: could not configure Threads: ${configError.message}`)
  configSaved = true

  const { error: accountError } = await service.from('social_accounts').insert({
    id: accountId,
    backend_id: 'default',
    provider_id: 'threads',
    external_id: externalAccountId,
    name: 'Webhook fixture',
    username: `webhook-${fixtureId}`,
    credential_secret_id: credentialSecretId,
    status: 'connected',
    connected_by: login.user.id,
  })
  if (accountError) throw new Error(`social-webhooks: could not create connected account fixture: ${accountError.message}`)

  const challengeUrl = new URL(`${url}/functions/v1/social-webhook`)
  challengeUrl.searchParams.set('provider', 'threads')
  challengeUrl.searchParams.set('hub.mode', 'subscribe')
  challengeUrl.searchParams.set('hub.verify_token', clientId)
  challengeUrl.searchParams.set('hub.challenge', 'fixture-challenge')
  const challenge = await fetch(challengeUrl, { signal: AbortSignal.timeout(5_000) })
  assert.equal(challenge.status, 200, 'Meta webhook ownership challenges use the configured provider route')
  assert.equal(await challenge.text(), 'fixture-challenge')

  const body = threadBody(externalAccountId, `comment-${fixtureId}`)
  const received = await sendWebhook(body)
  assert.equal(received.status, 200, JSON.stringify(received))
  assert.equal(received.accepted, 1, 'valid signed events persist before acknowledgement')

  const duplicate = await sendWebhook(body)
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate))
  assert.equal(duplicate.accepted, 0, 'provider retries do not create a second actionable row')

  const invalidBody = threadBody(externalAccountId, `invalid-${fixtureId}`)
  const invalid = await sendWebhook(invalidBody, 'wrong-secret')
  assert.equal(invalid.status, 401, 'invalid provider signatures are refused')

  const unknown = await sendWebhook(threadBody(`unknown-${fixtureId}`, `unknown-comment-${fixtureId}`))
  assert.equal(unknown.status, 404, 'a verified event cannot attach to an unknown provider account')

  const { data: events, error: eventError } = await service
    .from('social_inbound_events')
    .select('account_id, provider_event_id, event_kind, provider_author_id, item_id, post_id, comment_id, conversation_id, body, context')
    .eq('account_id', accountId)
  if (eventError) throw new Error(`social-webhooks: could not inspect persisted events: ${eventError.message}`)
  assert.equal(events.length, 1)
  assert.equal(events[0].event_kind, 'comment')
  assert.equal(events[0].provider_author_id, 'external-author')
  assert.equal(events[0].post_id, 'post-1')
  assert.equal(events[0].body, 'Please send the guide')
  assert.deepEqual(events[0].context, [])
} finally {
  const cleanup = []
  if (accountId) {
    const { error } = await service.from('social_inbound_events').delete().eq('account_id', accountId)
    if (error) cleanup.push(`event cleanup: ${error.message}`)
    const { error: accountError } = await service.from('social_accounts').delete().eq('id', accountId)
    if (accountError) cleanup.push(`account cleanup: ${accountError.message}`)
  }
  if (configSaved) {
    const result = previousConfig
      ? await service.from('social_provider_configs').upsert(previousConfig, { onConflict: 'provider_id' })
      : await service.from('social_provider_configs').delete().eq('provider_id', 'threads')
    if (result.error) cleanup.push(`provider configuration restore: ${result.error.message}`)
  }
  for (const id of secretIds) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: id })
    if (error) cleanup.push(`Vault cleanup: ${error.message}`)
  }
  if (cleanup.length) throw new Error(`social-webhooks cleanup failed: ${cleanup.join('; ')}`)
}

console.log('social-webhooks: verified signatures, challenge handling, account mapping, persistence and deduplication passed')
