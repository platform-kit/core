# Proposal

## Why

A site built on PlatformKit takes money and holds people's orders, bookings, files, recordings, tickets and earnings. Those protections exist piece by piece: database policies, signed links, verified payment webhooks, server-side prices. But no one has reviewed them together, and no single set of tests proves the guarantees a customer and a site owner rely on. The gated-content leak showed that a guarantee can look true from the interface and be false underneath.

## What Changes

- A security review of access and billing, recorded in the change, covering:
  - **Prices:** a buyer can't change what they pay, whether price, discount, quantity or shipping.
  - **Ownership:** one account can't read or change another's orders, bookings, tickets, files, recordings, invoices, payouts or earnings by changing an ID.
  - **Roles:** nobody can grant themselves a staff role, and the last administrator can't be removed.
  - **Incoming notifications:** every webhook from Stripe, Hyperswitch, cal.com and social platforms is checked before anything is read, and forged or replayed ones are refused.
  - **Links:** download and recording links are issued only to someone allowed and expire quickly; printers' links expire when the job no longer needs them.
  - **Abuse limits:** guest checkout, sign-up, support, forms and analytics intake each have limits per visitor.
  - **Secrets:** no server secret ever reaches the browser.
- Every finding is fixed, and each guarantee above gets a test that keeps it true.

There is no reader-facing copy, except that a refused request uses the site's existing error messages.

## Non-goals

This is not a full penetration test, and it does not review the content gate, which `protect-gated-content` covers, or third-party providers' own security. No new features.

## What James should look at

The list of guarantees: whether any is missing that a site owner would expect. And the review's findings, which will be listed in the change before any fix lands.

## Capabilities

### New Capabilities

- `access-and-billing-security`: the guarantees that protect money, records and roles, each proven by a test.

### Modified Capabilities

None.

## Impact

- Checkout, the payment and booking webhooks, the functions that serve files, recordings, tickets, invoices and payouts, role management, rate limits, and the browser build.
- Surfaces to verify: each guarantee's test against the local stack; a built site's files scanned for secrets.
