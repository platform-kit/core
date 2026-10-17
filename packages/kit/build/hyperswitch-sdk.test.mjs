import assert from 'node:assert/strict'
import {
  confirmV2CheckoutPayment,
  confirmPaymentMethodManagementSession,
  createHyperswitchClient,
  createPaymentMethodManagementWidget,
  HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE,
  loadHyperswitchSdk,
  retrieveV2CheckoutPayment,
} from '../../movable-types/src/lib/hyperswitch-sdk.js'

const savedMethodProfile = {
  profileId: 'pro_saved_methods_test',
  apiBaseUrl: 'http://127.0.0.1:18322',
  connectorAccount: { name: 'stripe', status: 'active', testMode: true },
  customer: {
    customerId: 'cus_saved_methods_test',
    savedPaymentMethods: [{ paymentMethodId: 'pm_saved_methods_test', type: 'card', status: 'active' }],
  },
}
assert.equal(savedMethodProfile.connectorAccount.testMode, true)
assert.equal(savedMethodProfile.customer.savedPaymentMethods[0].status, 'active')
await assert.rejects(loadHyperswitchSdk(), (error) =>
  error.code === HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE)
await assert.rejects(loadHyperswitchSdk('https://sdk.example.test/v1'), (error) =>
  error.code === HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE)
let profileSdkArguments
assert.equal(
  createHyperswitchClient((...args) => {
    profileSdkArguments = args
    return 'test-profile-sdk'
  }, 'pk_test_saved_methods', savedMethodProfile.apiBaseUrl, savedMethodProfile.profileId),
  'test-profile-sdk',
)
assert.deepEqual(profileSdkArguments, [
  { publishableKey: 'pk_test_saved_methods', profileId: savedMethodProfile.profileId },
  { customBackendUrl: savedMethodProfile.apiBaseUrl },
])

const managementCalls = {}
const elements = {
  create(type) {
    managementCalls.elementType = type
    return { mount: (selector) => { managementCalls.mountSelector = selector } }
  },
}
const managementSdk = {
  paymentMethodsManagementElements(options) {
    managementCalls.elementOptions = options
    return elements
  },
  async confirmTokenization(options) {
    managementCalls.confirmOptions = options
    return { id: 'pms_saved_methods_test' }
  },
}
const management = createPaymentMethodManagementWidget(managementSdk, 'sdk_test_authorization')
management.widget.mount('#usage-payment-method-management')
assert.deepEqual(managementCalls.elementOptions, {
  appearance: { theme: 'default' },
  sdkAuthorization: 'sdk_test_authorization',
})
assert.equal(managementCalls.elementType, 'paymentMethodsManagement')
assert.equal(managementCalls.mountSelector, '#usage-payment-method-management')
await confirmPaymentMethodManagementSession(
  managementSdk,
  management.elements,
  'https://site.example.test/usage?payment_method=updated',
)
assert.deepEqual(managementCalls.confirmOptions, {
  paymentMethodsManagementElements: elements,
  confirmParams: { return_url: 'https://site.example.test/usage?payment_method=updated' },
  redirect: 'always',
})
await assert.rejects(
  confirmPaymentMethodManagementSession(
    { confirmTokenization: async () => ({ error: { message: 'declined' } }) },
    elements,
    '/usage',
  ),
  /declined/,
)
await assert.rejects(
  confirmPaymentMethodManagementSession({ confirmTokenization: async () => ({}) }, elements, '/usage'),
  /did not confirm/,
)

let sdkScript
const loadedHyperFactory = () => 'loaded-sdk'
const previousWindow = globalThis.window
const previousDocument = globalThis.document
globalThis.window = { Hyper: null }
globalThis.document = {
  createElement: () => ({}),
  head: { append: (script) => { sdkScript = script; globalThis.window.Hyper = loadedHyperFactory; script.onload() } },
}
assert.equal(
  await loadHyperswitchSdk('https://beta.hyperswitch.io/v2'),
  loadedHyperFactory,
)
assert.equal(sdkScript.src, 'https://beta.hyperswitch.io/v2/HyperLoader.js')
if (previousWindow === undefined) delete globalThis.window
else globalThis.window = previousWindow
if (previousDocument === undefined) delete globalThis.document
else globalThis.document = previousDocument

