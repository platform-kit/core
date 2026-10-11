import { admin } from '../_shared/lib.ts'
import { createDirectWebhookClient, DIRECT_SOCIAL_ADAPTERS } from '../_shared/social/direct-sdk.mjs'
import { createManagedSocial, managedOperationContext } from '../_shared/social/managed-sdk.mjs'
import { availableSocialAutomationRoutes } from '../_shared/social/operations.mjs'
import { normalizeSocialAutomationEvents } from '../_shared/social/automation-events.mjs'
import {
  answerLinkedInWebhookChallenge,
  answerMetaWebhookChallenge,
} from 'npm:@opencoredev/social-sdk@0.5.0/server'

const MAX_BODY_BYTES = 1024 * 1024
const DIRECT_WEBHOOK_PROVIDERS = new Set(['instagram', 'threads', 'linkedin'])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function challengeResponse(response: { body: string; status: number; headers: HeadersInit }) {
  return new Response(response.body, { status: response.status, headers: response.headers })
}

async function directConfig(providerId: string) {
  const { data, error } = await admin
    .from('social_provider_configs')
    .select('client_id, client_secret_id, enabled')
    .eq('provider_id', providerId)
    .maybeSingle()
  if (error) throw new Error(`Could not load the ${providerId} webhook configuration (${error.code}).`)
  if (!data?.enabled || !data.client_secret_id || !data.client_id) return null
  const { data: secret, error: secretError } = await admin.rpc('social_vault_read', {
    p_secret_id: data.client_secret_id,
  })
  if (secretError) throw new Error(`Could not load the ${providerId} webhook secret (${secretError.code}).`)
  if (typeof secret !== 'string' || !secret) return null
  return { clientId: data.client_id as string, secret }
}

async function managedConfig() {
  const { data, error } = await admin
    .from('social_backend_configs')
    .select('credential_secret_id, webhook_secret_id, enabled')
    .eq('backend_id', 'zernio')
    .maybeSingle()
  if (error) throw new Error(`Could not load the Zernio webhook configuration (${error.code}).`)
  if (!data?.enabled || !data.credential_secret_id || !data.webhook_secret_id) return null
  const [credential, webhook] = await Promise.all([
    admin.rpc('social_vault_read', { p_secret_id: data.credential_secret_id }),
    admin.rpc('social_vault_read', { p_secret_id: data.webhook_secret_id }),
  ])
  if (credential.error || webhook.error)
    throw new Error('Could not load the Zernio webhook credentials.')
  if (typeof credential.data !== 'string' || !credential.data ||
      typeof webhook.data !== 'string' || !webhook.data)
    return null
  return { apiKey: credential.data, secret: webhook.data }
}

async function accountRouteAvailable(account: Record<string, any>, eventKind: string) {
  const backendId = account.backend_id || 'default'
  let client
  let manifest
  if (backendId === 'default') {
    const adapter = DIRECT_SOCIAL_ADAPTERS.find((item) => item.id === account.provider_id)
    if (!adapter || !account.credential_secret_id) return false
    const { data: tokenJson, error } = await admin.rpc('social_vault_read', {
      p_secret_id: account.credential_secret_id,
    })
    if (error) throw new Error(`Could not load connected Social credentials (${error.code}).`)
    if (typeof tokenJson !== 'string') return false
    let token
    try {
      token = JSON.parse(tokenJson)
    } catch {
      return false
    }
    if (typeof token.accessToken !== 'string' || !token.accessToken) return false
    const socialAccount = {
      id: account.external_id,
      providerId: account.provider_id,
      name: account.name,
      username: account.username,
      avatarUrl: account.avatar_url,
    }
    const tokens = {
      accessToken: token.accessToken,
      refreshToken: typeof token.refreshToken === 'string' ? token.refreshToken : null,
      expiresAt: typeof token.expiresAt === 'string' ? token.expiresAt : null,
      scopes: Array.isArray(token.scopes) ? token.scopes.filter((scope: unknown) => typeof scope === 'string') : [],
      ...(token.providerData && typeof token.providerData === 'object' ? { providerData: token.providerData } : {}),
    }
    try {
      manifest = await adapter.capabilities({ account: socialAccount, tokens, credentials: {} })
      client = adapter.createClient({ account: socialAccount, tokens })
    } catch {
      return false
    }
  } else if (backendId === 'zernio') {
    const config = await managedConfig()
    if (!config) return false
    client = createManagedSocial('zernio', config.apiKey, { webhookSecret: config.secret })
    manifest = Object.values(client.capabilities())[0]
  } else {
    return false
  }
  return availableSocialAutomationRoutes(manifest, account.provider_id, client, backendId)
    .some((route: { eventKind: string }) => route.eventKind === eventKind)
}

async function challenge(req: Request, providerId: string) {
  const config = await directConfig(providerId)
  if (!config) return json({ error: 'Webhook route is not configured.' }, 404)
  const query = new URL(req.url).searchParams
  if (providerId === 'instagram' || providerId === 'threads') {
    return challengeResponse(await answerMetaWebhookChallenge({
      verifyToken: config.clientId,
      query,
    }))
  }
  if (providerId === 'linkedin') {
    return challengeResponse(await answerLinkedInWebhookChallenge({
      secret: config.secret,
      query,
    }))
  }
  return json({ error: 'Webhook route is not available.' }, 404)
}

