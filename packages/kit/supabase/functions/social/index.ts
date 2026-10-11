import { admin, appUrl, getUser, json, preflight } from '../_shared/lib.ts'
import { SOCIAL_ADAPTERS } from '../_shared/social/registry.ts'
import {
  createManagedSocial,
  invokeManagedNative,
  managedPublishPlatforms,
  MANAGED_BACKEND_IDS,
  MANAGED_NATIVE_OPERATIONS,
  hasManagedBackend,
  connectedAccountRef,
  managedOperationContext,
} from '../_shared/social/managed-sdk.mjs'
import {
  availableSocialOperations,
  invokeNativeOperation,
  invokeSocialOperation,
  operationAvailable,
} from '../_shared/social/operations.mjs'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const GRANT_DAYS = 7
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

function databaseFailure(error: { code?: unknown }, code: string, message: string) {
  const databaseCode =
    typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(error.code)
      ? error.code
      : 'unknown'
  console.error(`social ${code}: database request failed`, databaseCode)
  return json({ error: message, code, databaseCode }, 500)
}

async function isAdmin(userId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('roles, role')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { allowed: false, error }
  const roles = Array.isArray(data?.roles) ? data.roles : []
  return { allowed: roles.includes('admin') || data?.role === 'admin', error: null }
}

async function hasSocialAccess(userId: string) {
  const check = await isAdmin(userId)
  if (check.error || check.allowed) return check
  const { data, error } = await admin
    .from('social_publisher_grants')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  return { allowed: Boolean(data), error }
}

async function userCanAccount(userId: string, accountId: string, permission: string) {
  const { data, error } = await admin.rpc('social_user_can', {
    p_user_id: userId,
    p_account_id: accountId,
    p_permission: permission,
  })
  return { allowed: data === true, error }
}

async function userCanManageAccounts(userId: string) {
  const { data, error } = await admin.rpc('social_user_can_manage_accounts', {
    p_user_id: userId,
  })
  return { allowed: data === true, error }
}

async function userCanCreateDraft(userId: string) {
  const { data, error } = await admin.rpc('social_user_can_create_draft', {
    p_user_id: userId,
  })
  return { allowed: data === true, error }
}

async function userCanManagePost(userId: string, postId: string, permission: string) {
  const { data, error } = await admin.rpc('social_user_can_manage_post', {
    p_user_id: userId,
    p_post_id: postId,
    p_permission: permission,
  })
  return { allowed: data === true, error }
}

async function userCanEditPost(userId: string, postId: string) {
  const { data, error } = await admin.rpc('social_user_can_edit_post', {
    p_user_id: userId,
    p_post_id: postId,
  })
  return { allowed: data === true, error }
}

async function userCanDelivery(userId: string, deliveryId: string, permission: string) {
  const { data, error } = await admin.rpc('social_user_delivery_account', {
    p_user_id: userId,
    p_delivery_id: deliveryId,
    p_permission: permission,
  })
  return { accountId: typeof data === 'string' ? data : null, error }
}

function permissionCheckFailure(error: unknown, permission: string) {
  if (error) {
    const databaseCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'unknown'
    console.error(`social authorization: ${permission} lookup failed`, databaseCode)
    return json(
      {
        error: 'Could not check the required Social permission.',
        code: 'social_permission_lookup_failed',
        databaseCode,
      },
      500,
    )
  }
  return null
}

async function saveProvider(
  userId: string,
  providerId: string,
  clientId: string,
  clientSecret: string,
  scopes: string[],
) {
  if (!SOCIAL_ADAPTERS.has(providerId))
    return json(
      { error: 'This social provider has no adapter configured.', code: 'provider_unavailable' },
      400,
    )
  const adapter = SOCIAL_ADAPTERS.get(providerId)
  const needsSecret = adapter.clientSecretRequired !== false
  if (
    (!clientId && providerId !== 'bluesky') ||
    clientId.length > 500 ||
    (needsSecret && !clientSecret) ||
    clientSecret.length > 4096
  )
    return json(
      {
        error: 'Enter the provider OAuth client ID and client secret.',
        code: 'provider_credentials_invalid',
      },
      400,
    )
  const allowedScopes = adapter.allowedScopes || []
  if (
    !scopes.length ||
    scopes.length > 100 ||
    scopes.some((scope) => !allowedScopes.includes(scope))
  )
    return json(
      { error: 'The provider OAuth scopes are invalid.', code: 'provider_scopes_invalid' },
      400,
    )

  const { data: previous, error: lookupError } = await admin
    .from('social_provider_configs')
    .select('client_secret_id')
    .eq('provider_id', providerId)
    .maybeSingle()
  if (lookupError)
    return json(
      {
        error: 'Could not read the existing provider configuration.',
        code: 'provider_lookup_failed',
      },
      500,
    )

  let secretId: string | null = null
  if (needsSecret) {
    const { data, error: vaultError } = await admin.rpc('social_vault_put', {
      p_secret: clientSecret,
      p_name: `social-${providerId}-client-${crypto.randomUUID()}`,
      p_description: 'Social publishing OAuth client secret',
    })
    if (vaultError || typeof data !== 'string') {
      console.error('social provider save: vault write failed', vaultError?.code)
      return json(
        {
          error: 'Could not store the provider OAuth client secret.',
          code: 'provider_secret_write_failed',
        },
        500,
      )
    }
    secretId = data
  }

  const { error: saveError } = await admin.from('social_provider_configs').upsert(
    {
      provider_id: providerId,
      client_id: providerId === 'bluesky' ? '' : clientId,
      client_secret_id: secretId,
      scopes,
      enabled: true,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'provider_id' },
  )
  if (saveError) {
    if (secretId) await admin.rpc('social_vault_delete', { p_secret_id: secretId })
    return json(
      { error: 'Could not save the provider OAuth configuration.', code: 'provider_write_failed' },
      500,
    )
  }
  if (previous?.client_secret_id && previous.client_secret_id !== secretId) {
    const { error } = await admin.rpc('social_vault_delete', {
      p_secret_id: previous.client_secret_id,
    })
    if (error) {
      console.error('social provider save: rotated secret cleanup failed', error.code)
      return json(
        {
          error: 'The provider was configured, but the previous secret could not be removed.',
          code: 'provider_secret_cleanup_failed',
        },
        500,
      )
    }
  }
  return json({ provider: { id: providerId, configured: true, scopes } })
}

async function saveBackend(
  userId: string,
  backendId: string,
  apiKey: string,
  webhookSecret: string,
) {
  if (!hasManagedBackend(backendId) || apiKey.trim().length < 8 || apiKey.length > 4096 || webhookSecret.length > 4096)
    return json(
      { error: 'Enter a valid managed backend and its API key.', code: 'backend_credentials_invalid' },
      400,
    )

  const { data: previous, error: lookupError } = await admin
    .from('social_backend_configs')
    .select('credential_secret_id, webhook_secret_id')
    .eq('backend_id', backendId)
    .maybeSingle()
  if (lookupError)
    return json({ error: 'Could not read the managed backend configuration.', code: 'backend_lookup_failed' }, 500)

  const { data: credentialSecretId, error: credentialError } = await admin.rpc('social_vault_put', {
    p_secret: apiKey,
    p_name: `social-${backendId}-api-${crypto.randomUUID()}`,
    p_description: 'Social publishing managed backend API key',
  })
  if (credentialError || typeof credentialSecretId !== 'string') {
    console.error('social backend save: API key Vault write failed', credentialError?.code)
    return json({ error: 'Could not store the managed backend API key.', code: 'backend_secret_write_failed' }, 500)
  }

  let webhookSecretId: string | null = previous?.webhook_secret_id || null
  if (webhookSecret) {
    const { data, error } = await admin.rpc('social_vault_put', {
      p_secret: webhookSecret,
      p_name: `social-${backendId}-webhook-${crypto.randomUUID()}`,
      p_description: 'Social publishing managed backend webhook secret',
    })
    if (error || typeof data !== 'string') {
      await admin.rpc('social_vault_delete', { p_secret_id: credentialSecretId })
      console.error('social backend save: webhook secret Vault write failed', error?.code)
      return json({ error: 'Could not store the managed backend webhook secret.', code: 'backend_webhook_secret_write_failed' }, 500)
    }
    webhookSecretId = data
  }

  const { error: saveError } = await admin.from('social_backend_configs').upsert(
    {
      backend_id: backendId,
      credential_secret_id: credentialSecretId,
      webhook_secret_id: webhookSecretId,
      enabled: true,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'backend_id' },
  )
  if (saveError) {
    await admin.rpc('social_vault_delete', { p_secret_id: credentialSecretId })
    if (webhookSecretId) await admin.rpc('social_vault_delete', { p_secret_id: webhookSecretId })
    return json({ error: 'Could not save the managed backend configuration.', code: 'backend_write_failed' }, 500)
  }

  for (const secretId of [
    previous?.credential_secret_id,
    webhookSecret ? previous?.webhook_secret_id : null,
  ]) {
    if (secretId) {
      const { error } = await admin.rpc('social_vault_delete', { p_secret_id: secretId })
      if (error) {
        console.error('social backend save: old Vault credential cleanup failed', error.code)
        return json({ error: 'The backend is configured, but an old secret could not be removed.', code: 'backend_secret_cleanup_failed' }, 500)
      }
    }
  }
  return json({ backend: { id: backendId, configured: true } })
}

async function managedBackend(backendId: string) {
  const { data, error } = await admin
    .from('social_backend_configs')
    .select('credential_secret_id, webhook_secret_id, enabled')
    .eq('backend_id', backendId)
    .maybeSingle()
  if (error) throw new Error(`Could not load managed backend configuration (${error.code || 'database_error'}).`)
  if (!data?.enabled) throw new Error('This managed backend is not configured or enabled.')
  const [{ data: apiKey, error: keyError }, webhookResult] = await Promise.all([
    admin.rpc('social_vault_read', { p_secret_id: data.credential_secret_id }),
    data.webhook_secret_id
      ? admin.rpc('social_vault_read', { p_secret_id: data.webhook_secret_id })
      : Promise.resolve({ data: null, error: null }),
  ])
  if (keyError || typeof apiKey !== 'string' || !apiKey)
    throw new Error(`Could not load managed backend credentials (${keyError?.code || 'credential_unavailable'}).`)
  if (webhookResult.error)
    throw new Error(`Could not load managed backend webhook credentials (${webhookResult.error.code || 'credential_unavailable'}).`)
  return {
    client: createManagedSocial(backendId, apiKey, {
      ...(typeof webhookResult.data === 'string' ? { webhookSecret: webhookResult.data } : {}),
    }),
  }
}

async function cancelManagedDeliveries(rows: Array<Record<string, any>>) {
  for (const delivery of rows) {
    const { data: account, error: accountError } = await admin
      .from('social_accounts')
      .select('backend_id, provider_id, external_id')
      .eq('id', delivery.account_id)
      .maybeSingle()
    if (accountError || !account)
      return { ok: false, code: 'social_account_lookup_failed' }
    const backendId = account.backend_id || 'default'
    if (backendId === 'default' || !delivery.remote_job_id)
      return { ok: false, code: 'remote_schedule_reference_missing' }
    try {
      const client = (await managedBackend(backendId)).client
      await client.posts.cancelScheduled({
        kind: 'scheduled-job',
        version: 1,
        backend: backendId,
        platform: account.provider_id,
        accountId: account.external_id,
        jobId: delivery.remote_job_id,
      }, managedOperationContext(backendId))
    } catch (error) {
      console.error('social schedule: managed cancellation failed', backendId, error instanceof Error ? error.message : 'unknown error')
      return { ok: false, code: 'remote_schedule_cancel_failed' }
    }
    const { error: updateError } = await admin
      .from('social_deliveries')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        lease_token: null,
        lease_until: null,
        next_attempt_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', delivery.id)
      .eq('status', 'remote_scheduled')
      .eq('remote_job_id', delivery.remote_job_id)
    if (updateError)
      return { ok: false, code: 'remote_schedule_state_write_failed' }
  }
  return { ok: true, code: null }
}

