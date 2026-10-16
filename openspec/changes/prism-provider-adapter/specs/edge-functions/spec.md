# Spec Delta

## ADDED Requirements

### Requirement: Prism webhooks are verified before payment state changes

A Prism webhook SHALL be verified using the selected connector's documented signature or shared-secret mechanism against the original request body before it is normalized, deduplicated, or applied. Prism transformation and webhook verification SHALL execute inside the Supabase Edge Function; the function SHALL NOT require a separate Node process or Prism gateway. A connector without a supported verification mechanism SHALL NOT be enabled for webhook-driven payment state. Invalid, unsupported, or replayed events SHALL NOT grant purchases, entitlements, subscription state, or payouts.

#### Scenario: An invalid Prism webhook is received

- **WHEN** a Prism webhook has a missing, invalid, or unsupported connector verification value
- **THEN** the function rejects it and writes no webhook inbox, payment, ledger, entitlement, subscription, or payout state

Verified by: Prism webhook integration tests against the served local function

#### Scenario: Prism webhooks do not depend on an external runtime

- **WHEN** a configured connector sends a webhook to the site's Prism Edge Function
- **THEN** that function verifies and normalizes the event without a separately deployed Node process or Prism service

Verified by: Prism Edge Function runtime tests and the function bundle check

#### Scenario: A valid Prism webhook is received

- **WHEN** a Prism webhook passes connector verification and has a valid normalized event
- **THEN** the event is durably deduplicated before processing and is applied at most once

Verified by: Prism webhook integration tests and `packages/kit/build/ledger.test.mjs`
