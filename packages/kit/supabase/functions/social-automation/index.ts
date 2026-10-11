import { admin, isServiceBearer, json, preflight } from '../_shared/lib.ts'
import {
  automationDeliveryOutcome,
  sendInstagramPrivateReply,
} from '../_shared/social/automation-delivery.mjs'
import {
  matchSocialAutomations,
  socialBotAllowsAnonymousSubject,
} from '../_shared/social/automation-rules.mjs'
import {
  availableSocialAutomationRoutes,
  invokeSocialOperation,
} from '../_shared/social/operations.mjs'
import { DIRECT_SOCIAL_ADAPTERS } from '../_shared/social/direct-sdk.mjs'
import { createManagedSocial } from '../_shared/social/managed-sdk.mjs'

type Row = Record<string, any>
type SocialRuntime = {
  account: Row
  providerAccount: Row
  client: any
  manifest: any
  backendId: string
  token?: Row
}

const accountSelect =
  'id, backend_id, provider_id, external_id, name, username, avatar_url, credential_secret_id, status'

function operationContext(backendId: string) {
  return {
    backendInstance: backendId,
    correlationId: crypto.randomUUID(),
    retryBudget: { maxAttempts: 1, maxElapsedMs: 60_000 },
  }
}

async function readSecret(secretId: string | null) {
  if (!secretId) return null
  const { data, error } = await admin.rpc('social_vault_read', { p_secret_id: secretId })
  if (error) throw new Error(`Social credential lookup failed (${error.code}).`)
  return typeof data === 'string' && data ? data : null
}

async function loadRuntime(account: Row): Promise<SocialRuntime | null> {
  const backendId = account.backend_id || 'default'
  const providerAccount = {
    id: account.external_id,
    providerId: account.provider_id,
    name: account.name,
    username: account.username,
    avatarUrl: account.avatar_url,
  }

  if (backendId === 'default') {
    const adapter = DIRECT_SOCIAL_ADAPTERS.find((item: Row) => item.id === account.provider_id)
    const tokenJson = await readSecret(account.credential_secret_id)
    if (
      !adapter ||
      typeof adapter.createClient !== 'function' ||
      typeof adapter.capabilities !== 'function' ||
      !tokenJson
    ) return null
    let storedToken: Row
    try {
      storedToken = JSON.parse(tokenJson)
    } catch {
      return null
    }
    if (typeof storedToken.accessToken !== 'string' || !storedToken.accessToken) return null
    const token = {
      accessToken: storedToken.accessToken,
      refreshToken: typeof storedToken.refreshToken === 'string' ? storedToken.refreshToken : null,
      expiresAt: typeof storedToken.expiresAt === 'string' ? storedToken.expiresAt : null,
      scopes: Array.isArray(storedToken.scopes)
        ? storedToken.scopes.filter((scope: unknown) => typeof scope === 'string')
        : [],
      ...(storedToken.providerData && typeof storedToken.providerData === 'object'
        ? { providerData: storedToken.providerData }
        : {}),
    }
    return {
      account,
      providerAccount,
      token,
      client: adapter.createClient({ account: providerAccount, tokens: token }),
      manifest: await adapter.capabilities({ account: providerAccount, tokens: token, credentials: {} }),
      backendId,
    }
  }

  if (backendId !== 'zernio') return null
  const { data: config, error } = await admin
    .from('social_backend_configs')
    .select('credential_secret_id, webhook_secret_id, enabled')
    .eq('backend_id', backendId)
    .maybeSingle()
  if (error) throw new Error(`Managed Social configuration lookup failed (${error.code}).`)
  if (!config?.enabled) return null
  const [apiKey, webhookSecret] = await Promise.all([
    readSecret(config.credential_secret_id),
    readSecret(config.webhook_secret_id),
  ])
  if (!apiKey || !webhookSecret) return null
  const client = createManagedSocial(backendId, apiKey, { webhookSecret })
  return {
    account,
    providerAccount,
    client,
    manifest: Object.values(client.capabilities())[0],
    backendId,
  }
}

function recordsFromPage(result: unknown): Row[] {
  if (!result || typeof result !== 'object') return []
  const items = (result as Row).items
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : []
}

