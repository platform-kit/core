---
scope: payments
---

## page

### main

title: Payments
subtitle: See which provider this site uses and open its payment operations console.
selected-provider: Selected provider
selected: Selected
stripe: Stripe
hyperswitch: Hyperswitch
provider-description: This is the provider selected for this site. Payment processing and order records continue to use that provider.
secrets-note: Secret API keys and webhook signing keys are kept in the server environment and are never shown here.
profile-capabilities: Declared profile capabilities
capabilities-note: These are the capabilities declared for this Hyperswitch profile, not a live health check. Verify the eligible connectors and routing rules in Hyperswitch before relying on a capability.
no-capabilities: No profile capabilities are declared.
open-control-center: Open Hyperswitch Control Center
control-center-unset: No Control Center URL is configured. Set payments.controlCenterUrl in the site configuration to add a safe link here.
payout-limitation-title: Connected-account payouts are unavailable
payout-limitation: Hyperswitch documents payout execution and saved payout-method tokenization, but not the connected-account onboarding and connector-verified readiness flow PlatformKit requires. A saved bank method alone is not proof it is payout-ready, so this site keeps payout operations disabled until the complete flow is supported and verified.
view-orders: View orders
open-stripe-dashboard: Open Stripe Dashboard

### capabilities

checkout.one-time: One-time checkout
checkout.subscription: Subscription checkout
checkout.confirm: Payment confirmation
checkout.trial: Subscription trials
checkout.tax: Tax collection
checkout.payment-method-selection: Payment-method selection
checkout.adjustable-quantity: Adjustable quantities
checkout.shipping-address: Shipping address collection
checkout.shipping-options: Shipping options
subscription.change: Subscription changes
subscription.proration: Subscription proration
customer.create: Customer records
customer.portal: Customer billing self-service
catalog.sync: Offer catalog synchronization
refunds: Refunds
usage.metered: Metered usage billing
usage.prepaid-top-up: Prepaid top-ups
payouts.connected-accounts: Connected-account payouts
