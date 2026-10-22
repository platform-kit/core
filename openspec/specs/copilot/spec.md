# copilot Specification

## Purpose
Defines how a site may sell an assistant as a declared offer and account for the cost of its spoken and typed conversations.

## Requirements

### Requirement: An assistant can be a business on its own

A deployment SHALL be able to sell an assistant with no code written beyond what a site already
declares: the assistant's conduct and its tools as content, the offer it is billed against named on
it, and the units sold as a pack or metered. What a person is charged SHALL be the site's own
unit at the site's own rate, and what the assistant costs to serve SHALL be visible to the site
beside it.

#### Scenario: an assistant sold by the unit

- **WHEN** a site declares an assistant, an offer selling units, and the assistant billed to that offer
- **THEN** somebody can buy units, hold a spoken or typed conversation, see what they have left, and be stopped when it runs out — with no code in the site

Verified by: `build/usage-db.test.mjs` end to end through the mock checkout; one live conversation read before it is trusted

#### Scenario: what it costs is shown beside what it sells for

- **WHEN** an administrator looks at the offer
- **THEN** the measured cost per unit over a recent window is shown beside the price per unit

Verified by: screenshots of the panel in both themes at 1280 and 390, read before reporting

### Requirement: Usage management does not replace assistant conversations

The voice assistant SHALL retain its conversation-history functionality. The reader's usage
balance, usage history, purchases, and automatic top-up controls SHALL live on a dedicated,
platform-wide usage surface, independent of chatbot identity and inclusive of billable work
from any configured operation.

#### Scenario: a reader opens assistant conversation history

- **WHEN** a reader opens past conversations in the voice assistant
- **THEN** they can browse and resume their conversations, and the conversation-history surface is not replaced by usage statistics

Verified by: `build/usage.test.mjs` and the reader-page browser probe

#### Scenario: a reader reviews usage from different operations

- **WHEN** a reader opens `/billing#usage` or follows the former `/app/usage` address
- **THEN** the usage page shows their own balance and recorded usage across all configured billable operations, without requiring a bot or conversation

Verified by: `build/usage.test.mjs` and the reader-page browser probe
