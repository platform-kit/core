export const HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE = 'hyperswitch_v2_browser_unavailable'

let sdkLoadPromise

export function createHyperswitchClient(Hyper, publishableKey, apiBaseUrl, profileId) {
  const options = apiBaseUrl ? { customBackendUrl: apiBaseUrl } : {}
  return profileId
    ? Hyper({ publishableKey, profileId }, options)
    : Hyper(publishableKey, options)
}

export function createPaymentMethodManagementWidget(hyper, sdkAuthorization) {
  const elements = hyper.paymentMethodsManagementElements({
    appearance: { theme: 'default' },
    sdkAuthorization,
  })
  const widget = elements.create('paymentMethodsManagement')
  return { elements, widget }
}

export async function confirmPaymentMethodManagementSession(hyper, elements, returnUrl) {
  const result = await hyper.confirmTokenization({
    paymentMethodsManagementElements: elements,
    confirmParams: { return_url: returnUrl },
    redirect: 'always',
  })
  if (result?.error) throw new Error(result.error.message || 'Payment method verification failed')
  if (!result?.id) throw new Error('The provider did not confirm the payment-method update')
  return result
}

function sdkUnavailable(message) {
  const error = new Error(message)
  error.code = HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE
  return error
}

function validSdkUrl(value) {
  try {
    const url = new URL(value)
    const localHttp = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return (url.protocol === 'https:' || localHttp) &&
      !url.username && !url.password && !url.search && !url.hash &&
      !url.pathname.replace(/\/+$/, '').endsWith('/v1')
  } catch {
    return false
  }
}

export async function loadHyperswitchSdk(clientUrl) {
  if (!validSdkUrl(clientUrl)) {
    throw sdkUnavailable('A valid V2 Hyperswitch SDK URL is required.')
  }
  const scriptUrl = `${clientUrl.replace(/\/+$/, '')}/HyperLoader.js`
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw sdkUnavailable('Hyperswitch browser SDK can only be loaded in a browser.')
  }
  if (typeof window.Hyper === 'function') return window.Hyper
  if (!sdkLoadPromise) {
    sdkLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = scriptUrl
      script.async = true
      script.onload = () => {
        if (typeof window.Hyper === 'function') resolve(window.Hyper)
        else reject(sdkUnavailable('The Hyperswitch V2 SDK did not initialize.'))
      }
      script.onerror = () => reject(sdkUnavailable('The Hyperswitch V2 SDK could not be loaded.'))
      document.head.append(script)
    }).catch((error) => {
      sdkLoadPromise = null
      throw error
    })
  }
  return sdkLoadPromise
}

function paymentMethodSessionToken(result) {
  const methods = result?.associated_payment_methods ??
    result?.payment_method_session?.associated_payment_methods
  const tokenData = Array.isArray(methods)
    ? methods.map((method) => method?.payment_method_token?.data)
      .find((value) => typeof value === 'string' && value.trim())
    : null
  if (!tokenData) {
    throw new Error('Hyperswitch did not return a V2 payment-method session token.')
  }
  return tokenData
}

function clientHeaders(publishableKey, clientSecret, profileId) {
  return {
    authorization: `publishable-key=${publishableKey},client-secret=${clientSecret}`,
    'content-type': 'application/json',
    'x-profile-id': profileId,
  }
}

function paymentUrl(apiBaseUrl, paymentId, action) {
  let base
  try {
    base = new URL(apiBaseUrl)
  } catch {
    throw new Error('Hyperswitch API URL is invalid.')
  }
  if (!['https:', 'http:'].includes(base.protocol) ||
      base.username || base.password || base.search || base.hash) {
    throw new Error('Hyperswitch API URL is invalid.')
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/v2/payments/${encodeURIComponent(paymentId)}/${action}`
  return base.href
}

function paymentStatus(result) {
  return typeof result?.status === 'string' ? result.status.toLowerCase() : ''
}

function paymentRedirectUrl(result) {
  const redirect = result?.next_action?.redirect_to_url
  const value = typeof redirect === 'string' ? redirect : redirect?.url
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

async function postConfirmIntent({
  returnUrl, apiBaseUrl, paymentId, publishableKey, clientSecret, profileId, fetchImpl, body,
}) {
  const response = await fetchImpl(paymentUrl(apiBaseUrl, paymentId, 'confirm-intent'), {
    method: 'POST',
    headers: clientHeaders(publishableKey, clientSecret, profileId),
    body: JSON.stringify({ ...body, return_url: returnUrl }),
  })
  if (!response.ok) {
    const error = new Error('Hyperswitch V2 payment confirmation failed.')
    error.code = 'payment_failed'
    throw error
  }
  const result = await response.json()
  const status = paymentStatus(result)
  if (status === 'succeeded' || status === 'processing') return { status }
  if (status === 'requires_customer_action' || status === 'requires_action') {
    const redirectUrl = paymentRedirectUrl(result)
    if (redirectUrl) return { status, redirectUrl }
  }
  const error = new Error('Hyperswitch did not confirm the V2 payment.')
  error.code = status || 'payment_failed'
  throw error
}

export async function confirmV2CheckoutPayment({
  hyper,
  elements,
  returnUrl,
  apiBaseUrl,
  paymentId,
  publishableKey,
  clientSecret,
  profileId,
  fetchImpl = fetch,
}) {
  const tokenized = await hyper.confirmTokenization({
    paymentMethodsManagementElements: elements,
    confirmParams: { return_url: returnUrl },
    redirect: 'if_required',
  })
  if (tokenized?.error) {
    const error = new Error(tokenized.error.message || 'Payment method verification failed.')
    error.code = tokenized.error.code || tokenized.error.type || 'payment_method_invalid'
    throw error
  }
  const paymentToken = paymentMethodSessionToken(tokenized)
  return postConfirmIntent({
    returnUrl, apiBaseUrl, paymentId, publishableKey, clientSecret, profileId, fetchImpl,
    body: {
      payment_method_data: { card_token: {} },
      payment_method_type: 'card',
      payment_token: paymentToken,
    },
  })
}

export async function retrieveV2CheckoutPayment({
  apiBaseUrl,
  paymentId,
  publishableKey,
  clientSecret,
  profileId,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(paymentUrl(apiBaseUrl, paymentId, 'get-intent'), {
    method: 'GET',
    headers: clientHeaders(publishableKey, clientSecret, profileId),
  })
  if (!response.ok) throw new Error('Hyperswitch V2 payment status could not be retrieved.')
  const status = paymentStatus(await response.json())
  if (!status) throw new Error('Hyperswitch returned no V2 payment status.')
  return status
}
