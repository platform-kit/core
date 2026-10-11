import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatContext, initializeLogger, tts as livekitTts } from '@livekit/agents'
import { EndpointLLM, EndpointTTS } from './providers.mjs'

initializeLogger({ pretty: false, level: 'silent' })

test('the completion adapter sends the grant and forwards streamed text without provider choices', async () => {
  let request
  const chunks = [
    { id: 'turn-1', choices: [{ delta: { content: 'A useful ' } }] },
    { id: 'turn-1', choices: [{ delta: { content: 'answer.' } }] },
  ].map((value) => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n'
  const llm = new EndpointLLM({
    baseURL: 'https://example.invalid/v1',
    grant: 'one-conversation-grant',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(chunks, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const context = new ChatContext()
  context.addMessage({ role: 'user', content: 'What is this?' })
  const result = await llm.chat({ chatCtx: context }).collect()

  assert.equal(request.url, 'https://example.invalid/v1/chat/completions')
  assert.equal(request.options.headers.authorization, 'Bearer one-conversation-grant')
  assert.deepEqual(JSON.parse(request.options.body), {
    messages: [{ role: 'user', content: 'What is this?' }],
    stream: true,
  })
  assert.equal(result.text, 'A useful answer.')
})

test('the speech adapter streams mono PCM frames from the site endpoint', async () => {
  let request
  const pcm = Buffer.alloc(2400 * 2)
  pcm.writeInt16LE(1234, 0)
  const tts = new EndpointTTS({
    url: 'https://example.invalid/v1/audio/speech',
    grant: 'one-conversation-grant',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(pcm, {
        headers: { 'content-type': 'audio/pcm', 'x-audio-format': 'pcm', 'x-audio-rate': '24000' },
      })
    },
  })
  const stream = tts.stream()
  stream.pushText('A useful answer.')
  stream.flush()
  stream.endInput()
  const frames = []
  for await (const item of stream) frames.push(item)

  assert.equal(request.url, 'https://example.invalid/v1/audio/speech')
  assert.equal(request.options.headers.authorization, 'Bearer one-conversation-grant')
  assert.deepEqual(JSON.parse(request.options.body), { text: 'A useful answer.', format: 'pcm' })
  const audio = frames.filter((item) => item?.frame)
  assert.equal(audio.length, 1)
  assert.equal(frames.at(-1), livekitTts.SynthesizeStream.END_OF_STREAM)
  assert.equal(audio[0].frame.sampleRate, 24000)
  assert.equal(audio[0].frame.channels, 1)
  assert.equal(audio[0].frame.data[0], 1234)
  assert.equal(audio[0].final, true)
})
