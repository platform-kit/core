import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'

const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anonKey || !localStack()) {
  console.log('social-oauth: skipped — no local Supabase stack in .env')
  process.exit(0)
}

const client = (key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const service = client(serviceKey())
const { data: login, error: loginError } = await client(anonKey).auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'password123',
})
if (loginError) throw new Error(`social OAuth test admin sign-in failed: ${loginError.message}`)
const admin = client(anonKey)
const { error: sessionError } = await admin.auth.setSession({
  access_token: login.session.access_token,
  refresh_token: login.session.refresh_token,
})
if (sessionError) throw new Error(`social OAuth test session setup failed: ${sessionError.message}`)

const id = randomUUID()
const callbackUrl = new URL(url + '/functions/v1/social-oauth')
callbackUrl.searchParams.set('provider', 'fixture')
const invoke = async (sb, endpoint, body) => {
  const { data, error } = await sb.auth.getSession()
  if (error || !data.session) throw new Error('social OAuth function call requires a signed-in test user')
  const response = await fetch(`${url}/functions/v1/${endpoint}`, {
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
const callback = async (state, params = {}) => {
  const target = new URL(callbackUrl)
  target.searchParams.set('state', state)
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  const response = await fetch(target, { headers: { apikey: anonKey }, redirect: 'manual' })
  const responseBody = await response.text()
  assert.equal(response.status, 303, `OAuth callback returns only the fixed application redirect: ${responseBody.slice(0, 1000)}`)
  const destination = new URL(response.headers.get('location'))
  assert.equal(destination.pathname, '/admin/social')
  return destination.searchParams.get('social_code')
}
const start = async () => {
  const result = await invoke(admin, 'social-oauth', { action: 'start', providerId: 'fixture' })
  assert.equal(result.status, 200, JSON.stringify(result))
  const authorization = new URL(result.authorizationUrl)
  assert.equal(authorization.hostname, 'social-test.invalid')
  const state = authorization.searchParams.get('state')
  assert.ok(state && state.length >= 40)
  return state
}
const stateHash = (state) => createHash('sha256').update(state).digest('hex')

let fixtureClientSecretId
let failed
const cleanupErrors = []
const providerConfigBackups = new Map()
const testProviderSecretIds = []
const testProviderStateIds = []
const testProviderAccountIds = []
const blueskyDpopKey = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
).then(({ privateKey }) => crypto.subtle.exportKey('jwk', privateKey))
try {
  const supported = await invoke(admin, 'social', { action: 'providers' })
  assert.equal(supported.status, 200, JSON.stringify(supported))
  assert.deepEqual(
    supported.providers.map((provider) => provider.id).sort(),
    ['bluesky', 'instagram', 'linkedin', 'reddit', 'threads', 'tiktok', 'x', 'youtube'],
    'the served Supabase Edge Functions load each direct Social SDK adapter',
  )

  for (const provider of supported.providers.filter(({ id }) => id !== 'fixture')) {
    const { data: previous, error: previousError } = await service.from('social_provider_configs')
      .select('provider_id, client_id, client_secret_id, scopes, enabled, updated_by, updated_at')
      .eq('provider_id', provider.id).maybeSingle()
    if (previousError) throw new Error(`${provider.id} configuration lookup failed: ${previousError.message}`)
    providerConfigBackups.set(provider.id, previous)

    let clientSecretId = null
    if (provider.clientSecretRequired) {
      const { data, error } = await service.rpc('social_vault_put', {
        p_secret: `social-oauth-matrix-${id}-${provider.id}`,
        p_name: `social-oauth-matrix-${id}-${provider.id}`,
        p_description: 'Local OAuth provider matrix fixture',
      })
      if (error || typeof data !== 'string') throw new Error(`${provider.id} OAuth secret setup failed: ${error?.message}`)
      clientSecretId = data
      testProviderSecretIds.push(data)
    }
    const { error: saveError } = await service.from('social_provider_configs').upsert({
      provider_id: provider.id,
      client_id: provider.id === 'bluesky' ? '' : `matrix-${provider.id}-${id}`,
      client_secret_id: clientSecretId,
      scopes: provider.scopes,
      enabled: true,
      updated_by: login.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider_id' })
    if (saveError) throw new Error(`${provider.id} OAuth config setup failed: ${saveError.message}`)

    if (provider.id === 'bluesky') {
      const missingHint = await invoke(admin, 'social-oauth', { action: 'start', providerId: provider.id })
      assert.equal(missingHint.status, 400, 'Bluesky requires an account handle, DID, or server hint')
      const metadataUrl = new URL(`${url}/functions/v1/social-oauth`)
      metadataUrl.searchParams.set('provider', 'bluesky')
      metadataUrl.searchParams.set('metadata', 'bluesky')
      const response = await fetch(metadataUrl, { headers: { apikey: anonKey } })
      const metadata = await response.json()
      if (response.status === 200) {
        const clientMetadataUrl = new URL(metadata.client_id)
        assert.equal(clientMetadataUrl.pathname, '/functions/v1/social-oauth')
        assert.equal(clientMetadataUrl.searchParams.get('provider'), 'bluesky')
        assert.equal(clientMetadataUrl.searchParams.get('metadata'), 'bluesky')
        assert.equal(metadata.redirect_uris?.length, 1)
      } else {
        assert.equal(response.status, 409, JSON.stringify(metadata))
        assert.equal(metadata.code, 'metadata_requires_https', 'loopback OAuth uses its loopback client id, not web metadata')
      }
    } else {
      const startedAt = new Date().toISOString()
      const result = await invoke(admin, 'social-oauth', { action: 'start', providerId: provider.id })
      assert.equal(result.status, 200, `${provider.id} OAuth start: ${JSON.stringify(result)}`)
      const authorization = new URL(result.authorizationUrl)
      assert.ok(authorization.protocol === 'https:', `${provider.id} authorization URL must use HTTPS`)
      const state = authorization.searchParams.get('state')
      assert.ok(state && state.length >= 40, `${provider.id} authorization must carry the server-generated state`)
      const { data: stateRow, error: stateError } = await service.from('social_oauth_states')
        .select('id').eq('state_hash', stateHash(state)).eq('provider_id', provider.id).single()
      if (stateError) throw new Error(`${provider.id} OAuth state lookup failed: ${stateError.message}`)
      testProviderStateIds.push(stateRow.id)
      assert.ok(Date.parse(result.expiresAt) > Date.now(), `${provider.id} OAuth state must expire in the future`)
      assert.ok(Date.parse(result.expiresAt) <= Date.parse(startedAt) + 11 * 60_000, `${provider.id} OAuth state must be short-lived`)
    }

    const accountId = randomUUID()
    const { data: tokenSecretId, error: tokenError } = await service.rpc('social_vault_put', {
      p_secret: JSON.stringify({
        accessToken: `social-test-${provider.id}`,
        refreshToken: null,
        expiresAt: null,
        scopes: provider.scopes,
        ...(provider.id === 'bluesky'
          ? {
              providerData: {
                blueskySession: {
                  service: 'https://bsky.social',
                  did: 'did:plc:abcdefghijklmnopqrstuvwx',
                  handle: `fixture-${id.slice(0, 8)}.bsky.social`,
                  version: 1,
                  pdsUrl: 'https://bsky.social',
                  issuer: 'https://bsky.social',
                  clientId: 'https://social-test.invalid/client-metadata.json',
                  authMethod: 'none',
                  accessToken: 'social-test-bluesky',
                  refreshToken: 'social-test-bluesky-refresh',
                  scopes: provider.scopes,
                  dpopKey: blueskyDpopKey,
                },
              },
            }
          : {}),
      }),
      p_name: `social-adapter-matrix-${id}-${provider.id}`,
      p_description: 'Local Deno adapter capability fixture',
    })
    if (tokenError || typeof tokenSecretId !== 'string')
      throw new Error(`${provider.id} account token setup failed: ${tokenError?.message}`)
    testProviderSecretIds.push(tokenSecretId)
    testProviderAccountIds.push(accountId)
    const { error: accountError } = await service.from('social_accounts').insert({
      id: accountId,
      provider_id: provider.id,
      external_id: provider.id === 'linkedin' ? `urn:li:person:${id}` : `${provider.id}-${id}`,
      name: `${provider.name} runtime fixture`,
      username: `fixture-${id.slice(0, 8)}`,
      credential_secret_id: tokenSecretId,
      connected_by: login.user.id,
    })
    if (accountError) throw new Error(`${provider.id} account setup failed: ${accountError.message}`)

    const capabilities = await invoke(admin, 'social', {
      action: 'account_capabilities',
      accountId,
    })
    assert.equal(capabilities.status, 200, `${provider.id} Deno adapter initialization: ${JSON.stringify(capabilities)}`)
    assert.equal(capabilities.capabilities.schemaVersion, 1, `${provider.id} returns a versioned capability manifest`)
    assert.ok(Array.isArray(capabilities.capabilities.capabilities), `${provider.id} declares operation capabilities`)
    assert.ok(
      capabilities.capabilities.capabilities.some(({ operation }) => operation === 'posts.publish'),
      `${provider.id} declares its post-publication operation`,
    )
    for (const operation of capabilities.capabilities.capabilities) {
      assert.ok(
        !operation.formats || operation.formats.every((format) =>
          ['text', 'image', 'video', 'carousel', 'sequence', 'document'].includes(format)),
        `${provider.id} uses only known Social SDK content formats`,
      )
    }
    const offeredOperations = new Set(capabilities.operations.map(({ operation }) => operation))
    for (const [operation, input] of [
      ['posts.read', { queryMode: 'post', referenceId: ' ' }],
      ['media.upload', { attachmentId: 'not-a-uuid' }],
      ['search.posts', { query: '' }],
      ['analytics.read', { postId: '' }],
      ['analytics.report.read', { from: 'not-a-date', to: '2026-01-01', metrics: ['views'] }],
      ['profiles.read', {}],
      ['graph.read', { kind: 'unsupported' }],
      ['graph.follow', { profileId: '' }],
      ['comments.read', { postId: '' }],
      ['comments.write', { postId: '', commentId: '', text: '' }],
      ['messages.read', { conversationId: ' ' }],
      ['messages.write', { conversationId: '', text: '' }],
      ['posts.cancelScheduled', { jobId: '' }],
      ['posts.deleteBackendRecord', { recordId: '' }],
      ['posts.removeFromPlatform', { postId: '' }],
      ['webhooks.verify', { body: null }],
      ['webhooks.decode', { body: null }],
    ]) {
      const result = await invoke(admin, 'social', {
        action: 'account_operation',
        accountId,
        operation,
        input,
      })
      const available = offeredOperations.has(operation)
      assert.equal(
        result.status,
        available && operation === 'media.upload' ? 400 : 422,
        `${provider.id} ${operation} remains in the served Edge Runtime: ${JSON.stringify(result)}`,
      )
      assert.equal(
        result.code,
        available ? 'operation_input_invalid' : 'operation_unsupported',
        `${provider.id} ${operation} is validated only when its account advertises it`,
      )
    }
    const nativeResult = await invoke(admin, 'social', {
      action: 'account_operation',
      accountId,
      operation: 'native',
      nativeOperation: '__not_declared__',
      input: {},
    })
    assert.equal(nativeResult.status, 422, `${provider.id} rejects undeclared native operations`)
    assert.equal(nativeResult.code, 'operation_unsupported')
  }

  const { data: existing, error: existingError } = await service.from('social_provider_configs')
    .select('provider_id').eq('provider_id', 'fixture').maybeSingle()
  if (existingError) throw new Error(`fixture provider lookup failed: ${existingError.message}`)
  assert.equal(existing, null, 'the local-only fixture provider must not pre-exist')

  const { data: secretId, error: secretError } = await service.rpc('social_vault_put', {
    p_secret: `oauth-fixture-${id}`,
    p_name: `social-oauth-test-${id}`,
    p_description: 'Local OAuth test fixture',
  })
  if (secretError) throw new Error(`fixture provider secret setup failed: ${secretError.message}`)
  fixtureClientSecretId = secretId
  const { error: providerError } = await service.from('social_provider_configs').insert({
    provider_id: 'fixture',
    client_id: `fixture-${id}`,
    client_secret_id: fixtureClientSecretId,
    scopes: ['fixture.read', 'fixture.write'],
    enabled: true,
    updated_by: login.user.id,
  })
  if (providerError) throw new Error(`fixture provider setup failed: ${providerError.message}`)

  const firstState = await start()
  assert.equal(await callback(firstState, { provider: 'x', code: 'fixture-valid-code' }), 'state_mismatch')
  assert.equal(await callback(firstState, { code: 'fixture-valid-code' }), 'connected')
  assert.equal(await callback(firstState, { code: 'fixture-valid-code' }), 'state_replayed')

  const { data: accounts, error: accountsError } = await service.from('social_accounts')
    .select('id, backend_id, provider_id, external_id, name, username, status, credential_secret_id')
    .eq('provider_id', 'fixture').order('external_id')
  if (accountsError) throw new Error(`fixture account read failed: ${accountsError.message}`)
  assert.equal(accounts.length, 2, 'one provider authorization can discover multiple independent accounts')
  assert.deepEqual(accounts.map((account) => account.external_id), ['fixture-account-one', 'fixture-account-two'])
  assert.ok(accounts.every((account) => account.backend_id === 'default'), 'direct accounts use the default backend identity')

  const safeAccounts = await invoke(admin, 'social', { action: 'accounts' })
  assert.equal(safeAccounts.status, 200, JSON.stringify(safeAccounts))
  const publicAccounts = safeAccounts.accounts.filter((account) => account.provider_id === 'fixture')
  assert.equal(publicAccounts.length, 2)
  assert.ok(publicAccounts.every((account) => !('credential_secret_id' in account) && !('accessToken' in account)))

  const expiredState = await start()
  const { error: expireError } = await service.from('social_oauth_states')
    .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('state_hash', stateHash(expiredState))
  if (expireError) throw new Error(`expire fixture OAuth state failed: ${expireError.message}`)
  assert.equal(await callback(expiredState, { code: 'fixture-valid-code' }), 'state_expired')

  const deniedState = await start()
  assert.equal(await callback(deniedState, { error: 'access_denied' }), 'authorization_denied')

  const reconnectState = await start()
  assert.equal(await callback(reconnectState, { code: 'fixture-valid-code' }), 'connected')
  const { data: reconnected, error: reconnectError } = await service.from('social_accounts')
    .select('id, backend_id, external_id, status').eq('provider_id', 'fixture').order('external_id')
  if (reconnectError) throw new Error(`fixture reconnect read failed: ${reconnectError.message}`)
  assert.equal(reconnected.length, 2, 'reconnecting updates each external account instead of duplicating it')
  assert.ok(reconnected.every((account) => account.backend_id === 'default'))
  assert.deepEqual(reconnected.map((account) => account.id), accounts.map((account) => account.id))

  const disconnected = await invoke(admin, 'social', { action: 'disconnect', accountId: accounts[0].id })
  assert.equal(disconnected.status, 200, JSON.stringify(disconnected))
  const { data: disconnectedAccount, error: disconnectReadError } = await service.from('social_accounts')
    .select('status').eq('id', accounts[0].id).single()
  if (disconnectReadError) throw new Error(`disconnected account read failed: ${disconnectReadError.message}`)
  assert.equal(disconnectedAccount.status, 'disconnected')

  console.log('social-oauth: PKCE start, callback binding, expiry, replay, multi-account reconnect and disconnect passed')
} catch (error) {
  failed = error
} finally {
  if (testProviderAccountIds.length) {
    const { error } = await service.from('social_accounts').delete().in('id', testProviderAccountIds)
    if (error) cleanupErrors.push(`delete direct adapter accounts: ${error.message}`)
  }
  const { data: accounts, error: accountReadError } = await service.from('social_accounts')
    .select('id, credential_secret_id').eq('provider_id', 'fixture')
  if (accountReadError) cleanupErrors.push(`read fixture accounts: ${accountReadError.message}`)
  else {
    if (accounts?.length) {
      const { error } = await service.from('social_accounts').delete().in('id', accounts.map((account) => account.id))
      if (error) cleanupErrors.push(`delete fixture accounts: ${error.message}`)
    }
    for (const account of accounts || []) {
      if (!account.credential_secret_id) continue
      const { error } = await service.rpc('social_vault_delete', { p_secret_id: account.credential_secret_id })
      if (error) cleanupErrors.push(`delete account token: ${error.message}`)
    }
  }
  const { data: states, error: stateReadError } = await service.from('social_oauth_states')
    .select('id, code_verifier_secret_id').eq('provider_id', 'fixture')
  if (stateReadError) cleanupErrors.push(`read fixture states: ${stateReadError.message}`)
  else {
    for (const state of states || []) {
      const { error } = await service.rpc('social_vault_delete', { p_secret_id: state.code_verifier_secret_id })
      if (error) cleanupErrors.push(`delete state verifier: ${error.message}`)
    }
    if (states?.length) {
      const { error } = await service.from('social_oauth_states').delete().in('id', states.map((state) => state.id))
      if (error) cleanupErrors.push(`delete fixture states: ${error.message}`)
    }
  }
  const { error: providerDeleteError } = await service.from('social_provider_configs').delete().eq('provider_id', 'fixture')
  if (providerDeleteError) cleanupErrors.push(`delete fixture provider: ${providerDeleteError.message}`)
  if (fixtureClientSecretId) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: fixtureClientSecretId })
    if (error) cleanupErrors.push(`delete fixture client secret: ${error.message}`)
  }

  if (testProviderStateIds.length) {
    const { data: states, error } = await service.from('social_oauth_states')
      .select('id, code_verifier_secret_id').in('id', testProviderStateIds)
    if (error) cleanupErrors.push(`read direct provider OAuth states: ${error.message}`)
    else {
      for (const state of states || []) {
        const { error: secretError } = await service.rpc('social_vault_delete', { p_secret_id: state.code_verifier_secret_id })
        if (secretError) cleanupErrors.push(`delete direct provider verifier: ${secretError.message}`)
      }
      const { error: deleteError } = await service.from('social_oauth_states').delete().in('id', testProviderStateIds)
      if (deleteError) cleanupErrors.push(`delete direct provider OAuth states: ${deleteError.message}`)
    }
  }
  for (const [providerId, previous] of providerConfigBackups) {
    const result = previous
      ? await service.from('social_provider_configs').upsert(previous, { onConflict: 'provider_id' })
      : await service.from('social_provider_configs').delete().eq('provider_id', providerId)
    if (result.error) cleanupErrors.push(`restore ${providerId} provider config: ${result.error.message}`)
  }
  for (const secretId of testProviderSecretIds) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: secretId })
    if (error) cleanupErrors.push(`delete direct provider test secret: ${error.message}`)
  }
}

if (failed) throw failed
if (cleanupErrors.length) throw new Error(cleanupErrors.join('; '))
