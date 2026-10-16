export const DEFAULT_HYPERSWITCH_CLIENT_URL = 'https://beta.hyperswitch.io/v1'

let loadedUrl = ''
let loadPromise

export function hyperswitchLoaderUrl(clientUrl) {
  const base = typeof clientUrl === 'string' && clientUrl.trim()
    ? clientUrl.trim()
    : DEFAULT_HYPERSWITCH_CLIENT_URL
  let url
  try {
    url = new URL(base)
  } catch {
    throw new Error('The Hyperswitch SDK URL is invalid.')
  }
  const localHttp = url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !localHttp) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('The Hyperswitch SDK URL must use HTTPS, or loopback HTTP for local development.')
  }
  return new URL('HyperLoader.js', `${url.href.replace(/\/+$/, '')}/`).href
}

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

export async function loadHyperswitchSdk(clientUrl) {
  const scriptUrl = hyperswitchLoaderUrl(clientUrl)
  if (typeof window.Hyper === 'function') {
    const existing = [...document.scripts].find((script) => {
      try {
        return new URL(script.src).pathname.endsWith('/HyperLoader.js')
      } catch {
        return false
      }
    })
    if (existing && new URL(existing.src).href !== scriptUrl) {
      throw new Error('The Hyperswitch SDK was already loaded from a different SDK URL.')
    }
    return window.Hyper
  }
  if (loadPromise) {
    if (loadedUrl !== scriptUrl) {
      throw new Error('A different Hyperswitch SDK URL is already loading.')
    }
    await loadPromise
    if (typeof window.Hyper !== 'function') throw new Error('The Hyperswitch SDK did not initialize.')
    return window.Hyper
  }

  loadedUrl = scriptUrl
  const script = document.createElement('script')
  script.src = scriptUrl
  script.async = true
  script.dataset.platformkitHyperswitchSdk = 'true'
  loadPromise = new Promise((resolve, reject) => {
    script.onload = resolve
    script.onerror = () => {
      script.remove()
      reject(new Error('The secure payment form could not be loaded. Please try again.'))
    }
    document.head.append(script)
  })
  try {
    await loadPromise
  } catch (error) {
    loadPromise = undefined
    loadedUrl = ''
    throw error
  }
  if (typeof window.Hyper !== 'function') {
    loadPromise = undefined
    loadedUrl = ''
    script.remove()
    throw new Error('The Hyperswitch SDK did not initialize.')
  }
  return window.Hyper
}
