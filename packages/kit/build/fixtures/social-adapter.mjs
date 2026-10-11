import { defineSocialAdapter, SocialAdapterError } from '../../supabase/functions/_shared/social/adapter.mjs'

const ACCOUNT = Object.freeze({
  id: 'account-1',
  providerId: 'fixture',
  name: 'Fixture Studio',
  username: 'fixture-studio',
  avatarUrl: null,
})
const TOKENS = Object.freeze({
  accessToken: 'fixture-access-token',
  refreshToken: 'fixture-refresh-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
  scopes: ['publish'],
})
const CAPABILITIES = Object.freeze({
  maxTextLength: 280,
  media: {
    image: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5_000_000 },
    video: { mimeTypes: ['video/mp4'], maxBytes: 20_000_000 },
  },
})

export function createDeterministicSocialAdapter() {
  const deliveries = new Map()
  return defineSocialAdapter({
    id: 'fixture',
    displayName: 'Fixture',
    defaultScopes: ['publish'],
    allowedScopes: ['publish'],
    async authorizationUrl({ state, redirectUri }) {
      const url = new URL('https://fixture.invalid/oauth/authorize')
      url.searchParams.set('state', state)
      url.searchParams.set('redirect_uri', redirectUri)
      return url.href
    },
    async exchangeCode({ code }) {
      if (code !== 'fixture-code') throw new SocialAdapterError({
        providerId: 'fixture', operation: 'exchangeCode', code: 'invalid_code',
        message: 'The fixture authorization code is invalid.',
      })
      return { ...TOKENS }
    },
    async refreshToken({ tokens }) {
      if (tokens.refreshToken !== TOKENS.refreshToken) throw new SocialAdapterError({
        providerId: 'fixture', operation: 'refreshToken', code: 'invalid_refresh_token',
        message: 'The fixture refresh token is invalid.',
      })
      return { ...TOKENS, accessToken: 'fixture-refreshed-access-token' }
    },
    async listAccounts() {
      return [ACCOUNT, { ...ACCOUNT, id: 'account-2', username: 'fixture-alt' }]
    },
    async capabilities() {
      return CAPABILITIES
    },
    async validatePost({ text, attachments }) {
      const issues = []
      if (text.length > CAPABILITIES.maxTextLength)
        issues.push({ code: 'text_too_long', message: 'Text exceeds the fixture platform limit.' })
      for (const attachment of attachments) {
        const allowed = CAPABILITIES.media[attachment.kind]
        if (!allowed || !allowed.mimeTypes.includes(attachment.mimeType))
          issues.push({ code: 'unsupported_media', message: 'The attachment type is not supported.', attachmentId: attachment.id })
        else if (attachment.size > allowed.maxBytes)
          issues.push({ code: 'media_too_large', message: 'The attachment exceeds the fixture platform limit.', attachmentId: attachment.id })
      }
      return { valid: issues.length === 0, issues }
    },
    async uploadMedia({ media, idempotencyKey }) {
      return { providerMediaId: `media-${media.mimeType}-${idempotencyKey}` }
    },
    async publish({ idempotencyKey }) {
      if (!deliveries.has(idempotencyKey))
        deliveries.set(idempotencyKey, { outcome: 'accepted', providerPostId: `post-${idempotencyKey}` })
      return { ...deliveries.get(idempotencyKey) }
    },
    async reconcile({ idempotencyKey, providerPostId }) {
      const delivery = deliveries.get(idempotencyKey)
      if (!delivery || (providerPostId && providerPostId !== delivery.providerPostId)) return { outcome: 'not_found' }
      return { outcome: 'published', providerPostId: delivery.providerPostId, publishedAt: '2030-01-01T00:00:00.000Z' }
    },
  })
}
