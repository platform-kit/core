import { createClient } from 'npm:@supabase/supabase-js@2'
import { SOCIAL_ADAPTERS } from '../_shared/social/registry.ts'
import { resolveSocialOutcome } from '../_shared/social/outcome.mjs'
import {
  hasSocialCapability,
  normalizePostMetrics,
} from '../_shared/social/metrics.mjs'
import {
  connectedAccountRef,
  createManagedSocial,
  hasManagedBackend,
  managedOperationContext,
} from '../_shared/social/managed-sdk.mjs'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_ATTEMPTS = 5
const MAX_RETRY_MS = 6 * 60 * 60 * 1000
const REFRESH_MARGIN_MS = 2 * 60 * 1000

type Delivery = {
  id: string
  post_id: string
  account_id: string
  lease_token: string
  scheduled_at: string
  attempt_count: number
  target_options?: Record<string, unknown>
  remote_job_id?: string | null
  remote_delivery_id?: string | null
}

type Tokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}

type DeliveryResult = {
  status: 'published' | 'remote_scheduled' | 'retry_wait' | 'failed' | 'blocked' | 'review_required'
  providerPostId?: string
  errorCode?: string
  error?: string
  nextAttemptAt?: string
}

type MetricsDelivery = {
  id: string
  post_id: string
  account_id: string
  provider_post_id: string
  published_at: string
  metrics_lease_token: string
}

type KnownFailureResult = {
  status: 'retry_wait' | 'failed' | 'blocked'
  errorCode?: string
  error?: string
  nextAttemptAt?: string
}

const safeCode = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : 'provider_error'

const safeMessage = (value: unknown) =>
  (typeof value === 'string' && value.trim() ? value.trim() : 'The provider did not confirm this delivery.')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const preflight = (req: Request) =>
  req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null

async function isServiceBearer(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  if (token === serviceRoleKey) return true
  try {
    const probe = createClient(supabaseUrl, token, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 })
    return !error
  } catch {
    return false
  }
}

async function readSecret(secretId: string) {
  const { data, error } = await admin.rpc('social_vault_read', { p_secret_id: secretId })
  if (error) throw new Error(`Could not read social credentials (${error.code || 'vault_error'}).`)
  if (typeof data !== 'string' || !data) throw new Error('Social credentials are unavailable.')
  return data
}

async function saveSecret(value: string, name: string) {
  const { data, error } = await admin.rpc('social_vault_put', {
    p_secret: value,
    p_name: name,
    p_description: 'Rotated social publishing OAuth credential',
  })
  if (error || typeof data !== 'string') throw new Error(`Could not save refreshed social credentials (${error?.code || 'vault_error'}).`)
  return data
}

async function refreshCredentials(account: Record<string, any>, adapter: ReturnType<typeof SOCIAL_ADAPTERS.get>, tokens: Tokens): Promise<Tokens> {
  const expiry = tokens.expiresAt ? Date.parse(tokens.expiresAt) : NaN
  if (Number.isFinite(expiry) && expiry > Date.now() + REFRESH_MARGIN_MS) return tokens
  if (!tokens.refreshToken) throw Object.assign(new Error('Reconnect this account before it can publish.'), { code: 'account_reconnect_required' })

  const { data: config, error: configError } = await admin.from('social_provider_configs')
    .select('client_id, client_secret_id, enabled').eq('provider_id', account.provider_id).maybeSingle()
  if (configError) throw new Error(`Could not load provider configuration (${configError.code}).`)
  if (!config?.enabled) throw Object.assign(new Error('This social provider is disabled.'), { code: 'provider_disabled' })

  const clientSecret = config.client_secret_id ? await readSecret(config.client_secret_id) : ''
  let refreshed: Tokens
  try {
    const credentials = { clientId: config.client_id, clientSecret }
    refreshed = adapter.connection
      ? await adapter.connection.refresh({ tokens, credentials })
      : await adapter.refreshToken({ tokens, credentials })
  } catch (error) {
    await admin.from('social_accounts').update({
      status: 'reconnect_required',
      updated_at: new Date().toISOString(),
    }).eq('id', account.id).eq('credential_secret_id', account.credential_secret_id)
    throw Object.assign(new Error('Reconnect this account before it can publish.'), {
      code: 'account_reconnect_required',
      cause: error,
    })
  }

  const nextSecretId = await saveSecret(JSON.stringify(refreshed), `social-${account.provider_id}-${account.external_id}-${crypto.randomUUID()}`)
  const { data: updated, error: updateError } = await admin.from('social_accounts')
    .update({ credential_secret_id: nextSecretId, status: 'connected', updated_at: new Date().toISOString() })
    .eq('id', account.id).eq('credential_secret_id', account.credential_secret_id).neq('status', 'disconnected')
    .select('id').maybeSingle()
  if (updateError || !updated) {
    const { error: cleanupError } = await admin.rpc('social_vault_delete', { p_secret_id: nextSecretId })
    if (cleanupError) console.error('social publish: uncommitted credential cleanup failed', cleanupError.code)
    throw new Error(`Could not persist refreshed social credentials (${updateError?.code || 'account_changed'}).`)
  }
  const { error: cleanupError } = await admin.rpc('social_vault_delete', { p_secret_id: account.credential_secret_id })
  if (cleanupError) console.error('social publish: previous credential cleanup failed', cleanupError.code)
  account.credential_secret_id = nextSecretId
  return refreshed
}

