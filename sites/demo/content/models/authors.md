---
key: authors
name: Authors
singular: Author
title: name
body: Biography
deliver:
  pages: true
  section: true
fields:
  - key: name
    kind: text
    label: Name
    required: true
    unique: true
    grid: true
    rules:
      - rule: min
        params: 2
  - key: role
    kind: select
    label: On the list
    options:
      - value: current
        label: In print
      - value: forthcoming
        label: Forthcoming
    default: current
    grid: true
  - key: line
    kind: long-text
    label: One line
    help: what this author writes about, in a sentence
  - key: book
    kind: text
    label: Their book
    grid: true
  - key: site
    kind: url
    label: Their own site
  - key: readings
    kind: boolean
    label: Available for readings
    default: true
---

The people who wrote the books. Each one has a page of their own, and the About page draws the
list from here.
