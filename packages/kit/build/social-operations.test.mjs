import assert from 'node:assert/strict'
import {
  availableSocialOperations,
  invokeNativeOperation,
  invokeSocialOperation,
  operationAvailable,
} from '../supabase/functions/_shared/social/operations.mjs'

const account = {
  backend: 'default',
  platform: 'x',
  accountId: 'external-account',
}
const calls = []
const result =
  (name) =>
  async (...args) => {
    calls.push([name, ...args])
    return name
  }
const client = {
  accounts: { get: result('accounts.get') },
  posts: {
    list: result('posts.list'),
    get: result('posts.get'),
    getDelivery: result('posts.getDelivery'),
    cancelScheduled: result('posts.cancelScheduled'),
    deleteBackendRecord: result('posts.deleteBackendRecord'),
    removeFromPlatform: result('posts.removeFromPlatform'),
  },
  media: { upload: result('media.upload') },
  search: { posts: result('search.posts') },
  analytics: {
    getAccountMetrics: result('analytics.account'),
    getPostMetrics: result('analytics.post'),
    getReport: result('analytics.report'),
  },
  graph: {
    getProfile: result('graph.profile'),
    listRelationships: result('graph.list'),
    follow: result('graph.follow'),
    unfollow: result('graph.unfollow'),
    block: result('graph.block'),
    unblock: result('graph.unblock'),
    mute: result('graph.mute'),
    unmute: result('graph.unmute'),
  },
  comments: { list: result('comments.list'), reply: result('comments.reply') },
  messages: {
    listConversations: result('messages.conversations'),
    listMessages: result('messages.list'),
    send: result('messages.send'),
  },
  notifications: { list: result('notifications.list'), markSeen: result('notifications.seen') },
  adapter: () => ({
    webhooks: {
      verify: async (input, context) => {
        calls.push([
          'webhooks.verify',
          input.headers.get('x-signature'),
          input.body,
          context.backendInstance,
          context.correlationId,
          context.retryBudget,
        ])
        return { valid: true, method: 'hmac' }
      },
      decode: async (input, context) => {
        calls.push([
          'webhooks.decode',
          input.headers.get('x-event'),
          input.body,
          context.backendInstance,
          context.correlationId,
          context.retryBudget,
        ])
        return { event: 'post.created' }
      },
    },
  }),
  native: (backend, acknowledgement) => {
    assert.equal(backend, 'default')
    assert.deepEqual(acknowledgement, { acknowledgeUnsafe: true })
    return { listProfiles: result('native.listProfiles') }
  },
}

const call = async (operation, input = {}) => {
  calls.length = 0
  const value = await invokeSocialOperation({ client, account, operation, input })
  return { value, call: calls[0] }
}
const assertAccountRef = (ref) =>
  assert.deepEqual(ref, {
    kind: 'connected-account',
    version: 1,
    backend: 'default',
    platform: 'x',
    accountId: 'external-account',
  })
const assertScopedRef = (ref, kind, fields) =>
  assert.deepEqual(ref, {
    kind,
    version: 1,
    backend: 'default',
    platform: 'x',
    accountId: 'external-account',
    ...fields,
  })

