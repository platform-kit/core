import { normalizeRedditOptions, redditSubmissionFromApi, validateRedditSubmission } from './reddit-content.mjs'

export const REDDIT_SCOPES = Object.freeze(['identity', 'read', 'submit'])

const REDDIT_USER_AGENT = 'web:platformkit:social-publishing:v1.0'

export function redditUserAgent(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : REDDIT_USER_AGENT
}

export function redditAuthorizationUrl({ clientId, redirectUri, scopes, state }) {
  const authorization = new URL('https://www.reddit.com/api/v1/authorize')
  authorization.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: redirectUri,
    duration: 'permanent',
    scope: scopes.join(' '),
  }).toString()
  return authorization.toString()
}

export async function redditJson(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Reddit returned an empty response.')
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 1_048_576) {
      await reader.cancel()
      throw new Error('Reddit returned an oversized response.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  })
  const body = await redditJson(response)
  if (!response.ok) {
    const error = new Error(`Reddit returned HTTP ${response.status}.`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

export async function completeRedditOAuth({ callbackUrl, attempt, credentials, fetchImpl = fetch, userAgent }) {
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code') || ''
  if (!code || !attempt.codeVerifier) throw new Error('Reddit authorization code is missing.')
  const basic = btoa(`${credentials.clientId}:${credentials.clientSecret}`)
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': redditUserAgent(userAgent),
  }
  const token = await fetchJson(fetchImpl, 'https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: attempt.redirectUri,
    }),
  })
  if (typeof token.access_token !== 'string' || !token.access_token)
    throw new Error('Reddit returned no access token.')

  const identity = await fetchJson(fetchImpl, 'https://oauth.reddit.com/api/v1/me', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': redditUserAgent(userAgent),
    },
  })
  if (typeof identity.id !== 'string' || typeof identity.name !== 'string')
    throw new Error('Reddit returned an invalid account identity.')
  return [{
    account: {
      id: identity.id,
      providerId: 'reddit',
      name: identity.name,
      username: identity.name,
      avatarUrl: typeof identity.icon_img === 'string' ? identity.icon_img : null,
    },
    tokens: {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
      expiresAt: typeof token.expires_in === 'number'
        ? new Date(Date.now() + token.expires_in * 1000).toISOString()
        : null,
      scopes: typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : [...attempt.scopes],
    },
  }]
}

export async function refreshRedditOAuth({ tokens, credentials, fetchImpl = fetch, userAgent }) {
  if (!tokens.refreshToken) throw new Error('The Reddit account has no refresh token; reconnect it.')
  const basic = btoa(`${credentials.clientId}:${credentials.clientSecret}`)
  const next = await fetchJson(fetchImpl, 'https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': redditUserAgent(userAgent),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
  })
  if (typeof next.access_token !== 'string' || !next.access_token)
    throw new Error('Reddit returned no refreshed access token.')
  return {
    accessToken: next.access_token,
    refreshToken: typeof next.refresh_token === 'string' ? next.refresh_token : tokens.refreshToken,
    expiresAt: typeof next.expires_in === 'number'
      ? new Date(Date.now() + next.expires_in * 1000).toISOString()
      : null,
    scopes: typeof next.scope === 'string' ? next.scope.split(/\s+/).filter(Boolean) : [...tokens.scopes],
  }
}

