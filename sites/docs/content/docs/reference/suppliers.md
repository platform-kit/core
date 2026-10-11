---
title: Suppliers
description: The one interface anything that makes or sends a thing wears, and how a site adds its own.
order: 86
sources: [packages/kit/supabase/functions/_shared/suppliers, packages/kit/build/suppliers.mjs, packages/kit/build/kinds, packages/kit/build/suppliers.test.mjs, packages/kit/build/store-kinds.test.mjs, sites/demo/build/suppliers.mjs]
reviewed: 2026-10-01
---

A **supplier** is anything that makes or sends what a shop sells: a print-on-demand press, a
garment printer, a warehouse, the shelf in the back room, a file in a bucket. There is one
interface, one registry, and nothing outside `_shared/suppliers/` names a supplier by id.

## A supplier makes a variant out of artefacts

That is the whole vocabulary, and it is deliberately empty of any word belonging to one kind of
thing:

- **`chosen`** — the variant's own option values: what the buyer picked.
- **`artefacts`** — whatever the *kind* derived for that variant: a book's page count and its
  print files, a garment's artwork and its placements. The supplier understands them and nothing
  between the two needs to.

The interface used to take `pages` and `files` by name, which meant a supplier making anything
but a book could not implement it — "plug-in" was true only of printers.

## The interface

| Field | What it is |
| --- | --- |
| `id` | a slug naming this supplier; the only place it is ever written |
| `name` | what a person calls it |
| `makes` | the formats it can **make**; `[]` for one that only sends |
| `sends` | whether anything physically travels |
| `stateful` | whether it keeps a title of its own, made once and replaced free after |
| `keys` | the **environment** keys it cannot work without, by name |
| `needs` | the **artefacts** it needs a kind to have produced |
| `levels` | our three shipping words (`standard`, `priority`, `express`) in its own |

`keys` and `needs` answer two different questions and a supplier that confused them would
report `LULU_CLIENT_KEY` as a missing artefact. `keys` is how a deploy refuses before it
starts; `needs` is matched against a kind's `produces` when the shop is configured.

| Method | What it answers |
| --- | --- |
| `configured()` / `mock()` | keys present; every call answered locally |
| `options(format)` | the **shop's** choices about how a thing is made — the admin's tab |
| `catalogue(chosen)` | the **buyer's** axes, where the supplier publishes them. Optional |
| `product({ chosen, options })` | its own descriptor for that variant. Pure |
| `measure({ product, artefacts })` | a shape, where it has one |
| `quote({ product, artefacts, quantity, country, level })` | `{ print, shipping, currency, days }` |
| `validate({ product, artefacts })` | `{ ok, errors }` |
| `register({ product, artefacts, title, sku, existing })` | stateful suppliers only |
| `order({ product, artefacts, ref, title, quantity, address, email, level, externalId, callbackUrl })` | `{ id, status, cost }` |
| `status(id)` / `statusOf(word)` | its words onto ours: submitted · in_production · shipped · rejected · canceled · failed |
| `webhook(body)` / `ensureWebhook(url)` | the job id a callback names; registering the callback |

A supplier that sends nothing — a download — answers `order` by saying it is already done. One
that is a shelf in a back room says so too, and waits for somebody to mark it sent.

## `quote` has three answers, and they are different

A number is a price. `null` means **ask somebody else** — a hand bindery that quotes by eye.
A real zero means **nothing**: a file costs nothing to send and nothing to make again. Collapsing
the last two is how a shop ends up offering free shipping it cannot do.

## The ones the kit ships

| Id | Makes | Keys |
| --- | --- | --- |
| `lulu` | softcover · hardcover | `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET` (+ `LULU_SANDBOX`) |
| `mixam` | softcover · hardcover | `MIXAM_USER`, `MIXAM_PASS` (+ `MIXAM_UK`) |
| `bookvault` | softcover · hardcover · premium | `BOOKVAULT_API_KEY` |
| `post-room` | — (it only sends) | none |
| `printify` | shirt · hoodie | `PRINTIFY_API_KEY`, `PRINTIFY_SHOP_ID` |
| `download` | pdf · epub | none |

Every one is mocked by `PRINT_MOCK=1`, by its own `<ID>_MOCK`, and by having no keys — which
is what lets the whole chain run on a fresh clone with no account.

## A catalogue, where the supplier publishes one

Most publish none: a printer makes what it is sent and has no opinion about colours. Where one
does, the axes are **that supplier's to say**, and a shop that types them in by hand is a shop
that goes on selling a colour nobody makes any more.

So a product names its `supplier`, and **Read the catalogue again** in the admin writes what
comes back into the file as ordinary option rows marked `from: <supplier id>`. Everything
afterwards — the variants, the keys, the admin's grid, the catalog, the checkout's own check —
reads them exactly as it reads a row somebody typed.

```yaml
options:
  - name: Colour
    from: ridgeway
    values: [{ value: black, label: Black }, { value: slate, label: Slate blue, gone: true }]
```

**A value the catalogue drops is marked, never deleted.** Deleting it would be wrong twice over:
a basket or an unfulfilled order names that variant and would stop resolving, and the shop is
never told it has stopped selling something. So it stays with `gone: true`, every combination
holding it is off sale at once, the till refuses one, and an order already placed still reads as
the words the buyer chose. A value the catalogue brings back loses its mark and sells again, with
nothing to clean up — which is why the mark is the mechanism rather than a list of dead keys the
file would have to remember the provenance of. An axis the catalogue drops **whole** is kept the
same way, because removing it would renumber every key the offer has.

The shop's own `unsold` list is never written by a refresh: that is a decision, and `gone` is
news.

## Adding your own

One file, and its name in your site's config:

```js
// platformkit.config.js
export default {
  store: { suppliers: './build/suppliers.mjs', kinds: './build/kinds.mjs' },
}
```

Export a factory taking `env` (or a plain object) for each one. The registry walks the kit's and
yours as one list, refuses a supplier that does not keep the shape **by name at registration**
rather than halfway through a sale, and refuses two suppliers sharing an id. Nothing downstream
knows which list yours came from.

`sites/demo/build/suppliers.mjs` has two worked examples: a hand bindery with no API at all, and
a garment printer that publishes a catalogue.

## Asking for them

`packages/kit/build/suppliers.mjs` is the one build-side door — `suppliersFor(ctx)` and
`kindsFor(ctx)`, both bound to the process's environment and cached per site root. Everything
that needs a supplier asks there. Reaching past it to `_shared/suppliers/index.js` gets the
kit's five and silently loses the site's, which is the shape a plug-in seam rots into: true of
the interface, false of the product.

## Kinds, the other half

A kind owns everything true only of one sort of thing, and reaches the store through exactly two
slots: `options(offer)` and `artefacts(variant)`. The store never opens the parcel — it stores
the record, hands it to a supplier, and may ask only whether the variant is makeable yet.

A kind declares which artefacts it **produces**; a supplier declares which it **needs**; the two
are matched when a shop is configured rather than when somebody tries to buy, because a refusal at
the till is a refusal too late. An ordinary product registers no kind at all — not a null column,
not a branch: absent.

The kit ships one: **`apparel`**, which owns everything true only of a garment — the product
type, the design and where it sits, and a mockup per colourway — and reaches the store through
those two slots and nothing else. See
[Selling garments](/content/docs/running-a-site/selling/garments).