function contextRecord(item: Row) {
  const body = typeof item.text === 'string' ? item.text : typeof item.body === 'string' ? item.body : ''
  const authorId = item.authorId ?? item.author_id ?? item.senderId ?? item.sender_id
  if (!body.trim()) return null
  return {
    ...(typeof authorId === 'string' ? { author_id: authorId } : {}),
    body: body.trim().slice(0, 900),
  }
}

async function loadEventContext(runtime: SocialRuntime, event: Row) {
  const context = operationContext(runtime.backendId)
  let result: unknown
  if (event.event_kind === 'comment' && event.post_id) {
    result = await invokeSocialOperation({
      client: runtime.client,
      account: {
        backend: runtime.backendId,
        platform: runtime.account.provider_id,
        accountId: runtime.account.external_id,
      },
      operation: 'comments.read',
      input: { postId: event.post_id, limit: 100 },
      context,
    })
    const items = recordsFromPage(result)
    const current = items.find((item) => (item.id ?? item.commentId) === event.item_id)
    const parentId = current?.parentId ?? current?.parent_id
    if (typeof parentId !== 'string' || !parentId) return []
    const parent = items.find((item) => (item.id ?? item.commentId) === parentId)
    const mapped = parent ? contextRecord(parent) : null
    return mapped ? [mapped] : []
  }
  if (event.event_kind === 'dm' && event.conversation_id) {
    result = await invokeSocialOperation({
      client: runtime.client,
      account: {
        backend: runtime.backendId,
        platform: runtime.account.provider_id,
        accountId: runtime.account.external_id,
      },
      operation: 'messages.read',
      input: { conversationId: event.conversation_id, limit: 100 },
      context,
    })
    return recordsFromPage(result)
      .filter((item) => (item.id ?? item.messageId) !== event.item_id)
      .slice(-8)
      .map(contextRecord)
      .filter(Boolean)
  }
  return []
}

async function finishEvent(eventId: string, status: 'complete' | 'quarantined' | 'failed', error?: string) {
  const { error: finishError } = await admin.rpc('social_finish_automation_event', {
    p_event_id: eventId,
    p_status: status,
    p_error: error || null,
  })
  if (finishError) throw new Error(`Social event completion failed (${finishError.code}).`)
}

async function pauseAutomaticRule(automationId: string) {
  const { error } = await admin.from('social_automations')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('id', automationId)
    .eq('mode', 'automatic')
    .eq('enabled', true)
  if (error) throw new Error(`Unavailable Social automation could not be paused (${error.code}).`)
}

