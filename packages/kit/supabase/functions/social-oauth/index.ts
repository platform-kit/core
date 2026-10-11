import { admin, appUrl, getUser, json, preflight } from '../_shared/lib.ts'
import { SOCIAL_ADAPTERS } from '../_shared/social/registry.ts'
import {
  blueskyLoopbackClientId,
  blueskyOAuthClientMetadata,
} from 'npm:@opencoredev/social-sdk@0.5.0/server'

const DEFAULT_PROVIDER_ID = 'x'
const STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_SCOPES = ['tweet.read', 'users.read', 'tweet.write', 'media.write', 'offline.access']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SocialTokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
  providerData?: Record<string, unknown>
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

function callbackUrl(providerId = DEFAULT_PROVIDER_ID) {
  const publicFunctionsUrl = Deno.env.get('PUBLIC_FUNCTIONS_URL')
  const configuredSupabaseUrl = Deno.env.get('VITE_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')
  const base = publicFunctionsUrl
    ? `${publicFunctionsUrl.replace(/\/+$/, '')}/social-oauth`
    : configuredSupabaseUrl
      ? `${configuredSupabaseUrl.replace(/\/+$/, '')}/functions/v1/social-oauth`
      : ''
  if (!base) throw new Error('SUPABASE_URL is not configured.')
  const callback = new URL(base)
  callback.searchParams.set('provider', providerId)
  return callback.toString()
}

function blueskyClientId() {
  const redirect = new URL(callbackUrl('bluesky'))
  if (['localhost', '127.0.0.1', '::1'].includes(redirect.hostname))
    return blueskyLoopbackClientId({
      redirectUris: [redirect.toString()],
      scope: 'atproto transition:generic',
    })
  const id = new URL(redirect)
  id.searchParams.set('metadata', 'bluesky')
  return id.toString()
}

function redirectResult(result: 'connected' | 'error', code: string) {
  const url = new URL('/admin/social', appUrl())
  url.searchParams.set('social_connection', result)
  url.searchParams.set('social_code', code)
  return Response.redirect(url, 303)
}

async function canManageAccounts(userId: string) {
  const { data, error } = await admin.rpc('social_user_can_manage_accounts', {
    p_user_id: userId,
  })
  return { allowed: data === true, error }
}

async function secret(action: 'put' | 'read' | 'delete', secretId?: string, value?: string, name?: string) {
  if (action === 'put') {
    const { data, error } = await admin.rpc('social_vault_put', {
      p_secret: value,
      p_name: name,
      p_description: 'Social publishing OAuth credential',
    })
    if (error) throw new Error(`Could not store social OAuth credential (${error.code || 'vault_error'}).`)
    return data as string
  }
  const { data, error } = action === 'read'
    ? await admin.rpc('social_vault_read', { p_secret_id: secretId })
    : await admin.rpc('social_vault_delete', { p_secret_id: secretId })
  if (error) throw new Error(`Could not ${action} social OAuth credential (${error.code || 'vault_error'}).`)
  return data as string | null
}

function localFixtureEnabled() {
  const value = Deno.env.get('SUPABASE_URL')
  if (!value) return false
  try {
    return ['kong', 'localhost', '127.0.0.1'].includes(new URL(value).hostname)
  } catch {
    return false
  }
}

function providerAvailable(providerId: string) {
  return SOCIAL_ADAPTERS.has(providerId) || (providerId === 'fixture' && localFixtureEnabled())
}

async function providerConfig(providerId: string) {
  const { data, error } = await admin.from('social_provider_configs')
    .select('provider_id, client_id, client_secret_id, scopes, enabled')
    .eq('provider_id', providerId).maybeSingle()
  if (error) throw new Error(`Could not load social provider configuration (${error.code || 'database_error'}).`)
  if (!data?.enabled || !providerAvailable(providerId)) throw new Error('The social provider is not configured or enabled.')
  const adapter = SOCIAL_ADAPTERS.has(providerId) ? SOCIAL_ADAPTERS.get(providerId) : null
  const clientSecret = data.client_secret_id ? await secret('read', data.client_secret_id) : null
  if (adapter?.clientSecretRequired !== false && !clientSecret)
    throw new Error('The provider credential is unavailable.')
  return {
    clientId: providerId === 'bluesky' ? blueskyClientId() : data.client_id as string,
    clientSecret: clientSecret || '',
    scopes: Array.isArray(data.scopes) && data.scopes.length
      ? data.scopes as string[]
      : SOCIAL_ADAPTERS.has(providerId) ? SOCIAL_ADAPTERS.get(providerId).defaultScopes || [] : DEFAULT_SCOPES,
  }
}

