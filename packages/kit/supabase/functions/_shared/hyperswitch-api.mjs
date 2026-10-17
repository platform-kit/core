import { PaymentProviderError } from './payment-provider.mjs'

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
const EVENT_TYPES = Object.freeze({
  payment_succeeded: 'payment.succeeded',
  payment_failed: 'payment.failed',
  payment_captured: 'payment.succeeded',
  payment_cancelled_post_capture: 'payment.refunded',
  refund_succeeded: 'payment.refunded',
  invoice_paid: 'invoice.paid',
  payout_success: 'payout.updated',
  payout_failed: 'payout.updated',
  payout_initiated: 'payout.updated',
  payout_processing: 'payout.updated',
  payout_cancelled: 'payout.updated',
  payout_expired: 'payout.updated',
  payout_reversed: 'payout.updated',
  payout_not_permitted: 'payout.updated',
})

const CHECKOUT_EXPIRATION_EVENTS = new Set(['payment_cancelled', 'payment_expired'])
export const HYPERSWITCH_DEFAULT_CLIENT_URL = 'https://beta.hyperswitch.io/v2'
const PAYOUT_STATUSES = Object.freeze({
  payout_success: 'success',
  payout_failed: 'failed',
  payout_initiated: 'initiated',
  payout_processing: 'processing',
  payout_cancelled: 'cancelled',
  payout_expired: 'expired',
  payout_reversed: 'reversed',
  payout_not_permitted: 'not_permitted',
})

export function hyperswitchClientUrl(value) {
  const configured = typeof value === 'string' && value.trim()
    ? value.trim()
    : HYPERSWITCH_DEFAULT_CLIENT_URL
  let url
  try {
    url = new URL(configured)
  } catch {
    throw new PaymentProviderError(
      'hyperswitch_configuration_invalid',
      'HYPERSWITCH_CLIENT_URL must be a valid SDK URL.',
      503,
    )
  }
  const localHttp = url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const path = url.pathname.replace(/\/+$/, '')
  if ((url.protocol !== 'https:' && !localHttp) ||
      url.username || url.password || url.search || url.hash ||
      path.endsWith('/v1') || (!localHttp && !path.endsWith('/v2'))) {
    throw new PaymentProviderError(
      'hyperswitch_configuration_invalid',
      'HYPERSWITCH_CLIENT_URL must be a V2 HTTPS SDK URL, or a loopback HTTP URL for local development, without credentials, query, or fragment.',
      503,
    )
  }
  return url.href.replace(/\/+$/, '')
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PaymentProviderError('hyperswitch_configuration_missing', `${name} is required.`, 503)
  }
  return value.trim()
}

function responseMessage(value, fallback) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  for (const field of ['message', 'error_message', 'error']) {
    const message = value[field]
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}

