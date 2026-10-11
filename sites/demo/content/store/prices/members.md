---
title: Members' price
kind: override
status: active
currency: usd
rules:
  - attribute: customer.class
    operator: eq
    value: subscribed
prices:
  - sku: notebook
    variant: linen.lined
    amount: 15
---

What a member pays. An override says what the price IS, and it always wins — a sale is only ever
taken where it is lower than the shop's own price, so it cannot undercut this.

A discount is a different thing: the winter promotion takes twenty per cent off whatever this
person pays, so a member pays twelve where a stranger pays fourteen-forty.