let confirmationRequest
const checkoutResult = await confirmV2CheckoutPayment({
  hyper: {
    confirmTokenization: async (options) => {
      assert.deepEqual(options, {
        paymentMethodsManagementElements: elements,
        confirmParams: { return_url: 'https://site.example.test/checkout?session=pay_test&payment_action=return' },
        redirect: 'if_required',
      })
      return {
        associated_payment_methods: [{
          payment_method_token: { data: 'pmt_session_test' },
        }],
      }
    },
  },
  elements,
  returnUrl: 'https://site.example.test/checkout?session=pay_test&payment_action=return',
  apiBaseUrl: 'https://router.example.test',
  paymentId: 'pay_test',
  publishableKey: 'pk_snd_test',
  clientSecret: 'cs_v2_test',
  profileId: 'pro_test',
  fetchImpl: async (url, init) => {
    confirmationRequest = { url: String(url), init }
    return Response.json({ id: 'pay_test', status: 'succeeded' })
  },
})
assert.deepEqual(checkoutResult, { status: 'succeeded' })
assert.equal(confirmationRequest.url, 'https://router.example.test/v2/payments/pay_test/confirm-intent')
assert.equal(confirmationRequest.init.method, 'POST')
assert.equal(confirmationRequest.init.headers.authorization, 'publishable-key=pk_snd_test,client-secret=cs_v2_test')
assert.equal(confirmationRequest.init.headers['x-profile-id'], 'pro_test')
assert.deepEqual(JSON.parse(confirmationRequest.init.body), {
  payment_method_data: { card_token: {} },
  payment_method_type: 'card',
  payment_token: 'pmt_session_test',
  return_url: 'https://site.example.test/checkout?session=pay_test&payment_action=return',
})

const actionResult = await confirmV2CheckoutPayment({
  hyper: {
    confirmTokenization: async () => ({
      associated_payment_methods: [{
        payment_method_token: { data: 'pmt_session_action' },
      }],
    }),
  },
  elements,
  returnUrl: 'https://site.example.test/checkout?session=pay_test&payment_action=return',
  apiBaseUrl: 'https://router.example.test',
  paymentId: 'pay_test',
  publishableKey: 'pk_snd_test',
  clientSecret: 'cs_v2_test',
  profileId: 'pro_test',
  fetchImpl: async () => Response.json({
    id: 'pay_test',
    status: 'requires_customer_action',
    next_action: { redirect_to_url: { url: 'https://issuer.example.test/3ds' } },
  }),
})
assert.deepEqual(actionResult, {
  status: 'requires_customer_action',
  redirectUrl: 'https://issuer.example.test/3ds',
})

await assert.rejects(confirmV2CheckoutPayment({
  hyper: { confirmTokenization: async () => ({ id: 'pms_without_token' }) },
  elements,
  returnUrl: 'https://site.example.test/checkout',
  apiBaseUrl: 'https://router.example.test',
  paymentId: 'pay_test',
  publishableKey: 'pk_snd_test',
  clientSecret: 'cs_v2_test',
  profileId: 'pro_test',
  fetchImpl: async () => { throw new Error('should not fetch without a session token') },
}), /did not return a V2 payment-method session token/)

assert.equal(await retrieveV2CheckoutPayment({
  apiBaseUrl: 'https://router.example.test',
  paymentId: 'pay_test',
  publishableKey: 'pk_snd_test',
  clientSecret: 'cs_v2_test',
  profileId: 'pro_test',
  fetchImpl: async (url, init) => {
    assert.equal(String(url), 'https://router.example.test/v2/payments/pay_test/get-intent')
    assert.equal(init.method, 'GET')
    return Response.json({ status: 'succeeded' })
  },
}), 'succeeded')
console.log('hyperswitch SDK: V2 browser loading, tokenization, confirmation, and status checks passed')

let sdkArguments
const sdkFactory = (...args) => {
  sdkArguments = args
  return 'initialized-sdk'
}
assert.equal(
  createHyperswitchClient(sdkFactory, 'pk_snd_test', 'http://127.0.0.1:18322', 'pro_test'),
  'initialized-sdk',
)
assert.deepEqual(sdkArguments, [
  { publishableKey: 'pk_snd_test', profileId: 'pro_test' },
  { customBackendUrl: 'http://127.0.0.1:18322' },
])
assert.equal(
  createHyperswitchClient(sdkFactory, 'pk_snd_test', 'https://api.example.test'),
  'initialized-sdk',
)
assert.deepEqual(sdkArguments, [
  'pk_snd_test',
  { customBackendUrl: 'https://api.example.test' },
])

for (const invalidClientUrl of [
  'http://sdk.example.test',
  'https://user:password@sdk.example.test',
  'https://sdk.example.test?v=1',
]) {
  await assert.rejects(loadHyperswitchSdk(invalidClientUrl), (error) =>
    error.code === HYPERSWITCH_V2_BROWSER_UNAVAILABLE_CODE)
}
