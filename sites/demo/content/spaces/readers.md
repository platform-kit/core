---
name: The reading room
kind: community
discoverable: true
welcome: welcome
groups:
  - Start here
  - The books
fill:
  tier: member
# anybody may knock, and somebody says yes. They are asked why and held to the house rules.
join:
  how: approve
  question: What are you reading at the moment?
  terms: |
    Be kind. Argue with the book, not with the person.
    What is said here stays here, and nothing from this room goes anywhere else.
# THE BADGES THIS ROOM INVENTS. What they are is declared here; who wears one is an act, given
# by a moderator on somebody's card, and never written in this file.
flair:
  - slug: founding
    name: Founding member
    icon: star
    colour: '#86613c'
    note: Here from the first week.
  - slug: whole-shelf
    name: Read the whole shelf
    icon: sparkle
    colour: '#3d7369'
    note: Finished every book in the library.
  - slug: host
    name: Hosts the Tuesday call
    icon: video
    colour: '#6a4b8a'
    inline: false
roles:
  - slug: member
    name: Reader
    rank: 0
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
    to: everyone
---

Every member of Northlight Press is in the reading room: one place to say what you are reading,
ask the editors something, and hear about a book before it is announced. Speaking aloud is
included — anybody in the room may leave a voice note.
