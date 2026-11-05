## ADDED Requirements

### Requirement: Funnels and blasts go to an audience built from rules

The `funnels` module SHALL send multi-step email funnels and one-off blasts to an audience built from rules: inactive, signed up, time since purchase or session, subscription, interest, level, answered, bought, not bought, role, community access and confirmed address. Each audience SHALL show a live count of who matches now.

#### Scenario: who it goes to

- **WHEN** a funnel's audience rules are applied to the seeded accounts
- **THEN** exactly the matching accounts are enrolled, and an opted-out one is not

Verified by: `build/marketing.test.mts` under `platformkit test --e2e`

### Requirement: Nothing is sent twice

A funnel's steps SHALL be timed by elapsed time, under daily, weekly and monthly caps, per-funnel cooldowns and opt-outs. Editing or renaming a campaign SHALL never re-send it to people who already had it, and a sent blast SHALL be kept as a record that can resume without sending twice.

#### Scenario: a blast resumed

- **WHEN** a blast is interrupted part-way and resumed
- **THEN** nobody who already had it is sent it again

Verified by: `build/marketing.test.mts` under `platformkit test --e2e`

### Requirement: Every marketing email can be refused in one click

Every marketing email SHALL carry one-click unsubscribe with a confirmation page, while order emails SHALL still arrive. Links SHALL be tagged so email visits show as campaigns on the dashboard.

#### Scenario: an unsubscribed reader buys

- **WHEN** a reader who unsubscribed buys something
- **THEN** they receive the order email and no further marketing email

Verified by: `build/marketing.test.mts` under `platformkit test --e2e`

### Requirement: Each funnel reports its results

Each funnel and blast SHALL report delivery, opens, clicks per link, unsubscribes, conversions and revenue for its goal, each step against the last, and who is waiting or held back.

#### Scenario: the figures are the rows

- **WHEN** the funnel analytics are asked for a seeded funnel
- **THEN** each count equals the count recomputed from the rows

Verified by: `build/funnels-analytics.test.mts` under `platformkit test --e2e`

### Requirement: Chat prompts are funnel steps

A funnel step SHALL be able to be a chat prompt, shown after time on site or on a page, on chosen pages, for signed-in or returning visitors or with a full bag, as a pop-up or as the support panel's resting prompt, with choice trees up to three levels.

#### Scenario: a prompt on a chosen page

- **WHEN** a visitor reaches a page a chat-prompt step names
- **THEN** the prompt is shown once, and its showing is recorded

Verified by: no test yet