async function finish(delivery: Delivery, attemptNumber: number, result: DeliveryResult) {
  const { data, error } = await admin.rpc('social_finish_delivery', {
    p_delivery_id: delivery.id,
    p_lease_token: delivery.lease_token,
    p_attempt_number: attemptNumber,
    p_status: result.status,
    p_provider_post_id: result.providerPostId || null,
    p_error_code: result.errorCode || null,
    p_error: result.error ? safeMessage(result.error) : null,
    p_next_attempt_at: result.nextAttemptAt || null,
  })
  if (error) throw new Error(`Could not record social delivery result (${error.code || 'database_error'}).`)
  if (data !== true) throw new Error('The social delivery lease expired before its result could be recorded.')
}

async function finishManaged(
  delivery: Delivery,
  attemptNumber: number,
  result: DeliveryResult,
  remoteJobId?: string,
  remoteDeliveryId?: string,
) {
  const { data, error } = await admin.rpc('social_finish_managed_delivery', {
    p_delivery_id: delivery.id,
    p_lease_token: delivery.lease_token,
    p_attempt_number: attemptNumber,
    p_status: result.status,
    p_remote_job_id: remoteJobId || null,
    p_remote_delivery_id: remoteDeliveryId || null,
    p_provider_post_id: result.providerPostId || null,
    p_error_code: result.errorCode || null,
    p_error: result.error ? safeMessage(result.error) : null,
    p_next_attempt_at: result.nextAttemptAt || null,
  })
  if (error) throw new Error(`Could not record managed social delivery result (${error.code || 'database_error'}).`)
  if (data !== true) throw new Error('The managed social delivery lease expired before its result could be recorded.')
}

async function managedClient(backendId: string) {
  if (!hasManagedBackend(backendId))
    throw Object.assign(new Error('This managed backend is not available.'), { code: 'backend_unavailable' })
  const { data: config, error: configError } = await admin
    .from('social_backend_configs')
    .select('credential_secret_id, enabled')
    .eq('backend_id', backendId)
    .maybeSingle()
  if (configError) throw new Error(`Could not load managed backend configuration (${configError.code}).`)
  if (!config?.enabled)
    throw Object.assign(new Error('This managed backend is disabled.'), { code: 'backend_disabled' })
  const { data: apiKey, error: keyError } = await admin.rpc('social_vault_read', {
    p_secret_id: config.credential_secret_id,
  })
  if (keyError || typeof apiKey !== 'string' || !apiKey)
    throw new Error(`Could not load managed backend credentials (${keyError?.code || 'credential_unavailable'}).`)
  return createManagedSocial(backendId, apiKey)
}

function managedMedia(items: Awaited<ReturnType<typeof getPayload>>['media']) {
  return Promise.all(items.map(async (item) => {
    if (item.kind !== 'image' && item.kind !== 'video')
      throw new Error('Managed social publishing received an unsupported media kind.')
    const digest = await crypto.subtle.digest('SHA-256', item.bytes)
    const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return {
      kind: item.kind,
      source: { kind: 'blob' as const, blob: new Blob([item.bytes], { type: item.mimeType }), fingerprint },
      mimeType: item.mimeType,
      filename: item.fileName,
      byteSize: item.size,
    }
  }))
}