async function startManagedConnection(body: Record<string, unknown>, userId: string) {
  const backendId = typeof body.backendId === 'string' ? body.backendId : ''
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : ''
  if (!hasManagedBackend(backendId) || !/^[a-z][a-z0-9-]{1,40}$/.test(platform))
    return json({ error: 'Choose a valid managed backend and social platform.', code: 'backend_connection_invalid' }, 400)
  let client: ReturnType<typeof createManagedSocial>
  try {
    client = (await managedBackend(backendId)).client
  } catch (error) {
    console.error('social managed connect: backend configuration unavailable', backendId, error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'This managed backend is not ready to connect.', code: 'backend_unavailable' }, 503)
  }
  if (!managedPublishPlatforms(client).includes(platform))
    return json({ error: 'This backend does not support publishing to the selected platform.', code: 'backend_platform_unsupported' }, 422)
  const redirectUrl = new URL('/admin/social', appUrl())
  redirectUrl.searchParams.set('social_connection', 'managed')
  try {
    let result: { url: string }
    if (backendId === 'zernio') {
      const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
      if (!profileId || profileId.length > 300)
        return json({ error: 'Choose a valid Zernio profile.', code: 'backend_profile_required' }, 400)
      result = await invokeManagedNative(client, backendId, 'createConnection', {
        platform: platform === 'x' ? 'twitter' : platform,
        profileId,
        redirectUrl: redirectUrl.toString(),
      })
    } else if (backendId === 'post-for-me') {
      result = await invokeManagedNative(client, backendId, 'createConnection', {
        platform: platform === 'x' ? 'twitter' : platform,
        externalId: userId,
        permissions: ['posts', 'feeds'],
        redirectUrl: redirectUrl.toString(),
      })
    } else {
      const connectPlatform = platform === 'x' ? 'X' : platform.toUpperCase().replaceAll('-', '_')
      result = await invokeManagedNative(client, backendId, 'createConnectLink', {
        platforms: [connectPlatform],
        expiryDays: 7,
        redirectUrl: redirectUrl.toString(),
        externalId: userId,
      })
    }
    return json({ authorizationUrl: result.url })
  } catch (error) {
    console.error('social managed connect: provider operation failed', backendId, platform, error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'The managed backend could not start account authorization.', code: 'backend_connection_failed' }, 502)
  }
}

async function listManagedProfiles(backendId: string) {
  if (backendId !== 'zernio')
    return json({ error: 'This managed backend does not have profiles.', code: 'operation_unsupported' }, 422)
  try {
    const client = (await managedBackend(backendId)).client
    const profiles = await invokeManagedNative(client, backendId, 'listProfiles')
    return json({
      profiles: profiles.flatMap((profile: unknown) => {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return []
        const value = profile as Record<string, unknown>
        const id = typeof value._id === 'string' ? value._id : ''
        if (!id) return []
        return [{
          id,
          name: typeof value.name === 'string' ? value.name : id,
          description: typeof value.description === 'string' ? value.description : '',
        }]
      }),
    })
  } catch (error) {
    console.error('social managed profiles: request failed', error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'Could not load managed backend profiles.', code: 'backend_profiles_failed' }, 502)
  }
}

async function listProviders() {
  const [{ data, error }, { data: managed, error: managedError }] = await Promise.all([
    admin
    .from('social_provider_configs')
    .select('provider_id, scopes, enabled')
    .order('provider_id'),
    admin
      .from('social_backend_configs')
      .select('backend_id, enabled')
      .order('backend_id'),
  ])
  if (error)
    return json({ error: 'Could not list social providers.', code: 'provider_list_failed' }, 500)
  if (managedError)
    return json({ error: 'Could not list managed social backends.', code: 'backend_list_failed' }, 500)
  const configured = new Map((data || []).map((row) => [row.provider_id, row]))
  const backends = []
  for (const id of MANAGED_BACKEND_IDS) {
    const enabled = Boolean(managed?.find((row) => row.backend_id === id && row.enabled))
    if (!enabled) {
      backends.push({ id, configured: false, platforms: [] })
      continue
    }
    try {
      const client = (await managedBackend(id)).client
      backends.push({ id, configured: true, platforms: managedPublishPlatforms(client) })
    } catch (backendError) {
      console.error(
        'social provider list: managed backend capability lookup failed',
        id,
        backendError instanceof Error ? backendError.message : 'unknown error',
      )
      return json(
        { error: 'Could not inspect a configured managed backend.', code: 'backend_capability_lookup_failed' },
        502,
      )
    }
  }
  return json({
    providers: SOCIAL_ADAPTERS.ids().map((id) => {
      const adapter = SOCIAL_ADAPTERS.get(id)
      return {
        id,
        name: adapter.displayName || id,
        configured: Boolean(configured.get(id)?.enabled),
        scopes: configured.get(id)?.scopes || adapter.defaultScopes || [],
        clientSecretRequired: adapter.clientSecretRequired !== false,
      }
    }),
    backends,
  })
}

async function syncManagedAccounts(userId: string) {
  const { data: configs, error: configError } = await admin
    .from('social_backend_configs')
    .select('backend_id')
    .eq('enabled', true)
    .order('backend_id')
  if (configError) throw new Error(`Could not list managed backend configuration (${configError.code}).`)
  for (const config of configs || []) {
    const backendId = config.backend_id
    if (!hasManagedBackend(backendId)) continue
    const client = (await managedBackend(backendId)).client
    const seen = new Set<string>()
    for await (const remote of client.accounts.iterate({ backend: backendId, limit: 100 })) {
      const ref = remote.ref
      if (ref.backend !== backendId || !ref.accountId || !ref.platform)
        throw new Error(`Managed backend "${backendId}" returned an invalid account reference.`)
      const identity = `${ref.platform}\u0000${ref.accountId}`
      if (seen.has(identity))
        throw new Error(`Managed backend "${backendId}" repeated an account during pagination.`)
      seen.add(identity)
      const status = remote.status === 'connected' ? 'connected' : 'reconnect_required'
      const values = {
          backend_id: backendId,
          provider_id: ref.platform,
          external_id: ref.accountId,
          name: remote.displayName || remote.handle || ref.accountId,
          username: remote.handle || ref.accountId,
          avatar_url: null,
          credential_secret_id: null,
          status,
          updated_at: new Date().toISOString(),
        }
      const { data: existing, error: existingError } = await admin
        .from('social_accounts')
        .select('id, status, disconnected_at')
        .eq('backend_id', backendId)
        .eq('provider_id', ref.platform)
        .eq('external_id', ref.accountId)
        .maybeSingle()
      if (existingError) throw new Error(`Could not find managed social account (${existingError.code}).`)
      const { error } = existing
        ? await admin.from('social_accounts').update(
            existing.status === 'disconnected'
              ? { ...values, status: 'disconnected', disconnected_at: existing.disconnected_at }
              : { ...values, disconnected_at: null },
          ).eq('id', existing.id)
        : await admin.from('social_accounts').insert({ ...values, connected_by: userId })
      if (error)
        throw new Error(`Could not save managed social account (${error.code || 'database_error'}).`)
    }
    const { data: existingAccounts, error: listError } = await admin
      .from('social_accounts')
      .select('id, provider_id, external_id, status')
      .eq('backend_id', backendId)
    if (listError) throw new Error(`Could not list cached managed accounts (${listError.code}).`)
    for (const row of existingAccounts || []) {
      if (row.status === 'disconnected' || seen.has(`${row.provider_id}\u0000${row.external_id}`)) continue
      const { error } = await admin
        .from('social_accounts')
        .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw new Error(`Could not mark a removed managed account (${error.code}).`)
    }
  }
}

async function listAccounts(userId: string) {
  const management = await userCanManageAccounts(userId)
  const permissionError = permissionCheckFailure(management.error, 'manage accounts')
  if (permissionError) return permissionError
  if (management.allowed) {
    try {
      await syncManagedAccounts(userId)
    } catch (error) {
      console.error('social managed account sync failed', error instanceof Error ? error.message : 'unknown error')
      return json({ error: 'Could not synchronize managed social accounts.', code: 'managed_account_sync_failed' }, 502)
    }
  }
  let permissions: Array<Record<string, unknown>> = []
  if (!management.allowed) {
    const { data: grant, error: grantError } = await admin
      .from('social_publisher_grants')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()
    if (grantError)
      return databaseFailure(grantError, 'social_permission_lookup_failed', 'Could not list social accounts.')
    if (!grant) return json({ accounts: [], canManageAccounts: false })
    const { data, error } = await admin
      .from('social_publisher_account_permissions')
      .select('account_id, read_posts, create_posts, edit_posts, schedule_posts, approve_posts, publish_now, view_results')
      .eq('grant_id', grant.id)
    if (error)
      return databaseFailure(error, 'social_permission_lookup_failed', 'Could not list social accounts.')
    permissions = data || []
    if (!permissions.length) return json({ accounts: [], canManageAccounts: false })
  }
  const { data, error } = await admin
    .from('social_accounts')
    .select(
      'id, backend_id, provider_id, external_id, name, username, avatar_url, status, approval_required, connected_by, connected_at, updated_at, disconnected_at',
    )
    .order('provider_id')
    .order('username')
  if (error)
    return json({ error: 'Could not list social accounts.', code: 'account_list_failed' }, 500)
  const permissionByAccount = new Map(
    permissions.map(({ account_id: accountId, ...perms }) => [accountId, perms]),
  )
  const accounts = management.allowed
    ? (data || []).map((account) => ({
        ...account,
        permissions: {
          read_posts: true,
          create_posts: true,
          edit_posts: true,
          schedule_posts: true,
          approve_posts: true,
          publish_now: true,
          view_results: true,
        },
      }))
    : (data || [])
        .filter((account) => permissionByAccount.has(account.id))
        .map((account) => ({ ...account, permissions: permissionByAccount.get(account.id) }))
  return json({ accounts, canManageAccounts: management.allowed })
}

async function spacesStaff(userId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('roles, role')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { allowed: false, error }
  const roles = Array.isArray(data?.roles)
    ? data.roles.filter((role: unknown) => typeof role === 'string' && role.length > 0)
    : typeof data?.role === 'string' && data.role.length > 0
      ? [data.role]
      : []
  return { allowed: roles.length > 0, error: null }
}

async function listDeskAccounts(userId: string) {
  const staff = await spacesStaff(userId)
  if (staff.error)
    return databaseFailure(staff.error, 'desk_staff_lookup_failed', 'Could not check Spaces staff access.')
  if (!staff.allowed)
    return json({ error: 'Spaces staff access is required.', code: 'desk_staff_required' }, 403)
  const social = await hasSocialAccess(userId)
  if (social.error)
    return databaseFailure(social.error, 'social_access_lookup_failed', 'Could not check social publisher access.')
  if (!social.allowed) return json({ accounts: [] })
  const response = await listAccounts(userId)
  const payload = await response.json()
  if (!response.ok) return json(payload, response.status)
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : []
  return json({
    accounts: accounts.filter((account) =>
      account?.permissions?.view_results === true && account?.permissions?.publish_now === true),
  })
}