async function loadVerifier(backendId: string, providerId: string) {
  if (backendId === 'default') {
    if (!DIRECT_WEBHOOK_PROVIDERS.has(providerId)) return null
    const config = await directConfig(providerId)
    if (!config) return null
    return {
      client: createDirectWebhookClient(providerId, config.secret),
      backend: 'default',
    }
  }
  if (backendId === 'zernio') {
    const config = await managedConfig()
    if (!config) return null
    return {
      client: createManagedSocial('zernio', config.apiKey, { webhookSecret: config.secret }),
      backend: 'zernio',
    }
  }
  return null
}

async function readBoundedBody(req: Request) {
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new RangeError('Webhook body exceeds the configured size limit.')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function accept(req: Request, backendId: string, providerId: string) {
  const verifier = await loadVerifier(backendId, providerId)
  if (!verifier) return json({ error: 'Webhook route is not configured or supported.' }, 404)
  let body
  try {
    body = await readBoundedBody(req)
  } catch (error) {
    return json({ error: error instanceof RangeError ? error.message : 'Could not read the webhook body.' }, 413)
  }
  if (body.byteLength === 0) return json({ error: 'Webhook body is empty.' }, 400)
  const adapter = verifier.client.adapter(verifier.backend, { acknowledgeUnsafe: true })
  if (typeof adapter?.webhooks?.verify !== 'function' || typeof adapter.webhooks.decode !== 'function')
    return json({ error: 'Webhook verification is not supported for this route.' }, 404)
  try {
    await adapter.webhooks.verify({ body, headers: req.headers })
  } catch {
    return json({ error: 'Webhook signature is invalid.' }, 401)
  }
  let decoded
  try {
    decoded = await adapter.webhooks.decode(
      { body, headers: req.headers },
      backendId === 'default' ? { backendInstance: 'default' } : managedOperationContext('zernio'),
    )
  } catch (error) {
    console.error('social webhook decode failed', backendId, providerId, error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'Webhook payload could not be decoded.' }, 400)
  }
  const normalizedEvents = normalizeSocialAutomationEvents({
    backend: backendId,
    provider: backendId === 'default' ? providerId : 'zernio',
    decoded,
    body,
  })
  if (!normalizedEvents.length) return json({ received: true, accepted: 0 })

  let accepted = 0
  let mappedAccounts = 0
  for (const event of normalizedEvents) {
    if (!decoded.accountIds?.includes(event.externalAccountId)) continue
    const eventProviderId = backendId === 'default' ? providerId : event.providerId
    if (typeof eventProviderId !== 'string' || !/^[a-z][a-z0-9-]{1,40}$/.test(eventProviderId))
      continue
    const { data: account, error: accountError } = await admin
      .from('social_accounts')
      .select('id, backend_id, provider_id, external_id, name, username, avatar_url, credential_secret_id, status')
      .eq('backend_id', backendId)
      .eq('provider_id', eventProviderId)
      .eq('external_id', event.externalAccountId)
      .eq('status', 'connected')
      .maybeSingle()
    if (accountError)
      return json({ error: 'Could not resolve the connected Social account.' }, 500)
    if (!account) continue
    mappedAccounts++
    if (!await accountRouteAvailable(account, event.eventKind)) continue
    const { data, error } = await admin
      .from('social_inbound_events')
      .upsert({
        account_id: account.id,
        backend_id: backendId,
        provider_id: account.provider_id,
        provider_event_id: event.providerEventId,
        event_kind: event.eventKind,
        provider_author_id: event.authorId,
        item_id: event.itemId,
        post_id: event.postId ?? null,
        comment_id: event.commentId ?? null,
        conversation_id: event.conversationId ?? null,
        body: event.body,
        context: [],
        status: 'pending',
        received_at: decoded.receivedAt || new Date().toISOString(),
      }, {
        onConflict: 'account_id,provider_event_id,item_id',
        ignoreDuplicates: true,
      })
      .select('id')
    if (error) {
      console.error('social webhook event persistence failed', backendId, providerId, error.code)
      return json({ error: 'Could not persist the Social event.' }, 500)
    }
    if (data?.length) {
      accepted += data.length
      try {
        const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const response = await fetch(`${base}/functions/v1/social-automation`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'process_event', eventId: data[0].id }),
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) console.warn('social webhook worker wake failed', response.status)
      } catch (error) {
        console.warn('social webhook worker wake failed', error instanceof Error ? error.message : 'unknown error')
      }
    }
  }
  if (!mappedAccounts) return json({ error: 'No connected account matches this webhook.' }, 404)
  return json({ received: true, accepted })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
  const url = new URL(req.url)
  const backendId = url.searchParams.get('backend') || 'default'
  const providerId = url.searchParams.get('provider') || ''
  if (req.method === 'GET') {
    if (backendId !== 'default' || !DIRECT_WEBHOOK_PROVIDERS.has(providerId))
      return json({ error: 'Webhook route is not available.' }, 404)
    try {
      return await challenge(req, providerId)
    } catch (error) {
      console.warn('social webhook challenge refused', providerId, error instanceof Error ? error.message : 'unknown error')
      return json({ error: 'Webhook challenge is invalid.' }, 403)
    }
  }
  if (req.method !== 'POST') return json({ error: 'POST is required.' }, 405)
  if (backendId === 'default' && !DIRECT_WEBHOOK_PROVIDERS.has(providerId))
    return json({ error: 'Webhook route is not available.' }, 404)
  try {
    return await accept(req, backendId, providerId)
  } catch (error) {
    console.error('social webhook request failed', backendId, providerId, error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'Could not process the Social webhook.' }, 500)
  }
})
