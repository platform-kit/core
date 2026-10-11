---
title: Events in a community
description: How a community lists events, repeats a schedule, takes RSVPs, and keeps attendees informed.
order: 52.2
sources:
  [
    packages/kit/build/events.mjs,
    packages/kit/build/events-push.mjs,
    packages/kit/supabase/schemas/95-events.sql,
    packages/kit/supabase/functions/event-reminders,
    packages/movable-types/src/pages/SpacesPage.vue,
  ]
reviewed: 2026-10-10
---

An event gives a community one place to say what is happening, when it happens, who it is for, and how to take part. Events appear in the community calendar and can belong to a space and a room, so readers can find the event and the conversation about it together.

## One date or a repeating gathering

A one-off event has a start and end. A recurring event describes a calendar pattern instead of requiring a new record for every date. It can repeat by day, week, month, or year, use a named time zone, stop after a date or number of occurrences, and skip exceptions. The calendar expands that pattern into upcoming dates over a rolling year.

The event description, host, place or link, audience, and capacity belong to the event itself. A host is described by a role or other eligible group, not by putting an individual's name into a content file. The audience may be open to everyone or limited to people who meet the event's access rule.

## RSVP and places

An event may take RSVPs or simply publish its details. When it takes RSVPs, the site can offer answers such as going or maybe, ask for a reason, and define which answer holds a place. Capacity limits the places available. A priced event can use the site's checkout rather than collecting payment informally.

## Reminders

For events that use reminders, the site sends a reminder for an upcoming occurrence to the people who have responded. Each reminder is recorded so it is not sent twice for the same person and occurrence. A recurring event has separate attendance for each date: responding to one date does not silently register someone for every future date.

The event fields and repeat options are listed in the [content reference](/content/docs/reference/frontmatter#content-events).
