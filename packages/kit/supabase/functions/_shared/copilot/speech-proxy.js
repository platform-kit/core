import { open as openGrant } from './grant.js'
import { unitsForCost } from '../usage-stripe.mjs'

const MICROS = 1_000_000n

export function pcmSecondsMicros(bytes, sampleRate, channels = 1, bitsPerSample = 16) {
  const size = Number(bytes), rate = Number(sampleRate)
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(rate) || rate <= 0 ||
      !Number.isSafeInteger(channels) || channels <= 0 || !Number.isSafeInteger(bitsPerSample) ||
      bitsPerSample <= 0 || bitsPerSample % 8 !== 0) {
    throw new Error('PCM duration needs valid byte, sample-rate, channel, and sample-width values')
  }
  const seconds = BigInt(size) * MICROS / BigInt(rate * channels * (bitsPerSample / 8))
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PCM duration exceeds the usage ledger range')
  return Number(seconds)
}

export function speechCostMicros(secondsMicros, rateMicros) {
  const seconds = Number(secondsMicros), rate = Number(rateMicros)
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(rate) || rate < 0) {
    throw new Error('speech cost needs non-negative safe integer rates')
  }
  if (!seconds || !rate) return 0
  const cost = (BigInt(seconds) * BigInt(rate) + MICROS - 1n) / MICROS
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('speech cost exceeds the usage ledger range')
  return Number(cost)
}

export function speechUsageRecord(grant, sourceRef, bytes, sampleRate, metered = grant?.usage?.metered, billable = true) {
  const usage = grant?.usage
  if (!usage?.offer_key) return null
  const secondsMicros = pcmSecondsMicros(bytes, sampleRate)
  if (!secondsMicros) return null
  const costMicros = speechCostMicros(secondsMicros, usage.speech_cost_per_second_micros)
  return {
    source_ref: sourceRef,
    user_id: grant.subject,
    bot_id: grant.bot,
    offer_key: usage.offer_key,
    kind: 'tts',
    cost_micros: costMicros,
    seconds_micros: secondsMicros,
    units_micros: billable && costMicros ? unitsForCost(costMicros, usage.rate_micros) : 0,
    metered: Boolean(metered),
    usage_unit: usage.unit || null,
    rate_micros: usage.rate_micros,
    meter: usage.meter || null,
    overage_price_micros: usage.overage_price_micros || null,
    speech_cost_per_second_micros: usage.speech_cost_per_second_micros,
  }
}

export function speechTelemetryRecord(grant, id, secondsMicros) {
  const usage = grant?.usage
  const seconds = Number(secondsMicros)
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('speech telemetry needs non-negative safe integer seconds')
  if (!usage?.offer_key || !seconds) return null
  return {
    source_ref: `copilot-stt:${grant.room}:${id}`,
    user_id: grant.subject,
    bot_id: grant.bot || null,
    offer_key: usage.offer_key,
    kind: 'stt',
    cost_micros: 0,
    seconds_micros: seconds,
    units_micros: 0,
    metered: false,
    usage_unit: usage.unit || null,
    rate_micros: usage.rate_micros,
    meter: null,
    overage_price_micros: null,
    speech_cost_per_second_micros: usage.speech_cost_per_second_micros,
  }
}

