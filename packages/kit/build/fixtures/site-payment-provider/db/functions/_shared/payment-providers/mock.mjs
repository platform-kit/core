export function createPaymentProvider(secrets) {
  if (Object.keys(secrets).some((name) => name !== 'SITE_MOCK_PAYMENT_SECRET')) {
    throw new Error('The adapter received undeclared secrets')
  }
  if (!secrets.SITE_MOCK_PAYMENT_SECRET) {
    throw new Error('SITE_MOCK_PAYMENT_SECRET is required')
  }
  return {
    id: 'site-mock',
    capabilities: ['checkout.one-time'],
    async createCheckout(input) {
      return {
        provider: 'site-mock',
        checkoutId: input.idempotencyKey,
        url: input.successUrl,
      }
    },
    async verifyWebhook() {
      return []
    },
  }
}
