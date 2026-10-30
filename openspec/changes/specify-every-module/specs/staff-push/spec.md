## ADDED Requirements

### Requirement: Staff choose what each browser is told

The `push` module SHALL let a staff member opt each browser into topics: new support conversations, new support messages, purchases, accounts, memberships and bookings. Support topics SHALL go to the support desk and the rest to administrators. A staff member SHALL be able to send a test notification, and to see and remove the other browsers that get theirs.

#### Scenario: a purchase

- **WHEN** a purchase is recorded and an administrator's browser is opted into purchases
- **THEN** that browser is sent a notification, and a browser not opted in is not

Verified by: no test yet

### Requirement: Only staff reach the push function

The push function SHALL refuse a caller who is not staff, and a subscription SHALL belong to the account that made it.

#### Scenario: a reader asks

- **WHEN** a signed-in reader who is not staff calls the push function
- **THEN** it is refused

Verified by: `build/function-doors.test.mjs`, `build/doors-db.test.mjs` under `platformkit test --e2e`