assert.deepEqual(
  operationAvailable(
    {
      capabilities: [
        { operation: 'posts.read', platform: 'x', availability: 'available' },
        { operation: 'graph.follow', platform: 'x', availability: 'unsupported-by-platform' },
      ],
    },
    'posts.read',
    'x',
  ),
  true,
)
assert.equal(
  operationAvailable(
    {
      capabilities: [
        { operation: 'posts.read', platform: 'x', availability: 'unknown-until-request' },
      ],
    },
    'posts.read',
    'x',
  ),
  false,
)
assert.equal(
  operationAvailable(
    { capabilities: [{ operation: 'posts.read', platform: 'reddit', availability: 'available' }] },
    'posts.read',
    'x',
  ),
  false,
)
assert.deepEqual(
  availableSocialOperations(
    {
      capabilities: [
        { operation: 'accounts.read', platform: 'x', availability: 'available' },
        { operation: 'posts.read', platform: 'x', availability: 'available' },
        { operation: 'comments.write', platform: 'x', availability: 'unsupported-by-platform' },
      ],
    },
    'x',
  ).map(({ operation }) => operation),
  ['accounts.read', 'posts.read'],
)
assert.deepEqual(
  availableSocialOperations(
    {
      capabilities: [
        { operation: 'webhooks.verify', platform: 'x', availability: 'available' },
        { operation: 'webhooks.decode', platform: 'x', availability: 'available' },
      ],
    },
    'x',
    client,
  ).map(({ operation }) => operation),
  ['webhooks.verify', 'webhooks.decode'],
)

const accountRead = await call('accounts.read')
assert.equal(accountRead.call[0], 'accounts.get')
assertAccountRef(accountRead.call[1])

const listPosts = await call('posts.read', { cursor: 'next', limit: 10 })
assert.equal(listPosts.call[0], 'posts.list')
assertAccountRef(listPosts.call[1])
assert.deepEqual(listPosts.call[2], { cursor: 'next', limit: 10 })
assert.equal(
  (await call('posts.read', { queryMode: 'post', referenceId: 'post.1' })).call[0],
  'posts.get',
)
assertScopedRef(calls[0][1], 'platform-post', { postId: 'post.1' })
assert.equal(
  (await call('posts.read', { queryMode: 'delivery', referenceId: 'delivery.1' })).call[0],
  'posts.getDelivery',
)
assertScopedRef(calls[0][1], 'delivery', { deliveryId: 'delivery.1' })
assert.equal(
  (await call('media.upload', { mediaAttachment: { kind: 'image' } })).call[0],
  'media.upload',
)
assertAccountRef(calls[0][2])
assert.equal((await call('search.posts', { query: ' hello ', limit: 5 })).call[2].query, 'hello')
assertAccountRef(calls[0][1])
assert.equal((await call('analytics.account.read')).call[0], 'analytics.account')
assertAccountRef(calls[0][1])
assert.equal((await call('analytics.read', { postId: 'post.1' })).call[0], 'analytics.post')
assertScopedRef(calls[0][1], 'platform-post', { postId: 'post.1' })
assert.equal(
  (
    await call('analytics.report.read', {
      from: '2026-01-01',
      to: '2026-01-31',
      metrics: ['views'],
      dimensions: ['day'],
    })
  ).call[0],
  'analytics.report',
)
assertAccountRef(calls[0][1])
assert.equal((await call('profiles.read', { handle: 'reader' })).call[0], 'graph.profile')
assertAccountRef(calls[0][1])
assert.equal((await call('graph.read', { kind: 'followers' })).call[0], 'graph.list')
assertAccountRef(calls[0][1])
assert.equal((await call('graph.follow', { profileId: 'profile.1' })).call[0], 'graph.follow')
assertScopedRef(calls[0][1], 'profile', { profileId: 'profile.1' })
assert.equal((await call('comments.read', { postId: 'post.1' })).call[0], 'comments.list')
assertScopedRef(calls[0][1], 'platform-post', { postId: 'post.1' })
assert.equal(
  (await call('comments.write', { postId: 'post.1', commentId: 'comment.1', text: 'Thanks' }))
    .call[0],
  'comments.reply',
)
assertScopedRef(calls[0][1], 'comment', { postId: 'post.1', commentId: 'comment.1' })
assert.equal((await call('messages.read')).call[0], 'messages.conversations')
assertAccountRef(calls[0][1])
assert.equal(
  (await call('messages.read', { conversationId: 'conversation.1' })).call[0],
  'messages.list',
)
assertScopedRef(calls[0][1], 'conversation', { conversationId: 'conversation.1' })
assert.equal(
  (await call('messages.write', { conversationId: 'conversation.1', text: 'Hello' })).call[0],
  'messages.send',
)
assertScopedRef(calls[0][1], 'conversation', { conversationId: 'conversation.1' })
assert.equal((await call('notifications.read')).call[0], 'notifications.list')
assertAccountRef(calls[0][1])
assert.equal(
  (await call('notifications.seen', { seenAt: '2026-01-01T00:00:00.000Z' })).call[0],
  'notifications.seen',
)
assertAccountRef(calls[0][1])
assert.equal(
  (await call('posts.cancelScheduled', { jobId: 'job.1' })).call[0],
  'posts.cancelScheduled',
)
assertScopedRef(calls[0][1], 'scheduled-job', { jobId: 'job.1' })
assert.equal(
  (await call('posts.deleteBackendRecord', { recordId: 'record.1' })).call[0],
  'posts.deleteBackendRecord',
)
assertScopedRef(calls[0][1], 'backend-post', { recordId: 'record.1' })
assert.equal(
  (await call('posts.removeFromPlatform', { postId: 'post.1' })).call[0],
  'posts.removeFromPlatform',
)
assertScopedRef(calls[0][1], 'platform-post', { postId: 'post.1' })
const verified = await call('webhooks.verify', {
  headerName: 'x-signature',
  signature: 'signed',
  body: '{}',
})
assert.deepEqual(verified.value, { valid: true, method: 'hmac' })
assert.equal(verified.call[0], 'webhooks.verify')
assert.equal(verified.call[1], 'signed')
assert.deepEqual(verified.call[2], new TextEncoder().encode('{}'))
assert.equal(verified.call[3], 'default')
assert.match(verified.call[4], /^[0-9a-f-]{36}$/)
assert.deepEqual(verified.call[5], { maxAttempts: 1, maxElapsedMs: 60_000 })
const decoded = await call('webhooks.decode', {
  headerName: 'x-event',
  headerValue: 'post.created',
  body: '{"data":{}}',
})
assert.deepEqual(decoded.value, { event: 'post.created' })
assert.equal(decoded.call[0], 'webhooks.decode')
assert.equal(decoded.call[1], 'post.created')
assert.deepEqual(decoded.call[2], new TextEncoder().encode('{"data":{}}'))
assert.equal(decoded.call[3], 'default')
assert.match(decoded.call[4], /^[0-9a-f-]{36}$/)
assert.deepEqual(decoded.call[5], { maxAttempts: 1, maxElapsedMs: 60_000 })