async function startResponse(event: Row, automation: Row, destination: string, bot: Row) {
  const { data: response, error: insertError } = await admin
    .from('social_automation_responses')
    .insert({
      account_id: event.account_id,
      automation_id: automation.id,
      event_id: event.id,
      destination,
      mode: automation.mode,
      status: 'generating',
    })
    .select('id')
    .maybeSingle()
  if (insertError?.code === '23505') return
  if (insertError || !response?.id)
    throw new Error(`Social response record could not be created (${insertError?.code || 'unknown'}).`)

  const subjectHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${event.account_id}:${event.provider_author_id}`),
  )
  const subjectKey = `social:${event.account_id}:${[...new Uint8Array(subjectHash)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const { data: run, error: runError } = await admin.rpc('social_start_automation_run', {
    p_response_id: response.id,
    p_subject_key: subjectKey,
  })
  if (runError) throw new Error(`Social bot run could not be started (${runError.code}).`)
  if (!run || run.error) {
    const reason = run?.error === 'budget'
      ? `Bot response limit reached${run.window ? ` (${run.window})` : ''}.`
      : 'The selected Social automation or bot is no longer available.'
    const { error } = await admin.from('social_automation_responses')
      .update({ status: 'failed', last_error: reason })
      .eq('id', response.id)
      .eq('status', 'generating')
    if (error) throw new Error(`Social response failure could not be saved (${error.code}).`)
    console.warn('social automation response was not queued', bot.slug, run?.error || 'unavailable')
  }
}

async function processEvent(eventId: string) {
  const { data: claimed, error: claimError } = await admin.rpc('social_claim_automation_events', {
    p_event_id: eventId,
    p_limit: 1,
  })
  if (claimError) throw new Error(`Social event claim failed (${claimError.code}).`)
  if (!Array.isArray(claimed) || !claimed.length) return { claimed: false }
  await processClaimedEvent(eventId)
  return { claimed: true }
}

async function processClaimedEvent(eventId: string) {
  const { data: event, error: eventError } = await admin
    .from('social_inbound_events').select('*').eq('id', eventId).maybeSingle()
  if (eventError || !event) throw new Error(`Claimed Social event lookup failed (${eventError?.code || 'missing'}).`)
  const { data: account, error: accountError } = await admin
    .from('social_accounts').select(accountSelect).eq('id', event.account_id).maybeSingle()
  if (accountError) throw new Error(`Social account lookup failed (${accountError.code}).`)
  if (!account || account.status !== 'connected') {
    await finishEvent(eventId, 'quarantined', 'The connected Social account is unavailable.')
    return { claimed: true, quarantined: true }
  }

  const runtime = await loadRuntime(account)
  if (!runtime) throw new Error('Social account credentials are unavailable.')
  const routes = availableSocialAutomationRoutes(
    runtime.manifest,
    account.provider_id,
    runtime.client,
    runtime.backendId,
  )
  const route = routes.find((item: Row) => item.eventKind === event.event_kind)
  if (!route) {
    await finishEvent(eventId, 'quarantined', 'The Social account no longer supports this event.')
    return { claimed: true, quarantined: true }
  }

  try {
    const context = await loadEventContext(runtime, event)
    if (context.length) {
      const { error } = await admin.from('social_inbound_events')
        .update({ context })
        .eq('id', eventId)
        .eq('status', 'processing')
      if (error) throw new Error(`Social conversation context could not be saved (${error.code}).`)
      event.context = context
    }
  } catch (error) {
    console.warn('social automation context unavailable', event.id, error instanceof Error ? error.message : 'unknown error')
  }

  const [{ data: automations, error: automationError }, { data: bots, error: botError }] =
    await Promise.all([
      admin.from('social_automations').select('*')
        .eq('account_id', account.id).eq('event_kind', event.event_kind).eq('enabled', true),
      admin.from('bots').select('*').eq('published', true).contains('surfaces', ['social']),
    ])
  if (automationError || botError)
    throw new Error(`Social automation lookup failed (${automationError?.code || botError?.code}).`)
  const matches = matchSocialAutomations({ event, account, automations: automations || [], bots: bots || [] })
  for (const match of matches) {
    for (const destination of match.automation.destinations || []) {
      if (!route.destinations.includes(destination)) continue
      await startResponse(event, match.automation, destination, match.bot)
    }
  }
  await finishEvent(eventId, 'complete')
  return { claimed: true, responses: matches.length }
}

async function deliverResponse(responseId: string, actorId: string | null = null) {
  const { data, error } = await admin.rpc('social_begin_automation_send', {
    p_response_id: responseId,
    p_actor_id: actorId,
  })
  if (error) throw new Error(`Social response-send authorization failed (${error.code}).`)
  if (!data || data.error) {
    if (actorId === null && ['account_unavailable', 'route_unavailable'].includes(data?.error)) {
      const { data: response, error: responseError } = await admin
        .from('social_automation_responses').select('automation_id, mode').eq('id', responseId).maybeSingle()
      if (responseError) throw new Error(`Social automation lookup failed (${responseError.code}).`)
      if (response?.mode === 'automatic') await pauseAutomaticRule(response.automation_id)
    }
    return { sent: false, reason: data?.error || 'response_unavailable' }
  }

  const [eventResult, accountResult, automationResult] = await Promise.all([
    admin.from('social_inbound_events').select('*').eq('id', data.event_id).maybeSingle(),
    admin.from('social_accounts').select(accountSelect).eq('id', data.account_id).maybeSingle(),
    admin.from('social_automations').select('*').eq('id', data.automation_id).maybeSingle(),
  ])
  if (eventResult.error || accountResult.error || automationResult.error)
    throw new Error('Social delivery context lookup failed.')
  const event = eventResult.data
  const account = accountResult.data
  const automation = automationResult.data
  let result: Row | undefined
  let deliveryError: unknown

  try {
    if (!event || !account || account.status !== 'connected' || !automation?.enabled) {
      if (automation && data.mode === 'automatic' && (!account || account.status !== 'connected'))
        await pauseAutomaticRule(automation.id)
      throw Object.assign(new Error('The account route is no longer available.'), {
        code: 'social_route_unavailable',
        definite: true,
      })
    }
    const runtime = await loadRuntime(account)
    if (!runtime) {
      if (data.mode === 'automatic') await pauseAutomaticRule(automation.id)
      throw Object.assign(new Error('The connected account credentials are unavailable.'), {
        code: 'social_route_unavailable',
        definite: true,
      })
    }
    const route = availableSocialAutomationRoutes(
      runtime.manifest,
      account.provider_id,
      runtime.client,
      runtime.backendId,
    ).find((item: Row) =>
      item.eventKind === event.event_kind && item.destinations.includes(data.destination),
    )
    if (!route) {
      if (data.mode === 'automatic') await pauseAutomaticRule(automation.id)
      throw Object.assign(new Error('The provider no longer supports this response destination.'), {
        code: 'social_route_unavailable',
        definite: true,
      })
    }

    if (data.destination === 'private_dm' && event.event_kind === 'comment') {
      if (runtime.backendId !== 'default' || account.provider_id !== 'instagram' || !runtime.token)
        throw Object.assign(new Error('Private replies to comments are not available on this route.'), {
          code: 'social_route_unavailable',
          definite: true,
        })
      result = await sendInstagramPrivateReply({
        accountId: account.external_id,
        commentId: event.comment_id || event.item_id,
        text: data.body,
        accessToken: runtime.token.accessToken,
      })
    } else {
      const operation = data.destination === 'public_reply' ? 'comments.write' : 'messages.write'
      result = await invokeSocialOperation({
        client: runtime.client,
        account: {
          backend: runtime.backendId,
          platform: account.provider_id,
          accountId: account.external_id,
        },
        operation,
        input: data.destination === 'public_reply'
          ? { postId: event.post_id, commentId: event.comment_id || event.item_id, text: data.body }
          : { conversationId: event.conversation_id, text: data.body },
        context: operationContext(runtime.backendId),
      })
      if (typeof result?.providerResponseId !== 'string') {
        const responseId = result?.id ?? result?.messageId ?? result?.commentId
        if (typeof responseId === 'string' && responseId) result = { providerResponseId: responseId }
      }
    }
  } catch (error) {
    deliveryError = error
  }
  const outcome = automationDeliveryOutcome({ result, error: deliveryError })
  const { error: finishError } = await admin.rpc('social_finish_automation_send', {
    p_response_id: responseId,
    p_status: outcome.status,
    p_provider_response_id: outcome.providerResponseId || null,
    p_error: outcome.errorCode || null,
  })
  if (finishError) throw new Error(`Social provider outcome could not be saved (${finishError.code}).`)
  return { sent: outcome.status === 'sent', status: outcome.status }
}

async function processDue() {
  const { error: recoveryError } = await admin.rpc('social_recover_automation_sends')
  if (recoveryError) throw new Error(`Social uncertain-send recovery failed (${recoveryError.code}).`)
  const { data: claimed, error: claimError } = await admin.rpc('social_claim_automation_events', {
    p_event_id: null,
    p_limit: 20,
  })
  if (claimError) throw new Error(`Social event recovery failed (${claimError.code}).`)
  let events = 0
  for (const eventId of Array.isArray(claimed) ? claimed : []) {
    try {
      await processClaimedEvent(eventId)
      events++
    } catch (error) {
      console.error('social automation event processing failed', error instanceof Error ? error.message : 'unknown error')
    }
  }
  const { data: pending, error: pendingError } = await admin
    .from('social_automation_responses').select('id')
    .eq('mode', 'automatic').eq('status', 'draft').order('created_at').limit(50)
  if (pendingError) throw new Error(`Automatic Social responses lookup failed (${pendingError.code}).`)
  let sent = 0
  for (const response of pending || []) {
    try {
      if ((await deliverResponse(response.id)).sent) sent++
    } catch (error) {
      console.error('social automatic delivery failed', response.id, error instanceof Error ? error.message : 'unknown error')
    }
  }
  return { events, sent }
}

async function validateRule(body: Row) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  const eventKind = body.eventKind
  const botSlug = typeof body.botSlug === 'string' ? body.botSlug : ''
  const destinations = Array.isArray(body.destinations) ? body.destinations : []
  if (
    !/^[0-9a-f-]{36}$/i.test(accountId) ||
    !['comment', 'dm'].includes(eventKind) ||
    !botSlug ||
    !destinations.length ||
    !destinations.every((item) => typeof item === 'string')
  ) return json({ error: 'The Social automation route is invalid.' }, 400)

  const { data: account, error: accountError } = await admin
    .from('social_accounts').select(accountSelect).eq('id', accountId).maybeSingle()
  if (accountError) throw new Error(`Social account lookup failed (${accountError.code}).`)
  if (!account || account.status !== 'connected')
    return json({ error: 'The connected Social account is unavailable.' }, 409)
  const runtime = await loadRuntime(account)
  if (!runtime) return json({ error: 'The connected Social account credentials are unavailable.' }, 409)
  const route = availableSocialAutomationRoutes(
    runtime.manifest,
    account.provider_id,
    runtime.client,
    runtime.backendId,
  ).find((item: Row) => item.eventKind === eventKind)
  if (!route || destinations.some((destination) => !route.destinations.includes(destination)))
    return json({ error: 'This account route does not support the selected event and response destinations.' }, 422)

  const { data: bot, error: botError } = await admin
    .from('bots').select('slug, published, surfaces, serves').eq('slug', botSlug).maybeSingle()
  if (botError) throw new Error(`Social bot lookup failed (${botError.code}).`)
  if (!socialBotAllowsAnonymousSubject(bot))
    return json({ error: 'Choose a published Social bot that can answer an anonymous provider author.' }, 422)
  return json({ valid: true })
}

async function automationOptions(body: Row) {
  const accountId = typeof body.accountId === 'string' ? body.accountId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId))
    return json({ error: 'Choose a social account.' }, 400)
  const { data: account, error } = await admin
    .from('social_accounts').select(accountSelect).eq('id', accountId).maybeSingle()
  if (error) throw new Error(`Social account lookup failed (${error.code}).`)
  if (!account || account.status !== 'connected')
    return json({ routes: [], unavailable: 'This account is not connected.' })
  const runtime = await loadRuntime(account)
  if (!runtime)
    return json({ routes: [], unavailable: 'The account route could not be verified.' })
  return json({
    routes: availableSocialAutomationRoutes(
      runtime.manifest,
      account.provider_id,
      runtime.client,
      runtime.backendId,
    ),
  })
}

Deno.serve(async (req) => {
  const options = preflight(req)
  if (options) return options
  if (req.method !== 'POST') return json({ error: 'POST is required.' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'not-allowed' }, 401)
  let body: Row
  try {
    body = await req.json()
  } catch {
    return json({ error: 'A valid JSON request is required.' }, 400)
  }
  try {
    if (body.action === 'process_event' && typeof body.eventId === 'string')
      return json(await processEvent(body.eventId))
    if (body.action === 'process_due')
      return json(await processDue())
    if (body.action === 'validate_rule')
      return await validateRule(body)
    if (body.action === 'automation_options')
      return await automationOptions(body)
    if (body.action === 'deliver_response' && typeof body.responseId === 'string')
      return json(await deliverResponse(
        body.responseId,
        typeof body.actorId === 'string' ? body.actorId : null,
      ))
    return json({ error: 'The Social automation action is not available.' }, 400)
  } catch (error) {
    console.error('social automation request failed', error instanceof Error ? error.message : 'unknown error')
    return json({ error: 'The Social automation could not be processed.' }, 500)
  }
})
