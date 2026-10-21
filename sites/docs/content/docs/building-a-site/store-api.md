---
title: The Store API, Shopify's
description: A site's store served as Shopify's Storefront API — products, collections and the cart at Shopify's endpoint under a public token — with a cart's checkout landing in the site's own bag; the guide. The reference lists every type and field served.
order: 56.97
sources:
  [
    packages/kit/supabase/functions/storefront-api,
    packages/kit/supabase/functions/_shared/api/shopify,
    packages/movable-types/src/pages/CartHandoffPage.vue,
    packages/kit/build/storefront-api.test.mjs,
    packages/kit/src/lib/cart.js,
    packages/kit/src/lib/shipto.js,
  ]
reviewed: 2026-10-20
---

## What it is

A site with the store and api modules on serves its store the way **Shopify** serves one to a headless storefront: the **Storefront API** — one GraphQL endpoint at `https://<domain>/api/<version>/graphql.json`, a public access token, Shopify's types (`Product`, `ProductVariant`, `Collection`, `Cart`), Shopify's ids and money — so a storefront written against a Shopify store points at the site instead: `@shopify/storefront-api-client` with `storeDomain` set to the site, Hydrogen's storefront client, a Framer or Webflow shop block, a mobile app. The reference — every type and field, the cart's rules, the errors — is [The Store API reference](/content/docs/reference/store-api).

```js
import { createStorefrontApiClient } from '@shopify/storefront-api-client'
const client = createStorefrontApiClient({
  storeDomain: 'northlight.example.com',
  apiVersion: '2024-10',
  publicAccessToken: '<a storefront key>',
})
const { data } = await client.request(
  `{ products(first: 10) { nodes { handle title priceRange { minVariantPrice { amount currencyCode } } variants(first: 20) { nodes { id title sku price { amount } selectedOptions { name value } } } } } }`,
)
const { data: made } = await client.request(
  `mutation($lines: [CartLineInput!]) { cartCreate(input: { lines: $lines, buyerIdentity: { countryCode: US } }) { cart { id checkoutUrl cost { totalAmount { amount } } } userErrors { code message } } }`,
  {
    variables: {
      lines: [
        {
          merchandiseId: 'gid://shopify/ProductVariant/the-quiet-room-softcover/parts',
          quantity: 1,
        },
      ],
    },
  },
)
window.location = made.cartCreate.cart.checkoutUrl
```

## The token

Settings → **API** makes a key of kind **Storefront** (_products, collections and carts for a headless storefront_). It is a public token, as Shopify's Storefront access token is: safe in a browser, it reads what the store sells and makes carts — nothing more. The client sends it as `X-Shopify-Storefront-Access-Token` (a bearer works too); no token is 401, a key of another kind 403, both in Shopify's error shape (`{ errors: [{ message }] }`); the rate limit is the api module's, `Retry-After` past it — counted in the database (`api_rate`) rather than in a worker's memory, so the number in the headers is what the door actually allows however many workers are up.

## What is sold is a product

The products are what the site's own bag sells, from the same offers (`content/store/products/*.md`, the catalog): a **good** is a product, its record's `sizes` one option _Size_ with a variant each (none: one _Default Title_ variant), its `compare` the compare-at price; a **book is one product**, as the store has one page per book — its handle the store page's id, one option _Format_ holding _Read online_ (the unlock offer), then every printed and downloadable format the book's print block sells, and _Contents_, _Cloth_ and _Foil_ as options when the block offers a choice, the variants the allowed combinations; a **download** sold on its own is a variant of its book's product. A membership and a session are not products: a subscription and a booking are not a cart's business, and are bought on the pricing page and in the app. Prices are the catalog's; pictures come by the Images API. A variant's id is `gid://shopify/ProductVariant/<sku>[/<variant>]` — the sku and the print choice (`parts.black.gold`) exactly as the bag's lines carry them, which is how a cart becomes a bag. Collections are the store's collection records with the products they name.

## The cart, and the checkout url

