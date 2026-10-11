---
title: The Store API reference
description: Every type, field, mutation and error of the Shopify-compatible Store API a site serves, the products' mapping and the cart's rules — the reference; the guide is under Building a site.
order: 85.7
reviewed: 2026-10-01
sources: [packages/kit/supabase/functions/storefront-api/index.ts, packages/kit/supabase/functions/_shared/api/shopify, packages/kit/supabase/functions/_shared/api/keys.ts, packages/kit/supabase/schemas/85-api.sql, packages/kit/build/storefront-api.test.mjs]
---

The guide is [The Store API, Shopify's](/content/docs/building-a-site/store-api). This page says exactly what is there.

A subscription carries a **source**: one somebody made through this API is `hand` and is theirs, and one a deployment ships declared in `platformkit.config.js` is `file` and is the projection's to replace — see [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Base, token, headers

| | |
| --- | --- |
| endpoint | `POST https://<domain>/api/store/api/<version>/graphql.json` — and, because Shopify’s client discards a path on its `storeDomain`, the same door at `POST https://<domain>/api/<version>/graphql.json` with `{ query, variables, operationName }`; `GET …/graphql.json?query=&variables=` too; any `<version>` (the docs assume `2024-10`); the function's own address `https://<ref>.supabase.co/functions/v1/storefront-api/api/…` answers too |
| the token | `X-Shopify-Storefront-Access-Token: <key>` (or `Authorization: Bearer <key>`): a key of kind `storefront` — public, as Shopify's is |
| refusals | 401 `{ errors: [{ message }] }` for no token or a revoked one; 403 for a key of another kind; 429 with `Retry-After` past the rate limit (the api module's); 400 a body that is not JSON or has no `query`; a query's own faults 200 with GraphQL's `errors` |
| `/api/desk/api/v1/…` | handed on whole to the `support-api` function (Chatwoot's Application API) |
| `/api/content/spaces/…`, `/api/content/content/v1/…` | handed on whole to the `content` function (the content API, under `/api` because `/spaces` is the community's address) |
| `/api/forms/forms`, `/api/me`, `/api/workspaces`, `/api/insights` | handed on whole to the `forms-api` function (Typeform's own paths, which have no prefix of their own) |
| the handoff's read | `GET …/api/store/carts/<token>` (`…/api/carts/<token>` too, beside the endpoint's alias) — no key; the cart's lines as the bag takes them (`sku`, `variant`, `quantity`, `kind`, `name`, `label`, `unit_amount`, `currency`, `image`, `handle`), `buyerIdentity`, `checkoutUrl`; 404 for none |
| CORS | open (`*`) |

## The schema

Shopify's names and shapes, a subset: `QueryRoot` — `shop`, `product(id, handle)`, `productByHandle(handle)`, `products(first, after, last, before, reverse, sortKey, query)`, `collection(id, handle)`, `collectionByHandle(handle)`, `collections(first, after, reverse, sortKey, query)`, `cart(id)`, `node(id)`, `nodes(ids)`, `productRecommendations(productId, productHandle)` (the same type's other products), `localization`; `Mutation` — `cartCreate(input)`, `cartLinesAdd(cartId, lines)`, `cartLinesUpdate(cartId, lines)`, `cartLinesRemove(cartId, lineIds)`, `cartBuyerIdentityUpdate(cartId, buyerIdentity)`, `cartAttributesUpdate(cartId, attributes)`, `cartNoteUpdate(cartId, note)`. Connections carry `edges { cursor node }`, `nodes` and `pageInfo` (`first` up to 250, 20 by default; `after` a cursor); money is `MoneyV2 { amount, currencyCode }` (`"15.0"`, `USD`); the `Node` interface answers `node(id)` for a product, a collection or a variant; introspection is on. Fields Shopify has that the site does not (`metafield`, `sellingPlanGroups`, `discountCodes`, `deliveryGroups`, `customer`…) answer null or empty rather than failing a query.

| Type | Fields |
| --- | --- |
| `Shop` | `id`, `name`, `description`, `primaryDomain { url host sslEnabled }`, `paymentSettings { currencyCode enabledPresentmentCurrencies }`, `shipsToCountries` (the storefront's shipping countries), `moneyFormat` |
| `Product` | `id` (`gid://shopify/Product/<handle>`), `handle`, `title`, `description(truncateAt)`, `descriptionHtml`, `productType` (`good` or `book`), `vendor` (a book's author, else the site), `tags`, `availableForSale`, `createdAt`, `updatedAt`, `publishedAt`, `onlineStoreUrl` (the store page), `featuredImage`, `images(first)`, `options { id name values optionValues }`, `variants(first)`, `variantBySelectedOptions(selectedOptions, caseInsensitiveMatch)`, `priceRange`, `compareAtPriceRange`, `collections(first)`, `seo`, `totalInventory` (null), `requiresSellingPlan` (false) |
| `ProductVariant` | `id` (`gid://shopify/ProductVariant/<sku>[/<variant>]`), `title` (the option values joined by ` / `; `Default Title`), `sku`, `price`, `priceV2`, `compareAtPrice`, `availableForSale`, `currentlyNotInStock`, `quantityAvailable` (null), `requiresShipping` (a good or a printed format), `selectedOptions { name value }`, `image`, `product`, `weight`, `weightUnit`, `taxable`, `barcode` |
| `Image` | `id`, `url`, `src`, `originalSrc`, `transformedSrc`, `altText`, `width`, `height` — the address on the Images API (its transforms by its own parameters) |
| `Collection` | `id` (`gid://shopify/Collection/<handle>`), `handle`, `title`, `description`, `descriptionHtml`, `image`, `updatedAt`, `onlineStoreUrl`, `products(first, sortKey)`, `seo` |
| `Cart` | `id` (`gid://shopify/Cart/<token>`), `checkoutUrl` (`https://<domain>/cart/c/<token>`), `createdAt`, `updatedAt`, `totalQuantity`, `lines(first)` → `CartLine { id quantity merchandise (a ProductVariant) attributes cost { totalAmount subtotalAmount amountPerQuantity compareAtAmountPerQuantity } }`, `cost { totalAmount subtotalAmount totalTaxAmount (null) totalDutyAmount (null) checkoutChargeAmount }`, `buyerIdentity { email phone countryCode }`, `attributes`, `note` |
| `CartUserError` | `code` (`INVALID_MERCHANDISE_LINE`, `QUANTITY_MUST_BE_POSITIVE`, `INVALID`), `field`, `message` |

Sort keys: `ProductSortKeys` `TITLE`, `PRICE`, `CREATED_AT`, `UPDATED_AT`, `BEST_SELLING` and `RELEVANCE` (the store's order); `query:` a word over the title, description and tags (Shopify's simple form; `title:` is taken off). Enums: `CurrencyCode`, `CountryCode` (the ones the store ships to and the usual others), `WeightUnit`, `CropRegion`.

## The products' mapping

| Offer | Product | Options and variants |
| --- | --- | --- |
| a `good` | one, `handle` the record's file name | *Size* from the record's `sizes` — a variant per size, `id …/<sku>/<size>`; none: one *Default Title* variant, `id …/<sku>`; `compare` → `compareAtPrice`; `requiresShipping` true |
| a book (its `book` unlock offer, its `print` and `download` offers) | one per book, `handle` the store page's id (the unlock product's file name, else `<slug>-print`), `productType` `book`, `vendor` the author, the picture the book's cover | *Format*: *Read online*, *Softcover*, *Hardcover*, *Premium hardcover*, *PDF*, *EPUB* as the offers say; *Contents* when the print block offers more than one; *Cloth* and *Foil* when the linen offers a choice; a variant per allowed combination, `id …/<format sku>/<contents>.<cloth>.<foil>` (no tail when the offer gives no choice); the unlock and a download take no print choice; `requiresShipping` for a printed format only |
| a `membership`, a `session` | none | — |

A record with `published: false`, and a book whose record is unpublished, are absent. Products are in the records' `order`; a collection lists the products its record names (by store-page id or sku), in that order.

## The cart's rules

A cart is a row of `storefront_carts` — `id` (a random token, the checkout url's secret), `lines` (`{ id, sku, variant, quantity, attributes }`, the bag's own shape plus a line id `gid://shopify/CartLine/…`), `buyer`, `attributes`, `note`, `key_id`, the times — filed under the key that made it, kept thirty days from its last change (the nightly sweep, `sweep_uploads`, clears older ones). A line's `merchandiseId` names a variant; a stackable line (a good, a printed format) adds up to the bag's cap of 10, a book online or a download stands at one; `cartLinesUpdate` with `quantity: 0` removes the line; `cartLinesRemove` takes line ids; `cartBuyerIdentityUpdate` keeps `email`, `phone`, `countryCode` (the handoff sets the shipping country from it when the store ships there); a cart another key made answers alike (the token is the secret, as Shopify's checkout link is). `cost` is recomputed from the catalog on every read: `subtotalAmount` = `totalAmount` = the lines' prices × quantities; tax, duties and shipping none — Checkout prices shipping by the country chosen. `cart(id)` for a token that is not there is `null`; a mutation on one answers `userErrors [{ code: INVALID, field: ['cartId'] }]`.

## The handoff page

`/cart/c/<token>` (`ROUTES.cart`; no chrome; never prerendered, `noindex`): reads the cart through `GET …/api/carts/<token>`, clears the bag and adds each line as the product page would (`lib/cart.js` `add`), sets `shipTo` from the buyer's country when the store ships there, waits for the session to be known, then calls the bag's own `checkout()` when the visitor may buy every line (a guest with print and download lines alone — `guestCart` — or a signed-in person) — Checkout's return is the site's usual `/app?checkout=success` — and otherwise opens the bag and the sign-in (intent `buy`). Words: `store.md` `cart.handoff` (`title`, `lead`, `signin-title`, `signin-lead`, `open-bag`, `expired-title`, `expired-lead`, `to-store`, `failed-title`, `failed-lead`).

## The keys

`api_keys.kind` gains `storefront` (Settings → API: **Storefront** — *products, collections and carts for a headless storefront*); the rest as [the content API reference](/content/docs/reference/contentful-api) says. The module switches are `store` and `api`.
