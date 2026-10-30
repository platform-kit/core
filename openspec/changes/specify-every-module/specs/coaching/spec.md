## ADDED Requirements

### Requirement: A member and a coach have one conversation

The `coaching` module SHALL give each member one conversation per coach, with a staff inbox. A message SHALL carry text, files, images or a voice note with its transcript, and SHALL take reactions, replies and withdrawal. Each side SHALL see unread counts and sent and read marks, and a coach SHALL be able to find any member to start a conversation.

#### Scenario: the conversation's arithmetic

- **WHEN** messages arrive across days, are reacted to and are read
- **THEN** the runs, the day breaks, the ticks and the unread count are what the shared chat model computes

Verified by: `build/chat.test.mjs`

### Requirement: Who may chat, and when

Chat SHALL be open by plan, or for a week around a paid session, and a coach SHALL see the reply time each member's plan promises. An away email SHALL be sent when the other person has been away, and never while they are on the site. The site SHALL choose whether chat lives in the reader's app or in the community.

#### Scenario: chat outside a plan's window

- **WHEN** a member with no chat plan and no session in the week around now opens a conversation
- **THEN** they cannot send in it

Verified by: no test yet