export function createHyperswitchApi(secrets, configuration, runtime = {}) {
  const baseUrl = requiredText(secrets.HYPERSWITCH_BASE_URL, 'HYPERSWITCH_BASE_URL')
  const apiKey = requiredText(secrets.HYPERSWITCH_API_KEY, 'HYPERSWITCH_API_KEY')
  const profileId = requiredText(secrets.HYPERSWITCH_PROFILE_ID, 'HYPERSWITCH_PROFILE_ID')
  const publishableKey = requiredText(
    secrets.HYPERSWITCH_PUBLISHABLE_KEY,
    'HYPERSWITCH_PUBLISHABLE_KEY',
  )
  let parsedBaseUrl
  try {
    parsedBaseUrl = new URL(baseUrl)
  } catch {
    throw new PaymentProviderError('hyperswitch_configuration_invalid', 'HYPERSWITCH_BASE_URL must be a valid HTTP(S) URL.', 503)
  }
  if (!['https:', 'http:'].includes(parsedBaseUrl.protocol) ||
      parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new PaymentProviderError('hyperswitch_configuration_invalid', 'HYPERSWITCH_BASE_URL must be an HTTP(S) origin without credentials, query, or fragment.', 503)
  }
  const fetchImpl = runtime.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new PaymentProviderError('hyperswitch_fetch_missing', 'The server runtime does not provide fetch for Hyperswitch requests.', 500)
  }
  const profileCapabilities = configuration?.profileCapabilities
  if (!Array.isArray(profileCapabilities) || new Set(profileCapabilities).size !== profileCapabilities.length) {
    throw new PaymentProviderError('hyperswitch_profile_invalid', 'Hyperswitch requires a unique profile capability list.', 500)
  }

  const requestWithAuth = async (method, path, body, idempotencyKey, authorization) => {
    // The V2 Router serves its payment-method service group (customers, payment-method
    // sessions, saved methods) under a configurable prefix; the Web SDK requires `v1`.
    const paymentMethodServicePath = typeof path === 'string' &&
      /^\/v1\/(customers|payment-method-sessions|payment-methods)(\/|$)/.test(path)
    if (typeof path !== 'string' || path.startsWith('//') ||
        (!path.startsWith('/v2/') && !paymentMethodServicePath)) {
      throw new PaymentProviderError('hyperswitch_path_invalid', 'Hyperswitch API paths must use a V2 Router route on the configured instance.', 500)
    }
    if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) {
      throw new PaymentProviderError('invalid_idempotency_key', 'Hyperswitch requests require a non-empty idempotency key when supplied.', 422)
    }
    const headers = {
      'content-type': 'application/json',
      'x-profile-id': profileId,
      Authorization: authorization,
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
    const basePath = parsedBaseUrl.pathname.replace(/\/+$/, '')
    const url = new URL(`${basePath}${path}`, parsedBaseUrl.origin)
    if (url.origin !== parsedBaseUrl.origin || (basePath && !url.pathname.startsWith(`${basePath}/`))) {
      throw new PaymentProviderError('hyperswitch_path_invalid', 'Hyperswitch API path escaped the configured instance.', 500)
    }

    let response
    for (let attempt = 0; attempt < 2; attempt++) {
      const init = {
        method,
        headers,
        ...(body == null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      }
      try {
        response = await fetchImpl(url, init)
      } catch (error) {
        if (attempt === 0 && idempotencyKey) continue
        throw new PaymentProviderError(
          'hyperswitch_network_error',
          `Hyperswitch request failed: ${String(error?.message ?? error)}`,
          502,
        )
      }
      if (attempt === 0 && idempotencyKey && RETRYABLE_STATUSES.has(response.status)) continue
      break
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      throw new PaymentProviderError('hyperswitch_invalid_response', 'Hyperswitch returned a response that was not valid JSON.', 502)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new PaymentProviderError('hyperswitch_invalid_response', 'Hyperswitch returned an invalid response object.', 502)
    }
    if (!response.ok) {
      throw new PaymentProviderError(
        'hyperswitch_request_failed',
        responseMessage(payload, `Hyperswitch returned HTTP ${response.status}.`),
        response.status >= 400 && response.status < 500 ? response.status : 502,
      )
    }
    return payload
  }
  const request = (method, path, body, idempotencyKey) =>
    requestWithAuth(method, path, body, idempotencyKey, `api-key=${apiKey}`)
  const requestWithClientSecret = (method, path, body, idempotencyKey, clientSecret) => {
    if (typeof clientSecret !== 'string' || !clientSecret.trim()) {
      throw new PaymentProviderError(
        'hyperswitch_client_secret_missing',
        'Hyperswitch V2 SDK authorization requires a client secret.',
        422,
      )
    }
    return requestWithAuth(
      method,
      path,
      body,
      idempotencyKey,
      `publishable-key=${publishableKey},client-secret=${clientSecret.trim()}`,
    )
  }

  return Object.freeze({
    profileId,
    profileCapabilities: Object.freeze([...profileCapabilities]),
    request,
    requestWithClientSecret,
  })
}

function constantTimeEqual(expected, received) {
  if (expected.length !== received.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index)
  }
  return difference === 0
}

async function hmacSha512Hex(secret, rawBody) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody))
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function epochSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 10_000_000_000 ? value / 1000 : value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  }
  return null
}

function stringMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string'))
}