function managedFailure(outcome: Record<string, any>, attempt: number): DeliveryResult {
  if (outcome.state === 'failed') {
    const disposition = outcome.retryDisposition || {}
    return resultForFailure(attempt, {
      code: outcome.code,
      message: outcome.message,
      disposition,
    })
  }
  return {
    status: 'review_required',
    errorCode: outcome.state === 'unknown' ? 'provider_outcome_uncertain' : 'managed_delivery_unexpected',
    error: 'The managed provider did not confirm whether this post was published.',
  }
}

async function deliverManaged(
  delivery: Delivery,
  account: Record<string, any>,
  attemptNumber: number,
  client: Awaited<ReturnType<typeof managedClient>>,
): Promise<void> {
  const { data: post, error: postError } = await admin
    .from('social_posts')
    .select('id, body, timezone')
    .eq('id', delivery.post_id)
    .maybeSingle()
  if (postError) throw new Error(`Could not load social post (${postError.code}).`)
  if (!post) {
    await finishManaged(delivery, attemptNumber, { status: 'failed', errorCode: 'post_missing', error: 'The scheduled post no longer exists.' })
    return
  }
  const backendId = account.backend_id || 'default'
  if (backendId !== 'default') {
    let client: Awaited<ReturnType<typeof managedClient>>
    try {
      client = await managedClient(backendId)
    } catch (error) {
      const code = safeCode((error as { code?: unknown })?.code)
      await finishClaimed(delivery, 'blocked', code, safeMessage(error instanceof Error ? error.message : ''))
      return
    }
    const { data: attemptNumber, error: startError } = await admin.rpc('social_start_delivery', {
      p_delivery_id: delivery.id,
      p_lease_token: delivery.lease_token,
    })
    if (startError) throw new Error(`Could not start managed social delivery (${startError.code}).`)
    if (typeof attemptNumber === 'number') await deliverManaged(delivery, account, attemptNumber, client)
    return
  }
  const target = {
    account: connectedAccountRef({
      backend: account.backend_id,
      platform: account.provider_id,
      accountId: account.external_id,
    }),
    options: delivery.target_options || {},
  }

  if (delivery.remote_job_id && delivery.remote_delivery_id) {
    const reference = {
      kind: 'delivery',
      version: 1,
      backend: account.backend_id,
      platform: account.provider_id,
      accountId: account.external_id,
      deliveryId: delivery.remote_delivery_id,
    } as const
    try {
      const outcome = await client.posts.getDelivery(reference, managedOperationContext(account.backend_id))
      if (outcome.state === 'published' && outcome.post?.postId) {
        await finishManaged(delivery, attemptNumber, { status: 'published', providerPostId: outcome.post.postId })
      } else if (outcome.state === 'failed') {
        await finishManaged(delivery, attemptNumber, managedFailure(outcome, attemptNumber))
      } else if (outcome.state === 'cancelled') {
        await finishManaged(delivery, attemptNumber, {
          status: 'failed',
          errorCode: 'remote_schedule_cancelled',
          error: 'The managed provider cancelled this scheduled post.',
        })
      } else if (outcome.state === 'scheduled' || outcome.state === 'accepted' || outcome.state === 'processing') {
        await finishManaged(delivery, attemptNumber, {
          status: 'remote_scheduled',
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        }, delivery.remote_job_id, delivery.remote_delivery_id)
      } else {
        await finishManaged(delivery, attemptNumber, {
          status: 'review_required',
          errorCode: 'provider_outcome_uncertain',
          error: 'The managed provider could not confirm this scheduled post.',
        }, delivery.remote_job_id, delivery.remote_delivery_id)
      }
    } catch (error) {
      console.error('social publish: managed delivery reconciliation failed', account.backend_id, error instanceof Error ? error.message : 'unknown error')
      await finishManaged(delivery, attemptNumber, {
        status: 'review_required',
        errorCode: 'provider_reconciliation_failed',
        error: 'The managed provider outcome could not be checked.',
      }, delivery.remote_job_id, delivery.remote_delivery_id)
    }
    return
  }

  const { media } = await getPayload(delivery)
  const contentMedia = await managedMedia(media)
  const capabilities = client.capabilities()
  const manifest = Object.values(capabilities).find((item: any) =>
    Array.isArray(item?.capabilities) &&
    item.capabilities.some((capability: any) =>
      capability?.platform === account.provider_id &&
      capability?.operation === 'posts.publish' &&
      capability?.availability === 'available',
    ),
  )
  if (!manifest) {
    await finishManaged(delivery, attemptNumber, {
      status: 'blocked',
      errorCode: 'backend_platform_unsupported',
      error: 'This managed backend no longer supports publishing to this account.',
    })
    return
  }
  if (
    account.backend_id === 'postfast' &&
    Date.parse(delivery.scheduled_at) <= Date.now()
  ) {
    await finishManaged(delivery, attemptNumber, {
      status: 'failed',
      errorCode: 'remote_schedule_missed',
      error: 'PostFast must receive this post before its scheduled time.',
    })
    return
  }
  const request = {
    targets: [target],
    content: { text: post.body, ...(contentMedia.length ? { media: contentMedia } : {}) },
    idempotencyKey: delivery.id,
    correlationId: delivery.id,
    ...(account.backend_id === 'postfast'
      ? { schedule: { at: delivery.scheduled_at, timeZone: post.timezone } }
      : {}),
  }
  const preparation = client.posts.prepare(request)
  if (!preparation.ok) {
    await finishManaged(delivery, attemptNumber, {
      status: 'failed',
      errorCode: 'provider_validation_failed',
      error: preparation.issues.map((issue: { code: string; message: string }) =>
        `${safeCode(issue.code)}: ${safeMessage(issue.message)}`,
      ).join('; '),
    })
    return
  }
  try {
    const result = await client.posts.publish(request, managedOperationContext(account.backend_id))
    const outcome = result.outcomes[0]
    if (!outcome) {
      await finishManaged(delivery, attemptNumber, {
        status: 'review_required',
        errorCode: 'provider_outcome_uncertain',
        error: 'The managed provider returned no delivery outcome.',
      })
    } else if (outcome.state === 'scheduled' && outcome.job && outcome.delivery) {
      await finishManaged(delivery, attemptNumber, {
        status: 'remote_scheduled',
        nextAttemptAt: delivery.scheduled_at,
      }, outcome.job.jobId, outcome.delivery.deliveryId)
    } else if (outcome.state === 'published' && outcome.post?.postId) {
      await finishManaged(delivery, attemptNumber, {
        status: 'published',
        providerPostId: outcome.post.postId,
      })
    } else if (outcome.state === 'failed') {
      await finishManaged(delivery, attemptNumber, managedFailure(outcome, attemptNumber))
    } else if (outcome.state === 'scheduled') {
      await finishManaged(delivery, attemptNumber, {
        status: 'review_required',
        errorCode: 'remote_schedule_reference_missing',
        error: 'The provider accepted a scheduled post without references needed for reconciliation.',
      }, outcome.job.jobId)
    } else {
      await finishManaged(delivery, attemptNumber, {
        status: 'review_required',
        errorCode: 'provider_outcome_uncertain',
        error: 'The managed provider did not confirm whether this post was published.',
      })
    }
  } catch (error) {
    console.error('social publish: managed provider operation failed', account.backend_id, error instanceof Error ? error.message : 'unknown error')
    await finishManaged(delivery, attemptNumber, {
      status: 'review_required',
      errorCode: 'provider_outcome_uncertain',
      error: 'The managed provider outcome is uncertain; review before retrying.',
    })
  }
}

