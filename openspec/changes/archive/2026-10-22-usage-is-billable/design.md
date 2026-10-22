# Design

## Context

See `proposal.md` for the motivation and the change specs for the externally visible
requirements.

The kit already has two authoritative seams for assistant usage. `agent_steps` records the
provider and token cost of each completed model call, and `agent_runs.spent_cents` aggregates
those costs. The generic agent path is admitted by `agent_summon`; the copilot path uses
`copilot_turn` and a short-lived signed grant before it reaches the same agent worker. Billing
is currently associated with those surfaces, but the usage policy must be reusable by any
server-side operation that can incur a provider cost; bot identity and page/module identity are
provenance, not prerequisites for authorization.

Offers are currently fixed-price and reconciled by `_shared/offers.ts`; Checkout and the
ledger identify them by the offer key. Product declarations are validated in Velite and
compiled into the functions' catalog. Bot declarations are also content, projected into
`public.bots`. Database changes belong in the kit's schema declarations, not in migration
files. The source tree under `supabase/` is assembled and must not be edited directly.

The voice page has two different speech paths. Speech recognition is the browser's native
`SpeechRecognition` API; the kit receives recognized text, not audio. Speech output can use a
site-configured OpenAI-compatible TTS endpoint through `copilot-speak`, which streams PCM, or
the browser's local voice engine. The client must never supply a cost, rate, provider price,
bot identity, or account identity to the usage writer. Browser-native STT duration is useful
telemetry, but this recognition path has no provider cost charged to the site and therefore
contributes no billable cost. Endpoint TTS cost is calculated server-side from the streamed
duration and the site's declared endpoint cost rate. Local TTS has zero site cost.

## Goals / Non-Goals

**Goals:**

- Preserve the current checkout, subscription identity, bot surfaces, spending ceilings, and
  behavior of every offer and bot that does not opt in.
- Keep usage and grant records as authoritative database state; derive balances from those
  records rather than maintaining a second balance.
- Provide a surface- and provider-independent server-side gate that authorizes and reserves usage
  before any configured billable operation begins.
- Reconcile model costs from the existing recorded provider usage, and endpoint TTS cost from
  server-authoritative seconds plus the site's declared speech cost rate.
- Make Stripe's meter events an idempotent projection of recorded billable units.
- Keep the theme responsible for user-facing words and the site responsible for its unit,
  price, rates, offers, and bot-to-offer associations.
- Let a site enable automatic top-up while leaving every reader in control of their explicit
  opt-in, refill threshold, selected eligible pack, and personal spend cap.

**Non-Goals:**

- Replacing the existing agent provider cost table or moving provider prices into Stripe
  metadata.
- Adding a new speech-recognition provider. The browser-native STT path remains the default.
- Tiered/volume pricing, refunding consumed units, a custom invoicing engine, or charging a
  person for speculative output.
- A site-owner-set spending cap on a reader's automatic top-ups.
- Editing assembled `supabase/` output or adding migrations.

## Decisions

### Offer declarations carry the unit economics

An opt-in offer adds a `usage` block while retaining the existing `price`, `billing`, and
`period` fields. The block names the unit and declares the cost-to-unit rate. A one-time
offer also declares the quantity it grants. A metered subscription declares its meter,
included units per billing period, and its per-unit overage price; the existing recurring
`price` remains the fixed subscription amount. This represents both a pure metered plan
(zero fixed amount and zero included units) and a base plan with an allowance and overage.
Existing offers without `usage` follow the existing single-price reconciliation and Checkout
path unchanged.

