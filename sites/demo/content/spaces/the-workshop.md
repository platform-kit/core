---
name: The workshop
kind: server
discoverable: true
welcome: floor
fill:
  bought: working-hours
# buying the book puts you in; so does asking, and the ask is kept either way
join:
  how: request
roles:
  - slug: member
    name: Member
    rank: 0
  - slug: founder
    name: Founding member
    colour: '#86613c'
    rank: 30
    can:
      - invite
  - slug: moderator
    name: Moderator
    colour: '#3d7369'
    rank: 50
    can:
      - mention-channel
      - voice
      - moderate
      - invite
grants:
  - capability: voice
    to: role:founder
  - capability: voice
    to: 'bought:coaching-session'
    days: 7
    note: a week of voice with every coaching call
---

Where the writing actually gets done. Buying *Working Hours* puts you in it; so does asking. A
founding member may speak aloud anywhere in the room, and anybody who books a call may for the
week that follows.