export async function verifyHyperswitchWebhook(request, secret) {
  const signingKey = requiredText(secret, 'HYPERSWITCH_WEBHOOK_SECRET')
  const rawBody = new Uint8Array(await request.arrayBuffer())
  const supplied = request.headers.get('X-Webhook-Signature-512') ?? ''
  if (!/^[0-9a-f]{128}$/i.test(supplied)) {
    throw new PaymentProviderError('invalid_webhook', 'Hyperswitch webhook signature is missing or malformed.', 400)
  }
  const expected = await hmacSha512Hex(signingKey, rawBody)
  if (!constantTimeEqual(expected, supplied.toLowerCase())) {
    throw new PaymentProviderError('invalid_webhook', 'Hyperswitch webhook signature verification failed.', 400)
  }

  let envelope
  try {
    envelope = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    throw new PaymentProviderError('invalid_webhook', 'Hyperswitch webhook body is not valid JSON.', 400)
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      typeof envelope.event_id !== 'string' || !envelope.event_id ||
      typeof envelope.event_type !== 'string' || !envelope.event_type ||
      !envelope.content || typeof envelope.content !== 'object' ||
      Array.isArray(envelope.content) ||
      !envelope.content.object || typeof envelope.content.object !== 'object' ||
      Array.isArray(envelope.content.object)) {
    throw new PaymentProviderError('invalid_webhook', 'Hyperswitch webhook envelope is incomplete.', 400)
  }

  const object = envelope.content.object
  const metadata = stringMetadata(object.metadata)
  const isCheckoutExpiration = CHECKOUT_EXPIRATION_EVENTS.has(envelope.event_type) &&
    metadata.platformkit_checkout === '1'
  const normalizedType = isCheckoutExpiration
    ? 'checkout.expired'
    : EVENT_TYPES[envelope.event_type]
  if (!normalizedType) return []
  const occurredAt = epochSeconds(envelope.timestamp) ??
    epochSeconds(object.updated) ??
    epochSeconds(object.created) ??
    0
  const isInvoicePaid = envelope.event_type === 'invoice_paid'
  const subscriptionId = typeof object.subscription_id === 'string'
    ? object.subscription_id
    : isInvoicePaid && envelope.content.type === 'subscription_details' &&
        typeof object.id === 'string'
      ? object.id
      : undefined
  if (isInvoicePaid && !subscriptionId) {
    return []
  }
  const paymentId = typeof object.payment_id === 'string'
    ? object.payment_id
    : typeof object.id === 'string' && envelope.content.type === 'payment_details' ? object.id : undefined
  const isPlatformCheckout = metadata.platformkit_checkout === '1'
  const type = normalizedType === 'payment.succeeded' && isPlatformCheckout
    ? 'checkout.completed'
    : normalizedType
  const payoutId = envelope.content.type === 'payout_details'
    ? typeof object.payout_id === 'string'
      ? object.payout_id
      : typeof object.id === 'string' ? object.id : undefined
    : undefined
  const invoice = isInvoicePaid
    ? {
      provider: 'hyperswitch',
      invoiceId: typeof object.invoice_id === 'string' ? object.invoice_id : envelope.event_id,
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(typeof object.billing_reason === 'string' ? { billingReason: object.billing_reason } : {}),
      lines: [],
    }
    : undefined
  return [{
    provider: 'hyperswitch',
    eventId: envelope.event_id,
    type,
    occurredAt,
    ...(typeof object.customer_id === 'string' ? { customerId: object.customer_id } : {}),
    ...(isPlatformCheckout && paymentId ? { checkoutId: paymentId } : {}),
    ...(paymentId ? { paymentId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(payoutId ? { payoutId } : {}),
    ...(typeof object.status === 'string'
      ? { status: object.status }
      : PAYOUT_STATUSES[envelope.event_type]
        ? { status: PAYOUT_STATUSES[envelope.event_type] }
        : {}),
    ...(Number.isSafeInteger(object.amount) && object.amount >= 0 ? { amountMinor: object.amount } : {}),
    ...(typeof object.currency === 'string' ? { currency: object.currency } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(invoice ? { invoice } : {}),
  }]
}