async function deskAccountReadFailure(userId: string, accountId: string) {
  if (!UUID.test(accountId))
    return json({ error: 'Choose a valid social account.', code: 'operation_request_invalid' }, 400)
  for (const [permission, label] of [
    ['view_results', 'view results'],
    ['publish_now', 'Social Admin publish access'],
  ] as const) {
    const access = await userCanAccount(userId, accountId, permission)
    const failure = permissionCheckFailure(access.error, label)
    if (failure) return failure
    if (!access.allowed)
      return json({ error: 'You cannot access this social account from Spaces.', code: 'social_permission_required' }, 403)
  }
  return null
}

async function listDeskPosts(userId: string) {
  const accountsResponse = await listDeskAccounts(userId)
  const payload = await accountsResponse.json()
  if (!accountsResponse.ok) return json(payload, accountsResponse.status)
  const ids = (Array.isArray(payload.accounts) ? payload.accounts : [])
    .filter((account) => account.status === 'connected')
    .map((account) => account.id)
    .filter((id: unknown): id is string => typeof id === 'string' && UUID.test(id))
  if (!ids.length) return json({ posts: [], truncated: false })
  const limit = 200
  const { data, error, count } = await admin
    .from('social_deliveries')
    .select('post_id, account_id, provider_post_id, published_at', { count: 'exact' })
    .in('account_id', ids)
    .eq('status', 'published')
    .not('provider_post_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) return databaseFailure(error, 'desk_posts_lookup_failed', 'Could not list published social posts.')
  const postIds = [...new Set((data || []).map((row) => row.post_id).filter((id) => typeof id === 'string'))]
  let postDetails = new Map<string, { body: string; title: string }>()
  if (postIds.length) {
    const { data: postRows, error: postError } = await admin
      .from('social_posts')
      .select('id, body')
      .in('id', postIds)
    if (postError) return databaseFailure(postError, 'desk_posts_lookup_failed', 'Could not load published social post details.')
    postDetails = new Map((postRows || []).flatMap((row) =>
      typeof row.id === 'string' && typeof row.body === 'string'
        ? [[row.id, { body: row.body, title: row.body.replace(/\s+/g, ' ').trim().slice(0, 100) }]]
        : []))
  }
  const posts = (data || []).map((row) => ({
    ...row,
    title: postDetails.get(row.post_id)?.title || null,
    body: postDetails.get(row.post_id)?.body || null,
  }))
  return json({ posts, truncated: (count ?? posts.length) >= limit })
}

function operationPermission(operation: string, nativeOperation: string) {
  if (operation === 'native') return 'manage_accounts'
  if (operation === 'accounts.read' || operation === 'posts.read') return 'read_posts'
  if (operation === 'posts.cancelScheduled') return 'schedule_posts'
  if (operation === 'notifications.seen') return 'view_results'
  if (
    operation === 'search.posts' ||
    operation.startsWith('analytics.') ||
    operation.startsWith('profiles.') ||
    operation === 'graph.read' ||
    operation === 'comments.read' ||
    operation === 'messages.read' ||
    operation === 'notifications.read' ||
    operation.startsWith('webhooks.')
  )
    return 'view_results'
  if (
    [
      'media.upload',
      'graph.follow',
      'graph.unfollow',
      'graph.block',
      'graph.unblock',
      'graph.mute',
      'graph.unmute',
      'comments.write',
      'messages.write',
      'posts.deleteBackendRecord',
      'posts.removeFromPlatform',
    ].includes(operation)
  )
    return 'publish_now'
  return nativeOperation ? 'manage_accounts' : null
}

async function accountOperation(
  body: Record<string, unknown>,
  userId: string,
  metadataOnly = false,
) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  const operation = typeof body.operation === 'string' ? body.operation : ''
  const nativeOperation = typeof body.nativeOperation === 'string' ? body.nativeOperation : ''
  if (!UUID.test(accountId) || (!metadataOnly && !/^[a-z][a-zA-Z0-9.]{1,100}$/.test(operation)))
    return json(
      { error: 'Choose a valid social account and operation.', code: 'operation_request_invalid' },
      400,
    )
  const permission = metadataOnly ? null : operationPermission(operation, nativeOperation)
  if (!metadataOnly && !permission)
    return json(
      { error: 'This social operation is not authorized.', code: 'operation_unsupported' },
      422,
    )
  const permissionNames = permission
    ? [permission]
    : [
        'read_posts',
        'create_posts',
        'edit_posts',
        'schedule_posts',
        'approve_posts',
        'publish_now',
        'view_results',
      ]
  const accountPermissions = await Promise.all(
    permissionNames.map((name) => userCanAccount(userId, accountId, name)),
  )
  const permissionError = accountPermissions.find((result) => result.error)?.error
  const permissionFailure = permissionCheckFailure(
    permissionError,
    permission || 'read account capabilities',
  )
  if (permissionFailure) return permissionFailure
  if (!accountPermissions.some((result) => result.allowed))
    return json(
      {
        error: 'You do not have permission to use this social account.',
        code: 'social_permission_required',
      },
      403,
    )
  const { data: account, error: accountError } = await admin
    .from('social_accounts')
    .select(
      'id, backend_id, provider_id, external_id, name, username, avatar_url, credential_secret_id, status',
    )
    .eq('id', accountId)
    .maybeSingle()
  if (accountError)
    return json({ error: 'Could not load the social account.', code: 'account_lookup_failed' }, 500)
  if (!account)
    return json({ error: 'The social account was not found.', code: 'account_not_found' }, 404)
  if (account.status !== 'connected')
    return json(
      {
        error: 'Reconnect this social account before using its operations.',
        code: 'account_reconnect_required',
      },
      409,
    )
  const backendId = account.backend_id || 'default'
  let adapter: ReturnType<typeof SOCIAL_ADAPTERS.get> | null = null
  let socialAccount: { id: string; providerId: string; name: string; username: string; avatarUrl: string | null }
  let manifest
  let client
  let nativeOperations: string[] = []
  if (backendId === 'default') {
    if (!SOCIAL_ADAPTERS.has(account.provider_id))
      return json({ error: 'This social account has no adapter configured.', code: 'provider_unavailable' }, 409)
    adapter = SOCIAL_ADAPTERS.get(account.provider_id)
    const { data: tokenJson, error: tokenError } = await admin.rpc('social_vault_read', {
      p_secret_id: account.credential_secret_id,
    })
    if (tokenError || typeof tokenJson !== 'string') {
      console.error('social operation: account credential lookup failed', tokenError?.code)
      return json({ error: 'Reconnect this social account before using its operations.', code: 'account_credential_unavailable' }, 409)
    }
    let tokens: Record<string, unknown>
    try {
      tokens = JSON.parse(tokenJson)
    } catch {
      return json({ error: 'Reconnect this social account before using its operations.', code: 'account_credential_invalid' }, 409)
    }
    if (typeof tokens.accessToken !== 'string' || !tokens.accessToken)
      return json({ error: 'Reconnect this social account before using its operations.', code: 'account_credential_invalid' }, 409)
    socialAccount = {
      id: account.external_id,
      providerId: account.provider_id,
      name: account.name,
      username: account.username,
      avatarUrl: account.avatar_url,
    }
    const tokenSet = {
      accessToken: tokens.accessToken,
      refreshToken: typeof tokens.refreshToken === 'string' ? tokens.refreshToken : null,
      expiresAt: typeof tokens.expiresAt === 'string' ? tokens.expiresAt : null,
      scopes: Array.isArray(tokens.scopes) ? tokens.scopes.filter((scope) => typeof scope === 'string') : [],
      ...(tokens.providerData && typeof tokens.providerData === 'object' ? { providerData: tokens.providerData } : {}),
    }
    try {
      manifest = await adapter.capabilities({ account: socialAccount, tokens: tokenSet, credentials: {} })
      client = adapter.createClient({ account: socialAccount, tokens: tokenSet })
      nativeOperations = adapter.nativeOperations || []
    } catch (error) {
      console.error('social operation: adapter initialization failed', error instanceof Error ? error.message : 'unknown error')
      return json({ error: 'Could not initialize this social account.', code: 'operation_adapter_failed' }, 502)
    }
  } else {
    if (!hasManagedBackend(backendId))
      return json({ error: 'This social account has an unknown managed backend.', code: 'backend_unavailable' }, 409)
    try {
      client = (await managedBackend(backendId)).client
      manifest = Object.values(client.capabilities())[0]
      if (!manifest) throw new Error('The managed backend did not declare capabilities.')
      nativeOperations = [...(MANAGED_NATIVE_OPERATIONS[backendId] || [])]
      socialAccount = {
        id: account.external_id,
        providerId: account.provider_id,
        name: account.name,
        username: account.username,
        avatarUrl: account.avatar_url,
      }
    } catch (error) {
      console.error('social operation: managed backend initialization failed', backendId, error instanceof Error ? error.message : 'unknown error')
      return json({ error: 'Could not initialize this managed social account.', code: 'operation_adapter_failed' }, 502)
    }
  }
  if (metadataOnly)
    return json({
      capabilities: manifest,
      operations: availableSocialOperations(manifest, account.provider_id, client, backendId),
      nativeOperations,
    })

  if (operation === 'native') {
    if (
      !operationAvailable(manifest, 'native', account.provider_id) ||
      !nativeOperations.includes(nativeOperation)
    )
      return json(
        {
          error: 'This native operation is not available for the account.',
          code: 'operation_unsupported',
        },
        422,
      )
    try {
      const result = await invokeNativeOperation({
        client,
        operation: nativeOperation,
        input:
          body.input && typeof body.input === 'object' && !Array.isArray(body.input)
            ? body.input
            : {},
        allowed: nativeOperations,
        backend: backendId,
      })
      return json({ result })
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'operation_failed'
      console.error(
        'social native operation failed',
        account.provider_id,
        nativeOperation,
        error instanceof Error ? error.message : 'unknown error',
      )
      return json(
        { error: 'The social operation failed.', code },
        code === 'operation_unsupported' ? 422 : 502,
      )
    }
  }

  if (
    !operationAvailable(manifest, operation, account.provider_id) ||
    !availableSocialOperations(manifest, account.provider_id, client, backendId).some(
      (item) => item.operation === operation,
    )
  )
    return json(
      {
        error: 'This operation is not available for the selected account.',
        code: 'operation_unsupported',
      },
      422,
    )
  const input =
    body.input && typeof body.input === 'object' && !Array.isArray(body.input)
      ? (body.input as Record<string, unknown>)
      : {}
  if (operation === 'media.upload') {
    const attachmentId = typeof input.attachmentId === 'string' ? input.attachmentId : ''
    if (!UUID.test(attachmentId))
      return json(
        { error: 'Choose a saved image or video attachment.', code: 'operation_input_invalid' },
        400,
      )
    const { data: attachment, error: attachmentError } = await admin
      .from('social_attachments')
      .select('object_path, kind, mime_type, file_name, byte_size')
      .eq('id', attachmentId)
      .maybeSingle()
    if (attachmentError)
      return json(
        { error: 'Could not load the selected media.', code: 'social_attachment_lookup_failed' },
        500,
      )
    if (!attachment)
      return json(
        { error: 'The selected media was not found.', code: 'social_attachment_not_found' },
        404,
      )
    const { data: file, error: fileError } = await admin.storage
      .from('social')
      .download(attachment.object_path)
    if (fileError || !file)
      return json(
        { error: 'Could not read the selected private media.', code: 'social_media_read_failed' },
        500,
      )
    const bytes = new Uint8Array(await file.arrayBuffer())
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    input.mediaAttachment = {
      kind: attachment.kind,
      source: {
        kind: 'blob',
        blob: new Blob([bytes], { type: attachment.mime_type }),
        fingerprint,
      },
      mimeType: attachment.mime_type,
      filename: attachment.file_name,
      byteSize: attachment.byte_size,
    }
  }
  try {
    const result = await invokeSocialOperation({
      client,
      account: {
        backend: backendId,
        platform: account.provider_id,
        accountId: account.external_id,
      },
      operation,
      input,
    })
    return json({ result })
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'operation_failed'
    console.error(
      'social operation failed',
      account.provider_id,
      operation,
      error instanceof Error ? error.message : 'unknown error',
    )
    return json(
      { error: 'The social operation failed.', code },
      code === 'operation_unsupported' || code === 'operation_input_invalid' ? 422 : 502,
    )
  }
}

