import { connectedAccountRef, createSocial } from 'npm:@opencoredev/social-sdk@0.5.0'
import { x } from 'npm:@opencoredev/social-sdk@0.5.0/x'
import { refreshOAuthToken } from 'npm:@opencoredev/social-sdk@0.5.0/server'
import { createSocialAdapterRegistry, defineSocialAdapter } from './adapter.mjs'

const DEFAULT_SCOPES = ['tweet.read', 'users.read', 'tweet.write', 'media.write', 'offline.access']

type SocialAccount = {
  id: string
  providerId: string
  name: string
  username: string
  avatarUrl: string | null
}

type SocialMedia = {
  id: string
  kind: 'image' | 'video'
  mimeType: string
  fileName: string
  size: number
  bytes: Uint8Array
}

type SocialTokenSet = {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}
type XCredentials = {
  clientId?: string
  clientSecret?: string
  accessToken?: string
  userId?: string
}

function clientFor(account: SocialAccount, tokens: SocialTokenSet, fetcher = fetch) {
  return createSocial({
    backend: x({
      auth: { userId: account.id, accessToken: tokens.accessToken },
      fetch: fetcher,
    }),
  })
}

const refFor = (account: SocialAccount) =>
  connectedAccountRef({ backend: 'default', platform: 'x', accountId: account.id })

const mediaContent = async (items: SocialMedia[]) => Promise.all(items.map(async (item) => ({
  kind: item.kind,
  source: {
    kind: 'blob' as const,
    blob: new Blob([item.bytes], { type: item.mimeType }),
    fingerprint: await digest(item.bytes),
  },
  mimeType: item.mimeType,
  filename: item.fileName,
  byteSize: item.size,
})))

async function tokenRequest(url: string, body: URLSearchParams, credentials: XCredentials): Promise<SocialTokenSet> {
  const authorization = credentials.clientId && credentials.clientSecret
    ? `Basic ${btoa(`${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(credentials.clientSecret)}`)}`
    : ''
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || typeof result?.access_token !== 'string')
    throw new Error(`X token request failed (${typeof result?.error === 'string' ? result.error : `http_${response.status}`}).`)
  const expiry = typeof result.expires_in === 'number' && Number.isFinite(result.expires_in)
    ? new Date(Date.now() + result.expires_in * 1000).toISOString()
    : null
  return {
    accessToken: result.access_token,
    refreshToken: typeof result.refresh_token === 'string' ? result.refresh_token : null,
    expiresAt: expiry,
    scopes: typeof result.scope === 'string' ? result.scope.split(/\s+/).filter(Boolean) : [],
  }
}

function xCredentials(credentials: Record<string, string>): XCredentials {
  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  }
}

export const xAdapter = defineSocialAdapter({
  id: 'x',
  displayName: 'X',
  nativeOperations: [],
  defaultScopes: DEFAULT_SCOPES,
  allowedScopes: DEFAULT_SCOPES,
  async authorizationUrl({ state, redirectUri, scopes, codeChallenge, credentials }) {
    const url = new URL('https://x.com/i/oauth2/authorize')
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return url.toString()
  },
  async exchangeCode({ code, redirectUri, verifier, credentials }) {
    return tokenRequest('https://api.x.com/2/oauth2/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }), xCredentials(credentials))
  },
  async refreshToken({ tokens, credentials }) {
    const next = await refreshOAuthToken('x', {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      scopes: tokens.scopes,
    }, {
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      ...(tokens.scopes.length ? { scopes: tokens.scopes } : {}),
    })
    return {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      expiresAt: next.expiresAt ?? null,
      scopes: [...(next.scopes ?? tokens.scopes)],
    }
  },
  async listAccounts({ tokens }) {
    const response = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    const result = await response.json().catch(() => null)
    const user = result?.data
    if (!response.ok || typeof user?.id !== 'string' || typeof user?.username !== 'string')
      throw new Error(`X account discovery failed (http_${response.status}).`)
    return [{
      id: user.id,
      providerId: 'x',
      name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : user.username,
      username: user.username,
      avatarUrl: typeof user.profile_image_url === 'string' ? user.profile_image_url : null,
    }]
  },
  async capabilities({ account, tokens }) {
    return clientFor(account, tokens).capabilities().default
  },
  createClient({ account, tokens }) {
    return clientFor(account, tokens)
  },
  async validatePost({ account, tokens, text, attachments }) {
    const social = clientFor(account, tokens)
    const prepared = social.posts.prepare({
      targets: [{ account: refFor(account) }] as const,
      content: { text, media: await mediaContent(attachments) },
    })
    return { valid: prepared.ok, issues: prepared.issues.map((issue) => ({ code: issue.code, message: issue.message })) }
  },
  async uploadMedia({ account, media, tokens }) {
    const social = clientFor(account, tokens)
    const [content] = await mediaContent([media])
    const ref = await social.media.upload(content, refFor(account))
    return { providerMediaId: JSON.stringify(ref) }
  },
  async publish({ account, text, media, tokens, idempotencyKey }) {
    const social = clientFor(account, tokens)
    const result = await social.posts.publish({
      targets: [{ account: refFor(account) }] as const,
      content: {
        text,
        media: media.map((item) => ({
          kind: item.kind,
          source: { kind: 'media-ref' as const, ref: JSON.parse(item.providerMediaId) },
          mimeType: item.mimeType,
          filename: item.fileName,
          byteSize: item.size,
        })),
      },
      idempotencyKey,
      correlationId: idempotencyKey,
    })
    const outcome = result.outcomes[0]
    if (!outcome) return { outcome: 'unknown' as const }
    if (outcome.state === 'published')
      return { outcome: 'published' as const, providerPostId: outcome.post.postId, publishedAt: outcome.observedAt }
    if (outcome.state === 'accepted' || outcome.state === 'processing' || outcome.state === 'scheduled')
      return { outcome: 'accepted' as const }
    if (outcome.state === 'unknown') return { outcome: 'unknown' as const }
    if (outcome.state === 'failed')
      return { outcome: 'failed' as const, code: outcome.code, message: outcome.message, retryDisposition: outcome.retryDisposition }
    return { outcome: 'failed' as const, code: outcome.reason, message: 'The Social SDK did not submit this target.' }
  },
  async reconcile({ account, tokens, providerPostId, text, submittedAt }) {
    const social = clientFor(account, tokens)
    const page = await social.posts.list(refFor(account), { limit: 100 })
    if (providerPostId) {
      const found = page.items.find((post) => post.id === providerPostId)
      if (found) return { outcome: 'published' as const, providerPostId, publishedAt: String(found.created_at || '') }
    }
    const lowerBound = Date.parse(submittedAt) - 60_000
    const matches = page.items.filter((post) => {
      if (post.text !== text || typeof post.id !== 'string') return false
      const createdAt = typeof post.created_at === 'string' ? Date.parse(post.created_at) : NaN
      return Number.isFinite(createdAt) && createdAt >= lowerBound
    })
    if (matches.length === 1)
      return { outcome: 'published' as const, providerPostId: String(matches[0].id), publishedAt: String(matches[0].created_at) }
    return { outcome: 'unknown' as const }
  },
})

export const SOCIAL_ADAPTERS = createSocialAdapterRegistry([xAdapter])

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