The rate is stored in the offer as provider-cost USD per whole usage unit. Model cost comes
from the provider's measured token usage; endpoint TTS cost comes from seconds observed at
the trusted endpoint multiplied by the site's declared endpoint cost-per-second rate. Browser
STT seconds are recorded as zero-cost telemetry because the site does not pay the browser's
recognition provider. Monetary values are converted to integer micro-units of their currency,
and one million integer usage micro-units represent one whole usage unit. This retains sub-cent
speech costs without floating-point balance arithmetic. Client input never supplies or overrides
a rate or resulting cost. For one-time packs, the existing one-time price is the pack price and the grant quantity
determines its displayed price per unit. For metered subscriptions, the existing recurring
price is the base fee and the additional Stripe metered price is the per-unit overage price in
the offer's currency. The content fields are `unit`, `rate` (provider-cost USD per whole usage
unit), `grant` (whole units for a one-time pack), `included` (whole units per subscription
period), `meter` (the Stripe event name), `overagePrice` (per unit in the offer's currency),
and optional `speechCostPerSecond` (provider-cost USD per second).

Alternatives considered: charging in provider tokens or cents would expose provider pricing
and make invoices change when models change; charging a flat amount per message cannot reflect
measured service cost. Floating-point usage was rejected because it makes balances and
replayed meter events difficult to compare exactly.

### Stripe receives usage after the local record commits

The catalog retains the offer key for the fixed/base price and gives its metered price a
separate stable lookup key. Each metered offer has its own event name: reusing an event name
could make one customer's usage apply to more than one attached subscription price. Stripe
Billing Meters use sum aggregation and a customer-id mapping. Reconciliation creates or reuses
the meter and its metered price. The base and metered prices share the offer's currency, so a
metered offer cannot be assigned an alternate-currency price-list entry. Checkout includes
the fixed/base and metered subscription prices together; existing offer line items are
unchanged.

For each idempotent usage record, a server-side writer first commits the record and the
included-allowance accounting, then submits a Stripe Meter Event with a stable identifier
derived from the usage reference. Stripe enforces identifier uniqueness for a rolling period
of at least 24 hours, so automatic retries use that same identifier inside the window. If an
ambiguous submission remains unresolved beyond that window, the system must stop automatic
resubmission and surface it for reconciliation rather than risk billing the same usage twice.
A metered event contains only the units above the active period's included allowance.
Successful recurring invoices create the next allowance grant with the invoice period as its
expiry; a replayed invoice cannot grant twice. Stripe remains the invoice authority and the
local records remain the authority for admission and user-visible balances.

Alternatives considered: Stripe credit grants alone cannot stop an in-cycle overrun before a
provider call. Metronome was rejected because its Checkout and Connect constraints conflict
with the platform's existing purchase and payout paths. Reporting before committing locally
was rejected because a database failure could then leave an invoice with no usage record.

### One server-side gate authorizes arbitrary billable work

Expose one server-side usage contract for any kit or site operation that opts into usage
billing. The caller supplies a verified server context, stable offer key, idempotent invocation
reference, and a bounded maximum usage reservation; bot id and surface labels are optional
provenance. The caller never supplies the subject id, subscription state, exchange rate, or
provider cost. The gate derives these from trusted authentication, current entitlement records,
and the declared offer.

Admission fails closed. For prepaid usage, one transaction reserves the maximum billable units
against the subject's available balance so concurrent calls cannot spend the same credits. For
metered subscription usage, the same transaction verifies a currently active subscription for
that offer and its declared overage policy. A missing subject, inactive or mismatched
subscription, insufficient credit, or missing bound refuses the invocation before its external
provider is called. A long-running or streaming operation is split into bounded units; it must
obtain the next reservation before crossing the current one and stops when authorization fails.

After work, a server-side settlement records measured provider usage once against the invocation
reference, commits any Stripe meter event to the retryable outbox, and releases unused reserved
units. A failed or abandoned operation releases its unused hold; a retry reuses the same
invocation reference and cannot create another charge. This keeps the user-level limit
independent of whether the invocation came from a bot, voice session, or a site's own function.

Alternatives considered: checking a balance and then calling a provider without reserving lets
concurrent calls overspend; checking only inside a bot worker leaves other code paths unprotected;
letting callers report their own identity, subscription, rate, or cost permits forged access or
charges. An unbounded invocation without a bounded reservation cannot guarantee prepaid
coverage and is refused until it can be bounded or chunked.

### Automatic top-up is an explicitly authorized reader purchase

A site opts in globally through its `platformkit.config.js` usage configuration. The site makes
eligible prepaid usage-pack offers available; it does not choose a reader's spending cap. Each
reader separately opts in, chooses an eligible pack and a low-balance threshold, and sets a
personal maximum spend per calendar month. The reader can change or turn off this preference at
any time. Automatic top-up remains unavailable unless both the site switch and the reader's
preference are enabled.

The reader must have explicitly authorized future off-session use of a saved payment method.
When an invocation would otherwise lack enough prepaid balance and the balance is at or below
the reader's threshold, the server may attempt one purchase of the reader's selected pack before
admitting provider work. The server checks the reader's remaining personal monthly cap and
serializes concurrent top-up attempts. It creates a stable, idempotent payment attempt tied to
the reader and the pack's stable offer key. A retry of the same attempt cannot charge twice.
Only confirmed payment creates the corresponding usage grant; the existing usage ledger remains
the source of truth for the resulting balance.

If the site or reader has disabled top-up, the monthly personal cap is exhausted, the payment
method is missing or declined, or the payment requires interactive authentication, the gate
refuses the billable invocation before calling its provider. A successful charge whose grant
has not yet been recorded also cannot authorize work; reconciliation retries the grant using
the same payment identity. One invocation does not trigger repeated pack purchases to cover an
oversized reservation: after one confirmed refill, the gate either reserves the bounded maximum
or refuses the work. The reader may still purchase packs manually.

Alternatives considered: site-wide per-reader caps would override the person paying and do not
belong to the site's policy; unlimited or implicit top-up could create unexpected charges;
granting units when a payment is merely created could allow provider work without collected
funds; letting a browser initiate an arbitrary charge or grant credits would bypass the offer,
consent, and idempotency checks.

### A single usage ledger serves every billable invocation

`usage_events` is append-only and keyed by a stable server-side invocation/work-step reference.
It records subject, offer, kind, measured cost, measured seconds where applicable, units, metered
units, and timestamp; bot and surface are optional provenance. `usage_grants` is append-only and
keyed by the Stripe Checkout session or recurring invoice that granted it, including a confirmed
automatic top-up payment. A balance view derives grants less eligible usage and outstanding
reservations, by subject and offer. Reader top-up preferences and payment attempts are declared
state, not projections; a reader can read and update only their own preference, while the server
alone creates or reconciles payment attempts.
Reservations are idempotent and tracked durably so concurrent invocations cannot consume the
same prepaid units and interrupted workers can safely settle or release a hold.

The authenticated role may select only its own usage, grants, and derived balances; it cannot
insert, update, or delete them. The service role is the only writer. A narrowly scoped
security-definer RPC performs admission, reservation, settlement, included-allowance
accounting, and usage insertion transactionally. The agent's per-person spending ceiling
remains an additional refusal check for agent work, not a replacement for the shared usage gate.
A prepaid offer refuses before provider work when the maximum reservation is unavailable. An
active metered subscription may continue beyond its included allowance only when its offer
explicitly authorizes metered overage.

Alternatives considered: storing a mutable balance duplicates the ledger and can drift;
letting the browser write usage or grants would let it forge charges and balances. Treating
an exhausted metered allowance like an exhausted prepaid pack would silently disable the
overage behavior the subscription sells.

### Voice reports seconds, while the server determines cost

The voice page reports STT-active seconds as telemetry only; the signed grant supplies the
subject and bot. A unique session/segment reference makes a reconnection harmless. The
server-side TTS proxy measures its streamed PCM duration and records it itself. The site
supplies the endpoint TTS cost-per-second rate with its usage offer; that rate is never sent
by the listener. Native browser recognition and local TTS have zero provider cost. A
speculative or interrupted endpoint segment remains visible as site cost but has zero
billable units.

Alternatives considered: moving all recognition to a new hosted provider would add a new
credential, privacy surface, latency, and cost; accepting client-calculated money or rates
would make billing forgeable. The current browser-native path is retained, with speech-time
telemetry clearly distinguished from cost.

### Theme and site own different parts

The kit and theme provide the generic usage/balance presentation and default strings. A site
supplies its own unit labels, per-unit wording, ending/refusal copy, offer values, and bot
associations through content. The admin's offer editor shows declared price per unit beside
recent measured service cost per unit and warns when price is below cost, without blocking
the save. The display follows the existing admin controls and look tokens; no new animation
or theme-specific billing behavior is introduced.

## Risks / Trade-offs

- [A site can choose a cost rate that is too low] → Show recent measured cost per unit beside
  the declared sale price and warn without silently changing the site's rate.
- [A worker may stop after the provider call but before recording it] → Keep the step
  reference stable, make usage writes idempotent, and retry local recording/meter submission
  from the worker path; never submit a Stripe event before the database record exists.
- [Concurrent calls can race for prepaid units] → Reserve the bounded maximum atomically before
  invoking the provider, then settle actual usage and release unused units.
- [Concurrent low-balance calls can trigger duplicate top-up charges] → Serialize attempts per
  reader and offer, use a stable Stripe idempotency key, and grant only once from confirmed payment.
- [Automatic refills can surprise or overcharge a reader] → Require an explicit reader opt-in,
  a reader-selected pack and threshold, a reader-set monthly cap, and a server-side check before
  every off-session charge.
- [A top-up payment can fail or require authentication] → Do not grant units or call the billable
  provider; explain that the reader must update or authenticate their payment method.
- [A Stripe Meter Event may be temporarily unavailable or its acknowledgement may be lost]
  → Keep the committed record as the retry source and retry with the same Stripe identifier
  within Stripe's documented rolling uniqueness window; after that window, stop automatic
  resubmission and surface the unresolved record for administrator reconciliation.
- [Client speech timing is not proof of provider cost] → Treat browser STT seconds as
  non-billable telemetry and derive endpoint TTS seconds from server-observed PCM bytes.
- [Prepaid and metered access have different exhaustion semantics] → Prepaid stops at zero;
  metered plans continue only while their subscription is active and remain bounded by the
  existing bot spending ceiling.
- [Metered price changes create new Stripe Price objects] → Reuse the existing key for the
  fixed/base price, use a separate deterministic usage key, and retire stale prices only
  through the existing reconciliation behavior.

## Migration Plan

1. Add kit schema declarations and idempotent functions/views for usage records, grants,
   reservations, reader-owned top-up preferences and attempts, authorization, settlement, and
   derived balances; assemble the site's `supabase/` tree and verify it matches its sources.
2. Add optional offer and bot fields, catalog compilation, Stripe Meter/Price reconciliation,
   checkout line items, webhook grants, reader-consented off-session top-ups, and meter-event
   retry behavior. Keep unconfigured legacy offers on the old path.
3. Expose the reusable server-side usage gate and wire agent, copilot, TTS, and a non-bot
   invocation fixture through it; then add speech measurements, reader top-up controls, and the
   generic usage UI.
4. Update docs and run the targeted unit, catalog, declarations, and database checks before
   the full change verification.

Rollback is a content/configuration change: remove `billing` from bots and disable the
`usage` block on offers. Existing usage records remain as an audit trail. Do not delete
records, rewrite Stripe history, or manually edit assembled schemas.
