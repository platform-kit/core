/*
 * THE ASSISTANT, IN A SHAPE ANYTHING CAN SPEAK TO.
 *
 * This is a DOOR, not an engine. Every decision — which bot answers, what it may reach, what it
 * may spend, when it stops — belongs to the loop that already exists and is untouched here: the
 * same run rows, the same lease and cancel, the same tools with their permission checks, the same
 * per-person ceiling. Nothing about the thinking is written twice. If it were, every rule would
 * have a second implementation and a second place to be got wrong.
 *
 * WHY A DOOR IS NEEDED AT ALL, since the loop already has one:
 *
 *   SHAPE      the thing that listens speaks OpenAI chat-completions and nothing else without
 *              custom code; the loop is invoked by a database RPC and has no HTTP shape.
 *   CALLER     `agent_summon` begins `if auth.uid() is null` — a person. The caller here is a
 *              worker outside the deployment holding a grant, not a session, so it comes through
 *              the service-role door `copilot_turn`, exactly as enrichment comes through
 *              `agent_job`.
 *   ANSWER     `post()` writes an answer INTO a surface's table and the client reads the row.
 *              There is no path that returns one on the response, and a voice turn needs one.
 *
 * The OpenAI shape is a choice rather than a necessity — the worker could speak our own protocol
 * through a custom LLM class. It is worth one adapter here to keep the worker a stock plugin that
 * knows nothing about this site, and to let anything else that speaks OpenAI (a phone bridge,
 * another product) reach the same bot with no further work.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cors, json } from '../_shared/lib.ts'
import { open as openGrant, sign as signGrant, grantExpiry } from '../_shared/copilot/grant.js'
import { speechTelemetryRecord } from '../_shared/copilot/speech-proxy.js'
import { livekit } from '../_shared/video/livekit.js'
import { recalls } from '../_shared/agents/loop.js'
import { fresh, of } from '../_shared/compiled.ts'
import bots from '../_shared/bots.json' with { type: 'json' }
import themeStrings from '../_shared/pipe/theme-strings.json' with { type: 'json' }

const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
const media = livekit({ db: admin, env: (key) => Deno.env.get(key) ?? '' })

/* how long to wait for the loop before giving up on a turn — a conversation cannot hang */
const TURN_MS = Number(Deno.env.get('COPILOT_TURN_MS') || 60_000)
const POLL_MS = 250
type ThemeStrings = { copilot?: { groups?: { page?: { head?: Record<string, string> } } } }
const WORDS = (themeStrings as ThemeStrings).copilot?.groups?.page?.head || {}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

/* OpenAI's own shape, so a stock client parses it without being told anything */
const chunk = (id: string, model: string, delta: Record<string, unknown>, finish: string | null = null) => ({
  id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
  choices: [{ index: 0, delta, finish_reason: finish }],
})