async function start(userId: string, providerId: string, loginHint?: string) {
  const access = await canManageAccounts(userId)
  if (access.error) return json({ error: 'Could not check account-management permission.', code: 'social_permission_lookup_failed' }, 500)
  if (!access.allowed) return json({ error: 'Manage accounts permission is required.', code: 'social_permission_required' }, 403)
  if (!providerAvailable(providerId)) return json({ error: 'This social provider is not available.', code: 'provider_unavailable' }, 404)
  const hint = typeof loginHint === 'string' ? loginHint.trim() : ''
  if (hint.length > 512 || (providerId === 'bluesky' && !hint))
    return json({ error: 'A valid Bluesky handle, DID, or server is required.', code: 'login_hint_invalid' }, 400)

  const { data: expiredStates, error: expiredError } = await admin.from('social_oauth_states')
    .select('id, code_verifier_secret_id').lt('expires_at', new Date().toISOString()).limit(100)
  if (expiredError) return json({ error: 'Could not clean up expired authorization attempts.', code: 'oauth_cleanup_failed' }, 500)
  for (const expired of expiredStates || []) {
    try {
      await secret('delete', expired.code_verifier_secret_id)
    } catch (error) {
      console.error('social OAuth start: expired verifier cleanup failed', error instanceof Error ? error.message : 'vault_error')
      return json({ error: 'Could not clean up an expired authorization attempt.', code: 'oauth_cleanup_failed' }, 500)
    }
  }
  if (expiredStates?.length) {
    const { error } = await admin.from('social_oauth_states').delete().in('id', expiredStates.map((item) => item.id))
    if (error) return json({ error: 'Could not remove expired authorization attempts.', code: 'oauth_cleanup_failed' }, 500)
  }

  let config: Awaited<ReturnType<typeof providerConfig>>
  try {
    config = await providerConfig(providerId)
  } catch (error) {
    console.error('social OAuth start:', error instanceof Error ? error.message : 'provider configuration failed')
    return json({ error: 'This provider is not ready to connect. Ask an administrator to check its configuration.', code: 'provider_unavailable' }, 503)
  }

  const state = randomToken()
  const verifier = randomToken()
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )))
  let authorizationUrl: string
  let providerState: string | undefined
  if (providerId === 'fixture') {
    const authorization = new URL('https://social-test.invalid/authorize')
    authorization.search = new URLSearchParams({ state, redirect_uri: callbackUrl(providerId) }).toString()
    authorizationUrl = authorization.toString()
  } else {
    try {
      const adapter = SOCIAL_ADAPTERS.get(providerId)
      const credentials = { clientId: config.clientId, clientSecret: config.clientSecret }
      if (adapter.connection) {
        const started = await adapter.connection.start({
          state,
          redirectUri: callbackUrl(providerId),
          scopes: config.scopes,
          codeChallenge: challenge,
          ...(providerId === 'bluesky' ? { loginHint: hint } : {}),
          credentials,
        })
        authorizationUrl = started.authorizationUrl
        providerState = started.providerState
      } else {
        authorizationUrl = await adapter.authorizationUrl({
          state,
          redirectUri: callbackUrl(providerId),
          scopes: config.scopes,
          codeChallenge: challenge,
          credentials,
        })
      }
    } catch (error) {
      console.error('social OAuth start: provider authorization URL failed', error instanceof Error ? error.message : 'provider error')
      return json({ error: 'Could not start provider authorization.', code: 'oauth_authorization_url_failed' }, 502)
    }
  }

  const verifierId = await secret(
    'put',
    undefined,
    JSON.stringify({ verifier, providerState, scopes: config.scopes }),
    `social-${providerId}-pkce-${crypto.randomUUID()}`,
  )
  if (!verifierId) return json({ error: 'Could not store the authorization verifier.', code: 'oauth_verifier_write_failed' }, 500)
  const stateHash = await sha256(state)
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString()
  const { error } = await admin.from('social_oauth_states').insert({
    state_hash: stateHash,
    provider_id: providerId,
    user_id: userId,
    return_path: '/admin/social',
    code_verifier_secret_id: verifierId,
    expires_at: expiresAt,
  })
  if (error) {
    await secret('delete', verifierId)
    console.error('social OAuth start: could not create state', error.code)
    return json({ error: 'Could not start provider authorization.', code: 'oauth_state_write_failed' }, 500)
  }
  return json({ authorizationUrl, expiresAt })
}