async function disconnect(accountId: string) {
  if (!UUID.test(accountId))
    return json({ error: 'A valid social account is required.', code: 'account_id_invalid' }, 400)
  const { data: account, error: lookupError } = await admin
    .from('social_accounts')
    .select('id, backend_id, credential_secret_id, status')
    .eq('id', accountId)
    .maybeSingle()
  if (lookupError)
    return json({ error: 'Could not load the social account.', code: 'account_lookup_failed' }, 500)
  if (!account)
    return json({ error: 'The social account was not found.', code: 'account_not_found' }, 404)
  if (account.status !== 'disconnected') {
    const { error } = await admin
      .from('social_accounts')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', accountId)
      .neq('status', 'disconnected')
    if (error)
      return json(
        { error: 'Could not disconnect the social account.', code: 'account_disconnect_failed' },
        500,
      )
  }
  if (account.backend_id === 'default' && account.credential_secret_id) {
    const { error: vaultError } = await admin.rpc('social_vault_delete', {
      p_secret_id: account.credential_secret_id,
    })
    if (vaultError) {
      console.error('social disconnect: credential deletion failed', vaultError.code)
      return json(
        {
          error: 'The account is disconnected, but its credential could not be removed.',
          code: 'account_credential_cleanup_failed',
        },
        500,
      )
    }
  }
  return json({ disconnected: true, accountId })
}

async function listPublishers() {
  const [publishers, accounts, permissions] = await Promise.all([
    admin
    .from('social_publisher_grants')
    .select(
    'id, email, user_id, status, can_manage_accounts, invited_by, invited_at, expires_at, accepted_at, revoked_at',
    )
    .order('invited_at', { ascending: false }),
    admin
      .from('social_accounts')
      .select('id, provider_id, name, username, status, approval_required')
      .order('provider_id')
      .order('username'),
    admin
      .from('social_publisher_account_permissions')
      .select('grant_id, account_id, read_posts, create_posts, edit_posts, schedule_posts, approve_posts, publish_now, view_results'),
  ])
  const error = publishers.error || accounts.error || permissions.error
  if (error)
    return json(
      { error: 'Could not load the Social access matrix.', code: 'social_grant_list_failed' },
      500,
    )
  const permissionsByGrant = new Map<string, Record<string, unknown>[]>()
  for (const permission of permissions.data || []) {
    const list = permissionsByGrant.get(permission.grant_id) || []
    list.push(permission)
    permissionsByGrant.set(permission.grant_id, list)
  }
  return json({
    publishers: (publishers.data || []).map((publisher) => ({
      ...publisher,
      accountPermissions: permissionsByGrant.get(publisher.id) || [],
    })),
    accounts: accounts.data || [],
  })
}

async function savePublisherPermissions(body: Record<string, unknown>, userId: string) {
  const grantId = typeof body.grantId === 'string' ? body.grantId : ''
  const canManageAccounts = body.canManageAccounts === true
  const rawPermissions = body.permissions
  if (
    !UUID.test(grantId) ||
    !Array.isArray(rawPermissions) ||
    rawPermissions.length > 100 ||
    rawPermissions.some((permission) =>
      !permission ||
      typeof permission !== 'object' ||
      Array.isArray(permission) ||
      typeof (permission as Record<string, unknown>).accountId !== 'string' ||
      !UUID.test((permission as Record<string, unknown>).accountId as string) ||
      ['read_posts', 'create_posts', 'edit_posts', 'schedule_posts', 'approve_posts', 'publish_now', 'view_results']
        .some((key) => (permission as Record<string, unknown>)[key] !== undefined &&
          typeof (permission as Record<string, unknown>)[key] !== 'boolean')
    )
  )
    return json({ error: 'The Social permissions are invalid.', code: 'social_permissions_invalid' }, 400)
  const { error } = await admin.rpc('social_set_publisher_permissions', {
    p_grant_id: grantId,
    p_actor_id: userId,
    p_can_manage_accounts: canManageAccounts,
    p_permissions: rawPermissions.map((item) => {
      const permission = item as Record<string, unknown>
      return {
        account_id: permission.accountId,
        read_posts: permission.read_posts === true,
        create_posts: permission.create_posts === true,
        edit_posts: permission.edit_posts === true,
        schedule_posts: permission.schedule_posts === true,
        approve_posts: permission.approve_posts === true,
        publish_now: permission.publish_now === true,
        view_results: permission.view_results === true,
      }
    }),
  })
  if (error) {
    const conflict = /grant is unavailable|account not found/i.test(error.message)
    return json(
      {
        error: conflict
          ? 'The publisher invitation or account is no longer available.'
          : 'Could not save Social permissions.',
        code: conflict ? 'social_permissions_conflict' : 'social_permissions_write_failed',
      },
      conflict ? 409 : 500,
    )
  }
  return json({ saved: true })
}

async function listDrafts(userId: string) {
  const { data: accessiblePostIds, error: permissionError } = await admin.rpc(
    'social_user_post_ids',
    { p_user_id: userId },
  )
  if (permissionError)
    return databaseFailure(
      permissionError,
      'social_permission_lookup_failed',
      'Could not check social draft access.',
    )
  if (!Array.isArray(accessiblePostIds) || accessiblePostIds.length === 0)
    return json({ posts: [] })
  const { data: posts, error: postError } = await admin
    .from('social_posts')
    .select('id, body, timezone, created_by, created_at, updated_at')
    .in('id', accessiblePostIds)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (postError)
    return databaseFailure(postError, 'social_post_list_failed', 'Could not load social drafts.')
  const ids = (posts || []).map((post) => post.id)
  if (!ids.length) return json({ posts: [] })
  const [attachments, deliveries] = await Promise.all([
    admin
      .from('social_attachments')
      .select('id, post_id, object_path, kind, mime_type, file_name, byte_size, position')
      .in('post_id', ids)
      .order('position'),
    admin
      .from('social_deliveries')
      .select(
        'id, post_id, account_id, target_options, scheduled_at, status, attempt_count, next_attempt_at, provider_post_id, last_error_code, last_error, published_at, metrics_state, metrics_last_fetched_at, metrics_next_fetch_at, metrics_attempt_count, metrics_last_error_code, metrics_last_error, recovered_by, recovered_at, recovery_action',
      )
      .in('post_id', ids)
      .order('scheduled_at'),
  ])
  if (attachments.error)
    return databaseFailure(
      attachments.error,
      'social_attachment_list_failed',
      'Could not load social post media.',
    )
  if (deliveries.error)
    return databaseFailure(
      deliveries.error,
      'social_delivery_list_failed',
      'Could not load social delivery states.',
    )
  const resultPermissions = await Promise.all(
    (deliveries.data || []).map((delivery) =>
      userCanAccount(userId, delivery.account_id, 'view_results'),
    ),
  )
  const resultPermissionError = resultPermissions.find((result) => result.error)?.error
  const resultPermissionFailure = permissionCheckFailure(resultPermissionError, 'view results')
  if (resultPermissionFailure) return resultPermissionFailure
  const resultAccess = new Map(
    (deliveries.data || []).map((delivery, index) => [
      delivery.id,
      resultPermissions[index].allowed,
    ]),
  )
  return json({
    posts: (posts || []).map((post) => ({
      ...post,
      attachments: (attachments.data || []).filter((item) => item.post_id === post.id),
      deliveries: (deliveries.data || [])
        .filter((item) => item.post_id === post.id)
        .map((delivery) => {
          if (resultAccess.get(delivery.id)) return delivery
          const {
            provider_post_id: _providerPostId,
            metrics_state: _metricsState,
            metrics_last_fetched_at: _metricsLastFetchedAt,
            metrics_next_fetch_at: _metricsNextFetchAt,
            metrics_attempt_count: _metricsAttemptCount,
            metrics_last_error_code: _metricsLastErrorCode,
            metrics_last_error: _metricsLastError,
            ...deliveryState
          } = delivery
          return deliveryState
        }),
    })),
  })
}

async function saveDraft(body: Record<string, unknown>, userId: string) {
  const postId = typeof body.postId === 'string' ? body.postId : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : 'UTC'
  if (postId && !UUID.test(postId))
    return json({ error: 'A valid post id is required.', code: 'post_id_invalid' }, 400)
  if (text.length > 25_000)
    return json({ error: 'Post text is too long to save.', code: 'post_text_too_long' }, 400)
  if (!timezone || timezone.length > 100)
    return json({ error: 'Choose a valid time zone.', code: 'timezone_invalid' }, 400)
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    return json({ error: 'Choose a valid time zone.', code: 'timezone_invalid' }, 400)
  }
  if (postId) {
    const authorization = await userCanEditPost(userId, postId)
    const failure = permissionCheckFailure(authorization.error, 'edit posts')
    if (failure) return failure
    if (!authorization.allowed)
      return json({ error: 'You cannot edit this social post.', code: 'social_permission_required' }, 403)
  } else {
    const authorization = await userCanCreateDraft(userId)
    const failure = permissionCheckFailure(authorization.error, 'create posts')
    if (failure) return failure
    if (!authorization.allowed)
      return json({ error: 'You cannot create social drafts.', code: 'social_permission_required' }, 403)
  }
  if (postId) {
    const { data, error } = await admin.rpc('social_save_draft', {
      p_post_id: postId,
      p_body: text,
      p_timezone: timezone,
      p_actor_id: userId,
    })
    if (error) {
      if (/already started|recovery/i.test(error.message))
        return json(
          {
            error: 'A post with a started or uncertain delivery cannot be edited.',
            code: 'post_locked',
          },
          409,
        )
      if (/post not found/i.test(error.message))
        return json(
          { error: 'The social draft was not found.', code: 'social_post_not_found' },
          404,
        )
      return databaseFailure(error, 'social_post_write_failed', 'Could not save the social draft.')
    }
    return json({ post: data })
  }
  const { data, error } = await admin
    .from('social_posts')
    .insert({ body: text, timezone, created_by: userId })
    .select('id, body, timezone, created_by, created_at, updated_at')
    .single()
  if (error)
    return databaseFailure(error, 'social_post_write_failed', 'Could not create the social draft.')
  return json({ post: data }, 201)
}

function mediaKind(file: File) {
  const type = file.type.toLowerCase()
  if (IMAGE_MIMES.has(type) && file.size <= MAX_IMAGE_BYTES) return 'image'
  if (type === 'video/mp4' && file.size <= MAX_VIDEO_BYTES) return 'video'
  return null
}

