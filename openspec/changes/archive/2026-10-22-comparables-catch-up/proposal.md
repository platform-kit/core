# Proposal

## Why

The comparison of PlatformKit with the products it replaces is missing features built since it was written: social scheduling, usage-based billing, AI bots and provider payouts. It also has no row for course platforms, the most likely comparison for memberships plus coaching, and it doesn't say translation is unbuilt.

## What Changes

- Five rows join the comparables table, in the spec and in both overview copies (`docs/COMPETITORS.md` and the docs site's "What PlatformKit is"):

| Instead of | The kit's module | What it does |
| --- | --- | --- |
| Kajabi, Teachable, Thinkific | memberships, books, sessions, coaching, forms | paid access by tier, reading chapter by chapter with quizzes and mastery, booked and paid coaching sessions, coaching chat, paid forms |
| Buffer, Hootsuite, Later | social publishing | connected accounts on eight networks, a scheduling calendar, approval queues, an inbox, keyword automations and analytics |
| Stripe Billing usage pricing, Orb, Metronome | usage-based billing | credits as prepaid packs and metered plans, automatic top-up, mid-period charges with recovery, a usage tab and a staff cost report |
| Intercom Fin, Chatbase, Voiceflow | bots | bots in rooms, the support desk and coaching, with tools, skills, slash commands, schedules, memory and spending caps |
| Practice Better, SimplePractice | sessions, providers and payouts | providers with terms, offerings reviewed before sale, payout rules with holding periods, earnings statements and payouts through Stripe Connect |

- The translation row's "what it leaves out" says the module is not built yet.

**Non-goals:** no runtime behavior; the fourth column stays documentation prose.

**Review focus:** that each row describes what is built today, and the Kajabi row's honesty about courses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-principles`: "Every comparable's core job is a module with a switch" carries the five rows.

## Impact

- Docs only: the spec's table, `docs/COMPETITORS.md`, and the docs site's "What PlatformKit is".
