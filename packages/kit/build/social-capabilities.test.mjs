import assert from 'node:assert/strict'
import {
  availableSocialAutomationRoutes,
  availableSocialOperations,
  operationAvailable,
} from '../supabase/functions/_shared/social/operations.mjs'

const platform = 'capability-fixture'
const routes = ['comments.read', 'comments.write', 'messages.read', 'messages.write']
const manifest = (capabilities) => ({ capabilities })
const available = (operation) => ({
  operation,
  platform,
  availability: 'available',
})

for (const operation of routes) {
  assert.equal(
    operationAvailable(manifest([available(operation)]), operation, platform),
    true,
    `${operation} is available when declared by the provider`,
  )
  assert.equal(
    operationAvailable(manifest([]), operation, platform),
    false,
    `${operation} is unavailable when omitted by the provider`,
  )
  assert.equal(
    operationAvailable(
      manifest([{ ...available(operation), availability: 'unknown-until-request' }]),
      operation,
      platform,
    ),
    false,
    `${operation} is not exposed while provider support is unknown`,
  )
  assert.equal(
    operationAvailable(
      manifest([{ ...available(operation), availability: 'unsupported-by-platform' }]),
      operation,
      platform,
    ),
    false,
    `${operation} is not exposed when the provider marks it unsupported`,
  )
}

const allRoutes = availableSocialOperations(
  manifest(routes.map(available)),
  platform,
).map(({ operation }) => operation)
assert.deepEqual(allRoutes, routes)

const commentsOnly = availableSocialOperations(
  manifest([available('comments.read'), available('comments.write')]),
  platform,
).map(({ operation }) => operation)
assert.deepEqual(commentsOnly, ['comments.read', 'comments.write'])

const messagesOnly = availableSocialOperations(
  manifest([available('messages.read'), available('messages.write')]),
  platform,
).map(({ operation }) => operation)
assert.deepEqual(messagesOnly, ['messages.read', 'messages.write'])

assert.deepEqual(
  availableSocialOperations(
    manifest([{ ...available('messages.read'), platform: 'another-platform' }]),
    platform,
  ),
  [],
  'a capability declared for a different platform cannot leak into this account',
)

assert.deepEqual(
  availableSocialOperations(manifest([available('profiles.read')]), platform)
    .map(({ operation }) => operation),
  ['profiles.read'],
  'author profile reads are available only when explicitly declared by the provider',
)

const socialClient = (webhooks = { verify() {}, decode() {} }) => ({
  adapter: () => ({ webhooks }),
})
const routesFor = (backend, provider, operations, webhooks) =>
  availableSocialAutomationRoutes(
    manifest(
      [
        ...operations.map((operation) => ({
          operation,
          platform: provider,
          availability: 'available',
        })),
        ...(webhooks
          ? [{ operation: 'webhooks.verify', platform: provider, availability: webhooks }]
          : [{ operation: 'webhooks.verify', platform: provider, availability: 'available' }]),
      ],
    ),
    provider,
    socialClient(),
    backend,
  )

assert.deepEqual(
  routesFor('default', 'instagram', [
    'comments.read',
    'comments.write',
    'messages.read',
    'messages.write',
  ]),
  [
    { eventKind: 'comment', destinations: ['public_reply'] },
    { eventKind: 'dm', destinations: ['private_dm'] },
  ],
  'comment-triggered replies stay public even when the same account can send DMs',
)
assert.deepEqual(
  routesFor('default', 'instagram', [
    'comments.read',
    'comments.write',
    'comments.privateReply',
  ]),
  [{ eventKind: 'comment', destinations: ['public_reply', 'private_dm'] }],
  'a private DM from a comment is exposed only when the provider explicitly declares that action',
)
assert.deepEqual(
  routesFor('default', 'threads', ['comments.read', 'comments.write']),
  [{ eventKind: 'comment', destinations: ['public_reply'] }],
)
assert.deepEqual(
  routesFor('default', 'linkedin', ['comments.read', 'comments.write'], 'approval-dependent'),
  [],
  'approval-dependent webhook support cannot enable automation',
)
assert.deepEqual(
  routesFor('zernio', 'instagram', [
    'comments.read',
    'comments.write',
    'messages.read',
    'messages.write',
  ]),
  [
    { eventKind: 'comment', destinations: ['public_reply'] },
    { eventKind: 'dm', destinations: ['private_dm'] },
  ],
)
assert.deepEqual(
  routesFor('post-for-me', 'instagram', [
    'comments.read',
    'comments.write',
    'messages.read',
    'messages.write',
  ]),
  [],
  'the shared-secret-only Post for Me webhook does not qualify for signed automation events',
)
assert.deepEqual(
  availableSocialAutomationRoutes(
    manifest([
      { operation: 'webhooks.verify', platform: 'instagram', availability: 'available' },
      { operation: 'comments.read', platform: 'instagram', availability: 'available' },
      { operation: 'comments.write', platform: 'instagram', availability: 'available' },
    ]),
    'instagram',
    socialClient({ verify() {} }),
  ),
  [],
  'a provider without an actual webhook decoder is not actionable',
)
assert.deepEqual(routesFor('default', platform, ['comments.read', 'comments.write']), [])

console.log('Social Desk capabilities: provider-declared comment and DM routes only')