A cart is Shopify's Cart API — `cartCreate`, `cartLinesAdd`, `cartLinesUpdate`, `cartLinesRemove`, `cartBuyerIdentityUpdate`, `cartAttributesUpdate`, `cartNoteUpdate`, `cart(id)` — kept by the site for thirty days: its lines, the buyer identity (email, country, phone), attributes and a note; its `cost` the catalog's arithmetic over the lines (shipping is not in the cart — Checkout prices it once the country is known; tax and duties none); a line naming no variant a `userErrors` entry (`INVALID_MERCHANDISE_LINE`) that changes nothing, a quantity of zero `QUANTITY_MUST_BE_POSITIVE`, a quantity above the bag's cap of ten clamped, a book online never more than one.

**`checkoutUrl` is the site's own** — `https://<domain>/cart/c/<token>` — because a cart made anywhere checks out where the site's buyers do. Opening it fills the bag with the cart's lines, sets the shipping country when the cart's buyer gave one, and goes on: straight to Checkout when every line may be bought as the visitor is (a guest with printed and downloadable lines alone — the [guest checkout](/content/docs/running-a-site/selling/store) — or a signed-in person), otherwise to the store with the bag open and the sign-in offered (a book to read online is kept on an account). The ledger, the print order, the confirmation email and the files run exactly as for any bag: nothing is bought through the API, and no line skips a check the bag makes. A cart that is gone says so and offers the store.

## The address

Two rewrites on the host: `/api/store/*` — the room, as every API has one — and `/api/*`, the alias, because `@shopify/storefront-api-client` takes a `storeDomain` and throws away any path on it, so their client asks at the top of `/api` whatever it is given. Both reach `https://<ref>.supabase.co/functions/v1/storefront-api` — the [hosting page](/content/docs/building-a-site/dev-build-and-deploy) has the file; the reference page keeps `/api` itself (nginx is told so exactly). Where the host has no rewrite the site's shell forwards `/api/<version>/graphql.json` to the function before anything loads; the function's own address answers too. One host rule carries `/api/*`, so this function is where the doors under it are told apart and handed on whole: `/api/desk/api/v1/…` is Chatwoot's Application API ([the Support API](/content/docs/building-a-site/support-api)) and goes to `support-api`; and `/api/forms/forms`, `/api/me`, `/api/workspaces` and `/api/insights` are the [Forms API](/content/docs/building-a-site/forms-api) — Typeform's own paths, which have no prefix of their own and so no host rule of their own — and go to `forms-api`. Every other door under `/api` has a host rule that reaches its function directly, so nothing else pays for the hop. The reference at `/api` carries the Store API as a group (_Storefront_: the endpoint and the handoff's cart read).

## Where the shapes are, and what checks them

`_shared/api/shopify/` — `products.js` (the offers and the records → the products, variants, options and collections; the ids and their inverse), `schema.js` (the Storefront schema's core as SDL, with resolvers over the store and a cart store), `cart.js` (a cart's rows, arithmetic and errors) — plain JavaScript the function and the test share. The function reads the store from the live content index (never a draft) and the catalog, kept a few seconds; carts are `storefront_carts` (service role only; the nightly sweep clears those older than thirty days). `build/storefront-api.test.mjs` (in `platformkit test` with store and api on; `STOREFRONT_API_TEST=0` skips it) pins the products from a fixture and the schema under Node, and — with the stack up — the official client against the served door (shop, products, a product by handle, a collection, introspection, the cart's life, the refusals), and on Playwright the checkout url followed: a guest's paperback paid under the Stripe mock, a book online landing on the bag with the sign-in, an expired token (`STOREFRONT_API_SHOTS` a directory for its screenshots).

## What is not there, on purpose

Shopify's Admin API; customer accounts and the Customer Account API; selling plans and subscriptions (a membership is bought on the pricing page); discount codes and gift cards; metafields, metaobjects and markets (`@inContext`); the Checkout API (`checkoutCreate`, which Shopify itself retired); Hydrogen's framework beyond its storefront client.
