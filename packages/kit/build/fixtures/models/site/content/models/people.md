---
key: people
name: People
singular: Person
title: name
deliver:
  pages: true
fields:
  - key: name
    kind: text
    label: Name
    required: true
    unique: true
    grid: true
  - key: role
    kind: select
    label: Role
    options:
      - value: teacher
        label: Teacher
      - value: guest
        label: Guest
---

