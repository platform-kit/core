# Spec Delta

## Purpose

Lets each independently operated site choose its inference providers, measure their actual usage, and set its own customer pricing without inheriting another site's providers or economics.

## ADDED Requirements

### Requirement: Each site owns its inference providers and fallback order

Every site SHALL be able to declare its own ordered inference providers, endpoint and model choices, and fallback behavior. A billable request SHALL use only providers declared for the site that owns the request; a client SHALL NOT choose or override its provider, endpoint, tariff, or fallback chain. Credentials SHALL be supplied as deployment secrets referenced by name, never as values in site configuration or generated client assets. A site's provider configuration SHALL NOT affect another site.

#### Scenario: two sites use different providers and rates

- **WHEN** two sites declare different endpoints, fallback orders, or prices for the same model name
- **THEN** each server uses only its own declarations and secrets, and changing one site's declaration does not change the other site's runtime

Verified by: `build/inference-config.test.mjs` and the isolated multi-site build probe

#### Scenario: a provider fails and fallback is configured

- **WHEN** a configured provider fails in a way the site's fallback policy permits
- **THEN** only the next provider declared by that site is tried, and the actual provider and model for each attempt are recorded for accounting

Verified by: `build/inference-config.test.mjs` and `build/usage.test.mjs`

#### Scenario: a secret is configured

- **WHEN** a site references a provider credential by environment variable
- **THEN** the server resolves the secret at runtime and no secret value appears in generated catalog, browser assets, or another site's configuration

Verified by: `build/inference-config.test.mjs` and the assembled-function leak check

### Requirement: Each inference operation has its own billing policy

A site SHALL be able to assign a distinct policy to each stable, server-identified inference operation. A policy SHALL explicitly select either site-funded use or a specific usage offer; the selected offer's declaration determines whether authorization uses prepaid credits or an active metered subscription. Operation policies MAY set their own markup, overriding an offer-level markup, which in turn overrides the site's default. A shared model, provider, or user SHALL NOT cause one operation's policy to be inherited by another. A client SHALL NOT choose the operation policy or mark paid work as site-funded.

#### Scenario: staff-only and customer-facing assistants use the same provider

- **WHEN** a site assigns a staff operation site-funded policy and a customer operation a prepaid or metered offer
- **THEN** the staff operation records site provider cost without charging the staff reader, while the customer operation authorizes against only its declared offer

Verified by: `build/inference-config.test.mjs`, `build/usage.test.mjs`, and `build/usage-db.test.mjs`

#### Scenario: two bots have different business rules

- **WHEN** a site assigns a paid offer to its D&D game bot and a site-funded policy to its NPC chat bots
- **THEN** only invocations of the game bot consume that offer's balance or meter

Verified by: `build/inference-config.test.mjs` and the isolated `agent-run` billing test

#### Scenario: one capability is free in one app location and paid in another

- **WHEN** a site assigns distinct operation IDs and policies to two uses of LLM or speech generation
- **THEN** each invocation follows its own policy and markup, even when both use the same provider and model

Verified by: `build/inference-config.test.mjs` and the generic usage-gate operation-policy test

#### Scenario: an operation has no billing policy

- **WHEN** an external provider call requests a billable operation that the site's server configuration does not identify
- **THEN** the call is refused before provider work rather than implicitly treated as free or assigned a different operation's offer

Verified by: `build/inference-config.test.mjs` and the generic usage-gate operation-policy test

### Requirement: Provider cost and customer pricing are separate site-owned declarations

A site SHALL be able to declare provider-and-model-specific cost rates for every usage dimension its provider adapter measures, including distinct input and output rates and any supported cached, reasoning, image, or audio usage. Rates SHALL be keyed by the actual provider and model, not by model name alone. The site SHALL separately declare customer markup defaults, with optional offer-level and operation-level overrides. Provider cost, applied markup, billable units, and the offer's retail price SHALL remain distinguishable in usage and administrative reporting. Client-supplied cost, rate, or markup SHALL never be authoritative.

#### Scenario: the same model label has different provider costs

- **WHEN** two providers or sites use the same model label with different declared rates
- **THEN** each recorded attempt uses the tariff for the provider and model that actually served it

Verified by: `build/inference-config.test.mjs` and `build/usage.test.mjs`

#### Scenario: markup follows operation, offer, then site default

- **WHEN** an operation and an offer both define markup, or neither does
- **THEN** the operation's markup wins, otherwise the offer's markup wins, otherwise the site's default applies; the report shows provider cost, applied markup, consumed units, and retail price separately

Verified by: `build/inference-config.test.mjs`, `build/usage.test.mjs`, and screenshots of the usage report in both themes at 1280 and 390

#### Scenario: an inference model has no complete tariff

- **WHEN** a site enables a model for billable work but omits a required measured-usage rate
- **THEN** site validation or deploy validation refuses that billable configuration and identifies the provider and model

Verified by: `build/inference-config.test.mjs` and `build/deploy-checks.mjs --test`

### Requirement: Provider usage is measured by a trusted adapter

The platform SHALL normalize usage returned by each supported provider protocol into server-side measured dimensions and SHALL calculate provider cost using the owning site's declared tariff. A provider's response SHALL NOT be assumed to contain a trustworthy dollar charge; provider-specific dollar fields SHALL be used only when that provider adapter explicitly validates their meaning and currency. A protocol or model that cannot provide usage required by its tariff SHALL not silently produce a zero-cost billable record.

#### Scenario: an OpenAI-shaped provider returns token usage

- **WHEN** a provider returns supported input and output token counts
- **THEN** the server calculates cost from that provider/model's site-declared rates, independent of any client-supplied cost

Verified by: `build/inference-config.test.mjs` and `build/usage.test.mjs`

#### Scenario: a provider omits or malforms usage

- **WHEN** a billable provider attempt returns no valid usage measurement after it may have processed the request
- **THEN** the attempt is settled at no more than its conservatively reserved maximum, marked as estimated, and surfaced for administrator review rather than settled as zero

Verified by: `build/usage.test.mjs` with omitted, malformed, and valid usage fixtures
