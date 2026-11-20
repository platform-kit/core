## ADDED Requirements

### Requirement: Every offer has its own checkout page

The kit SHALL serve `/checkout/<sku>` for every published offer, whether or not the store module is on: the offer's title, subtitle and body, its ways to pay with what each commits the buyer to, and a way to continue to the payment provider. A signed-out reader who chooses to pay SHALL be asked to sign in and SHALL then continue to the payment without choosing again. A reader who already holds the offer SHALL be sent to billing instead. An unknown offer SHALL say so. With the store module off, an offer's store address SHALL show its checkout page. The Pricing section SHALL send an offer sold in terms or on a plan to its checkout page with the way to pay already chosen.

#### Scenario: a programme sells with the store off

- **WHEN** a site with the store module off shows a membership sold in 3-month terms, and a signed-out reader chooses the monthly term, agrees to it and continues
- **THEN** they are asked to sign in, and once signed in they are taken to the payment provider for that term

Verified by: DharmaLab's Group Mentorship driven in a browser

#### Scenario: an old store link

- **WHEN** the store module is off and a reader opens `/store/products/<sku>`
- **THEN** they see that offer's checkout page

Verified by: DharmaLab driven in a browser; `build/module-routes.test.mts`

### Requirement: A checkout left unfinished can be followed up

When a signed-in person opens a checkout, the kit SHALL record the offer it is for. A checkout SHALL count as left unfinished while the person has paid for nothing on that offer since it was opened: no paid purchase, no subscription and no commitment. A funnel's audience SHALL accept `abandoned-checkout` (a span since the checkout was opened, or `none`) and `abandoned-offer` (offers to narrow it to). `/checkout` with no offer SHALL open the reader's latest checkout left unfinished, or say there is none.

#### Scenario: following up and stopping

- **WHEN** a reader opens a checkout for an offer and leaves, and later pays for that offer
- **THEN** `abandoned-checkout` matches them after leaving and not after paying, and `/checkout` opened in between shows that offer

Verified by: DharmaLab in a browser and against its database (the rule checked before and after a paid purchase, inside a transaction rolled back)
