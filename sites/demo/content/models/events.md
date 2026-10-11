---
key: events
name: Events
singular: Event
title: title
order:
  by: starts
  dir: asc
deliver:
  pages: true
  json: true
fields:
  - key: title
    kind: text
    label: Title
    required: true
    grid: true
  - key: starts
    kind: datetime
    label: Starts
    required: true
    grid: true
  - key: author
    kind: reference
    label: Author
    model: authors
    grid: true
  - key: where
    kind: group
    label: Where
    fields:
      - key: venue
        kind: text
        label: Venue
      - key: city
        kind: text
        label: City
  - key: seats
    kind: number
    label: Seats
    rules:
      - rule: between
        params:
          - 1
          - 200
      - rule: integer
  - key: sessions
    kind: list
    label: Sessions
    of: group
    fields:
      - key: name
        kind: text
        label: Name
      - key: minutes
        kind: number
        label: Minutes
  - key: details
    kind: markdown
    label: Details
---