async function finishClaimed(delivery: Delivery, status: 'failed' | 'blocked', code: string, message: string) {
  const { data, error } = await admin.from('social_deliveries')
    .update({
      status,
      lease_token: null,
      lease_until: null,
      last_error_code: safeCode(code),
      last_error: safeMessage(message),
      updated_at: new Date().toISOString(),
    })
    .eq('id', delivery.id).eq('status', 'claimed').eq('lease_token', delivery.lease_token)
    .select('id').maybeSingle()
  if (error) throw new Error(`Could not record the social delivery preflight result (${error.code}).`)
  if (!data) throw new Error('The social delivery claim expired before preflight completed.')
}

async function getPayload(delivery: Delivery) {
  const { data: post, error: postError } = await admin.from('social_posts')
    .select('id, body').eq('id', delivery.post_id).maybeSingle()
  if (postError) throw new Error(`Could not load social post (${postError.code}).`)
  if (!post) throw Object.assign(new Error('The scheduled post no longer exists.'), { code: 'post_missing' })

  const { data: attachments, error: attachmentError } = await admin.from('social_attachments')
    .select('id, object_path, kind, mime_type, file_name, byte_size, position')
    .eq('post_id', delivery.post_id).order('position')
  if (attachmentError) throw new Error(`Could not load social media (${attachmentError.code}).`)
  const media = []
  for (const attachment of attachments || []) {
    const { data, error } = await admin.storage.from('social').download(attachment.object_path)
    if (error || !data) throw new Error(`Could not read social media (${error?.message || 'storage_error'}).`)
    media.push({
      id: attachment.id,
      kind: attachment.kind,
      bytes: new Uint8Array(await data.arrayBuffer()),
      mimeType: attachment.mime_type,
      fileName: attachment.file_name,
      size: attachment.byte_size,
    })
  }
  return { post, media }
}