export function createRedditBackend(account, tokens, { defineAdapter, connectedAccountRef, fetchImpl = fetch, userAgent } = {}) {
  const refForAccount = connectedAccountRef({
    backend: 'default',
    platform: 'reddit',
    accountId: account.id,
  })
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`https://oauth.reddit.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': redditUserAgent(userAgent),
        ...(init.body instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...init.headers,
      },
    })
    let body
    try { body = await redditJson(response) } catch (error) {
      if (response.ok) throw error
      body = null
    }
    if (!response.ok) {
      const error = new Error(`Reddit returned HTTP ${response.status}.`)
      error.status = response.status
      error.body = body
      throw error
    }
    return body
  }
  const capabilityManifest = {
    schemaVersion: 1,
    backend: 'direct-reddit',
    apiRevision: 'Reddit OAuth API',
    runtime: ['deno'],
    capabilities: [
      { operation: 'accounts.read', platform: 'reddit', availability: 'available', requiredScopes: ['identity'] },
      { operation: 'posts.publish', platform: 'reddit', availability: 'available', formats: ['text'], requiredScopes: ['submit'] },
      { operation: 'posts.read', platform: 'reddit', availability: 'available', formats: ['text'], requiredScopes: ['read'] },
      { operation: 'media.upload', platform: 'reddit', availability: 'unsupported-by-platform', notes: 'This adapter currently supports self-text posts only.' },
    ],
  }
  return defineAdapter({
    id: 'reddit',
    capabilities: capabilityManifest,
    posts: {
      prepareTarget(target) {
        return validateRedditSubmission({
          text: target.content.text,
          media: target.content.media,
          options: target.options,
        }).map((issue) => ({ ...issue, severity: 'error' }))
      },
      async publishTarget(target) {
        const observedAt = new Date().toISOString()
        const { subreddit, title } = normalizeRedditOptions(target.options)
        const form = new URLSearchParams({
          api_type: 'json',
          kind: 'self',
          sr: subreddit,
          title,
          text: target.content.text,
        })
        try {
          const body = await request('/api/submit', { method: 'POST', body: form })
          const result = redditSubmissionFromApi(body)
          if (result.error) {
            return {
              state: 'failed',
              targetIndex: target.targetIndex,
              account: target.account,
              code: result.error.code,
              message: result.error.message,
              retryDisposition: { kind: 'never' },
              observedAt,
            }
          }
          if (!result.id)
            return {
              state: 'unknown',
              targetIndex: target.targetIndex,
              account: target.account,
              reason: 'unmapped-state',
              diagnostic: 'Reddit accepted no recognizable post identifier.',
              observedAt,
            }
          const post = {
            kind: 'platform-post',
            version: 1,
            backend: target.account.backend,
            platform: 'reddit',
            accountId: target.account.accountId,
            postId: result.id,
          }
          return {
            state: 'published',
            targetIndex: target.targetIndex,
            account: target.account,
            post,
            ...(typeof result.url === 'string' ? { url: result.url } : {}),
            observedAt,
          }
        } catch (error) {
          const status = Number(error?.status)
          const dispatched = error instanceof TypeError || !Number.isFinite(status)
          return {
            state: dispatched ? 'unknown' : 'failed',
            targetIndex: target.targetIndex,
            account: target.account,
            ...(dispatched
              ? { reason: 'ambiguous-submission', diagnostic: 'Reddit submission outcome could not be confirmed.' }
              : {
                  code: status === 429 ? 'reddit_rate_limited' : status === 401 ? 'reddit_unauthorized' : 'reddit_request_failed',
                  message: status === 401 ? 'Reconnect this Reddit account.' : `Reddit returned HTTP ${status}.`,
                  retryDisposition: status === 429
                    ? { kind: 'after-delay', delayMs: 60_000 }
                    : status >= 500 ? { kind: 'reconcile-first' } : { kind: 'never' },
                }),
            observedAt,
          }
        }
      },
      async list(ref, input) {
        if (ref.accountId !== account.id || ref.platform !== 'reddit')
          throw new Error('The Reddit account reference does not match.')
        const limit = Math.max(1, Math.min(100, input.limit || 100))
        const body = await request(`/user/${encodeURIComponent(account.username)}/submitted.json?limit=${limit}&sort=new`)
        const children = body?.data?.children
        return {
          items: Array.isArray(children) ? children.flatMap((child) => {
            const item = child?.data
            return typeof item?.id === 'string' ? [{
              id: item.id,
              text: typeof item.selftext === 'string' ? item.selftext : '',
              title: typeof item.title === 'string' ? item.title : '',
              created_at: typeof item.created_utc === 'number' ? new Date(item.created_utc * 1000).toISOString() : '',
              url: typeof item.url === 'string' ? item.url : '',
            }] : []
          }) : [],
        }
      },
    },
  })
}