function validMediaSignature(kind: 'image' | 'video', type: string, bytes: Uint8Array) {
  if (kind === 'image' && type === 'image/png')
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
  if (kind === 'image' && type === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return (
    kind === 'video' &&
    type === 'video/mp4' &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  )
}

async function uploadAttachment(postId: string, file: File, userId: string, replaceId?: string) {
  if (!UUID.test(postId) || (replaceId && !UUID.test(replaceId)))
    return json(
      { error: 'A valid post and attachment are required.', code: 'attachment_request_invalid' },
      400,
    )
  const authorization = await userCanEditPost(userId, postId)
  const permissionFailure = permissionCheckFailure(authorization.error, 'edit posts')
  if (permissionFailure) return permissionFailure
  if (!authorization.allowed)
    return json({ error: 'You cannot edit this social post.', code: 'social_permission_required' }, 403)
  if (!file || file.size <= 0)
    return json({ error: 'Choose a non-empty image or video.', code: 'attachment_empty' }, 400)
  const kind = mediaKind(file)
  if (!kind)
    return json(
      {
        error: 'Use a JPEG or PNG image up to 5 MiB, or an MP4 video up to 100 MiB.',
        code: 'attachment_type_unsupported',
      },
      415,
    )
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!validMediaSignature(kind, file.type.toLowerCase(), bytes))
    return json(
      {
        error: 'The file contents do not match its image or video type.',
        code: 'attachment_signature_invalid',
      },
      415,
    )
  const { data: post, error: postError } = await admin
    .from('social_posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle()
  if (postError)
    return json(
      { error: 'Could not check the post for this media.', code: 'social_post_lookup_failed' },
      500,
    )
  if (!post)
    return json({ error: 'The social draft was not found.', code: 'social_post_not_found' }, 404)

  const { data: old, error: oldError } = replaceId
    ? await admin
        .from('social_attachments')
        .select('id, object_path, position')
        .eq('id', replaceId)
        .eq('post_id', postId)
        .maybeSingle()
    : { data: null, error: null }
  if (oldError)
    return json(
      {
        error: 'Could not load the media being replaced.',
        code: 'social_attachment_lookup_failed',
      },
      500,
    )
  if (replaceId && !old)
    return json(
      { error: 'The attachment was not found on this post.', code: 'social_attachment_not_found' },
      404,
    )

  const attachmentId = replaceId || crypto.randomUUID()
  const objectPath = `posts/${postId}/${crypto.randomUUID()}`
  const uploaded = await admin.storage
    .from('social')
    .upload(objectPath, bytes, { contentType: file.type, upsert: false })
  if (uploaded.error)
    return json(
      {
        error: 'Could not upload the private social media file.',
        code: 'social_media_upload_failed',
      },
      500,
    )

  const fileName =
    (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload'
  const { data: previousPath, error: saveError } = await admin.rpc('social_save_attachment', {
    p_attachment_id: attachmentId,
    p_post_id: postId,
    p_object_path: objectPath,
    p_kind: kind,
    p_mime_type: file.type,
    p_file_name: fileName,
    p_byte_size: bytes.length,
    p_replace: Boolean(replaceId),
    p_actor_id: userId,
  })
  if (saveError) {
    await admin.storage.from('social').remove([objectPath])
    if (/already started|recovery/i.test(saveError.message))
      return json(
        {
          error: 'Media cannot be changed after a delivery starts or needs recovery.',
          code: 'post_locked',
        },
        409,
      )
    if (/attachment not found/i.test(saveError.message))
      return json(
        {
          error: 'The attachment was not found on this post.',
          code: 'social_attachment_not_found',
        },
        404,
      )
    if (/post not found/i.test(saveError.message))
      return json({ error: 'The social draft was not found.', code: 'social_post_not_found' }, 404)
    return json(
      { error: 'Could not save the social media details.', code: 'social_attachment_write_failed' },
      500,
    )
  }
  const { data: saved, error: readError } = await admin
    .from('social_attachments')
    .select('id, post_id, object_path, kind, mime_type, file_name, byte_size, position')
    .eq('id', attachmentId)
    .single()
  if (readError)
    return json(
      {
        error: 'The media is saved, but its record could not be reloaded.',
        code: 'social_attachment_readback_failed',
      },
      500,
    )
  const previousObject = typeof previousPath === 'string' ? previousPath : old?.object_path
  if (previousObject && previousObject !== objectPath) {
    const { error } = await admin.storage.from('social').remove([previousObject])
    if (error) {
      console.error('social attachment replace: previous object cleanup failed', error.message)
      return json(
        {
          error: 'The replacement is saved, but the old media file could not be removed.',
          code: 'social_attachment_cleanup_failed',
        },
        500,
      )
    }
  }
  return json({ attachment: saved }, replaceId ? 200 : 201)
}

async function deleteAttachment(attachmentId: string, userId: string) {
  if (!UUID.test(attachmentId))
    return json({ error: 'A valid attachment id is required.', code: 'attachment_id_invalid' }, 400)
  const { data: attachment, error: lookupError } = await admin
    .from('social_attachments')
    .select('post_id')
    .eq('id', attachmentId)
    .maybeSingle()
  if (lookupError)
    return databaseFailure(lookupError, 'social_attachment_lookup_failed', 'Could not check this attachment.')
  if (!attachment)
    return json({ error: 'The attachment was not found.', code: 'social_attachment_not_found' }, 404)
  const authorization = await userCanEditPost(userId, attachment.post_id)
  const permissionFailure = permissionCheckFailure(authorization.error, 'edit posts')
  if (permissionFailure) return permissionFailure
  if (!authorization.allowed)
    return json({ error: 'You cannot edit this social post.', code: 'social_permission_required' }, 403)
  const { data: objectPath, error: deleteError } = await admin.rpc('social_remove_attachment', {
    p_attachment_id: attachmentId,
    p_actor_id: userId,
  })
  if (deleteError) {
    if (/already started|recovery/i.test(deleteError.message))
      return json(
        {
          error: 'Media cannot be changed after a delivery starts or needs recovery.',
          code: 'post_locked',
        },
        409,
      )
    if (/attachment not found/i.test(deleteError.message))
      return json(
        { error: 'The attachment was not found.', code: 'social_attachment_not_found' },
        404,
      )
    return json(
      { error: 'Could not remove the social media file.', code: 'social_attachment_delete_failed' },
      500,
    )
  }
  if (typeof objectPath !== 'string')
    return json(
      { error: 'The attachment was not found.', code: 'social_attachment_not_found' },
      404,
    )
  const { error: removeError } = await admin.storage.from('social').remove([objectPath])
  if (removeError) {
    console.error('social attachment delete: object cleanup failed', removeError.message)
    return json(
      {
        error: 'The attachment record was removed, but its private file could not be cleaned up.',
        code: 'social_media_cleanup_failed',
      },
      500,
    )
  }
  return json({ removed: true, attachmentId })
}

async function orderAttachments(postId: string, attachmentIds: string[], userId: string) {
  if (
    !UUID.test(postId) ||
    !Array.isArray(attachmentIds) ||
    attachmentIds.some((id) => !UUID.test(id)) ||
    new Set(attachmentIds).size !== attachmentIds.length
  )
    return json(
      { error: 'The attachment order is invalid.', code: 'attachment_order_invalid' },
      400,
    )
  const authorization = await userCanEditPost(userId, postId)
  const permissionFailure = permissionCheckFailure(authorization.error, 'edit posts')
  if (permissionFailure) return permissionFailure
  if (!authorization.allowed)
    return json({ error: 'You cannot edit this social post.', code: 'social_permission_required' }, 403)
  const { error } = await admin.rpc('social_order_attachments', {
    p_post_id: postId,
    p_attachment_ids: attachmentIds,
    p_actor_id: userId,
  })
  if (error) {
    if (/order must name every/i.test(error.message))
      return json(
        {
          error: 'The order must include every attachment on this post exactly once.',
          code: 'attachment_order_mismatch',
        },
        400,
      )
    if (/already started|recovery/i.test(error.message))
      return json(
        {
          error: 'Media cannot be changed after a delivery starts or needs recovery.',
          code: 'post_locked',
        },
        409,
      )
    return json(
      { error: 'Could not save the social media order.', code: 'social_attachment_order_failed' },
      500,
    )
  }
  return json({ ordered: true })
}

async function schedulePost(body: Record<string, unknown>, userId: string) {
  const postId = typeof body.postId === 'string' ? body.postId : ''
  const targetIds =
    Array.isArray(body.accountIds) && body.accountIds.every((id) => typeof id === 'string')
      ? [...new Set(body.accountIds as string[])]
      : []
  const scheduledAt = typeof body.scheduledAt === 'string' ? body.scheduledAt : ''
  const publishNow = body.publishNow === true
  const targetOptions =
    body.targetOptions &&
    typeof body.targetOptions === 'object' &&
    !Array.isArray(body.targetOptions)
      ? (body.targetOptions as Record<string, unknown>)
      : {}
  const timestamp = Date.parse(scheduledAt)
  const text = typeof body.text === 'string' ? body.text : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone : 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    return json({ error: 'Choose a valid time zone.', code: 'timezone_invalid' }, 400)
  }
  if (
    !UUID.test(postId) ||
    !targetIds.length ||
    targetIds.length > 50 ||
    targetIds.some((id) => !UUID.test(id)) ||
    !Number.isFinite(timestamp) ||
    (!publishNow && timestamp <= Date.now()) ||
    timezone.length > 100
  )
    return json(
      {
        error: 'Choose a future time, a saved post, and at least one social account.',
        code: 'schedule_request_invalid',
      },
      400,
    )
  const permission = publishNow ? 'publish_now' : 'schedule_posts'
  const targetPermissions = await Promise.all(
    targetIds.map((accountId) => userCanAccount(userId, accountId, permission)),
  )
  const targetPermissionError = targetPermissions.find((result) => result.error)?.error
  const targetPermissionFailure = permissionCheckFailure(targetPermissionError, permission)
  if (targetPermissionFailure) return targetPermissionFailure
  if (targetPermissions.some((result) => !result.allowed))
    return json(
      { error: 'You do not have permission for every selected social account.', code: 'social_permission_required' },
      403,
    )
  if (Object.keys(targetOptions).some((id) => !UUID.test(id) || !targetIds.includes(id)))
    return json(
      {
        error: 'Per-account publishing options do not match the selected accounts.',
        code: 'target_options_invalid',
      },
      400,
    )
  const { data: post, error: postError } = await admin
    .from('social_posts')
    .select('id, updated_at')
    .eq('id', postId)
    .maybeSingle()
  if (postError)
    return json(
      { error: 'Could not load the social draft.', code: 'social_post_lookup_failed' },
      500,
    )
  if (!post)
    return json({ error: 'The social draft was not found.', code: 'social_post_not_found' }, 404)
  const [attachmentResult, accountResult] = await Promise.all([
    admin
      .from('social_attachments')
      .select('id, object_path, kind, mime_type, file_name, byte_size, position')
      .eq('post_id', postId)
      .order('position'),
    admin
      .from('social_accounts')
      .select('id, backend_id, provider_id, external_id, name, username, credential_secret_id, status')
      .in('id', targetIds),
  ])
  if (attachmentResult.error)
    return json(
      { error: 'Could not load media for validation.', code: 'social_attachment_list_failed' },
      500,
    )
  if (accountResult.error)
    return json(
      { error: 'Could not load selected social accounts.', code: 'social_account_lookup_failed' },
      500,
    )
  const accounts = accountResult.data || []
  const targetErrors: Array<{
    accountId: string
    providerId?: string
    issues: Array<{ code: string; message: string }>
  }> = []
  if (accounts.length !== targetIds.length) {
    for (const accountId of targetIds.filter(
      (id) => !accounts.some((account) => account.id === id),
    ))
      targetErrors.push({
        accountId,
        issues: [{ code: 'account_unavailable', message: 'This social account is unavailable.' }],
      })
  }
  const media = []
  for (const attachment of attachmentResult.data || []) {
    const { data, error } = await admin.storage.from('social').download(attachment.object_path)
    if (error || !data)
      return json(
        {
          error: 'Could not read a private media file for validation.',
          code: 'social_media_read_failed',
        },
        500,
      )
    media.push({
      id: attachment.id,
      kind: attachment.kind,
      bytes: new Uint8Array(await data.arrayBuffer()),
      mimeType: attachment.mime_type,
      fileName: attachment.file_name,
      size: attachment.byte_size,
    })
  }
  for (const account of accounts) {
    if (account.status !== 'connected') {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'account_reconnect_required',
            message: 'Reconnect this account before scheduling.',
          },
        ],
      })
      continue
    }
    const backendId = account.backend_id || 'default'
    if (backendId !== 'default') {
      try {
        const client = (await managedBackend(backendId)).client
        const contentMedia = await Promise.all(media.map(async (item) => {
          const digest = await crypto.subtle.digest('SHA-256', item.bytes)
          const fingerprint = [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('')
          return {
            kind: item.kind,
            source: { kind: 'blob' as const, blob: new Blob([item.bytes], { type: item.mimeType }), fingerprint },
            mimeType: item.mimeType,
            filename: item.fileName,
            byteSize: item.size,
          }
        }))
        const request = {
          targets: [{
            account: connectedAccountRef({
              backend: backendId,
              platform: account.provider_id,
              accountId: account.external_id,
            }),
            options: targetOptions[account.id] || {},
          }],
          content: { text, ...(contentMedia.length ? { media: contentMedia } : {}) },
          ...(backendId === 'postfast'
            ? { schedule: { at: new Date(timestamp).toISOString(), timeZone: timezone } }
            : {}),
        }
        const validation = client.posts.prepare(request)
        if (!validation.ok) {
          targetErrors.push({
            accountId: account.id,
            providerId: account.provider_id,
            issues: validation.issues
              .filter((issue: { severity: string }) => issue.severity === 'error')
              .map((issue: { code: string; message: string }) => ({
                code: issue.code,
                message: issue.message,
              })),
          })
        }
      } catch (error) {
        console.error(
          'social schedule: managed SDK validation failed',
          backendId,
          error instanceof Error ? error.message : 'unknown error',
        )
        targetErrors.push({
          accountId: account.id,
          providerId: account.provider_id,
          issues: [{
            code: 'provider_validation_failed',
            message: 'Could not validate this post for the selected account.',
          }],
        })
      }
      continue
    }
    if (!SOCIAL_ADAPTERS.has(account.provider_id)) {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'provider_unsupported',
            message: 'This provider has no publishing adapter configured yet.',
          },
        ],
      })
      continue
    }
    const adapter = SOCIAL_ADAPTERS.get(account.provider_id)
    const { data: tokenJson, error: tokenError } = await admin.rpc('social_vault_read', {
      p_secret_id: account.credential_secret_id,
    })
    if (tokenError || typeof tokenJson !== 'string') {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'account_credential_unavailable',
            message: 'Reconnect this account before scheduling.',
          },
        ],
      })
      continue
    }
    let tokens: {
      accessToken?: string
      refreshToken?: string | null
      expiresAt?: string | null
      scopes?: string[]
    }
    try {
      tokens = JSON.parse(tokenJson)
    } catch {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'account_credential_invalid',
            message: 'Reconnect this account before scheduling.',
          },
        ],
      })
      continue
    }
    if (!tokens.accessToken) {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'account_credential_invalid',
            message: 'Reconnect this account before scheduling.',
          },
        ],
      })
      continue
    }
    let validation
    try {
      const socialAccount = {
        id: account.external_id,
        providerId: account.provider_id,
        name: account.name,
        username: account.username,
        avatarUrl: null,
      }
      const tokenSet = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        expiresAt: tokens.expiresAt || null,
        scopes: tokens.scopes || [],
      }
      const capabilities = await adapter.capabilities({
        account: socialAccount,
        tokens: tokenSet,
        credentials: {},
      })
      validation = await adapter.validatePost({
        account: socialAccount,
        tokens: tokenSet,
        text,
        attachments: media,
        capabilities,
        options: targetOptions[account.id],
      })
    } catch (error) {
      console.error(
        'social schedule: Social SDK validation failed',
        error instanceof Error ? error.message : 'unknown error',
      )
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: [
          {
            code: 'provider_validation_failed',
            message: 'Could not validate this post for the selected account.',
          },
        ],
      })
      continue
    }
    if (!validation.valid) {
      targetErrors.push({
        accountId: account.id,
        providerId: account.provider_id,
        issues: validation.issues.map((issue: { code: string; message: string }) => ({
          code: issue.code,
          message: issue.message,
        })),
      })
    }
  }
  if (targetErrors.length)
    return json(
      {
        error: 'One or more selected accounts cannot publish this post.',
        code: 'social_target_validation_failed',
        targetErrors,
      },
      422,
    )
  const { data: remoteSchedules, error: remoteScheduleError } = await admin
    .from('social_deliveries')
    .select('id, account_id, remote_job_id')
    .eq('post_id', postId)
    .eq('status', 'remote_scheduled')
  if (remoteScheduleError)
    return json(
      { error: 'Could not check remote scheduled deliveries.', code: 'remote_schedule_lookup_failed' },
      500,
    )
  const remoteCancellation = await cancelManagedDeliveries(remoteSchedules || [])
  if (!remoteCancellation.ok)
    return json(
      {
        error: 'A remotely scheduled post could not be safely cancelled before this schedule change.',
        code: remoteCancellation.code,
      },
      502,
    )
  const { data: deliveries, error: scheduleError } = await admin.rpc('social_schedule_post', {
    p_post_id: postId,
    p_body: text,
    p_timezone: timezone,
    p_account_ids: targetIds,
    p_scheduled_at: new Date(timestamp).toISOString(),
    p_expected_updated_at: post.updated_at,
    p_target_options: targetOptions,
    p_actor_id: userId,
    p_publish_now: publishNow,
  })
  if (scheduleError) {
    const conflict = /already started|uncertain|post changed/i.test(scheduleError.message)
    return json(
      {
        error: conflict
          ? 'The post changed during validation or a delivery has already started. Reload it and try again.'
          : 'Could not schedule this social post.',
        code: conflict ? 'post_locked' : 'social_schedule_failed',
      },
      conflict ? 409 : 500,
    )
  }
  return json({ deliveries: deliveries || [] })
}