function delayFor(attempt: number, suggested?: number) {
  const exponential = Math.min(15 * 60 * 1000 * (2 ** Math.max(0, attempt - 1)), MAX_RETRY_MS)
  const requested = Number.isFinite(suggested) && suggested! > 0 ? suggested! : exponential
  return Math.min(Math.max(requested, 30_000), MAX_RETRY_MS)
}

function resultForFailure(attempt: number, failure: {
  code?: unknown
  message?: unknown
  disposition?: { kind?: string; delayMs?: number }
}): KnownFailureResult {
  const code = safeCode(failure.code)
  const message = safeMessage(failure.message)
  const kind = failure.disposition?.kind
  if (kind === 'after-reconnect')
    return { status: 'blocked', errorCode: code, error: message }
  if (kind === 'after-delay' && attempt < MAX_ATTEMPTS) {
    const delay = delayFor(attempt, failure.disposition?.delayMs)
    return { status: 'retry_wait', errorCode: code, error: message, nextAttemptAt: new Date(Date.now() + delay).toISOString() }
  }
  return { status: 'failed', errorCode: code, error: message }
}

async function deliver(delivery: Delivery): Promise<void> {
  const { data: account, error: accountError } = await admin.from('social_accounts')
    .select('id, backend_id, provider_id, external_id, name, username, credential_secret_id, status')
    .eq('id', delivery.account_id).maybeSingle()
  if (accountError) throw new Error(`Could not load the connected account (${accountError.code}).`)
  if (!account || account.status !== 'connected') {
    await finishClaimed(delivery, 'blocked', 'account_unavailable', 'Reconnect this account before publishing.')
    return
  }
  if (!SOCIAL_ADAPTERS.has(account.provider_id)) {
    await finishClaimed(delivery, 'blocked', 'provider_unsupported', 'This provider has no publishing adapter configured yet.')
    return
  }
  const adapter = SOCIAL_ADAPTERS.get(account.provider_id)
  const socialAccount = {
    id: account.external_id,
    providerId: account.provider_id,
    name: account.name,
    username: account.username,
    avatarUrl: null,
  }

  const { data: tokenJson, error: tokenError } = await admin.rpc('social_vault_read', { p_secret_id: account.credential_secret_id })
  if (tokenError || typeof tokenJson !== 'string') {
    await finishClaimed(delivery, 'blocked', 'credential_unavailable', 'Reconnect this account before publishing.')
    return
  }

  let tokens: Tokens
  try {
    const parsed = JSON.parse(tokenJson)
    if (!parsed?.accessToken) throw new Error('access token missing')
    tokens = {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
    }
  } catch {
    await finishClaimed(delivery, 'blocked', 'credential_invalid', 'Reconnect this account before publishing.')
    return
  }

  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    tokens = await refreshCredentials(account, adapter, tokens)
    payload = await getPayload(delivery)
    const capabilities = await adapter.capabilities({
      account: socialAccount,
      tokens,
      credentials: {},
    })
    const validation = await adapter.validatePost({
      account: socialAccount,
      text: payload.post.body,
      attachments: payload.media,
      capabilities,
      options: delivery.target_options || {},
    })
    if (!validation.valid) {
      const issues = validation.issues.map((issue: { code: string; message: string }) => `${safeCode(issue.code)}: ${safeMessage(issue.message)}`).join('; ')
      await finishClaimed(delivery, 'failed', 'provider_validation_failed', issues)
      return
    }
  } catch (error) {
    const code = safeCode((error as { code?: unknown })?.code)
    const blocked = code === 'account_reconnect_required' || code === 'provider_disabled'
    await finishClaimed(delivery, blocked ? 'blocked' : 'failed', code, safeMessage(error instanceof Error ? error.message : ''))
    return
  }

  const { data: attemptNumber, error: startError } = await admin.rpc('social_start_delivery', {
    p_delivery_id: delivery.id,
    p_lease_token: delivery.lease_token,
  })
  if (startError) throw new Error(`Could not start social delivery (${startError.code}).`)
  if (typeof attemptNumber !== 'number') return

  const startedAt = new Date().toISOString()
  let result: DeliveryResult
  const reconcile = (providerPostId?: string) => adapter.reconcile({
    account: socialAccount,
    tokens,
    credentials: {},
    idempotencyKey: delivery.id,
    providerPostId,
    text: payload.post.body,
    submittedAt: startedAt,
    options: delivery.target_options || {},
  })
  const onKnownFailure = (failure: { code?: unknown; message?: unknown; disposition?: { kind?: string; delayMs?: number } }) =>
    resultForFailure(attemptNumber, failure)
  try {
    const media = []
    for (const item of payload.media) {
      const uploaded = await adapter.uploadMedia({
        account: socialAccount,
        media: item,
        tokens,
        credentials: {},
        idempotencyKey: `${delivery.id}:${item.id}`,
      })
      media.push({ ...item, providerMediaId: uploaded.providerMediaId })
    }
    const published = await adapter.publish({
      account: socialAccount,
      tokens,
      credentials: {},
      text: payload.post.body,
      media,
      idempotencyKey: delivery.id,
      options: delivery.target_options || {},
    })
    result = await resolveSocialOutcome({
      publishResult: published,
      reconcile,
      onKnownFailure,
    })
  } catch (error) {
    console.error('social publish: provider operation failed', error instanceof Error ? error.message : 'unknown error')
    result = await resolveSocialOutcome({
      publishError: error,
      reconcile,
      onKnownFailure,
    })
  }
  await finish(delivery, attemptNumber, result)
}

