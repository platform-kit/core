## ADDED Requirements

### Requirement: An encrypted channel is readable only on members' devices

The `space-encryption` module SHALL let a space or a channel be declared encrypted, resolved in one place for a channel and the space above it. The server SHALL store only ciphertext for such a channel. Each browser SHALL be set up separately, with a one-time recovery key to read earlier messages on a new device. Messages sent before someone joined SHALL stay unreadable to them.

#### Scenario: what the database holds

- **WHEN** a message is sent to an encrypted channel
- **THEN** the database holds no plaintext of it, and the room keys it stores are sealed under a recovery key it has never seen

Verified by: `build/encryption-db.test.mjs` under `platformkit test --e2e`, `build/encryption.test.mjs`

### Requirement: What an encrypted room gives up

An encrypted room SHALL have no search, no bots and no moderation of message contents, and its notifications and reports SHALL carry no words. An encrypted declaration SHALL be refused when the `space-encryption` module is off, rather than served as plain text.

#### Scenario: encryption asked for with the module off

- **WHEN** a channel's file says `encrypted: true` and the module is off
- **THEN** the spaces compile refuses it by name

Verified by: `build/modules-off.test.mjs`
