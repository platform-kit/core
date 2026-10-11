import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { resolveSocialOutcome } from '../supabase/functions/_shared/social/outcome.mjs'
import { localStack, serviceKey, supabaseUrl } from './tts/storage.mjs'

const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
const key = serviceKey()
if (!url || !anonKey || !key || !localStack()) {
  console.log('social-managed: skipped — local Supabase credentials are unavailable')
  process.exit(0)
}

const health = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2_000) })
if (!health.ok) {
  console.log('social-managed: skipped — the local Supabase stack is not up')
  process.exit(0)
}

const client = (apiKey) =>
  createClient(url, apiKey, { auth: { persistSession: false, autoRefreshToken: false } })
const service = client(key)
const admin = client(anonKey)
const { data: login, error: loginError } = await admin.auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'password123',
})
if (loginError) throw new Error(`social managed test admin sign-in failed: ${loginError.message}`)
const { error: sessionError } = await admin.auth.setSession({
  access_token: login.session.access_token,
  refresh_token: login.session.refresh_token,
})
if (sessionError) throw new Error(`social managed test session setup failed: ${sessionError.message}`)

const testId = randomUUID()
const accountIds = []
const secretIds = []
const insertedBackendIds = []
const enabledBackendIds = []
let postId
let failure
const cleanupErrors = []