async function finishMetrics(
  delivery: MetricsDelivery,
  outcome: 'success' | 'unsupported' | 'error',
  metrics?: ReturnType<typeof normalizePostMetrics>,
  errorCode?: string,
  error?: string,
) {
  const { data, error: rpcError } = await admin.rpc('social_finish_metrics', {
    p_delivery_id: delivery.id,
    p_lease_token: delivery.metrics_lease_token,
    p_outcome: outcome,
    p_views: metrics?.views ?? null,
    p_reads: metrics?.reads ?? null,
    p_likes: metrics?.likes ?? null,
    p_comments: metrics?.comments ?? null,
    p_provider_metrics: metrics?.providerMetrics ?? {},
    p_error_code: errorCode || null,
    p_error: error ? safeMessage(error) : null,
  })
  if (rpcError) throw new Error(`Could not persist social metrics (${rpcError.code || 'database_error'}).`)
  if (data !== true) throw new Error('The social metrics lease expired before its result could be recorded.')
}

function metricsManifest(client: any, directManifest?: unknown) {
  const manifest = directManifest || client?.capabilities?.()
  return Array.isArray(manifest) ? manifest : [manifest, ...Object.values(manifest || {})]
}

async function collectMetrics(delivery: MetricsDelivery): Promise<void> {
  try {
    const { data: account, error: accountError } = await admin.from('social_accounts')
      .select('id, backend_id, provider_id, external_id, name, username, credential_secret_id, status')
      .eq('id', delivery.account_id).maybeSingle()
    if (accountError) throw Object.assign(new Error('Could not load the connected social account.'), { code: accountError.code })
    if (!account || account.status !== 'connected')
      throw Object.assign(new Error('Reconnect this account before its metrics can be collected.'), { code: 'account_unavailable' })

    const backendId = account.backend_id || 'default'
    const sdkAccount = {
      id: account.external_id,
      providerId: account.provider_id,
      name: account.name,
      username: account.username,
      avatarUrl: null,
    }
    let client: any
    let manifest: unknown
    if (backendId !== 'default') {
      client = await managedClient(backendId)
      manifest = client.capabilities()
    } else {
      if (!SOCIAL_ADAPTERS.has(account.provider_id)) {
        await finishMetrics(delivery, 'unsupported', undefined, 'provider_adapter_unavailable', 'No analytics adapter is registered for this provider.')
        return
      }
      const adapter = SOCIAL_ADAPTERS.get(account.provider_id)
      const { data: tokenJson, error: tokenError } = await admin.rpc('social_vault_read', {
        p_secret_id: account.credential_secret_id,
      })
      if (tokenError || typeof tokenJson !== 'string')
        throw Object.assign(new Error('Reconnect this account before its metrics can be collected.'), { code: 'credential_unavailable' })
      const parsed = JSON.parse(tokenJson)
      if (!parsed?.accessToken)
        throw Object.assign(new Error('Reconnect this account before its metrics can be collected.'), { code: 'credential_invalid' })
      const tokens: Tokens = {
        accessToken: parsed.accessToken,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
        expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
        scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      }
      const refreshed = await refreshCredentials(account, adapter, tokens)
      client = adapter.createClient?.({ account: sdkAccount, tokens: refreshed })
      manifest = await adapter.capabilities({ account: sdkAccount, tokens: refreshed, credentials: {} })
    }

    if (!hasSocialCapability(metricsManifest(client, manifest), 'analytics.read', account.provider_id)) {
      await finishMetrics(delivery, 'unsupported', undefined, 'analytics_unsupported', 'This connected account does not provide post-level analytics.')
      return
    }
    if (typeof client?.analytics?.getPostMetrics !== 'function') {
      await finishMetrics(delivery, 'unsupported', undefined, 'analytics_operation_unavailable', 'This provider has no post metrics operation.')
      return
    }

    const reference = {
      kind: 'platform-post',
      version: 1,
      backend: backendId,
      platform: account.provider_id,
      accountId: account.external_id,
      postId: delivery.provider_post_id,
    }
    const response = await client.analytics.getPostMetrics(reference)
    await finishMetrics(delivery, 'success', normalizePostMetrics(response))
  } catch (error) {
    const code = safeCode((error as { code?: unknown })?.code)
    const message =
      code === 'account_unavailable' || code === 'credential_unavailable' || code === 'credential_invalid'
        ? 'Reconnect this account before its metrics can be collected.'
        : code === 'metrics_response_too_large' || code === 'metrics_response_invalid'
          ? safeMessage(error instanceof Error ? error.message : 'The provider returned invalid metrics.')
          : 'The provider metrics request failed; it will be retried on the next scheduled check.'
    await finishMetrics(delivery, 'error', undefined, code, message)
  }
}

