---
title: Selling garments
description: Upload a design, pick a product type from the supplier's catalogue, and what the buyer sees.
order: 24
sources: [packages/kit/build/kinds/apparel.js, packages/kit/supabase/functions/_shared/suppliers/printify.js, packages/kit/build/store-kinds.test.mjs]
reviewed: 2026-10-01
---

A shirt is not a book and not an ordinary product. What is true only of it — the **product type**,
the **design**, where that design sits on the garment, and a **picture per colour** — is a *kind*,
and the store never opens it. Module: `store`; supplier: `printify`.

## Three steps

1. **Upload the design** to the [library](/content/docs/running-a-site/content/media) — the same
   button every other file field uses. There is no second uploader.
2. **Pick the product type.** The list is the supplier's own catalogue. You cannot type one.
3. **Read the catalogue** on the product, and the colours and sizes that type is made in are
   written in for you, with a picture per colour.

Then price it and publish it like anything else.

## Why you cannot type a product type

A product type is the *supplier's* fact. If you could type one, a typo could become an order —
and you would find out when a customer's shirt did not arrive.

So the control offers a list and the file keeps an id, and a file naming a type the supplier does
not sell is refused in all three places a file can reach the shop: **at the build**, **at the
save**, and **at the till** — in the same words each time, because they ask the same question of
the same function. The same goes one level down: a colour the type is not made in is refused with
the colour named.

## What the buyer sees

A card, the gallery and the picker show the **mockup for the colour chosen** — the supplier
renders them from your design on that garment, and the site keeps the addresses. A garment is
photographed per colour and not per size, so the same picture serves every size of one colour.

## Where the fetching happens

Nowhere a buyer waits. Asking the supplier is something the **admin** does, when you press *Read
the catalogue again* — so:

- in [cloud mode](/content/docs/running-a-site/settings/cloud-mode), where nothing ever builds,
  adding a colour gets you its mockup without a deploy;
- a product page is never slow because a supplier is slow, and never broken because one is down.

A colour the supplier stops making is **marked, not deleted** — it goes off sale at once, the till
refuses it, and an order already placed still reads as the words the buyer chose. See
[Suppliers](/content/docs/reference/suppliers).

## Keys

`PRINTIFY_API_KEY` (a personal access token) and `PRINTIFY_SHOP_ID`. With neither — or with
`PRINT_MOCK=1` or `PRINTIFY_MOCK=1` — every call is answered locally against a fixture
catalogue and a job walks itself to shipped, so the whole chain runs with no account.
