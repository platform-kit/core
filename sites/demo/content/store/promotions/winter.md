---
title: Winter sale
status: active
method: percentage
value: 20
target: items
allocation: each
applies:
  - sku: notebook
---

Twenty per cent off the notebooks, for everybody. Written as a reduction rather than a price, so
it comes off whatever each person would have paid — a member gets twenty per cent off their own
rate — and it cannot go stale when the notebook is re-priced.

To run this for new customers only, add the rule `customer.class ne subscribed`. That one line
is the entire policy; nothing is inferred from how specific anything looks.
