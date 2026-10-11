import { connectedAccountRef, createSocial, defineAdapter } from 'npm:@opencoredev/social-sdk@0.5.0'
import { bluesky } from 'npm:@opencoredev/social-sdk@0.5.0/bluesky'
import { instagram } from 'npm:@opencoredev/social-sdk@0.5.0/instagram'
import { linkedin } from 'npm:@opencoredev/social-sdk@0.5.0/linkedin'
import { threads } from 'npm:@opencoredev/social-sdk@0.5.0/threads'
import { tiktok } from 'npm:@opencoredev/social-sdk@0.5.0/tiktok'
import { youtube } from 'npm:@opencoredev/social-sdk@0.5.0/youtube'
import {
  blueskyOAuthTransport,
  exchangeLongLivedOAuthToken,
  refreshBlueskyOAuthSession,
  refreshOAuthToken,
} from 'npm:@opencoredev/social-sdk@0.5.0/server'
import { defineSocialAdapter } from './adapter.mjs'
import { completeRedditOAuth, createRedditBackend, redditAuthorizationUrl, redditUserAgent, refreshRedditOAuth } from './reddit-adapter.mjs'

const scopeSets = {
  instagram: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments'],
  threads: ['threads_basic', 'threads_content_publish'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
  tiktok: ['user.info.basic', 'video.publish', 'video.upload'],
  linkedin: ['openid', 'profile', 'w_member_social'],
  bluesky: ['atproto', 'transition:generic'],
  reddit: ['identity', 'read', 'submit'],
}

const socialAccount = (account) => ({
  id: account.id,
  providerId: account.providerId,
  name: account.name,
  username: account.username,
  avatarUrl: account.avatarUrl || null,
})

function backendFor(account, tokens, webhookSecret) {
  switch (account.providerId) {
    case 'reddit':
      return createRedditBackend(account, tokens, {
        defineAdapter,
        connectedAccountRef,
        userAgent: redditUserAgent(Deno.env.get('REDDIT_USER_AGENT')),
      })
    case 'instagram':
      return instagram({
        auth: { accessToken: tokens.accessToken, accountId: account.id, flavor: 'instagram-login' },
        ...(webhookSecret ? { webhookSecret } : {}),
      })
    case 'threads':
      return threads({
        auth: { userId: account.id, accessToken: tokens.accessToken },
        ...(webhookSecret ? { webhookSecret } : {}),
      })
    case 'youtube':
      return youtube({ auth: { accessToken: tokens.accessToken, channelId: account.id } })
    case 'tiktok':
      return tiktok({
        auth: { accessToken: tokens.accessToken, openId: account.id },
        verifiedMediaOrigins: [],
      })
    case 'linkedin':
      return linkedin({
        auth: { accessToken: tokens.accessToken, author: account.id },
        apiVersion: Deno.env.get('LINKEDIN_API_VERSION') || '202609',
        ...(webhookSecret ? { webhookSecret } : {}),
      })
    case 'bluesky': {
      const session = tokens.providerData?.blueskySession
      if (!session || typeof session !== 'object')
        throw new Error('The Bluesky OAuth session is unavailable; reconnect this account.')
      const transport = blueskyOAuthTransport(session)
      return bluesky({
        auth: { service: transport.service, did: session.did, handle: session.handle },
        session: transport,
      })
    }

    default:
      throw new Error(`No direct Social SDK adapter is registered for "${account.providerId}".`)
  }
}

const refFor = (account) => connectedAccountRef({
  backend: 'default',
  platform: account.providerId,
  accountId: account.id,
})

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function mediaContent(items) {
  return Promise.all(items.map(async (item) => ({
    kind: item.kind,
    source: {
      kind: 'blob',
      blob: new Blob([item.bytes], { type: item.mimeType }),
      fingerprint: await digest(item.bytes),
    },
    mimeType: item.mimeType,
    filename: item.fileName,
    byteSize: item.size,
  })))
}

function clientFor(account, tokens, webhookSecret) {
  return createSocial({ backend: backendFor(socialAccount(account), tokens, webhookSecret) })
}

export function createDirectWebhookClient(providerId, webhookSecret) {
  const account = {
    id: 'webhook',
    providerId,
    name: '',
    username: '',
    avatarUrl: null,
  }
  return clientFor(account, { accessToken: 'webhook-verification-only', refreshToken: null, scopes: [] }, webhookSecret)
}

function tokenValue(token) {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken || null,
    expiresAt: token.expiresAt || null,
    scopes: [...(token.scopes || [])],
  }
}

