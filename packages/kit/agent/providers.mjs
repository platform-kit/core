import {
  DEFAULT_API_CONNECT_OPTIONS,
  LLM,
  LLMStream,
  tts,
} from '@livekit/agents'
import { AudioFrame } from '@livekit/rtc-node'
import { randomUUID } from 'node:crypto'

const { SynthesizeStream, TTS } = tts
const FRAME_SAMPLES = 2400

function endpoint(base, path) {
  const url = new URL(base)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`
  return url.toString()
}

function requestSignal(signal, timeoutMs) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

async function* sseEvents(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, boundary)
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0]
        buffer = buffer.slice(boundary + separator.length)
        yield event
      }
      if (done) break
    }
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

function eventData(event) {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
}

export class EndpointLLM extends LLM {
  constructor({ baseURL, grant, fetchImpl = fetch }) {
    super()
    this.url = endpoint(baseURL, 'chat/completions')
    this.grant = grant
    this.fetchImpl = fetchImpl
  }

  label() {
    return 'platform endpoint'
  }

  chat({ chatCtx, connOptions = DEFAULT_API_CONNECT_OPTIONS }) {
    return new EndpointLLMStream(this, { chatCtx, connOptions })
  }
}

class EndpointLLMStream extends LLMStream {
  constructor(llm, options) {
    super(llm, options)
    this.url = llm.url
    this.grant = llm.grant
    this.fetchImpl = llm.fetchImpl
  }

  async run() {
    try {
      const messages = await this.chatCtx.toProviderFormat('openai')
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.grant}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({ messages, stream: true }),
        signal: requestSignal(this.abortController.signal, this.connOptions.timeoutMs),
      })
      if (!response.ok || !response.body) {
        throw new Error(`completion endpoint refused the request (${response.status})`)
      }

      for await (const event of sseEvents(response.body)) {
        const data = eventData(event)
        if (!data || data === '[DONE]') continue
        const chunk = JSON.parse(data)
        const content = chunk.choices?.[0]?.delta?.content
        if (typeof content !== 'string' || !content) continue
        this.queue.put({
          id: typeof chunk.id === 'string' ? chunk.id : randomUUID(),
          delta: { role: 'assistant', content },
        })
      }
    } finally {
      this.queue.close()
    }
  }
}

export class EndpointTTS extends TTS {
  label = 'platform speech endpoint'

  constructor({ url, grant, fetchImpl = fetch, sampleRate = 24000 }) {
    super(sampleRate, 1, { streaming: true })
    this.url = url
    this.grant = grant
    this.fetchImpl = fetchImpl
  }

  synthesize() {
    throw new Error('use the streaming speech endpoint')
  }

  stream({ connOptions = DEFAULT_API_CONNECT_OPTIONS } = {}) {
    return new EndpointSynthesizeStream(this, connOptions)
  }
}

class EndpointSynthesizeStream extends SynthesizeStream {
  constructor(tts, connOptions) {
    super(tts, connOptions)
    this.url = tts.url
    this.grant = tts.grant
    this.fetchImpl = tts.fetchImpl
    this.sampleRate = tts.sampleRate
  }

  async run() {
    let text = ''
    let segment = 0
    for await (const part of this.input) {
      if (this.abortSignal.aborted) return
      if (part === SynthesizeStream.FLUSH_SENTINEL) {
        if (text.trim()) await this.speak(text, String(++segment))
        text = ''
      } else {
        text += part
      }
    }
    if (text.trim()) await this.speak(text, String(++segment))
    this.queue.put(SynthesizeStream.END_OF_STREAM)
  }

  async speak(text, segmentId) {
    this.markStarted()
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.grant}`,
        'content-type': 'application/json',
        accept: 'audio/pcm',
      },
      body: JSON.stringify({ text, format: 'pcm' }),
      signal: requestSignal(this.abortSignal, this.connOptions.timeoutMs),
    })
    if (!response.ok || !response.body) {
      throw new Error(`speech endpoint refused the request (${response.status})`)
    }
    if (response.headers.get('x-audio-format')?.toLowerCase() === 'wav') {
      throw new Error('speech endpoint returned WAV instead of raw PCM')
    }
    const rate = Number(response.headers.get('x-audio-rate') || this.sampleRate)
    if (rate !== this.sampleRate) {
      throw new Error(`speech endpoint sample rate ${rate} does not match ${this.sampleRate}`)
    }

    const reader = response.body.getReader()
    let carry = Buffer.alloc(0)
    let last = null
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (value?.length) carry = Buffer.concat([carry, Buffer.from(value)])
        while (carry.length >= FRAME_SAMPLES * 2) {
          const samples = pcmSamples(carry.subarray(0, FRAME_SAMPLES * 2))
          carry = carry.subarray(FRAME_SAMPLES * 2)
          if (last) this.putFrame(last, segmentId, false)
          last = new AudioFrame(samples, this.sampleRate, 1, samples.length)
        }
        if (done) break
      }
    } finally {
      reader.releaseLock()
    }
    if (carry.length % 2) throw new Error('speech endpoint returned an incomplete PCM sample')
    if (carry.length) {
      const samples = pcmSamples(carry)
      if (last) this.putFrame(last, segmentId, false)
      last = new AudioFrame(samples, this.sampleRate, 1, samples.length)
    }
    if (!last) throw new Error('speech endpoint returned no audio')
    this.putFrame(last, segmentId, true)
  }

  putFrame(frame, segmentId, final) {
    this.queue.put({
      requestId: randomUUID(),
      segmentId,
      frame,
      final,
    })
  }
}

function pcmSamples(bytes) {
  const samples = new Int16Array(bytes.length / 2)
  for (let index = 0; index < samples.length; index++) {
    samples[index] = bytes.readInt16LE(index * 2)
  }
  return samples
}