function ceilingResponse(id: string, model: string, content: string, reason: string, stream: boolean) {
  if (!stream) {
    return new Response(JSON.stringify({
      id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }), {
      headers: { ...cors, 'content-type': 'application/json', 'x-copilot-ended': reason },
    })
  }
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      controller.enqueue(enc.encode(sse(chunk(id, model, { role: 'assistant', content: '' }))))
      controller.enqueue(enc.encode(sse(chunk(id, model, { content }))))
      controller.enqueue(enc.encode(sse(chunk(id, model, {}, 'stop'))))
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, {
    headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-copilot-ended': reason },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)

  /*
   * HOW A BROWSER GETS A GRANT. Everything below this runs on a grant, and a page has none until
   * something mints one — so this is the one route that takes the PERSON's session instead.
   *
   * It is deliberately the only place a JWT is accepted. The page signs in as itself, asks to
   * speak to a named bot, and is handed a grant for that bot, itself and a few minutes; from then
   * on nothing it holds can reach anything wider. A worker is handed the same grant and never
   * sees the session at all.
   */
  if (new URL(req.url).pathname.endsWith('/start')) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const { data: who } = await admin.auth.getUser(jwt)
    const me = who?.user
    if (!me) return json({ error: { message: 'sign in to speak', type: 'invalid_request_error' } }, 401)
    const asked = await req.json().catch(() => ({}))
    const slug = String(asked.bot || '').trim()
    const bot: any = (bots as any[]).find((b) => b.slug === slug && (b.surfaces || []).includes('voice'))
    if (!bot) return json({ error: { message: 'no bot of that name speaks', type: 'invalid_request_error' } }, 404)

    let usage: any = null
    let usageSummary: any = null
    if (bot.billing) {
      await fresh()
      const offers = Object.values((of('catalog') as any).offers || {}) as any[]
      const offer = offers.find((item) => item.key === bot.billing && item.usage)
      if (!offer) return json({ error: { message: 'the assistant usage offer is not available', type: 'server_error' } }, 503)
      usage = {
        offer_key: String(offer.key),
        rate_micros: Number(offer.usage.rate_micros),
        speech_cost_per_second_micros: Number(offer.usage.speech_cost_per_second_micros || 0),
        overage_price_micros: Number(offer.usage.overage_price_micros || 0),
        unit: String(offer.usage.unit),
        meter: String(offer.usage.meter || ''),
        metered: Boolean(offer.usage.meter),
      }
      if (!Number.isSafeInteger(usage.rate_micros) || usage.rate_micros <= 0 ||
          !Number.isSafeInteger(usage.speech_cost_per_second_micros) ||
          usage.speech_cost_per_second_micros < 0) {
        return json({ error: { message: 'the assistant usage offer has invalid rates', type: 'server_error' } }, 503)
      }

      let mode = usage.metered ? 'metered' : 'prepaid'
      let remainingMicros = 0
      let periodStart: string | null = null
      if (usage.metered) {
        const { data: subscriptions, error: subscriptionError } = await admin.from('subscriptions')
          .select('current_period_start, usage_unit, usage_rate_micros, usage_meter, usage_included_micros, usage_overage_price_micros, usage_speech_cost_per_second_micros')
          .eq('user_id', me.id).eq('key', usage.offer_key)
          .in('status', ['active', 'trialing'])
          .not('usage_meter', 'is', null)
          .lte('current_period_start', new Date().toISOString())
          .gt('current_period_end', new Date().toISOString())
          .order('updated_at', { ascending: false }).limit(1)
        if (subscriptionError) return json({ error: { message: subscriptionError.message, type: 'server_error' } }, 500)
        if (!subscriptions?.length) mode = 'prepaid'
        else {
          const subscribed = subscriptions[0]
          periodStart = subscribed.current_period_start
          usage = {
            ...usage,
            unit: subscribed.usage_unit ?? usage.unit,
            rate_micros: subscribed.usage_rate_micros == null ? usage.rate_micros : Number(subscribed.usage_rate_micros),
            meter: subscribed.usage_meter ?? usage.meter,
            overage_price_micros: subscribed.usage_overage_price_micros == null
              ? usage.overage_price_micros : Number(subscribed.usage_overage_price_micros),
            speech_cost_per_second_micros: subscribed.usage_speech_cost_per_second_micros == null
              ? usage.speech_cost_per_second_micros : Number(subscribed.usage_speech_cost_per_second_micros),
          }
          const { data: balance, error: balanceError } = await admin.from('usage_balances')
            .select('remaining_micros')
            .eq('user_id', me.id).eq('offer_key', usage.offer_key)
            .eq('period_start', periodStart)
            .maybeSingle()
          if (balanceError) return json({ error: { message: balanceError.message, type: 'server_error' } }, 500)
          remainingMicros = Number(balance?.remaining_micros || 0)
        }
      }
      if (mode === 'prepaid') {
        const { data: balance, error: balanceError } = await admin.from('usage_balances')
          .select('remaining_micros')
          .eq('user_id', me.id).eq('offer_key', usage.offer_key).is('period_start', null)
          .maybeSingle()
        if (balanceError) return json({ error: { message: balanceError.message, type: 'server_error' } }, 500)
        remainingMicros = Number(balance?.remaining_micros || 0)
      }
      usageSummary = {
        offer_key: usage.offer_key,
        sku: offer.sku,
        billing: offer.billing,
        unit: usage.unit,
        mode,
        remaining_micros: remainingMicros,
        period_start: periodStart,
        purchase_sku: offer.billing === 'once' && Number(offer.usage.grant_micros) > 0 ? offer.sku : null,
      }
    }

    /* the ceilings are the bot's own, carried IN the grant so nothing downstream can raise them */
    const minutes = Number(bot.limits?.minutes) || 10
    const cents = Math.round((Number(bot.limits?.spend) || 0.5) * 100)
    const room = 'cp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    const expires = grantExpiry()
    const ending = {
      minutes: String(WORDS['ceiling-minutes'] || ''),
      spend: String(WORDS['ceiling-spend'] || ''),
    }
    const grant = await signGrant({ bot: bot.slug, subject: me.id, room, minutes, cents, ending, expires, usage }, SERVICE)
    const livekitKeys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
      .map((key) => Deno.env.get(key))
    if (livekitKeys.some(Boolean) && !livekitKeys.every(Boolean)) {
      return json({ error: { message: 'LiveKit configuration requires URL, API key, and API secret', type: 'server_error' } }, 503)
    }
    const transport = media.configured()
      ? await media.dispatchAgent({
        room,
        identity: me.id,
        metadata: grant,
        ttl: Math.max(60, Math.ceil((expires - Date.now()) / 1000)),
      })
      : null
    const { error: cleanupError } = await admin.from('copilot_sessions').delete().lt('expires_at', new Date().toISOString())
    if (cleanupError) return json({ error: { message: cleanupError.message, type: 'server_error' } }, 500)
    const { error: sessionError } = await admin.from('copilot_sessions').insert({
      room, bot: bot.slug, user_id: me.id, minutes, cents, expires_at: new Date(expires).toISOString(),
    })
    if (sessionError) return json({ error: { message: sessionError.message, type: 'server_error' } }, 500)
    return json({
      grant, room, bot: bot.slug, name: bot.name,
      transport,
      /* what the page needs to draw and speak, so it asks for nothing twice */
      voice: bot.voice || {}, minutes, greeting: bot.voice?.greeting || '',
      ...(usageSummary ? { usage: usageSummary } : {}),
    })
  }

  /* ---------------------------------------------------------------- the grant */
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const g: any = await openGrant(bearer, SERVICE)
  if (g.error) {
    /* said plainly: a worker that cannot start should know why without anybody reading a log */
    return json({ error: { message: `grant ${g.error}`, type: 'invalid_request_error' } }, 401)
  }

  if (new URL(req.url).pathname.endsWith('/telemetry')) {
    const telemetry = await req.json().catch(() => ({}))
    const secondsMicros = Number(telemetry?.seconds_micros)
    const id = String(telemetry?.id || '')
    if (telemetry?.kind !== 'stt' || !Number.isSafeInteger(secondsMicros) || secondsMicros < 0 ||
        secondsMicros > Number(g.minutes) * 60 * 1_000_000 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: { message: 'invalid speech telemetry', type: 'invalid_request_error' } }, 400)
    }
    const usageRecord = speechTelemetryRecord(g, id, secondsMicros)
    if (!usageRecord) return json({ ok: true, recorded: false })
    const { data, error } = await admin.rpc('usage_record', {
      p_source_ref: usageRecord.source_ref,
      p_user_id: usageRecord.user_id,
      p_bot_id: usageRecord.bot_id,
      p_offer_key: usageRecord.offer_key,
      p_kind: usageRecord.kind,
      p_cost_micros: usageRecord.cost_micros,
      p_seconds_micros: usageRecord.seconds_micros,
      p_units_micros: usageRecord.units_micros,
      p_metered: usageRecord.metered,
      p_usage_unit: usageRecord.usage_unit,
      p_rate_micros: usageRecord.rate_micros,
      p_meter: usageRecord.meter,
      p_overage_price_micros: usageRecord.overage_price_micros,
      p_speech_cost_per_second_micros: usageRecord.speech_cost_per_second_micros,
    })
    if (error) return json({ error: { message: `speech telemetry could not be recorded: ${error.message}`, type: 'server_error' } }, 500)
    if (!data?.admitted) return json({ error: { message: data?.reason || 'speech telemetry was refused', type: 'server_error' } }, 503)
    return json({ ok: true, duplicate: Boolean(data.duplicate) })
  }

  const body = await req.json().catch(() => ({}))
  /*
   * WHAT A CLIENT SENDS AND THIS IGNORES: `system`, `tools`, `model`, `max_tokens`, `temperature`.
   * The bot's file decides all of them. Ignored rather than refused, because every OpenAI SDK
   * sends some of them by default and refusing would make the door unusable with the libraries it
   * exists to serve — but a client cannot supply a prompt, name a tool, choose a model or raise a
   * limit, and the answer is the same as if it had sent none of them.
   */
  const messages: any[] = Array.isArray(body.messages) ? body.messages : []
  const ask = [...messages].reverse().find((m) => m && m.role === 'user' && typeof m.content === 'string')?.content || ''
  const stream = body.stream !== false
  const model = String(g.bot)   /* a client names a model; what answers is the bot */

  if (!ask.trim()) return json({ error: { message: 'nothing was said', type: 'invalid_request_error' } }, 400)

  /* ------------------------------------------------- the run, through the one door */
  const { data: made, error } = await admin.rpc('copilot_turn', {
    p_bot: g.bot, p_subject: g.subject, p_room: g.room || '', p_ask: ask,
  })
  if (error) return json({ error: { message: error.message, type: 'server_error' } }, 500)
  if (!made?.ok) {
    const limit = made?.error === 'conversation-minutes' ? 'minutes'
      : made?.error === 'conversation-spend' ? 'spend'
        : null
    if (limit) {
      const content = String(g.ending?.[limit] || WORDS[`ceiling-${limit}`] || '')
      if (content) return ceilingResponse(`chatcmpl-${g.room}`, model, content, limit, stream)
    }
    return json({ error: { message: String(made?.error || 'refused'), type: 'invalid_request_error' } }, 403)
  }
  const runId = made.id

  /*
   * THE LOOP IS WOKEN RATHER THAN RE-IMPLEMENTED. Inserting a queued run already posts to the
   * worker through pg_net (agent_wake), but that is fire-and-forget and a voice turn cannot wait
   * on a trigger's round trip — so the worker is also called directly here and awaited. It is the
   * same worker either way; this only removes the latency.
   */
  const drive = fetch(`${URL_}/functions/v1/agent-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ run: runId }),
  }).catch(() => null)

  async function answer(): Promise<{ said: string; why: string | null }> {
    const until = Date.now() + TURN_MS
    await drive
    while (Date.now() < until) {
      const { data: r } = await admin.from('agent_runs').select('status, said, error').eq('id', runId).maybeSingle()
      if (r && ['done', 'failed', 'cancelled'].includes(r.status)) return { said: String(r.said || ''), why: r.error || null }
      await new Promise((res) => setTimeout(res, POLL_MS))
    }
    return { said: '', why: 'timeout' }
  }

  /* WHAT WAS SAID IS REMEMBERED, where the bot's file asked to recall and nowhere else. The
     embedding is made here because the database has no model of its own; it costs nothing and
     leaves the deployment never. A failure to remember must never fail the answer. */
  async function remember(said: string) {
    const bot: any = (bots as any[]).find((b) => b.slug === g.bot)
    if (!bot || !recalls(bot) || !ask.trim()) return
    try {
      // @ts-ignore the edge runtime's own model
      const session = new Supabase.ai.Session('gte-small')
      const v = await session.run(ask.slice(0, 1500), { mean_pool: true, normalize: true })
      await admin.rpc('copilot_remember', { p_user: g.subject, p_bot: g.bot, p_said: ask, p_embedding: JSON.stringify(v) })
    } catch { /* remembering is a courtesy; the answer is the promise */ }
  }

  if (!stream) {
    const { said, why } = await answer()
    await remember(said)
    return json({
      id: `chatcmpl-${runId}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: said }, finish_reason: why ? 'stop' : 'stop' }],
    })
  }

  /*
   * SSE FROM THE FIRST COMMIT, even though this version writes the answer in one piece. The shape
   * is what lets the preamble (a sentence spoken while a tool runs) and token streaming land later
   * without the worker changing at all — and the worker is the part that is hard to redeploy.
   */
  const body_ = new ReadableStream({
    async start(c) {
      const enc = new TextEncoder()
      const send = (o: unknown) => c.enqueue(enc.encode(sse(o)))
      send(chunk(`chatcmpl-${runId}`, model, { role: 'assistant', content: '' }))
      const { said } = await answer()
      if (said) send(chunk(`chatcmpl-${runId}`, model, { content: said }))
      send(chunk(`chatcmpl-${runId}`, model, {}, 'stop'))
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
      await remember(said)
    },
  })
  return new Response(body_, { headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
})
