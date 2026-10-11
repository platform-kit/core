/**
 * @typedef {{ id: string, providerId: string, name: string, username: string, avatarUrl: string | null }} SocialAccount
 * @typedef {{ id: string, kind: 'image' | 'video', mimeType: string, fileName: string, size: number, bytes: Uint8Array }} SocialMedia
 * @typedef {{ code: string, message: string, attachmentId?: string }} SocialValidationIssue
 * @typedef {{ valid: boolean, issues: SocialValidationIssue[] }} SocialValidation
 * @typedef {{ accessToken: string, refreshToken: string | null, expiresAt: string | null, scopes: string[] }} SocialTokenSet
 * @typedef {{ outcome: 'published' | 'pending' | 'not_found' | 'unknown', providerPostId?: string, publishedAt?: string }} SocialReconciliation
 * @typedef {Object} SocialAdapter
 * @property {string} id
 * @property {string} [displayName]
 * @property {string[]} [nativeOperations]
 * @property {string[]} [defaultScopes]
 * @property {string[]} [allowedScopes]
 * @property {(input: { account: SocialAccount, tokens: SocialTokenSet }) => object} [createClient]
 * @property {boolean} [clientSecretRequired]
 * @property {{
 *   start: (input: { state: string, redirectUri: string, scopes: string[], codeChallenge: string, credentials: Record<string, string>, loginHint?: string }) => Promise<{ authorizationUrl: string, providerState?: string, providerStateSecret?: boolean }>,
 *   complete: (input: { callbackUrl: string, attempt: object, credentials: Record<string, string> }) => Promise<Array<{ account: SocialAccount, tokens: SocialTokenSet }>>,
 *   refresh: (input: { tokens: SocialTokenSet, credentials: Record<string, string> }) => Promise<SocialTokenSet>
 * }} [connection]
 * @property {(input: { state: string, redirectUri: string, scopes: string[], codeChallenge: string, credentials: Record<string, string> }) => Promise<string>} [authorizationUrl]
 * @property {(input: { code: string, state: string, redirectUri: string, verifier: string, credentials: Record<string, string> }) => Promise<SocialTokenSet>} [exchangeCode]
 * @property {(input: { tokens: SocialTokenSet, credentials: Record<string, string> }) => Promise<SocialTokenSet>} [refreshToken]
 * @property {(input: { tokens: SocialTokenSet, credentials: Record<string, string> }) => Promise<SocialAccount[]>} [listAccounts]
 * @property {(input: { account: SocialAccount, tokens: SocialTokenSet, credentials: Record<string, string> }) => Promise<object>} capabilities
 * @property {(input: { account: SocialAccount, tokens: SocialTokenSet, text: string, attachments: SocialMedia[], capabilities: object, options?: object }) => Promise<SocialValidation>} validatePost
 * @property {(input: { account: SocialAccount, media: SocialMedia, tokens: SocialTokenSet, credentials: Record<string, string>, idempotencyKey: string }) => Promise<{ providerMediaId: string }>} uploadMedia
 * @property {(input: { account: SocialAccount, text: string, media: Array<{ id: string, kind: 'image' | 'video', mimeType: string, fileName: string, size: number, providerMediaId: string }>, tokens: SocialTokenSet, credentials: Record<string, string>, idempotencyKey: string, options?: object }) => Promise<{ outcome: 'accepted' | 'published' | 'failed' | 'unknown', providerPostId?: string, publishedAt?: string, code?: string, message?: string, retryDisposition?: { kind?: string, delayMs?: number } }>} publish
 * @property {(input: { account: SocialAccount, idempotencyKey: string, providerPostId?: string, text: string, submittedAt: string, tokens: SocialTokenSet, credentials: Record<string, string> }) => Promise<SocialReconciliation>} reconcile
 */

export const SOCIAL_ADAPTER_METHODS = Object.freeze([
  'capabilities',
  'validatePost',
  'uploadMedia',
  'publish',
  'reconcile',
])
const LEGACY_CONNECTION_METHODS = Object.freeze([
  'authorizationUrl',
  'exchangeCode',
  'refreshToken',
  'listAccounts',
])
const CONNECTION_METHODS = Object.freeze(['start', 'complete', 'refresh'])

const ADAPTER_ID = /^[a-z][a-z0-9-]*$/

/**
 * @param {SocialAdapter} adapter
 * @returns {SocialAdapter}
 */
