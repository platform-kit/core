import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the worker contains no site choices or inference-backed defaults', async () => {
  const files = ['agent.mjs', 'providers.mjs']
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n')

  for (const term of ['weather.gov', 'content/bots', '@livekit/agents/inference']) {
    assert.doesNotMatch(source.toLowerCase(), new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
  assert.doesNotMatch(source, /\btools\s*:/)
  assert.doesNotMatch(source, /\bmodel\s*:/)
  assert.doesNotMatch(source, /instructions:\s*(['"`])(?!\1)/)
  assert.match(source, /vad:\s*null/)
  assert.match(source, /turnHandling:\s*\{\s*turnDetection:\s*null\s*\}/)
})