async function collectDueMetrics() {
  const { data, error } = await admin.rpc('social_claim_metrics', { p_limit: 10, p_lease_seconds: 300 })
  if (error) {
    console.error('social metrics: due claim failed', error.code)
    return json({ error: 'Could not claim due social metrics.', code: 'social_metrics_claim_failed' }, 500)
  }
  const deliveries = (data || []) as MetricsDelivery[]
  let processed = 0
  let errors = 0
  for (const delivery of deliveries) {
    try {
      await collectMetrics(delivery)
      processed += 1
    } catch (error) {
      errors += 1
      console.error('social metrics: collection failed', error instanceof Error ? error.message : 'unknown error')
    }
  }
  return json({ claimed: deliveries.length, processed, errors }, errors ? 207 : 200)
}

async function handle(req: Request) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'Service authorization is required.', code: 'service_role_required' }, 403)
  let body: Record<string, unknown>
  try {
    const value = await req.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body')
    body = value as Record<string, unknown>
  } catch {
    return json({ error: 'A JSON request body is required.', code: 'request_invalid' }, 400)
  }
  if (body.action === 'collect_metrics') return collectDueMetrics()
  if (body.action !== 'deliver_due') return json({ error: 'Unknown social publishing action.', code: 'action_invalid' }, 400)

  const { data, error } = await admin.rpc('social_claim_due', { p_limit: 10, p_lease_seconds: 120 })
  if (error) {
    console.error('social publish: due claim failed', error.code)
    return json({ error: 'Could not claim due social posts.', code: 'social_claim_failed' }, 500)
  }
  const deliveries = (data || []) as Delivery[]
  let processed = 0
  let errors = 0
  for (const delivery of deliveries) {
    try {
      await deliver(delivery)
      processed += 1
    } catch (error) {
      errors += 1
      console.error('social publish: delivery processing failed', error instanceof Error ? error.message : 'unknown error')
    }
  }
  return json({ claimed: deliveries.length, processed, errors }, errors ? 207 : 200)
}

Deno.serve((req) => preflight(req) ?? handle(req))