async function exchangeCode(providerId: string, code: string, state: string, redirectUri: string, verifier: string, config: Awaited<ReturnType<typeof providerConfig>>) {
  if (providerId === 'fixture') {
    if (!localFixtureEnabled() || code !== 'fixture-valid-code')
      throw new Error('The local social test authorization code is invalid.')
    return {
      accessToken: `fixture-access-${crypto.randomUUID()}`,
      refreshToken: `fixture-refresh-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: config.scopes,
    }
  }
  return SOCIAL_ADAPTERS.get(providerId).exchangeCode({
    code,
    state,
    redirectUri,
    verifier,
    credentials: { clientId: config.clientId, clientSecret: config.clientSecret },
  })
}

function tokenSet(result: Record<string, unknown>): SocialTokenSet {
  const now = Date.now()
  const expiry = typeof result.expires_in === 'number' && Number.isFinite(result.expires_in)
    ? new Date(now + result.expires_in * 1000).toISOString()
    : null
  const scopes = typeof result.scope === 'string' ? result.scope.split(/\s+/).filter(Boolean) : []
  return {
    accessToken: typeof result.access_token === 'string' ? result.access_token : '',
    refreshToken: typeof result.refresh_token === 'string' ? result.refresh_token : null,
    expiresAt: expiry,
    scopes,
  }
}

async function discoverAccounts(providerId: string, tokens: SocialTokenSet) {
  if (providerId === 'fixture') {
    if (!localFixtureEnabled()) throw new Error('The local social test adapter is unavailable.')
    return [
      { external_id: 'fixture-account-one', name: 'Fixture One', username: 'fixture_one', avatar_url: null },
      { external_id: 'fixture-account-two', name: 'Fixture Two', username: 'fixture_two', avatar_url: null },
    ]
  }
  const accounts = await SOCIAL_ADAPTERS.get(providerId).listAccounts({ tokens, credentials: {} })
  return accounts.map((account: { id: string; name: string; username: string; avatarUrl: string | null }) => ({
    external_id: account.id,
    name: account.name,
    username: account.username,
    avatar_url: account.avatarUrl,
  }))
}

async function callback(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  if (!state || state.length > 512) return redirectResult('error', 'state_invalid')
  const stateHash = await sha256(state)
  const { data: saved, error: lookupError } = await admin.from('social_oauth_states')
    .select('id, provider_id, user_id, code_verifier_secret_id, created_at, expires_at, consumed_at')
    .eq('state_hash', stateHash).maybeSingle()
  if (lookupError) {
    console.error('social OAuth callback: state lookup failed', lookupError.code)
    return redirectResult('error', 'state_unavailable')
  }
  if (!saved || saved.provider_id !== url.searchParams.get('provider'))
    return redirectResult('error', 'state_mismatch')
  if (saved.consumed_at || Date.parse(saved.expires_at) <= Date.now())
    return redirectResult('error', saved.consumed_at ? 'state_replayed' : 'state_expired')

  const consumedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin.from('social_oauth_states')
    .update({ consumed_at: consumedAt })
    .eq('id', saved.id).is('consumed_at', null).gt('expires_at', consumedAt)
    .select('id, user_id, code_verifier_secret_id').maybeSingle()
  if (claimError) {
    console.error('social OAuth callback: state claim failed', claimError.code)
    return redirectResult('error', 'state_unavailable')
  }
  if (!claimed) return redirectResult('error', 'state_replayed')
  const access = await canManageAccounts(claimed.user_id)
  if (access.error || !access.allowed) {
    try { await secret('delete', claimed.code_verifier_secret_id) }
    catch (error) {
      console.error('social OAuth callback: verifier cleanup failed', error instanceof Error ? error.message : 'vault_error')
    }
    if (access.error) console.error('social OAuth callback: account permission lookup failed', access.error.code)
    return redirectResult('error', access.error ? 'permission_unavailable' : 'permission_revoked')
  }
  if (url.searchParams.has('error')) {
    await secret('delete', claimed.code_verifier_secret_id)
    return redirectResult('error', 'authorization_denied')
  }
  if (!code || code.length > 4096) {
    await secret('delete', claimed.code_verifier_secret_id)
    return redirectResult('error', 'authorization_denied')
  }

  let pendingTokenSecretIds: string[] = []
  try {
    const config = await providerConfig(saved.provider_id)
    const verifierValue = await secret('read', claimed.code_verifier_secret_id)
    if (!verifierValue) throw new Error('PKCE verifier is unavailable.')
    let verifier = verifierValue
    let providerState: string | undefined
    let scopes = config.scopes
    try {
      const parsed = JSON.parse(verifierValue)
      if (typeof parsed?.verifier === 'string') {
        verifier = parsed.verifier
        providerState = typeof parsed.providerState === 'string' ? parsed.providerState : undefined
        scopes = Array.isArray(parsed.scopes) ? parsed.scopes : config.scopes
      }
    } catch {
      // Existing in-flight authorization states store the verifier as plain text.
    }
    const adapter = SOCIAL_ADAPTERS.has(saved.provider_id) ? SOCIAL_ADAPTERS.get(saved.provider_id) : null
    let connected: Array<{ account: { id: string; providerId: string; name: string; username: string; avatarUrl: string | null }; tokens: SocialTokenSet }>
    if (adapter?.connection) {
      const attempt = {
        id: claimed.id,
        backend: saved.provider_id,
        tenantId: 'site',
        principalId: claimed.user_id,
        platforms: [saved.provider_id],
        capabilities: ['posts.publish', 'media.upload'],
        redirectUri: callbackUrl(saved.provider_id),
        state,
        codeVerifier: verifier,
        ...(providerState ? { providerState } : {}),
        createdAt: saved.created_at,
        expiresAt: saved.expires_at,
        scopes,
      }
      connected = await adapter.connection.complete({
        callbackUrl: req.url,
        attempt,
        credentials: { clientId: config.clientId, clientSecret: config.clientSecret },
      })
    } else {
      const tokens = await exchangeCode(saved.provider_id, code, state, callbackUrl(saved.provider_id), verifier, config)
      const accounts = await discoverAccounts(saved.provider_id, tokens)
      connected = accounts.map((account: { external_id: string; name: string; username: string; avatar_url: string | null }) => ({
        account: {
          id: account.external_id,
          providerId: saved.provider_id,
          name: account.name,
          username: account.username,
          avatarUrl: account.avatar_url,
        },
        tokens,
      }))
    }
    if (!connected.length) throw new Error('The provider did not return any social accounts.')
    const saveAccess = await canManageAccounts(claimed.user_id)
    if (saveAccess.error || !saveAccess.allowed)
      throw new Error(saveAccess.error ? 'Account permission could not be rechecked.' : 'Account-management permission was revoked.')

    const savedAccounts = []
    for (const { account, tokens } of connected) {
      if (!tokens.accessToken) throw new Error('The provider returned an empty account credential.')
      const id = await secret(
        'put',
        undefined,
        JSON.stringify(tokens),
        `social-${saved.provider_id}-${account.id}-${crypto.randomUUID()}`,
      )
      if (!id) throw new Error('Could not store provider credentials.')
      pendingTokenSecretIds.push(id)
      savedAccounts.push({
        external_id: account.id,
        name: account.name,
        username: account.username,
        avatar_url: account.avatarUrl,
        credential_secret_id: id,
      })
    }
    const { data: previous, error: previousError } = await admin.from('social_accounts')
      .select('credential_secret_id')
      .eq('provider_id', saved.provider_id).in('external_id', connected.map(({ account }) => account.id))
    if (previousError) throw new Error(`Could not check existing social accounts (${previousError.code}).`)
    const { error: saveError } = await admin.from('social_accounts').upsert(savedAccounts.map((account) => ({
      ...account,
      backend_id: 'default',
      provider_id: saved.provider_id,
      status: 'connected',
      connected_by: claimed.user_id,
      updated_at: new Date().toISOString(),
      disconnected_at: null,
    })), { onConflict: 'backend_id,provider_id,external_id' })
    if (saveError) throw new Error(`Could not save social accounts (${saveError.code}).`)
    const currentSecrets = new Set(pendingTokenSecretIds)
    pendingTokenSecretIds = []
    for (const old of previous || []) {
      if (old.credential_secret_id && !currentSecrets.has(old.credential_secret_id))
        await secret('delete', old.credential_secret_id)
    }
    await secret('delete', claimed.code_verifier_secret_id)
    return redirectResult('connected', 'connected')
  } catch (error) {
    for (const id of pendingTokenSecretIds) {
      try { await secret('delete', id) }
      catch (cleanupError) {
        console.error('social OAuth callback: token cleanup failed', cleanupError instanceof Error ? cleanupError.message : 'vault_error')
      }
    }
    try { await secret('delete', claimed.code_verifier_secret_id) }
    catch (cleanupError) {
      console.error('social OAuth callback: verifier cleanup failed', cleanupError instanceof Error ? cleanupError.message : 'vault_error')
    }
    console.error('social OAuth callback:', error instanceof Error ? error.message : 'account connection failed')
    return redirectResult('error', 'connection_failed')
  }
}

async function refresh(userId: string, accountId: string) {
  if (!UUID.test(accountId)) return json({ error: 'A valid social account is required.', code: 'account_id_invalid' }, 400)
  const access = await canManageAccounts(userId)
  if (access.error) return json({ error: 'Could not check account-management permission.', code: 'social_permission_lookup_failed' }, 500)
  if (!access.allowed) return json({ error: 'Manage accounts permission is required.', code: 'social_permission_required' }, 403)

  const { data: account, error } = await admin.from('social_accounts')
    .select('id, provider_id, credential_secret_id')
    .eq('id', accountId).neq('status', 'disconnected').maybeSingle()
  if (error) return json({ error: 'Could not load the social account.', code: 'account_lookup_failed' }, 500)
  if (!account) return json({ error: 'The social account is unavailable.', code: 'account_not_found' }, 404)
  try {
    const tokens = JSON.parse((await secret('read', account.credential_secret_id)) || '') as SocialTokenSet
    if (!tokens.refreshToken) return json({ error: 'Reconnect this account to restore access.', code: 'reconnect_required' }, 409)
    const config = await providerConfig(account.provider_id)
    const adapter = SOCIAL_ADAPTERS.get(account.provider_id)
    const next = adapter.connection
      ? await adapter.connection.refresh({
        tokens,
        credentials: { clientId: config.clientId, clientSecret: config.clientSecret },
      })
      : await adapter.refreshToken({
        tokens,
        credentials: { clientId: config.clientId, clientSecret: config.clientSecret },
      })
    if (!next.scopes.length) next.scopes = tokens.scopes
    const nextId = await secret('put', undefined, JSON.stringify(next), `social-${account.provider_id}-${accountId}`)
    if (!nextId) throw new Error('Could not store refreshed provider credentials.')
    const { data: updated, error: updateError } = await admin.from('social_accounts')
      .update({ credential_secret_id: nextId, status: 'connected', updated_at: new Date().toISOString() })
      .eq('id', accountId).eq('credential_secret_id', account.credential_secret_id)
      .select('id').maybeSingle()
    if (updateError || !updated) {
      await secret('delete', nextId)
      throw new Error(`Could not rotate provider credentials (${updateError?.code || 'concurrent_change'}).`)
    }
    await secret('delete', account.credential_secret_id)
    return json({ refreshed: true })
  } catch (error) {
    console.error('social OAuth refresh:', error instanceof Error ? error.message : 'refresh failed')
    return json({ error: 'This provider could not refresh the account. Reconnect it before scheduling more posts.', code: 'refresh_failed' }, 502)
  }
}

Deno.serve(async (req) => {
  const options = preflight(req)
  if (options) return options

  const url = new URL(req.url)
  if (req.method === 'GET') {
    if (url.searchParams.get('metadata') === 'bluesky') {
      if (url.searchParams.get('provider') !== 'bluesky')
        return json({ error: 'The Bluesky metadata route is invalid.', code: 'metadata_route_invalid' }, 404)
      try {
        const redirectUri = callbackUrl('bluesky')
        const clientId = blueskyClientId()
        if (new URL(clientId).protocol !== 'https:')
          return json({ error: 'Bluesky OAuth client metadata requires a public HTTPS callback URL.', code: 'metadata_requires_https' }, 409)
        const metadata = blueskyOAuthClientMetadata({
          clientId,
          redirectUris: [redirectUri],
          scope: 'atproto transition:generic',
          applicationType: 'web',
          clientName: 'Site Social Publisher',
        })
        return new Response(JSON.stringify(metadata), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
        })
      } catch (error) {
        console.error('social OAuth metadata:', error instanceof Error ? error.message : 'metadata failed')
        return json({ error: 'Could not create Bluesky OAuth metadata.', code: 'metadata_invalid' }, 500)
      }
    }
    return callback(req)
  }
  if (req.method !== 'POST') return json({ error: 'POST is required.', code: 'method_not_allowed' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'Sign in to use social publishing.', code: 'unauthenticated' }, 401)
  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError()
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'A JSON request body is required.', code: 'invalid_request' }, 400)
  }

  if (body.action === 'start') {
    const providerId = typeof body.providerId === 'string' ? body.providerId : DEFAULT_PROVIDER_ID
    return start(user.id, providerId, typeof body.loginHint === 'string' ? body.loginHint : undefined)
  }
  if (body.action === 'refresh')
    return refresh(user.id, typeof body.accountId === 'string' ? body.accountId : '')
  return json({ error: `Unknown social OAuth action for ${url.pathname}.`, code: 'action_invalid' }, 400)
})
