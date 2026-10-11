---
name: Orders
topic: What the shop is doing, written by the shop
mode: stream
visibility: open
order: 2
hears:
  - purchase.paid
  - subscription.started
  - account.new
  - support.escalated
---

What the shop just did, and what the desk could not answer in time.
