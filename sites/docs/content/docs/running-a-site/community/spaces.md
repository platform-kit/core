---
title: Spaces and communities
description: How spaces gather people, rooms, conversations, events, and shared community features.
order: 52.1
sources:
  [
    packages/kit/supabase/functions/spaces,
    packages/kit/build/spaces-disk.mjs,
    packages/kit/src/lib/community,
    packages/kit/theme/src/pages/SpacesPage.vue,
  ]
reviewed: 2026-10-22
---

Spaces are the site's shared places for people to gather. A community can have a public front page, discoverable spaces, and rooms for different kinds of conversation. The site's owner decides how each space is presented and who can enter; the people who actually join are recorded as membership, not listed in a content file.

## A space and its rooms

A space has a name, description, optional cover, and an ordered set of rooms. It may appear in the community directory or remain private to its members. A space can be open to join, accept requests, or require approval. A welcome room can orient new members, and room groups can make a larger community easier to browse.

Rooms support different kinds of activity: ongoing conversation, a forum, or a feed, with optional community features such as events, polls, voice, files, and moderation. A room can be public within its space or private. The community's front page can show the feed, events, people, and other sections the site chooses to offer.

## Membership and permissions

A space can be invitation-only or filled by a declared rule, such as a role, membership tier, or purchase. The rule describes who qualifies; it never names individual people. Invitations and manual additions remain individual membership records. Space roles and grants control what members may do, while moderation actions apply to people and conversations rather than changing the space's declaration.

## Encrypted rooms

A room can be end-to-end encrypted, so its messages are readable only on members' devices. That choice also means the site cannot search or moderate message text, bots cannot read the room, and newcomers cannot read earlier messages. Read [Encrypted channels](/content/docs/building-a-site/encrypted-channels) before enabling it; encryption is not a reversible display option.

Events can be attached to a space and room. See [Events in a community](/content/docs/running-a-site/community/events) for calendars and RSVPs. The configuration fields are in the [content reference](/content/docs/reference/frontmatter#content-spaces).
