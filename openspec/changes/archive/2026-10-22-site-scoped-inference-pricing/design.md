# Design

## Context

See `proposal.md` for the motivation. The current provider adapter has a kit-wide token-price table, and the usage offer separately maps provider cost to customer units. Site configuration is compiled for the site's server functions, while the product catalog is also generated per site. Existing provider keys are environment secrets; they must remain outside content, committed generated data, and browser bundles.

The specifications in `specs/inference-pricing/spec.md` and `specs/platform-data/spec.md` define the required behavior.

## Goals / Non-Goals

**Goals:**

- Make provider selection, fallback order, provider tariffs, and markup policy independent for each site.
- Let each trusted inference operation choose its own sponsor, usage offer, and markup without coupling policy to the chatbot surface.
- Keep upstream cost, customer usage, and retail price auditable as distinct values.
- Require safe authorization before a potentially billable provider call, including all configured fallback attempts.
- Preserve usage and pricing evidence when provider results are incomplete or uncertain.

**Non-Goals:**

- A reader-facing provider picker or a control that lets clients choose provider rates.
- A shared marketplace or centralized service for sites to exchange provider credentials or pricing.
- Treating arbitrary provider-reported dollar amounts as authoritative.
- Rewriting already-settled historical usage when a site's tariff or markup changes.

## Decisions

### Site configuration is the source of provider policy

Add a validated `inference` declaration to `platformkit.config.js`. It owns the site's ordered provider definitions, provider-specific model identifiers, endpoint/protocol, secret environment-variable names, fallback policy, and provider/model usage tariffs. The compiled site server configuration carries this declaration to only that site's function bundle. The public site configuration omits it. Secret values are resolved from the function's runtime environment; neither the secret values nor a generated client-visible credential reference is emitted to browser assets.

The site's inference declaration is opt-in for paid use. Existing non-billable mock/development behavior can remain available, but a billable external call without a complete, validated site declaration is refused. This avoids silently inheriting the kit's historical global tariff as though it were this business's actual negotiated cost.

**Alternative considered:** keep provider prices as kit defaults and allow sites to override them. Rejected as the billing authority: a default can be mistaken for a site's real upstream cost, and identical model labels can have different costs across providers or contracts.

### Provider adapters normalize usage; site tariffs calculate cost

Each supported adapter normalizes the provider's response into explicit usage dimensions (initially input and output tokens, plus dimensions the adapter can reliably observe). The server chooses the tariff by the actual provider identity and returned model identifier. It calculates upstream cost from those dimensions and that site's tariff. A provider-specific monetary amount is accepted only if that provider's adapter documents and validates its unit and currency; an OpenAI-shaped response's token counts are not treated as a dollar charge.

If a configured model or usage dimension has no complete tariff, validation fails before it can serve billable work. This is preferable to allowing unpriced work and attempting to infer its cost afterward.

### Billing policy is selected per stable operation ID

The site declares an `operations` policy map in its server-side usage configuration, keyed by stable operation IDs. A policy is either site-funded (cost is tracked to the site and reader units are not debited) or names one usage offer. The offer's existing billing type decides whether the shared gate checks prepaid credits or an active metered subscription. An unregistered operation cannot invoke a paid provider; it does not inherit a global free policy or another operation's offer. A resource such as a bot derives its operation ID from trusted server-loaded content, never from a client parameter. The shared authorization and settlement helper remains reusable by any server operation; bots are only one caller.

**Alternative considered:** one global usage offer or a default billing mode for every provider call. Rejected because staff tools, free NPC conversations, paid game sessions, and paid/unpaid TTS placements can share the same underlying model while requiring different business rules.

### Markup is a distinct multiplier layered over offer unit conversion

The site declares one default markup multiplier, with an optional override on a usage offer and then an operation-level override. Precedence is operation, offer, site. For each reader-billed attempt, the server applies the chosen multiplier to provider cost, then uses the operation's offer cost-to-unit rate to calculate customer units; the offer's prepaid grant, included allowance, Stripe overage price, and retail product price remain the retail layer. Site-funded operations record provider cost and a zero reader debit. The ledger snapshots provider cost, operation ID, sponsor/offer, markup value/version, and resulting units so later configuration changes do not rewrite history.

