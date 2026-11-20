# Proposal

## Why

A funnel email is the same for everyone in its audience. A site whose strongest argument is the reader's own data, such as a diagnostic's results, can't put that data in front of them in the email, only link to it. The reader has to click through before the email says anything about them.

## What Changes

- **A site can register a reader block**: a named piece of an email the site renders from one reader's own data, such as their results.
- **An email places it by name** with one line in its markdown. Each recipient's copy carries their own.
- **A reader with nothing to show gets the email without the block**, or, if the email says so, isn't sent that step.
- **The block is rendered on the server, from the reader's own rows only**, as email-safe HTML in the email's design.
- **Every existing email is unchanged.**

## Capabilities

### New Capabilities

- `reader-email-block`: a site's own per-reader block in a funnel or blast email.

## Impact

- `platformkit.config.js`: `emails.blocks`, the site's renderers (a server module).
- The funnels runner and the blast sender render a step's blocks for each recipient.
- The email compiler accepts the block line and refuses a block no site registers.
- The admin's email preview renders a block against a chosen account.
- The funnels documentation.