export function defineSocialAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter))
    throw new TypeError('A social adapter must be an object.')
  if (typeof adapter.id !== 'string' || !ADAPTER_ID.test(adapter.id))
    throw new TypeError('A social adapter id must be a lowercase platform name.')
  if (adapter.displayName !== undefined && (typeof adapter.displayName !== 'string' || !adapter.displayName.trim()))
    throw new TypeError(`Social adapter "${adapter.id}" must have a non-empty display name.`)
  if (adapter.clientSecretRequired !== undefined && typeof adapter.clientSecretRequired !== 'boolean')
    throw new TypeError(`Social adapter "${adapter.id}" has an invalid clientSecretRequired flag.`)
  for (const key of ['defaultScopes', 'allowedScopes']) {
    const scopes = adapter[key]
    if (scopes !== undefined && (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string' || !scope.trim())
        || new Set(scopes).size !== scopes.length))
      throw new TypeError(`Social adapter "${adapter.id}" has invalid ${key}.`)
  }
  if (adapter.defaultScopes && adapter.allowedScopes
      && adapter.defaultScopes.some((scope) => !adapter.allowedScopes.includes(scope)))
    throw new TypeError(`Social adapter "${adapter.id}" has a default scope it does not allow.`)
  if (adapter.connection !== undefined) {
    if (!adapter.connection || typeof adapter.connection !== 'object' || Array.isArray(adapter.connection))
      throw new TypeError(`Social adapter "${adapter.id}" has an invalid connection lifecycle.`)
    for (const method of CONNECTION_METHODS) {
      if (typeof adapter.connection[method] !== 'function')
        throw new TypeError(`Social adapter "${adapter.id}" connection must implement ${method}().`)
    }
  } else {
    for (const method of LEGACY_CONNECTION_METHODS) {
      if (typeof adapter[method] !== 'function')
        throw new TypeError(`Social adapter "${adapter.id}" must implement ${method}() or connection.${method}.`)
    }
  }
  for (const method of SOCIAL_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function')
      throw new TypeError(`Social adapter "${adapter.id}" must implement ${method}().`)
  }
  return Object.freeze({
    ...adapter,
    ...(adapter.defaultScopes ? { defaultScopes: Object.freeze([...adapter.defaultScopes]) } : {}),
    ...(adapter.allowedScopes ? { allowedScopes: Object.freeze([...adapter.allowedScopes]) } : {}),
    ...(adapter.connection ? { connection: Object.freeze({ ...adapter.connection }) } : {}),
  })
}

/**
 * @param {SocialAdapter[]} adapters
 */
export function createSocialAdapterRegistry(adapters) {
  const byId = new Map()
  for (const candidate of adapters) {
    const adapter = defineSocialAdapter(candidate)
    if (byId.has(adapter.id)) throw new Error(`Social adapter "${adapter.id}" is registered more than once.`)
    byId.set(adapter.id, adapter)
  }
  return Object.freeze({
    ids: () => [...byId.keys()],
    has: (id) => byId.has(id),
    get: (id) => {
      const adapter = byId.get(id)
      if (!adapter) throw new Error(`No social adapter is registered for "${id}".`)
      return adapter
    },
  })
}

/**
 * @typedef {{ providerId: string, operation: string, code: string, message: string, retryable?: boolean, outcome?: 'known' | 'unknown' }} SocialAdapterErrorOptions
 */
export class SocialAdapterError extends Error {
  /** @param {SocialAdapterErrorOptions} options */
  constructor({ providerId, operation, code, message, retryable = false, outcome = 'known' }) {
    if (typeof providerId !== 'string' || !ADAPTER_ID.test(providerId)) throw new TypeError('A social adapter error needs a valid provider id.')
    if (typeof operation !== 'string' || !operation) throw new TypeError('A social adapter error needs an operation.')
    if (typeof code !== 'string' || !code) throw new TypeError('A social adapter error needs a code.')
    if (typeof message !== 'string' || !message) throw new TypeError('A social adapter error needs a message.')
    if (typeof retryable !== 'boolean') throw new TypeError('A social adapter error retryable flag must be boolean.')
    if (!['known', 'unknown'].includes(outcome)) throw new TypeError('A social adapter error outcome must be known or unknown.')
    super(message)
    this.name = 'SocialAdapterError'
    this.providerId = providerId
    this.operation = operation
    this.code = code
    this.retryable = retryable
    this.outcome = outcome
  }
}