**Alternative considered:** encode markup only in the offer's unit conversion rate. Rejected because it makes the site's upstream cost and its desired margin indistinguishable, and cannot represent operation-specific business rules when two surfaces share an offer.

### Reserve the maximum authorized fallback chain before making a provider call

Before the first provider request, compute the maximum provider cost for every provider/model attempt permitted by the configured fallback chain, applying each attempt's tariff and the request's token/output limits. Reserve the aggregate in customer units through the existing shared usage authorization. If the reader cannot cover the bound, refuse before any external call. On completion, record and settle each attempt against its actual measured cost, then release unused reservation.

An attempt known not to have reached a provider releases its portion. If the provider may have processed it but returns no usable usage, or the connection fails after send with an uncertain outcome, settle that attempt at its reserved maximum and mark it estimated. A fallback may proceed only while the remaining authorization covers its maximum. This deliberately favors preventing unpaid provider work over avoiding every possible overestimate; the estimated state is visible to the site administrator for reconciliation.

### Keep provider attempts as auditable usage evidence

Persist actual provider/model identity, normalized dimensions, calculated provider cost, customer markup, and measured-versus-estimated status for each attempt. Associate attempts with the invocation and site-owned offer so fallback spend is not hidden in only the final response. Site usage reporting sums provider costs separately from customer units and retail value. Existing schema declarations and functions are updated at their source, then assembled; no migration or hand edit to generated `supabase/` files is introduced.

### Validate and deploy a site's server policy as one unit

Configuration validation checks provider identifiers, unique provider/model tariff keys, positive and complete rates, the fallback chain, markup values, secret-reference syntax, and billable offer compatibility. Deploy checks fail before deployment when a billable path can reach an unpriced model or has no safe maximum reservation. Generated catalogs continue to contain offer-facing retail data only; provider secrets and server-only provider policy do not leak into that catalog.

## Risks / Trade-offs

- **[A missing usage result can charge the reserved maximum, more than actual cost]** → Bound each attempt by configured request limits, label estimates distinctly, expose them for review, and release unused portions whenever outcome and usage are known.
- **[Reserving the whole fallback chain can refuse work that the first provider alone could have completed]** → Release unused reservation immediately after attempts conclude; require sites to keep fallback lists and per-attempt limits proportionate.
- **[Provider protocol variants may report different usage fields]** → Normalize through tested provider adapters and refuse unsupported billable configurations rather than guessing.
- **[A site's rate card can become stale when a provider changes prices]** → Make the rate schedule explicit and versioned in site configuration, identify the applied version in usage records, and document that the site owner maintains it.
- **[Server config assembly could accidentally expose server-only settings]** → Keep inference policy out of public `#site` exports and generated catalogs, and add a build/assembly leak test.
- **[Markup changes may affect how quickly a reader consumes a prepaid balance]** → Apply policy changes only to new invocations, snapshot each applied rule, and retain the offer's existing customer-facing price and grant semantics.

## Migration Plan

1. Add optional site inference and operation-policy configuration with strict validation. Site-funded operations record costs without reader billing; reader-billed external use must declare an operation policy, complete tariffs, and bounds before it is enabled.
2. Generate a server-only configuration for each site's functions and verify it does not appear in public outputs.
3. Add adapter normalization, operation-specific authorization, reservation across fallback attempts, and attempt-level measured/estimated settlement. Update the declared usage schema and function sources, then assemble.
4. Add site-default and offer-override markup, ledger snapshots, administrator visibility, deploy checks, and the configuration/usage-billing documentation.
5. Deploy the generated server configuration and catalog from the same site revision. Roll back by redeploying the prior site revision and its matching generated functions/catalog; no database migration is required because database changes are declaration-driven.

## Open Questions

None. The initial markup rule is a multiplier (site default, optional offer override); additional pricing formulas can be considered separately without weakening site isolation or fail-closed billing.
