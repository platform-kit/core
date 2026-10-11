# store-api

## Purpose

The site's store served as Shopify's Storefront API — the products, collections and carts a headless storefront reads and makes, at Shopify's endpoint under a public token — with a cart's checkout url landing in the site's own bag, so nothing is bought by a route of its own.

## Requirements

### Requirement: The store is Shopify's Storefront API

A site with the `store` and `api` modules on SHALL serve its store as Shopify's Storefront API at `https://<domain>/api/<version>/graphql.json` (any version; `POST { query, variables }`, or `GET ?query=`), under a key of kind `storefront` sent as `X-Shopify-Storefront-Access-Token` (or a bearer) — no key 401 and a key of another kind 403 in Shopify's error shape, the rate limit the api module's — answering the Storefront schema's core with Shopify's ids, connections, money and errors, introspection included: `shop`; `products` (search, sort, cursor paging), `product` and `productByHandle`; `collections`, `collection` and `collectionByHandle`; `cart` and the mutations `cartCreate`, `cartLinesAdd`, `cartLinesUpdate`, `cartLinesRemove`, `cartBuyerIdentityUpdate`, `cartAttributesUpdate`. What is sold is what the site's bag sells, from the same offers: a good with its sizes as variants, one product per book with its ways to have it as variants (read online, each printed and downloadable format, the print choices as options), a download — at the catalog's prices, the pictures on the images door; a membership and a session are not products. `@shopify/storefront-api-client` SHALL work with `storeDomain` set to the site and nothing else changed.
 A product SHALL carry its options and its variants, each with its own price, sku and availability, as Shopify's own shape has them; a variant that is tracked and gone SHALL say so; and the price a product reports SHALL be the one that buyer would be charged.
#### Scenario: the official client, one domain changed

- **WHEN** `createStorefrontApiClient({ storeDomain: <the site>, apiVersion: '2024-10', publicAccessToken: <a storefront key> })` asks `shop`, `products(first: 10)` with variants and prices, `product(handle:)` for a book in print and for a good with sizes, `collection(handle:)` with its products, and the introspection query
- **THEN** every product's variants and prices are the catalog's offers (a print variant per allowed contents × cloth × foil, its `sku` the format's), the good's sizes are its variants under the option *Size*, the collection lists the products its record names, the ids are `gid://shopify/…`, and the schema introspects

Verified by: `build/storefront-api.test.mjs` on the root (books in print) and the demo (goods with sizes, books online)

#### Scenario: no key, a wrong key

- **WHEN** the endpoint is asked with no token, with a revoked storefront key, and with a content delivery key
- **THEN** 401 `{ errors: [{ message }] }` for the first two and 403 for the last; a query error (a field the schema does not have) is 200 with GraphQL's `errors`

Verified by: the test

#### Scenario: a headless storefront reads a variant

- **WHEN** a client asks the Storefront API for a product with options
- **THEN** the options and variants come back in Shopify's shape, each with its price and whether it can be bought

Verified by: `storefront-api.test.mjs`

### Requirement: A cart is Shopify's, and checks out on the site

A cart made through the API SHALL be a row the site keeps for thirty days — its lines (a variant, a quantity, attributes), its buyer identity (email, country, phone), its attributes and note — answered as Shopify's `Cart`: `id` (`gid://shopify/Cart/<token>`), `lines` with `merchandise` the variant and `cost` per line, `cost` (subtotal and total from the catalog; tax, duties and shipping none — Checkout prices shipping), `totalQuantity`, `buyerIdentity`, `checkoutUrl`. A line naming no variant SHALL be a `CartUserError` (`INVALID_MERCHANDISE_LINE`), a quantity of zero `QUANTITY_MUST_BE_POSITIVE`, a quantity above the bag's cap clamped; a cart not found `null`. `checkoutUrl` SHALL be `https://<domain>/cart/c/<token>`: opening it fills the site's bag with the cart's lines and the country the buyer identity gave, then goes straight to Checkout when every line may be bought as the visitor is (a guest with print and download lines alone, or a signed-in reader), and otherwise opens the bag with the sign-in; a cart that is gone says so and offers the store.

#### Scenario: a cart's life through the client

- **WHEN** the client runs `cartCreate` with a paperback and a download, `cartLinesAdd` a good, `cartLinesUpdate` the good's quantity, `cartLinesRemove` the download, `cartBuyerIdentityUpdate` with a country, and reads `cart(id)`
- **THEN** each answer's `cart.lines` and `cost.totalAmount` are the catalog's arithmetic over the lines as they stand, `totalQuantity` counts them, the buyer identity reads back, a bad merchandise id is a `userErrors` entry and changes nothing, and `checkoutUrl` names the site's `/cart/c/<token>`

Verified by: the test

#### Scenario: the checkout url, followed

- **WHEN** a guest opens the `checkoutUrl` of a cart holding a paperback under the Stripe mock, and a signed-out reader opens one holding a book online
- **THEN** the first lands on Checkout's return with the order paid — the purchase and the print order as a guest's, the bag emptied — and the second on the store with the bag holding the book and the sign-in offered; an unknown token shows the expired words and the way to the store

Verified by: the test on Playwright (the mock), screenshots of the handoff and the expired state in both themes
