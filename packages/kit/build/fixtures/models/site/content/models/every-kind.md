---
key: every-kind
name: Every kind
singular: Entry
title: title
body: Notes
access:
  - authenticated
order:
  by: rank
  dir: desc
deliver:
  pages: true
  json: true
  section: true
fields:
  - key: title
    kind: text
    label: Title
    help: the name
    required: true
    unique: true
    grid: true
    rules:
      - rule: min
        params: 3
      - rule: max
        params: 40
  - key: blurb
    kind: long-text
    label: Blurb
    rules:
      - rule: starts_with
        params: A
  - key: about
    kind: markdown
    label: About
  - key: rank
    kind: number
    label: Rank
    default: 1
    rules:
      - rule: between
        params:
          - 1
          - 10
      - rule: integer
  - key: live
    kind: boolean
    label: Live
    default: true
  - key: day
    kind: date
    label: Day
    rules:
      - rule: after
        params: '2020-01-01'
  - key: at
    kind: datetime
    label: At
  - key: site
    kind: url
    label: Site
    rules:
      - rule: url
  - key: mail
    kind: email
    label: Mail
    rules:
      - rule: email
  - key: colour
    kind: select
    label: Colour
    options:
      - value: red
        label: Red
      - value: blue
        label: Blue
  - key: colours
    kind: multi-select
    label: Colours
    rules:
      - rule: max
        params: 2
    options:
      - value: red
        label: Red
      - value: blue
        label: Blue
  - key: tags
    kind: tags
    label: Tags
  - key: host
    kind: reference
    label: Host
    model: people
  - key: guests
    kind: reference
    label: Guests
    model: people
    many: true
  - key: cover
    kind: image
    label: Cover
  - key: sheet
    kind: file
    label: Sheet
  - key: where
    kind: group
    label: Where
    fields:
      - key: city
        kind: text
        label: City
        required: true
      - key: seats
        kind: number
        label: Seats
  - key: sessions
    kind: list
    label: Sessions
    of: group
    fields:
      - key: name
        kind: text
        label: Name
      - key: length
        kind: number
        label: Length
        rules:
          - rule: min
            params: 5
  - key: links
    kind: list
    label: Links
    of: url
  - key: code
    kind: text
    label: Code
    required: true
    shown:
      field: live
      is: is
      value: true
    rules:
      - rule: regex
        params: '^[A-Z]{3}$'
      - rule: alpha
      - rule: alpha_num
      - rule: alpha_dash
      - rule: size
        params: 3
      - rule: ends_with
        params: Z
  - key: pick
    kind: text
    label: Pick
    rules:
      - rule: in
        params:
          - one
          - two
      - rule: not_in
        params:
          - three
  - key: digits
    kind: text
    label: Digits
    rules:
      - rule: numeric
      - rule: digits
        params: 4
  - key: when
    kind: date
    label: When
    rules:
      - rule: date
      - rule: before
        params: '2030-01-01'
---

