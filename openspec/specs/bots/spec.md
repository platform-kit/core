# bots Specification

## Purpose
Defines how a site's declared assistants may charge for usage consistently across private and shared conversation surfaces.

## Requirements

### Requirement: A bot may be billed to the person it answers for, whatever surface it is on

A bot's file MAY name the offer its usage is billed against, and that SHALL be the whole of what a
site writes to charge for it. It SHALL make no difference what surface the bot is on — a copilot
somebody speaks to, a desk bot, a bot in a shared channel — because the bot is the thing that costs
money. A bot naming no offer SHALL cost the person nothing and SHALL behave exactly as it does
today.

#### Scenario: the same bot on two surfaces

- **WHEN** a bot billed to an offer answers once in a shared channel and once in a private conversation
- **THEN** both are billed to the person it answered for, the same way, against the same offer

Verified by: `build/usage.test.mjs`

#### Scenario: a bot that is not billed

- **WHEN** a bot names no offer
- **THEN** nothing is recorded against anybody and nothing is reported to the provider

Verified by: `build/usage.test.mjs`

### Requirement: Somebody out of units is told, and the spending ceiling still comes first

Where a person has no units left, the bot SHALL say so in words the site can edit and SHALL NOT
answer, rather than answering and leaving a debt or failing without explanation. The per-person
spending ceiling SHALL remain in force whether or not usage is billed, so that a fault in billing
cannot let a bill run away.

#### Scenario: the balance reaches zero mid-conversation

- **WHEN** a person's last unit is spent and they ask again
- **THEN** the bot says they are out, in the site's words, offers where to get more, and makes no paid call

Verified by: `build/usage-db.test.mjs`; the words pinned by `build/strings.test.mjs`

#### Scenario: billed and over the ceiling

- **WHEN** a person is inside their balance but over the per-person ceiling for the window
- **THEN** the run is still refused, and the refusal says which limit it was

Verified by: `build/usage.test.mjs` over `agent_over_cap`
