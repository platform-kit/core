import assert from 'node:assert/strict'
import test from 'node:test'
import { assistantText, inputOf } from './protocol.mjs'

test('room input accepts only bounded identified text turns', () => {
  const enc = new TextEncoder()
  assert.deepEqual(inputOf(enc.encode('{"id":"turn-1","text":" hello " }')), { id: 'turn-1', text: 'hello' })
  assert.equal(inputOf(enc.encode('not json')), null)
  assert.equal(inputOf(enc.encode('{"id":"turn 1","text":"hello"}')), null)
  assert.equal(inputOf(enc.encode('{"id":"turn-1","text":"   "}')), null)
  assert.equal(inputOf(enc.encode(JSON.stringify({ id: 'turn-1', text: 'x'.repeat(4100) }))).text.length, 4000)
})

test('only assistant message text is returned to the reader', () => {
  assert.equal(assistantText({ type: 'message', role: 'assistant', content: ['Hello', ' there'] }), 'Hello there')
  assert.equal(assistantText({ type: 'message', role: 'user', content: ['Hello'] }), '')
  assert.equal(assistantText({ type: 'function_call', role: 'assistant', content: ['ignored'] }), '')
  assert.equal(assistantText({ type: 'message', role: 'assistant', content: [{ image: 'ignored' }] }), '')
})