async function invite(email: string, inviterId: string) {
  const { data: active, error: activeError } = await admin
    .from('social_publisher_grants')
    .select('id')
    .eq('email', email)
    .eq('status', 'active')
    .maybeSingle()
  if (activeError)
    return json(
      { error: 'Could not check publisher access.', code: 'social_grant_lookup_failed' },
      500,
    )
  if (active)
    return json(
      { error: 'This address already has publisher access.', code: 'social_publisher_exists' },
      409,
    )

  const { data: existing, error: lookupError } = await admin
    .from('social_publisher_grants')
    .select('id')
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle()
  if (lookupError)
    return json(
      { error: 'Could not check publisher access.', code: 'social_grant_lookup_failed' },
      500,
    )

  const expiresAt = new Date(Date.now() + GRANT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let grantId: string
  if (existing) {
    const { data, error } = await admin
      .from('social_publisher_grants')
      .update({
        invited_by: inviterId,
        invited_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq('id', existing.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (error)
      return json(
        { error: 'Could not prepare the publisher invitation.', code: 'social_grant_write_failed' },
        500,
      )
    if (!data)
      return json(
        {
          error: 'Publisher access changed; refresh and try again.',
          code: 'social_grant_conflict',
        },
        409,
      )
    grantId = data.id
  } else {
    const { data, error } = await admin
      .from('social_publisher_grants')
      .insert({
        email,
        invited_by: inviterId,
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (error)
      return json(
        { error: 'Could not prepare the publisher invitation.', code: 'social_grant_write_failed' },
        500,
      )
    grantId = data.id
  }

  const { error: mailError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl()}/admin/social?invitation=accepted`,
  })
  if (mailError) {
    const { error: expireError } = await admin
      .from('social_publisher_grants')
      .update({ status: 'expired' })
      .eq('id', grantId)
      .eq('status', 'pending')
    if (expireError) {
      console.error('social invite: could not expire undelivered grant', expireError.code)
      return json(
        {
          error: 'The invitation could not be sent and its grant could not be closed.',
          code: 'social_invite_cleanup_failed',
        },
        500,
      )
    }
    console.error('social invite: Auth invitation failed', mailError.code)
    return json(
      {
        error: 'Supabase Auth could not send this invitation.',
        code: 'social_invite_delivery_failed',
      },
      502,
    )
  }

  return json({ invitation: { id: grantId, email, status: 'pending', expires_at: expiresAt } }, 201)
}

async function accept(user: { id: string; email?: string; invited_at?: string | null }) {
  const email = user.email?.trim().toLowerCase()
  if (!email || !EMAIL.test(email) || !user.invited_at)
    return json(
      {
        error: 'Accept the Supabase invitation sent to this address.',
        code: 'social_invitation_not_accepted',
      },
      403,
    )

  const now = new Date().toISOString()
  const { data: grant, error } = await admin
    .from('social_publisher_grants')
    .update({ user_id: user.id, status: 'active', accepted_at: now })
    .eq('email', email)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .select('id, expires_at')
    .maybeSingle()
  if (error)
    return json(
      { error: 'Could not accept the publisher invitation.', code: 'social_grant_write_failed' },
      500,
    )
  if (!grant)
    return json(
      {
        error: 'This invitation is expired, revoked, or already used.',
        code: 'social_invitation_unavailable',
      },
      409,
    )
  return json({ invitation: { id: grant.id, status: 'active', expires_at: grant.expires_at } })
}

async function revoke(grantId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(grantId))
    return json(
      { error: 'A valid publisher grant id is required.', code: 'social_grant_id_invalid' },
      400,
    )
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('social_publisher_grants')
    .update({ status: 'revoked', revoked_at: now })
    .in('status', ['pending', 'active'])
    .eq('id', grantId)
    .select('id, email, status, revoked_at')
    .maybeSingle()
  if (error)
    return json(
      { error: 'Could not revoke publisher access.', code: 'social_grant_write_failed' },
      500,
    )
  if (!data)
    return json(
      { error: 'The publisher grant is no longer active.', code: 'social_grant_unavailable' },
      404,
    )
  return json({ publisher: data })
}

async function recoverDelivery(body: Record<string, unknown>, actorId: string) {
  const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : ''
  const resolution = body.resolution
  const providerPostId = typeof body.providerPostId === 'string' ? body.providerPostId.trim() : ''
  if (!UUID.test(deliveryId))
    return json({ error: 'A valid delivery id is required.', code: 'delivery_id_invalid' }, 400)
  if (resolution !== 'retry' && resolution !== 'marked_published')
    return json(
      { error: 'Choose a valid delivery recovery action.', code: 'delivery_resolution_invalid' },
      400,
    )
  if (resolution === 'marked_published' && (!providerPostId || providerPostId.length > 300))
    return json(
      {
        error: 'Enter the post id reported by the social platform.',
        code: 'provider_post_id_invalid',
      },
      400,
    )

  const { data, error } = await admin.rpc('social_recover_delivery', {
    p_delivery_id: deliveryId,
    p_resolution: resolution,
    p_provider_post_id: providerPostId || null,
    p_actor_id: actorId,
    p_confirmed_not_published: body.confirmedNotPublished === true,
  })
  if (error) {
    console.error('social delivery recovery failed', error.code)
    const conflict = error.code === 'P0001'
    return json(
      {
        error: conflict
          ? 'The delivery could not be recovered in its current state.'
          : 'Could not save the delivery recovery action.',
        code: conflict ? 'delivery_recovery_conflict' : 'delivery_recovery_failed',
      },
      conflict ? 409 : 500,
    )
  }
  if (data !== true)
    return json({ error: 'The delivery no longer exists.', code: 'delivery_not_found' }, 404)
  return json({ deliveryId, resolution })
}

async function listApprovalQueue(userId: string) {
  const { data: pending, error } = await admin.rpc('social_user_approval_queue', {
    p_user_id: userId,
  })
  if (error)
    return databaseFailure(error, 'social_approval_queue_failed', 'Could not load approvals.')
  if (!Array.isArray(pending) || pending.length === 0) return json({ deliveries: [] })

  const postIds = [...new Set(pending.map((delivery) => delivery.post_id))]
  const accountIds = [...new Set(pending.map((delivery) => delivery.account_id))]
  const [posts, accounts] = await Promise.all([
    admin
      .from('social_posts')
      .select('id, body, timezone, created_by, created_at, updated_at')
      .in('id', postIds),
    admin
      .from('social_accounts')
      .select('id, provider_id, name, username')
      .in('id', accountIds),
  ])
  if (posts.error)
    return databaseFailure(posts.error, 'social_approval_post_failed', 'Could not load approvals.')
  if (accounts.error)
    return databaseFailure(accounts.error, 'social_approval_account_failed', 'Could not load approvals.')

  const postsById = new Map((posts.data || []).map((post) => [post.id, post]))
  const accountsById = new Map((accounts.data || []).map((account) => [account.id, account]))
  return json({
    deliveries: pending.map((delivery) => ({
      ...delivery,
      post: postsById.get(delivery.post_id) || null,
      account: accountsById.get(delivery.account_id) || null,
    })),
  })
}

async function reviewDelivery(body: Record<string, unknown>, userId: string) {
  const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : ''
  const decision = body.decision
  if (!UUID.test(deliveryId) || (decision !== 'approve' && decision !== 'return'))
    return json({ error: 'Choose a valid approval action.', code: 'approval_request_invalid' }, 400)
  const authorization = await userCanDelivery(userId, deliveryId, 'approve_posts')
  const permissionFailure = permissionCheckFailure(authorization.error, 'approve posts')
  if (permissionFailure) return permissionFailure
  if (!authorization.accountId)
    return json({ error: 'You cannot review this social delivery.', code: 'social_permission_required' }, 403)

  const { data, error } = await admin.rpc('social_review_delivery', {
    p_delivery_id: deliveryId,
    p_actor_id: userId,
    p_decision: decision,
  })
  if (error) {
    const conflict = error.code === 'P0001'
    console.error('social delivery approval failed', error.code)
    return json(
      {
        error:
          /not awaiting approval|approval requirement/i.test(error.message)
            ? 'This delivery is no longer awaiting approval.'
            : 'Could not save the approval decision.',
        code:
          /not awaiting approval|approval requirement/i.test(error.message)
            ? 'approval_state_conflict'
            : conflict
              ? 'approval_conflict'
              : 'approval_failed',
      },
      conflict ? 409 : 500,
    )
  }
  return json({ delivery: data })
}

async function setAccountApproval(body: Record<string, unknown>, userId: string) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  if (!UUID.test(accountId) || typeof body.required !== 'boolean')
    return json({ error: 'Choose a social account and approval setting.', code: 'approval_setting_invalid' }, 400)
  const authorization = await userCanManageAccounts(userId)
  const permissionFailure = permissionCheckFailure(authorization.error, 'manage accounts')
  if (permissionFailure) return permissionFailure
  if (!authorization.allowed)
    return json({ error: 'Manage accounts permission is required.', code: 'social_permission_required' }, 403)
  const { data, error } = await admin.rpc('social_set_account_approval', {
    p_account_id: accountId,
    p_actor_id: userId,
    p_required: body.required,
  })
  if (error)
    return databaseFailure(error, 'social_approval_setting_failed', 'Could not update approval settings.')
  return json({ account: data })
}

async function automationPermissionFailure(userId: string, accountId: string, publish: boolean) {
  const view = await userCanAccount(userId, accountId, 'view_results')
  const viewFailure = permissionCheckFailure(view.error, 'view results')
  if (viewFailure) return viewFailure
  if (!view.allowed)
    return json({ error: 'View results permission is required for this account.', code: 'social_permission_required' }, 403)
  if (!publish) return null
  const publishAccess = await userCanAccount(userId, accountId, 'publish_now')
  const publishFailure = permissionCheckFailure(publishAccess.error, 'publish now')
  if (publishFailure) return publishFailure
  if (!publishAccess.allowed)
    return json({ error: 'Publish now permission is required for this account.', code: 'social_permission_required' }, 403)
  return null
}

async function listAutomations(body: Record<string, unknown>, userId: string) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  if (!UUID.test(accountId))
    return json({ error: 'Choose a social account.', code: 'social_account_invalid' }, 400)
  const denied = await automationPermissionFailure(userId, accountId, false)
  if (denied) return denied
  const [automationResult, eventResult, responseResult, botResult] = await Promise.all([
    admin.from('social_automations').select(
      'id, account_id, event_kind, keyword, bot_slug, destinations, mode, enabled, authorized_by, authorized_at, created_at, updated_at',
    ).eq('account_id', accountId).order('created_at', { ascending: false }).limit(100),
    admin.from('social_inbound_events').select(
      'id, account_id, event_kind, provider_author_id, item_id, post_id, comment_id, conversation_id, body, context, status, received_at',
    ).eq('account_id', accountId).order('received_at', { ascending: false }).limit(50),
    admin.from('social_automation_responses').select(
      'id, account_id, automation_id, event_id, destination, mode, status, body, provider_response_id, attempts, reviewed_by, sent_by, last_error, created_at, updated_at, sent_at',
    ).eq('account_id', accountId).order('created_at', { ascending: false }).limit(100),
    admin.from('bots').select('slug, name, published, surfaces, serves')
      .eq('published', true).contains('surfaces', ['social']).order('name'),
  ])
  if (automationResult.error)
    return databaseFailure(automationResult.error, 'social_automation_list_failed', 'Could not load Social automations.')
  if (eventResult.error)
    return databaseFailure(eventResult.error, 'social_automation_events_failed', 'Could not load Social conversation history.')
  if (responseResult.error)
    return databaseFailure(responseResult.error, 'social_automation_responses_failed', 'Could not load Social response history.')
  if (botResult.error)
    return databaseFailure(botResult.error, 'social_automation_bots_failed', 'Could not load Social bot choices.')
  return json({
    automations: automationResult.data || [],
    events: eventResult.data || [],
    responses: responseResult.data || [],
    bots: (botResult.data || []).filter((bot) => Array.isArray(bot.serves) && bot.serves.length === 0)
      .map(({ slug, name }) => ({ slug, name })),
  })
}

async function automationOptions(body: Record<string, unknown>, userId: string) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  if (!UUID.test(accountId))
    return json({ error: 'Choose a social account.', code: 'social_account_invalid' }, 400)
  const denied = await automationPermissionFailure(userId, accountId, false)
  if (denied) return denied
  const { data, error } = await admin.functions.invoke('social-automation', {
    body: { action: 'automation_options', accountId },
  })
  if (error) {
    console.error('social automation options failed', error.message)
    return json({ error: 'Could not verify this account’s automation capabilities.', code: 'social_automation_options_failed' }, 502)
  }
  return json(data || { routes: [], unavailable: 'The account route could not be verified.' })
}

async function saveAutomation(body: Record<string, unknown>, userId: string) {
  const id = typeof body.id === 'string' ? body.id : ''
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  const eventKind = body.eventKind
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : ''
  const botSlug = typeof body.botSlug === 'string' ? body.botSlug.trim() : ''
  const mode = body.mode === undefined ? 'draft' : body.mode
  const enabled = body.enabled === undefined ? true : body.enabled
  const suppliedDestinations = Array.isArray(body.destinations) ? body.destinations : []
  const destinations = ['public_reply', 'private_dm'].filter((destination) =>
    suppliedDestinations.includes(destination),
  )
  if (
    (id && !UUID.test(id)) ||
    !UUID.test(accountId) ||
    !['comment', 'dm'].includes(eventKind as string) ||
    !keyword ||
    keyword.length > 100 ||
    !botSlug ||
    botSlug.length > 100 ||
    !['draft', 'automatic'].includes(mode as string) ||
    typeof enabled !== 'boolean' ||
    !destinations.length ||
    destinations.length !== suppliedDestinations.length ||
    (eventKind === 'dm' && (destinations.length !== 1 || destinations[0] !== 'private_dm'))
  )
    return json({ error: 'Complete the automation rule with supported event, keyword, bot, destinations and mode.', code: 'social_automation_invalid' }, 400)

  const denied = await automationPermissionFailure(userId, accountId, true)
  if (denied) return denied
  if (id) {
    const { data: existing, error } = await admin.from('social_automations')
      .select('account_id').eq('id', id).maybeSingle()
    if (error)
      return databaseFailure(error, 'social_automation_lookup_failed', 'Could not load the Social automation.')
    if (!existing || existing.account_id !== accountId)
      return json({ error: 'The Social automation is unavailable for this account.', code: 'social_automation_not_found' }, 404)
  }

  if (enabled) {
    const { data: validation, error: validationError } = await admin.functions.invoke('social-automation', {
      body: { action: 'validate_rule', accountId, eventKind, botSlug, destinations },
    })
    if (validationError) {
      console.error('social automation validation failed', validationError.message)
      return json({ error: 'Could not verify the selected provider route and bot.', code: 'social_automation_validation_failed' }, 502)
    }
    if (!validation?.valid)
      return json({ error: validation?.error || 'The selected provider route and bot are not available.', code: 'social_automation_route_unavailable' }, 422)
  }

  const values = {
    account_id: accountId,
    event_kind: eventKind,
    keyword,
    bot_slug: botSlug,
    destinations,
    mode,
    enabled,
    authorized_by: userId,
    authorized_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const query = id
    ? admin.from('social_automations').update(values).eq('id', id)
    : admin.from('social_automations').insert(values)
  const { data, error } = await query.select(
    'id, account_id, event_kind, keyword, bot_slug, destinations, mode, enabled, authorized_by, authorized_at, created_at, updated_at',
  ).single()
  if (error)
    return databaseFailure(error, 'social_automation_save_failed', 'Could not save the Social automation.')
  return json({ automation: data })
}

async function reviewAutomationResponse(body: Record<string, unknown>, userId: string) {
  const responseId = typeof body.responseId === 'string' ? body.responseId : ''
  const decision = body.decision
  if (!UUID.test(responseId) || !['send', 'discard'].includes(decision as string))
    return json({ error: 'Choose a Social response and a review action.', code: 'social_response_review_invalid' }, 400)
  const [view, publish] = await Promise.all([
    userCanDelivery(userId, responseId, 'view_results'),
    userCanDelivery(userId, responseId, 'publish_now'),
  ])
  const viewFailure = permissionCheckFailure(view.error, 'view results')
  if (viewFailure) return viewFailure
  const publishFailure = permissionCheckFailure(publish.error, 'publish now')
  if (publishFailure) return publishFailure
  if (!view.accountId || publish.accountId !== view.accountId)
    return json({ error: 'You cannot review this Social response.', code: 'social_permission_required' }, 403)

  if (decision === 'discard') {
    const { data, error } = await admin.from('social_automation_responses')
      .update({ status: 'discarded', reviewed_by: userId, updated_at: new Date().toISOString() })
      .eq('id', responseId).eq('account_id', view.accountId).eq('mode', 'draft').eq('status', 'draft')
      .select('id, status').maybeSingle()
    if (error)
      return databaseFailure(error, 'social_response_discard_failed', 'Could not discard the Social response.')
    if (!data)
      return json({ error: 'This Social response is no longer awaiting review.', code: 'social_response_unavailable' }, 409)
    return json({ response: data })
  }

  if (body.text !== undefined) {
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text || text.length > 10000)
      return json({ error: 'A response must contain between 1 and 10000 characters.', code: 'social_response_text_invalid' }, 400)
    const { data, error } = await admin.from('social_automation_responses')
      .update({ body: text, updated_at: new Date().toISOString() })
      .eq('id', responseId).eq('account_id', view.accountId).eq('mode', 'draft').eq('status', 'draft')
      .select('id').maybeSingle()
    if (error)
      return databaseFailure(error, 'social_response_edit_failed', 'Could not update the Social response.')
    if (!data)
      return json({ error: 'This Social response is no longer awaiting review.', code: 'social_response_unavailable' }, 409)
  }
  const { data, error } = await admin.functions.invoke('social-automation', {
    body: { action: 'deliver_response', responseId, actorId: userId },
  })
  if (error) {
    console.error('social response send request failed', error.message)
    return json({ error: 'Could not complete the reviewed Social response.', code: 'social_response_send_failed' }, 502)
  }
  return json({ response: data })
}

Deno.serve(async (req) => {
  const options = preflight(req)
  if (options) return options
  if (req.method !== 'POST')
    return json({ error: 'POST is required.', code: 'method_not_allowed' }, 405)

  const user = await getUser(req)
  if (!user)
    return json({ error: 'Sign in to use social publishing.', code: 'unauthenticated' }, 401)
  let body: Record<string, unknown>
  try {
    if (req.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
      const form = await req.formData()
      body = {
        action: form.get('action'),
        postId: form.get('postId'),
        attachmentId: form.get('attachmentId'),
        file: form.get('file'),
      }
    } else {
      const parsed = await req.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError()
      body = parsed as Record<string, unknown>
    }
  } catch {
    return json(
      { error: 'A valid JSON or multipart request body is required.', code: 'invalid_request' },
      400,
    )
  }

  if (
    body.action === 'desk_accounts' ||
    body.action === 'desk_posts' ||
    body.action === 'desk_capabilities' ||
    body.action === 'desk_operation'
  ) {
    if (body.action === 'desk_accounts') return listDeskAccounts(user.id)
    if (body.action === 'desk_posts') return listDeskPosts(user.id)

    const staff = await spacesStaff(user.id)
    if (staff.error)
      return databaseFailure(staff.error, 'desk_staff_lookup_failed', 'Could not check Spaces staff access.')
    if (!staff.allowed)
      return json({ error: 'Spaces staff access is required.', code: 'desk_staff_required' }, 403)
    const social = await hasSocialAccess(user.id)
    if (social.error)
      return databaseFailure(social.error, 'social_access_lookup_failed', 'Could not check social publisher access.')
    if (!social.allowed)
      return json({ error: 'You do not have social publisher access.', code: 'social_access_required' }, 403)
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    const readFailure = await deskAccountReadFailure(user.id, accountId)
    if (readFailure) return readFailure
    if (body.action === 'desk_capabilities')
      return accountOperation({ ...body, action: 'account_capabilities' }, user.id, true)
    const operation = typeof body.operation === 'string' ? body.operation : ''
    if (!['comments.read', 'comments.write', 'messages.read', 'messages.write', 'profiles.read'].includes(operation))
      return json({ error: 'This operation is not available in the Spaces Desk.', code: 'operation_unsupported' }, 422)
    return accountOperation({ ...body, action: 'account_operation' }, user.id)
  }

  if (body.action === 'accept_invitation') return accept(user)
  if (
    body.action === 'invite' ||
    body.action === 'revoke' ||
    body.action === 'save_permissions' ||
    body.action === 'save_provider' ||
    body.action === 'save_backend' ||
    body.action === 'publishers'
  ) {
    const check = await isAdmin(user.id)
    if (check.error)
      return json(
        { error: 'Could not check administrator access.', code: 'social_access_lookup_failed' },
        500,
      )
    if (!check.allowed)
      return json(
        { error: 'Only an administrator may manage publisher access.', code: 'admin_required' },
        403,
      )
    if (body.action === 'publishers') return listPublishers()
    if (body.action === 'save_permissions') return savePublisherPermissions(body, user.id)
    if (body.action === 'invite') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (email.length > 254 || !EMAIL.test(email))
        return json({ error: 'Enter a valid email address.', code: 'email_invalid' }, 400)
      return invite(email, user.id)
    }
    if (body.action === 'revoke')
      return revoke(typeof body.grantId === 'string' ? body.grantId : '')
    if (body.action === 'save_backend')
      return saveBackend(
        user.id,
        typeof body.backendId === 'string' ? body.backendId : '',
        typeof body.apiKey === 'string' ? body.apiKey : '',
        typeof body.webhookSecret === 'string' ? body.webhookSecret : '',
      )
    const providerId = typeof body.providerId === 'string' ? body.providerId : 'x'
    const adapter = SOCIAL_ADAPTERS.has(providerId) ? SOCIAL_ADAPTERS.get(providerId) : null
    const scopes: string[] =
      Array.isArray(body.scopes) && body.scopes.every((scope) => typeof scope === 'string')
        ? (body.scopes as string[])
        : adapter?.defaultScopes || []
    return saveProvider(
      user.id,
      providerId,
      typeof body.clientId === 'string' ? body.clientId.trim() : '',
      typeof body.clientSecret === 'string' ? body.clientSecret : '',
      [...new Set(scopes)],
    )
  }
  if (
    body.action === 'providers' ||
    body.action === 'accounts' ||
    body.action === 'managed_connect' ||
    body.action === 'managed_profiles' ||
    body.action === 'disconnect' ||
    body.action === 'drafts' ||
    body.action === 'save_draft' ||
    body.action === 'upload_attachment' ||
    body.action === 'replace_attachment' ||
    body.action === 'remove_attachment' ||
    body.action === 'order_attachments' ||
    body.action === 'schedule' ||
    body.action === 'cancel_schedule' ||
    body.action === 'recover_delivery' ||
    body.action === 'automation_list' ||
    body.action === 'automation_options' ||
    body.action === 'automation_save' ||
    body.action === 'automation_response' ||
    body.action === 'account_operation' ||
    body.action === 'account_capabilities' ||
    body.action === 'approval_queue' ||
    body.action === 'review_delivery' ||
    body.action === 'set_approval'
  ) {
    const check = await hasSocialAccess(user.id)
    if (check.error)
      return json(
        { error: 'Could not check social publisher access.', code: 'social_access_lookup_failed' },
        500,
      )
    if (!check.allowed)
      return json(
        { error: 'You do not have social publisher access.', code: 'social_access_required' },
        403,
      )
    if (body.action === 'providers') return listProviders()
    if (body.action === 'accounts') return listAccounts(user.id)
    if (body.action === 'automation_list') return listAutomations(body, user.id)
    if (body.action === 'automation_options') return automationOptions(body, user.id)
    if (body.action === 'automation_save') return saveAutomation(body, user.id)
    if (body.action === 'automation_response') return reviewAutomationResponse(body, user.id)
    if (
      body.action === 'managed_connect' ||
      body.action === 'managed_profiles' ||
      body.action === 'disconnect'
    ) {
      const management = await userCanManageAccounts(user.id)
      const failure = permissionCheckFailure(management.error, 'manage accounts')
      if (failure) return failure
      if (!management.allowed)
        return json(
          { error: 'Manage accounts permission is required.', code: 'social_permission_required' },
          403,
        )
    }
    if (body.action === 'managed_connect') return startManagedConnection(body, user.id)
    if (body.action === 'managed_profiles')
      return listManagedProfiles(typeof body.backendId === 'string' ? body.backendId : '')
    if (body.action === 'account_operation') return accountOperation(body, user.id)
    if (body.action === 'account_capabilities') return accountOperation(body, user.id, true)
    if (body.action === 'disconnect')
      return disconnect(typeof body.accountId === 'string' ? body.accountId : '')
    if (body.action === 'drafts') return listDrafts(user.id)
    if (body.action === 'save_draft') return saveDraft(body, user.id)
    if (body.action === 'upload_attachment' || body.action === 'replace_attachment') {
      if (!(body.file instanceof File))
        return json(
          { error: 'Choose an image or video file.', code: 'attachment_file_required' },
          400,
        )
      return uploadAttachment(
        typeof body.postId === 'string' ? body.postId : '',
        body.file,
        user.id,
        body.action === 'replace_attachment' && typeof body.attachmentId === 'string'
          ? body.attachmentId
          : undefined,
      )
    }
    if (body.action === 'remove_attachment')
      return deleteAttachment(
        typeof body.attachmentId === 'string' ? body.attachmentId : '',
        user.id,
      )
    if (body.action === 'order_attachments')
      return orderAttachments(
        typeof body.postId === 'string' ? body.postId : '',
        Array.isArray(body.attachmentIds) &&
          body.attachmentIds.every((id) => typeof id === 'string')
          ? (body.attachmentIds as string[])
          : [],
        user.id,
      )
    if (body.action === 'schedule') return schedulePost(body, user.id)
    if (body.action === 'recover_delivery') {
      const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId : ''
      const recoveryAccess = await userCanDelivery(user.id, deliveryId, 'publish_now')
      const failure = permissionCheckFailure(recoveryAccess.error, 'publish now')
      if (failure) return failure
      if (!recoveryAccess.accountId)
        return json(
          { error: 'You cannot recover this social delivery.', code: 'social_permission_required' },
          403,
        )
      return recoverDelivery(body, user.id)
    }
    if (body.action === 'approval_queue') return listApprovalQueue(user.id)
    if (body.action === 'review_delivery') return reviewDelivery(body, user.id)
    if (body.action === 'set_approval') return setAccountApproval(body, user.id)
    const postId = typeof body.postId === 'string' ? body.postId : ''
    if (!UUID.test(postId))
      return json({ error: 'A valid post id is required.', code: 'post_id_invalid' }, 400)
    const cancellationAccess = await userCanManagePost(user.id, postId, 'schedule_posts')
    const cancellationFailure = permissionCheckFailure(cancellationAccess.error, 'schedule posts')
    if (cancellationFailure) return cancellationFailure
    if (!cancellationAccess.allowed)
      return json(
        { error: 'You cannot cancel this social schedule.', code: 'social_permission_required' },
        403,
      )
    const { data: remoteSchedules, error: remoteScheduleError } = await admin
      .from('social_deliveries')
      .select('id, account_id, remote_job_id')
      .eq('post_id', postId)
      .eq('status', 'remote_scheduled')
    if (remoteScheduleError)
      return json(
        { error: 'Could not check remote scheduled deliveries.', code: 'remote_schedule_lookup_failed' },
        500,
      )
    const remoteCancellation = await cancelManagedDeliveries(remoteSchedules || [])
    if (!remoteCancellation.ok)
      return json(
        {
          error: 'A remotely scheduled post could not be safely cancelled.',
          code: remoteCancellation.code,
        },
        502,
      )
    const { data, error } = await admin
      .from('social_deliveries')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        lease_token: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('post_id', postId)
      .in('status', ['scheduled', 'retry_wait', 'blocked', 'failed'])
      .select('id')
    if (error)
      return json(
        { error: 'Could not cancel the scheduled social post.', code: 'social_cancel_failed' },
        500,
      )
    if (!data?.length) {
      const { data: active, error: activeError } = await admin
        .from('social_deliveries')
        .select('id, status')
        .eq('post_id', postId)
        .limit(1)
      if (activeError)
        return json(
          {
            error: 'Could not check the social delivery state.',
            code: 'social_delivery_lookup_failed',
          },
          500,
        )
      if (
        active?.some((delivery) =>
          ['claimed', 'publishing', 'published', 'review_required'].includes(delivery.status),
        )
      )
        return json(
          {
            error: 'A delivery has started or needs recovery and cannot be cancelled here.',
            code: 'social_cancel_locked',
          },
          409,
        )
    }
    return json({ cancelled: data?.length || 0 })
  }
  return json({ error: 'Unknown social-publishing action.', code: 'action_invalid' }, 400)
})
