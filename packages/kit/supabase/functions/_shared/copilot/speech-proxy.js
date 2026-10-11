import { open as openGrant } from './grant.js'

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

    let upstream
    try {
      upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: body.model || model,
          voice: body.voice || voice,
          input: text.slice(0, 4000),
          response_format: body.format || 'pcm',
          stream_format: 'audio',
        }),
      })
    } catch (error) {
      return json({
        error: 'endpoint unreachable',
        detail: String(error?.message || error).slice(0, 200),
      }, 502)
    }

    if (!upstream.ok || !upstream.body) {
      return json({ error: 'endpoint refused', status: upstream.status }, 502)
    }

    return new Response(upstream.body, {
      headers: {
        ...cors,
        'content-type': upstream.headers.get('content-type') || 'audio/pcm',
        'cache-control': 'no-store',
        'x-audio-format': String(body.format || 'pcm'),
        'x-audio-rate': upstream.headers.get('x-audio-rate') || '24000',
      },
    })
  }
}
