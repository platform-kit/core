export default {
  key: 'site-mock-payments',
  what: 'a site-owned mock payment provider',
  static: false,
  git: true,
  cloud: true,
  owns: {
    env: ['SITE_MOCK_PAYMENT_SECRET'],
  },
  paymentProviders: [{
    id: 'site-mock',
    adapter: 'payment-providers/mock.mjs',
    capabilities: ['checkout.one-time'],
    secrets: ['SITE_MOCK_PAYMENT_SECRET'],
    webhookPath: '/functions/v1/payment-provider-webhook',
  }],
}