export function createSpeechHandler({
  service,
  url,
  key,
  model = 'tts-1',
  voice = 'alloy',
  cors,
  json,
  fetchImpl = fetch,
  open = openGrant,
  authorizeUsage = async () => ({ admitted: true, mode: 'prepaid', settle: async () => ({}), release: async () => true }),
  newId = () => crypto.randomUUID(),
  onUsageError = (error) => console.error('copilot speech usage could not be recorded', error),
}) {
  const base = String(url || '').replace(/\/$/, '')
  const endpoint = /\/audio\/speech$/.test(base) ? base : `${base}/audio/speech`

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ error: 'POST' }, 405)

    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const grant = await open(bearer, service)
    if (grant.error) return json({ error: `grant ${grant.error}` }, 401)

    if (!base || !key) {
      return json({
        error: 'no-endpoint',
        say: 'this deployment names no speech endpoint; the page speaks for itself',
      }, 503)
    }

    let body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'invalid JSON' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'invalid request' }, 400)
    }

    const text = String(body.text || '').trim()
    if (!text) return json({ error: 'nothing to say' }, 400)

    let authorization = null
    const invocationRef = grant.usage?.offer_key ? `copilot-tts:${grant.room}:${newId()}` : ''
    if (grant.usage?.offer_key) {
      const maxSecondsMicros = Math.max(1, text.length) * 1_000_000
      const maxCostMicros = speechCostMicros(maxSecondsMicros, Number(grant.usage.speech_cost_per_second_micros) || 0)
      const maxUnitsMicros = Math.max(1, unitsForCost(maxCostMicros, Number(grant.usage.rate_micros)))
      authorization = await authorizeUsage({
        userId: grant.subject,
        offerKey: grant.usage.offer_key,
        invocationRef,
        maxUnitsMicros,
        botId: grant.bot || null,
      })
      if (!authorization?.admitted) return json({ error: authorization?.reason || 'usage balance exhausted' }, 402)
    }

    const format = grant.usage?.offer_key ? 'pcm' : String(body.format || 'pcm')
    let upstream
    try {
      upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: body.model || model,
          voice: body.voice || voice,
          input: text.slice(0, 4000),
          response_format: format,
          stream_format: 'audio',
        }),
      })
    } catch (error) {
      if (authorization?.admitted) await authorization.release()
      return json({
        error: 'endpoint unreachable',
        detail: String(error?.message || error).slice(0, 200),
      }, 502)
    }

    if (!upstream.ok || !upstream.body) {
      if (authorization?.admitted) await authorization.release()
      return json({ error: 'endpoint refused', status: upstream.status }, 502)
    }

    const sampleRate = Number(upstream.headers.get('x-audio-rate') || 24000)
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      await upstream.body.cancel('invalid PCM sample rate')
      if (authorization?.admitted) await authorization.release()
      return json({ error: 'endpoint returned an invalid PCM sample rate' }, 502)
    }
    let audioBody = upstream.body
    if (authorization?.admitted) {
      const reader = upstream.body.getReader()
      let bytes = 0
      let recorded = false
      let interrupted = false
      const maxBytes = Math.max(2, Math.floor(text.length * sampleRate * 2))
      const record = async () => {
        if (recorded) return
        recorded = true
        try {
          const usage = speechUsageRecord(grant, invocationRef, bytes, sampleRate, authorization.mode === 'metered', !interrupted)
          if (!usage) {
            await authorization.release()
          } else {
            try {
              await authorization.settle({
                kind: usage.kind,
                costMicros: usage.cost_micros,
                secondsMicros: usage.seconds_micros,
                unitsMicros: usage.units_micros,
              })
            } catch (firstError) {
              try {
                await authorization.settle({
                  kind: usage.kind,
                  costMicros: usage.cost_micros,
                  secondsMicros: usage.seconds_micros,
                  unitsMicros: usage.units_micros,
                })
              } catch (retryError) {
                onUsageError(new AggregateError([firstError, retryError], 'speech usage record failed after an idempotent retry'))
              }
            }
          }
        } catch (error) {
          onUsageError(error)
        }
      }
      audioBody = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              await record()
              controller.close()
              return
            }
            if (value) {
              const remaining = Math.max(0, maxBytes - bytes)
              const size = Math.min(value.byteLength, remaining)
              const safeSize = size - (size % 2)
              if (safeSize > 0) {
                bytes += safeSize
                controller.enqueue(safeSize === value.byteLength ? value : value.slice(0, safeSize))
              }
              if (safeSize < value.byteLength) {
                await reader.cancel('authorized speech duration reached')
                await record()
                controller.close()
                return
              }
            }
            if (!value?.byteLength) controller.enqueue(value)
          } catch (error) {
            await record()
            controller.error(error)
          }
        },
        async cancel(reason) {
          interrupted = true
          try { await reader.cancel(reason) } finally { await record() }
        },
      })
    }

    return new Response(audioBody, {
      headers: {
        ...cors,
        'content-type': upstream.headers.get('content-type') || 'audio/pcm',
        'cache-control': 'no-store',
        'x-audio-format': format,
        'x-audio-rate': String(sampleRate),
      },
    })
  }
}
