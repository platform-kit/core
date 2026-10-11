import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSocialAdapterRegistry,
  defineSocialAdapter,
  SOCIAL_ADAPTER_METHODS,
  SocialAdapterError,
} from '../supabase/functions/_shared/social/adapter.mjs'
import { createDeterministicSocialAdapter } from './fixtures/social-adapter.mjs'

const adapter = createDeterministicSocialAdapter()
const registry = createSocialAdapterRegistry([adapter])

assert.deepEqual(SOCIAL_ADAPTER_METHODS, [
  'capabilities', 'validatePost', 'uploadMedia', 'publish', 'reconcile',
])
assert.deepEqual(registry.ids(), ['fixture'])
assert.equal(registry.has('fixture'), true)
assert.equal(registry.get('fixture').id, adapter.id)
assert.equal(registry.get('fixture').publish, adapter.publish)
assert.equal(registry.has('missing'), false)
assert.throws(() => registry.get('missing'), /No social adapter is registered/)
assert.throws(() => createSocialAdapterRegistry([adapter, adapter]), /registered more than once/)
assert.throws(() => defineSocialAdapter({ ...adapter, publish: undefined }), /must implement publish/)
assert.throws(() => defineSocialAdapter({ ...adapter, id: 'Fixture' }), /lowercase platform name/)
assert.throws(() => defineSocialAdapter({ ...adapter, defaultScopes: ['missing'], allowedScopes: ['publish'] }), /default scope it does not allow/)

const root = fileURLToPath(new URL('../../../', import.meta.url))
const productionPaths = [
  'packages/kit/supabase/functions/social-oauth/index.ts',
  'packages/kit/supabase/functions/social/index.ts',
  'packages/kit/supabase/functions/social-publish/index.ts',
]
for (const file of productionPaths) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  assert.match(source, /SOCIAL_ADAPTERS/, `${file} must resolve platform behavior through the adapter registry`)
  assert.doesNotMatch(source, /validateXPost|publishXPost|refreshXCredentials|provider_id !== 'x'/, `${file} must not contain provider-specific paths`)
}
const providerSource = fs.readFileSync(path.join(root, 'packages/kit/supabase/functions/_shared/social/registry.ts'), 'utf8')
assert.match(providerSource, /xAdapter/)
assert.match(providerSource, /DIRECT_SOCIAL_ADAPTERS/)
const directSource = fs.readFileSync(path.join(root, 'packages/kit/supabase/functions/_shared/social/direct-sdk.mjs'), 'utf8')
for (const provider of ['threads', 'bluesky', 'youtube', 'tiktok', 'instagram', 'linkedin']) {
  assert.match(directSource, new RegExp(`createAdapter\\('${provider}'`), `${provider} must be registered`)
}

const modernConnection = defineSocialAdapter({
  ...adapter,
  id: 'modern',
  authorizationUrl: undefined,
  exchangeCode: undefined,
  refreshToken: undefined,
  listAccounts: undefined,
  connection: { start: async () => ({}), complete: async () => [], refresh: async () => ({}) },
})
assert.equal(typeof modernConnection.connection.complete, 'function')
assert.throws(() => defineSocialAdapter({
  ...modernConnection,
  connection: { start: async () => ({}), complete: async () => [] },
}), /connection must implement refresh/)

const authorization = new URL(await adapter.authorizationUrl({
  state: 'state-fixture',
  redirectUri: 'https://site.invalid/v1/social-oauth/callback',
  scopes: ['publish'],
  codeChallenge: 'challenge-fixture',
  credentials: {},
}))
assert.equal(authorization.searchParams.get('state'), 'state-fixture')
assert.equal(authorization.searchParams.get('redirect_uri'), 'https://site.invalid/v1/social-oauth/callback')

const tokens = await adapter.exchangeCode({
  code: 'fixture-code',
  state: 'state-fixture',
  redirectUri: 'https://site.invalid/v1/social-oauth/callback',
  verifier: 'verifier-fixture',
  credentials: {},
})
assert.equal(tokens.accessToken, 'fixture-access-token')
assert.deepEqual(await adapter.refreshToken({ tokens, credentials: {} }), {
  ...tokens,
  accessToken: 'fixture-refreshed-access-token',
})
assert.deepEqual((await adapter.listAccounts({ tokens, credentials: {} })).map((account) => account.id), ['account-1', 'account-2'])

const account = (await adapter.listAccounts({ tokens, credentials: {} }))[0]
const capabilities = await adapter.capabilities({ account, tokens, credentials: {} })
const valid = await adapter.validatePost({
  account,
  text: 'A scheduled update.',
  attachments: [{ id: 'image-1', kind: 'image', mimeType: 'image/png', fileName: 'image.png', size: 1_024, bytes: new Uint8Array([1]) }],
  capabilities,
})
assert.deepEqual(valid, { valid: true, issues: [] })
const invalid = await adapter.validatePost({
  account,
  text: 'x'.repeat(281),
  attachments: [{ id: 'video-1', kind: 'video', mimeType: 'video/quicktime', fileName: 'video.mov', size: 1_024, bytes: new Uint8Array([1]) }],
  capabilities,
})
assert.equal(invalid.valid, false)
assert.deepEqual(invalid.issues.map((issue) => issue.code), ['text_too_long', 'unsupported_media'])

const media = await adapter.uploadMedia({
  account,
  media: { id: 'image-1', kind: 'image', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', fileName: 'image.png', size: 3 },
  tokens,
  credentials: {},
  idempotencyKey: 'target-1',
})
assert.equal(media.providerMediaId, 'media-image/png-target-1')

const publication = {
  account,
  text: 'A scheduled update.',
  media: [{
    id: 'image-1',
    kind: 'image',
    mimeType: 'image/png',
    fileName: 'image.png',
    size: 3,
    providerMediaId: media.providerMediaId,
  }],
  tokens,
  credentials: {},
  idempotencyKey: 'target-1',
}
assert.deepEqual(await adapter.publish(publication), { outcome: 'accepted', providerPostId: 'post-target-1' })
assert.deepEqual(await adapter.publish(publication), { outcome: 'accepted', providerPostId: 'post-target-1' })
assert.deepEqual(await adapter.reconcile({
  account,
  idempotencyKey: 'target-1',
  providerPostId: 'post-target-1',
  text: 'A scheduled update.',
  submittedAt: '2030-01-01T00:00:00.000Z',
  tokens,
  credentials: {},
}), { outcome: 'published', providerPostId: 'post-target-1', publishedAt: '2030-01-01T00:00:00.000Z' })

await assert.rejects(
  adapter.exchangeCode({ code: 'wrong', state: 'state-fixture', redirectUri: 'https://site.invalid/callback', verifier: 'verifier-fixture', credentials: {} }),
  (error) => error instanceof SocialAdapterError && error.code === 'invalid_code' && error.outcome === 'known',
)

console.log('social-adapter: adapter registry and all normalized provider operations passed')