function createAdapter(id, displayName) {
  const scopes = scopeSets[id]
  return defineSocialAdapter({
    id,
    displayName,
    nativeOperations: [],
    ...(id === 'bluesky' ? { clientSecretRequired: false } : {}),
    defaultScopes: scopes,
    allowedScopes: scopes,
    capabilities({ account, tokens }) {
      const manifest = clientFor(account, tokens).capabilities().default
      if (id !== 'instagram' || !tokens.scopes?.includes('instagram_business_manage_comments')) return manifest
      return {
        ...manifest,
        capabilities: [
          ...(manifest.capabilities || []),
          { operation: 'comments.privateReply', platform: 'instagram', availability: 'available' },
        ],
      }
    },
    createClient({ account, tokens }) {
      return clientFor(account, tokens)
    },
    async validatePost({ account, tokens, text, attachments, options }) {
      const social = clientFor(account, tokens)
      const prepared = social.posts.prepare({
        targets: [{ account: refFor(account), ...(options ? { options } : {}) }],
        content: { text, media: await mediaContent(attachments) },
      })
      return {
        valid: prepared.ok,
        issues: prepared.issues.map((issue) => ({ code: issue.code, message: issue.message })),
      }
    },
    async uploadMedia({ account, media, tokens }) {
      const social = clientFor(account, tokens)
      const [content] = await mediaContent([media])
      const ref = await social.media.upload(content, refFor(account))
      return { providerMediaId: JSON.stringify(ref) }
    },
    async publish({ account, text, media, tokens, idempotencyKey, options }) {
      const social = clientFor(account, tokens)
      const result = await social.posts.publish({
        targets: [{ account: refFor(account), ...(options ? { options } : {}) }],
        content: {
          text,
          media: media.map((item) => ({
            kind: item.kind,
            source: { kind: 'media-ref', ref: JSON.parse(item.providerMediaId) },
            mimeType: item.mimeType,
            filename: item.fileName,
            byteSize: item.size,
          })),
        },
        idempotencyKey,
        correlationId: idempotencyKey,
      })
      const outcome = result.outcomes[0]
      if (!outcome) return { outcome: 'unknown' }
      if (outcome.state === 'published')
        return { outcome: 'published', providerPostId: outcome.post.postId, publishedAt: outcome.observedAt }
      if (['accepted', 'processing', 'scheduled'].includes(outcome.state)) return { outcome: 'accepted' }
      if (outcome.state === 'unknown') return { outcome: 'unknown' }
      if (outcome.state === 'failed')
        return {
          outcome: 'failed',
          code: outcome.code,
          message: outcome.message,
          retryDisposition: outcome.retryDisposition,
        }
      return { outcome: 'failed', code: outcome.reason, message: 'The Social SDK did not submit this target.' }
    },
    async reconcile({ account, tokens, providerPostId, text, submittedAt }) {
      const social = clientFor(account, tokens)
      const page = await social.posts.list(refFor(account), { limit: 100 })
      if (providerPostId) {
        const found = page.items.find((post) => post.id === providerPostId)
        if (found)
          return { outcome: 'published', providerPostId, publishedAt: String(found.created_at || '') }
      }
      const lowerBound = Date.parse(submittedAt) - 60_000
      const matches = page.items.filter((post) => {
        if (post.text !== text || typeof post.id !== 'string') return false
        const createdAt = typeof post.created_at === 'string' ? Date.parse(post.created_at) : NaN
        return Number.isFinite(createdAt) && createdAt >= lowerBound
      })
      if (matches.length === 1)
        return {
          outcome: 'published',
          providerPostId: String(matches[0].id),
          publishedAt: String(matches[0].created_at),
        }
      return { outcome: 'unknown' }
    },
    connection: {
      async start(input) {
        if (id === 'reddit') return { authorizationUrl: redditAuthorizationUrl({
          clientId: input.credentials.clientId,
          redirectUri: input.redirectUri,
          scopes: input.scopes,
          state: input.state,
        }) }
        if (id === 'bluesky') {
          const { blueskyOAuth } = await import('npm:@opencoredev/social-sdk@0.5.0/server')
          const provider = blueskyOAuth({
            clientId: input.credentials.clientId,
            scope: input.scopes.join(' '),
          })
          return provider.start({
            platforms: ['bluesky'],
            capabilities: ['posts.publish', 'media.upload'],
            redirectUri: input.redirectUri,
            state: input.state,
            codeChallenge: input.codeChallenge,
            ...(input.loginHint ? { loginHint: input.loginHint } : {}),
          })
        }
        const { oauthProvider } = await import('npm:@opencoredev/social-sdk@0.5.0/server')
        const provider = oauthProvider(id, {
          clientId: input.credentials.clientId,
          clientSecret: input.credentials.clientSecret,
          scopes: input.scopes,
          ...(id === 'linkedin' ? { linkedinApiVersion: Deno.env.get('LINKEDIN_API_VERSION') || '202609' } : {}),
        })
        return provider.start({
          platforms: [id],
          capabilities: ['posts.publish', 'media.upload'],
          redirectUri: input.redirectUri,
          state: input.state,
          codeChallenge: input.codeChallenge,
          ...(input.loginHint ? { loginHint: input.loginHint } : {}),
        })
      },
      async complete({ callbackUrl, attempt, credentials }) {
        if (id === 'reddit') return completeRedditOAuth({
          callbackUrl,
          attempt,
          credentials,
          userAgent: redditUserAgent(Deno.env.get('REDDIT_USER_AGENT')),
        })
        const tokensByAccount = new Map()
        let provider
        if (id === 'bluesky') {
          const { blueskyOAuth } = await import('npm:@opencoredev/social-sdk@0.5.0/server')
          provider = blueskyOAuth({
            clientId: credentials.clientId,
            scope: attempt.scopes.join(' '),
            sessionSink: async ({ account, session }) => {
              tokensByAccount.set(account.ref.accountId, {
                accessToken: session.accessToken,
                refreshToken: session.refreshToken || null,
                expiresAt: session.expiresAt || null,
                scopes: [...session.scopes],
                providerData: { blueskySession: session },
              })
            },
          })
        } else {
          const { oauthProvider } = await import('npm:@opencoredev/social-sdk@0.5.0/server')
          provider = oauthProvider(id, {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            scopes: attempt.scopes,
            ...(id === 'linkedin' ? { linkedinApiVersion: Deno.env.get('LINKEDIN_API_VERSION') || '202609' } : {}),
            credentialSink: {
              save: async ({ account, token }) => {
                const saved = id === 'threads' || id === 'instagram'
                  ? await exchangeLongLivedOAuthToken(id, {
                    clientId: credentials.clientId,
                    clientSecret: credentials.clientSecret,
                    scopes: attempt.scopes,
                  }, token)
                  : token
                tokensByAccount.set(account.ref.accountId, tokenValue(saved))
              },
            },
          })
        }
        const discovered = await provider.complete({ callbackUrl, attempt })
        return discovered.map(({ ref, displayName }) => {
          const tokens = tokensByAccount.get(ref.accountId)
          if (!tokens?.accessToken) throw new Error(`The ${id} authorization returned no account credential.`)
          const session = tokens.providerData?.blueskySession
          return {
            account: {
              id: ref.accountId,
              providerId: id,
              name: displayName || ref.accountId,
              username: session?.handle || ref.accountId,
              avatarUrl: null,
            },
            tokens,
          }
        })
      },
      async refresh({ tokens, credentials }) {
        if (id === 'reddit') return refreshRedditOAuth({
          tokens,
          credentials,
          userAgent: redditUserAgent(Deno.env.get('REDDIT_USER_AGENT')),
        })
        if (id === 'bluesky') {
          const session = tokens.providerData?.blueskySession
          if (!session || typeof session !== 'object')
            throw new Error('The Bluesky OAuth session is unavailable; reconnect this account.')
          const { refreshBlueskyOAuthSession } = await import('npm:@opencoredev/social-sdk@0.5.0/server')
          const next = await refreshBlueskyOAuthSession(session, { clientId: credentials.clientId })
          return {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken || null,
            expiresAt: next.expiresAt || null,
            scopes: [...next.scopes],
            providerData: { blueskySession: next },
          }
        }
        const next = await refreshOAuthToken(id, {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          scopes: tokens.scopes,
        }, tokens)
        return tokenValue(next)
      },
    },
  })
}

export const DIRECT_SOCIAL_ADAPTERS = [
  createAdapter('reddit', 'Reddit'),
  createAdapter('threads', 'Threads'),
  createAdapter('bluesky', 'Bluesky'),
  createAdapter('youtube', 'YouTube'),
  createAdapter('tiktok', 'TikTok'),
  createAdapter('instagram', 'Instagram'),
  createAdapter('linkedin', 'LinkedIn'),
]