async function invoke(body) {
  const response = await fetch(`${url}/functions/v1/social`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${login.session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let result = {}
  try {
    result = await response.json()
  } catch {
    // Keep the HTTP status for non-JSON responses.
  }
  return { status: response.status, ...result }
}

async function putSecret(secret, name, description) {
  const { data, error } = await service.rpc('social_vault_put', {
    p_secret: secret,
    p_name: name,
    p_description: description,
  })
  if (error || typeof data !== 'string')
    throw new Error(`social managed test Vault write failed: ${error?.message || 'no secret id'}`)
  secretIds.push(data)
  return data
}

try {
  const initial = await invoke({ action: 'providers' })
  assert.equal(initial.status, 200, JSON.stringify(initial))
  const backendIds = ['zernio', 'post-for-me', 'postfast']
  assert.deepEqual(initial.backends.map(({ id }) => id).sort(), [...backendIds].sort())

  const { data: currentConfigs, error: configError } = await service
    .from('social_backend_configs')
    .select('backend_id, enabled')
  assert.equal(configError, null, configError?.message)
  const configs = new Map((currentConfigs || []).map((config) => [config.backend_id, config]))

  for (const backendId of backendIds) {
    const existing = configs.get(backendId)
    if (existing) {
      if (!existing.enabled) {
        const { error } = await service
          .from('social_backend_configs')
          .update({ enabled: true })
          .eq('backend_id', backendId)
        assert.equal(error, null, error?.message)
        enabledBackendIds.push(backendId)
      }
      continue
    }
    const credentialSecretId = await putSecret(
      `managed-runtime-fixture-${testId}-${backendId}`,
      `social-managed-test-${testId}-${backendId}`,
      'Temporary managed Social SDK runtime fixture',
    )
    const { error } = await service.from('social_backend_configs').insert({
      backend_id: backendId,
      credential_secret_id: credentialSecretId,
      enabled: true,
      updated_by: login.user.id,
    })
    assert.equal(error, null, error?.message)
    insertedBackendIds.push(backendId)
  }

  const configured = await invoke({ action: 'providers' })
  assert.equal(configured.status, 200, JSON.stringify(configured))
  assert.ok(configured.backends.every((backend) => backend.configured))
  assert.ok(
    configured.backends.every(
      (backend) =>
        Array.isArray(backend.platforms) &&
        backend.platforms.every((platform) => typeof platform === 'string'),
    ),
  )
  assert.ok(!configured.providers.some(({ id }) => id === 'facebook'),
    'Facebook is not advertised as a direct adapter')
  assert.ok(!configured.backends.some(({ id }) => id === 'postiz'), 'Postiz is not registered')

  const directIds = new Set(configured.providers.map(({ id }) => id))
  for (const backend of configured.backends) {
    assert.ok(backend.platforms.length, `${backend.id} declares at least one publishable platform`)
    for (const platform of backend.platforms) {
      const accountId = randomUUID()
      const externalAccountId = `runtime-${backend.id}-${platform}-${testId}`
      const { error: accountError } = await service.from('social_accounts').insert({
        id: accountId,
        backend_id: backend.id,
        provider_id: platform,
        external_id: externalAccountId,
        name: `${backend.name} runtime fixture`,
        username: `runtime-${backend.id}-${platform}`,
        connected_by: login.user.id,
        status: 'connected',
      })
      assert.equal(accountError, null, `${backend.id}/${platform} account setup: ${accountError?.message}`)
      accountIds.push(accountId)

      const capabilities = await invoke({ action: 'account_capabilities', accountId })
      assert.equal(
        capabilities.status,
        200,
        `${backend.id}/${platform} account initializes in the Supabase Edge Runtime: ${JSON.stringify(capabilities)}`,
      )
      assert.ok(capabilities.capabilities)
      assert.ok(Array.isArray(capabilities.operations))
      assert.ok(
        capabilities.capabilities.capabilities.some(
          (capability) =>
            capability.platform === platform &&
            capability.operation === 'posts.publish' &&
            capability.availability === 'available',
        ),
        `${backend.id}/${platform} publishes only when its runtime capability is declared`,
      )
      assert.doesNotMatch(JSON.stringify(capabilities), /managed-runtime-fixture|apiKey/i)

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
        const result = await invoke({
          action: 'account_operation',
          accountId,
          operation,
          input,
        })
        const available = offeredOperations.has(operation)
        assert.equal(
          result.status,
          available && operation === 'media.upload' ? 400 : 422,
          `${backend.id}/${platform} ${operation} runtime guard: ${JSON.stringify(result)}`,
        )
        assert.equal(
          result.code,
          available ? 'operation_input_invalid' : 'operation_unsupported',
          `${backend.id}/${platform} ${operation} is gated by its declared capability`,
        )
      }
      const nativeResult = await invoke({
        action: 'account_operation',
        accountId,
        operation: 'native',
        nativeOperation: '__not_declared__',
        input: {},
      })
      assert.equal(nativeResult.status, 422, `${backend.id}/${platform} rejects undeclared native operations`)
      assert.equal(nativeResult.code, 'operation_unsupported')
    }
  }

  const sharedRoutes = configured.backends.flatMap((backend) =>
    backend.platforms
      .filter((platform) => directIds.has(platform))
      .map((platform) => ({ ...backend, platform })),
  )
  const preferredPlatforms = ['reddit', 'threads', 'linkedin', 'x', 'bluesky', 'instagram', 'tiktok', 'youtube']
  const route = preferredPlatforms
    .map((platform) => sharedRoutes.find((candidate) => candidate.platform === platform))
    .find(Boolean)
  assert.ok(route, 'at least one managed route shares a platform with a direct adapter')
  const platform = route.platform
  const externalId = `same-account-${testId}`
  const directSecretId = await putSecret(
    JSON.stringify({ accessToken: `direct-token-${testId}`, scopes: [] }),
    `social-managed-direct-${testId}`,
    'Temporary direct Social account runtime fixture',
  )
  const directAccountId = randomUUID()
  const managedAccountId = randomUUID()
  const directAccount = await service.from('social_accounts').insert({
    id: directAccountId,
    backend_id: 'default',
    provider_id: platform,
    external_id: externalId,
    name: 'Direct runtime fixture',
    username: `direct-${testId.slice(0, 8)}`,
    credential_secret_id: directSecretId,
    connected_by: login.user.id,
    status: 'connected',
  })
  assert.equal(directAccount.error, null, directAccount.error?.message)
  accountIds.push(directAccountId)
  const managedAccount = await service.from('social_accounts').insert({
    id: managedAccountId,
    backend_id: route.id,
    provider_id: platform,
    external_id: externalId,
    name: 'Managed runtime fixture',
    username: `managed-${testId.slice(0, 8)}`,
    connected_by: login.user.id,
    status: 'connected',
  })
  assert.equal(managedAccount.error, null, managedAccount.error?.message)
  accountIds.push(managedAccountId)

  const [directCapabilities, managedCapabilities] = await Promise.all(
    [directAccountId, managedAccountId].map((accountId) =>
      invoke({ action: 'account_capabilities', accountId }),
    ),
  )
  for (const [accountType, response] of [
    ['direct', directCapabilities],
    ['managed', managedCapabilities],
  ]) {
    assert.equal(response.status, 200, `${accountType} ${route.id}/${platform}: ${JSON.stringify(response)}`)
    assert.ok(response.capabilities)
    assert.ok(Array.isArray(response.operations))
    assert.doesNotMatch(JSON.stringify(response), /direct-token|managed-runtime-fixture/)
  }
  const manifest = managedCapabilities.capabilities
  assert.ok(
    manifest.capabilities.some(
      (capability) =>
        capability.platform === platform &&
        capability.operation === 'posts.publish' &&
        capability.availability === 'available',
    ),
    `${route.id} declares ${platform} publishing before offering it`,
  )

  const draft = await invoke({
    action: 'save_draft',
    text: `Mixed direct and managed account fixture ${testId}`,
    timezone: 'UTC',
  })
  assert.equal(draft.status, 201, JSON.stringify(draft))
  postId = draft.post.id
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const scheduled = await invoke({
    action: 'schedule',
    postId,
    text: draft.post.body,
    timezone: 'UTC',
    accountIds: [directAccountId, managedAccountId],
    targetOptions: {},
    scheduledAt,
  })
  assert.equal(scheduled.status, 200, JSON.stringify(scheduled))
  assert.equal(scheduled.deliveries.length, 2)
  assert.ok(scheduled.deliveries.every((delivery) => delivery.status === 'scheduled'))

  const independentResults = await Promise.all([
    resolveSocialOutcome({
      publishResult: { outcome: 'published', providerPostId: 'direct-published' },
      onKnownFailure: () => ({ status: 'failed' }),
    }),
    resolveSocialOutcome({
      publishResult: {
        outcome: 'failed',
        code: 'managed_rate_limited',
        retryDisposition: { kind: 'after-delay', delayMs: 30_000 },
      },
      onKnownFailure: (result) => ({
        status: result.disposition?.kind === 'after-delay' ? 'retry_wait' : 'failed',
        errorCode: result.code,
      }),
    }),
  ])
  assert.deepEqual(
    Object.fromEntries(
      scheduled.deliveries.map((delivery, index) => [delivery.account_id, independentResults[index].status]),
    ),
    {
      [scheduled.deliveries[0].account_id]: 'published',
      [scheduled.deliveries[1].account_id]: 'retry_wait',
    },
    'a target result is recorded independently and cannot overwrite its sibling',
  )

  const { data: listed, error: listedError } = await service
    .from('social_accounts')
    .select('id, backend_id, provider_id, external_id')
    .in('id', [directAccountId, managedAccountId])
  assert.equal(listedError, null, listedError?.message)
  assert.deepEqual(
    listed.map((account) => account.backend_id).sort(),
    [route.id, 'default'].sort(),
    'direct and managed identities for the same platform account remain distinct',
  )
  assert.ok(listed.every((account) => account.external_id === externalId))
} catch (error) {
  failure = error
} finally {
  if (postId) {
    const { error } = await service.from('social_posts').delete().eq('id', postId)
    if (error) cleanupErrors.push(`post cleanup: ${error.message}`)
  }
  for (const accountId of accountIds) {
    const { error } = await service.from('social_accounts').delete().eq('id', accountId)
    if (error) cleanupErrors.push(`account cleanup: ${error.message}`)
  }
  for (const backendId of insertedBackendIds) {
    const { error } = await service.from('social_backend_configs').delete().eq('backend_id', backendId)
    if (error) cleanupErrors.push(`backend config cleanup: ${error.message}`)
  }
  for (const backendId of enabledBackendIds) {
    const { error } = await service
      .from('social_backend_configs')
      .update({ enabled: false })
      .eq('backend_id', backendId)
    if (error) cleanupErrors.push(`backend state cleanup: ${error.message}`)
  }
  for (const secretId of secretIds) {
    const { error } = await service.rpc('social_vault_delete', { p_secret_id: secretId })
    if (error) cleanupErrors.push(`Vault cleanup: ${error.message}`)
  }
}

if (failure) throw failure
if (cleanupErrors.length) throw new Error(cleanupErrors.join('\n'))
console.log(
  'social-managed: all managed SDK factories load in Supabase Edge Runtime, direct/managed identity stays distinct, and mixed targets retain independent outcomes',
)