assert.equal(
  await invokeNativeOperation({
    client,
    operation: 'listProfiles',
    allowed: ['listProfiles'],
  }),
  'native.listProfiles',
)
await assert.rejects(invokeSocialOperation({ client, account, operation: 'unknown' }), {
  code: 'operation_unsupported',
})
await assert.rejects(
  invokeNativeOperation({ client, operation: 'deleteEverything', allowed: ['listProfiles'] }),
  { code: 'operation_unsupported' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'comments.write',
    input: { postId: 'post', commentId: '', text: 'x' },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'analytics.report.read',
    input: { from: '2026-02-30', to: '2026-03-01', metrics: ['views'] },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'posts.read',
    input: { queryMode: 'unknown' },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'webhooks.verify',
    input: { signature: 'orphaned', body: '{}' },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'webhooks.decode',
    input: { headerName: 'x-event', body: '{}' },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client,
    account,
    operation: 'webhooks.decode',
    input: { body: 'x'.repeat(1_048_577) },
  }),
  { code: 'operation_input_invalid' },
)
await assert.rejects(
  invokeSocialOperation({
    client: {
      ...client,
      adapter: () => ({ webhooks: { verify: undefined, decode: undefined } }),
    },
    account,
    operation: 'webhooks.decode',
    input: { body: '{}' },
  }),
  { code: 'operation_unsupported' },
)

console.log(
  'social-operations: normalized SDK surfaces, scoped references, validation and native allowlisting passed',
)
