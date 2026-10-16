import assert from 'node:assert/strict'
import {
  confirmPaymentMethodManagementSession,
  createHyperswitchClient,
  createPaymentMethodManagementWidget,
  hyperswitchLoaderUrl,
} from '../../movable-types/src/lib/hyperswitch-sdk.js'

const savedMethodProfile = {
  profileId: 'pro_saved_methods_test',
  clientUrl: 'http://127.0.0.1:9050/v1',
  apiBaseUrl: 'http://127.0.0.1:18322',
  connectorAccount: { name: 'stripe', status: 'active', testMode: true },
  customer: {
    customerId: 'cus_saved_methods_test',
    savedPaymentMethods: [{ paymentMethodId: 'pm_saved_methods_test', type: 'card', status: 'active' }],
  },
}
assert.equal(savedMethodProfile.connectorAccount.testMode, true)
assert.equal(savedMethodProfile.customer.savedPaymentMethods[0].status, 'active')
assert.equal(hyperswitchLoaderUrl(savedMethodProfile.clientUrl), 'http://127.0.0.1:9050/v1/HyperLoader.js')
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
console.log('hyperswitch SDK: profile-scoped local client and saved-method management passed')

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

assert.equal(
  hyperswitchLoaderUrl(),
  'https://beta.hyperswitch.io/v1/HyperLoader.js',
)
assert.equal(
  hyperswitchLoaderUrl('http://localhost:9050/'),
  'http://localhost:9050/HyperLoader.js',
)
assert.equal(
  hyperswitchLoaderUrl('https://sdk.example.test/v1'),
  'https://sdk.example.test/v1/HyperLoader.js',
)
for (const invalidClientUrl of [
  'http://sdk.example.test',
  'https://user:password@sdk.example.test',
  'https://sdk.example.test?v=1',
]) {
  assert.throws(() => hyperswitchLoaderUrl(invalidClientUrl))
}
