---
title: Ten pounds off a big order
status: active
method: fixed
value: 10
target: order
rules:
  - attribute: item_total
    operator: gte
    value: 5000
---

The commonest discount there is, and one a per-item model cannot express at all: it comes off the
order as a whole rather than off any line, and it only appears once the basket is over fifty.
