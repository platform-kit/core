/*
 * The Storefront schema's core as SDL (Shopify's names, in Shopify's shapes — connections with edges, nodes and
 * pageInfo; MoneyV2; the Node interface; userErrors) with resolvers over a store (products.js) and a cart store the
 * function hands in (`carts`: get, create, save). Built once on `graphql`; introspection answers, so a client's
 * codegen works. Every field a common storefront reads is here; what Shopify has and the site does not (selling
 * plans, metafields, markets, customers, discounts) answers empty or null rather than failing a query.
 */
import { buildSchema, graphql } from 'graphql'
import { findProduct, findVariant, pageOf, productSort, GID } from './products.js'
import { linesIn, linesUpdated, linesRemoved, cartOf, buyerIn, attributesIn } from './cart.js'

export const SDL = /* GraphQL */ `
scalar DateTime
scalar Decimal
scalar URL
scalar HTML
scalar JSON
scalar UnsignedInt64
interface Node { id: ID! }
enum CurrencyCode { USD EUR GBP CAD AUD NZD JPY CHF SEK NOK DKK }
enum CountryCode { US CA GB IE AU NZ DE FR NL ES IT SE NO DK CH AT BE PT FI PL JP ZZ }
enum ProductSortKeys { TITLE PRODUCT_TYPE VENDOR UPDATED_AT CREATED_AT BEST_SELLING PRICE ID RELEVANCE }
enum ProductCollectionSortKeys { TITLE PRICE BEST_SELLING CREATED MANUAL COLLECTION_DEFAULT ID RELEVANCE }
enum CollectionSortKeys { TITLE UPDATED_AT ID RELEVANCE }
enum WeightUnit { KILOGRAMS GRAMS POUNDS OUNCES }
enum CartErrorCode { INVALID INVALID_MERCHANDISE_LINE LESS_THAN MISSING_NOTE QUANTITY_MUST_BE_POSITIVE INVALID_INCREMENT MAXIMUM_EXCEEDED MINIMUM_NOT_MET }
enum CropRegion { CENTER TOP BOTTOM LEFT RIGHT }
enum ImageContentType { PNG JPG WEBP }
input ImageTransformInput { crop: CropRegion, maxWidth: Int, maxHeight: Int, scale: Int, preferredContentType: ImageContentType }
type MoneyV2 { amount: Decimal!, currencyCode: CurrencyCode! }
type PageInfo { hasNextPage: Boolean!, hasPreviousPage: Boolean!, startCursor: String, endCursor: String }
type Image { id: ID, url(transform: ImageTransformInput): URL!, src: URL!, originalSrc: URL!, transformedSrc(maxWidth: Int, maxHeight: Int, crop: CropRegion, scale: Int, preferredContentType: ImageContentType): URL!, altText: String, width: Int, height: Int }
type ImageEdge { cursor: String!, node: Image! }
type ImageConnection { edges: [ImageEdge!]!, nodes: [Image!]!, pageInfo: PageInfo! }
type SEO { title: String, description: String }
type Domain { url: URL!, host: String!, sslEnabled: Boolean! }
type PaymentSettings { currencyCode: CurrencyCode!, enabledPresentmentCurrencies: [CurrencyCode!]!, supportedDigitalWallets: [String!]! }
type ShopPolicy { id: ID!, title: String!, body: String!, handle: String!, url: URL! }
type Shop implements Node { id: ID!, name: String!, description: String, primaryDomain: Domain!, paymentSettings: PaymentSettings!, shipsToCountries: [CountryCode!]!, moneyFormat: String!, privacyPolicy: ShopPolicy, refundPolicy: ShopPolicy, shippingPolicy: ShopPolicy, termsOfService: ShopPolicy, brand: JSON }
type ProductOptionValue { id: ID!, name: String! }
type ProductOption implements Node { id: ID!, name: String!, values: [String!]!, optionValues: [ProductOptionValue!]! }
type SelectedOption { name: String!, value: String! }
input SelectedOptionInput { name: String!, value: String! }
input VariantOptionFilter { name: String!, value: String! }
type ProductPriceRange { minVariantPrice: MoneyV2!, maxVariantPrice: MoneyV2! }
type UnitPriceMeasurement { measuredType: String, quantityUnit: String, quantityValue: Float!, referenceUnit: String, referenceValue: Int! }
type ProductVariant implements Node {
  id: ID!, title: String!, sku: String, barcode: String, availableForSale: Boolean!, currentlyNotInStock: Boolean!, quantityAvailable: Int, requiresShipping: Boolean!, taxable: Boolean!,
  price: MoneyV2!, priceV2: MoneyV2!, compareAtPrice: MoneyV2, compareAtPriceV2: MoneyV2, unitPrice: MoneyV2, unitPriceMeasurement: UnitPriceMeasurement,
  selectedOptions: [SelectedOption!]!, image: Image, product: Product!, weight: Float, weightUnit: WeightUnit!, metafield(namespace: String, key: String!): JSON, metafields(identifiers: [JSON!]!): [JSON]!
}
type ProductVariantEdge { cursor: String!, node: ProductVariant! }
type ProductVariantConnection { edges: [ProductVariantEdge!]!, nodes: [ProductVariant!]!, pageInfo: PageInfo! }
type Product implements Node {
  id: ID!, handle: String!, title: String!, description(truncateAt: Int): String!, descriptionHtml: HTML!, productType: String!, vendor: String!, tags: [String!]!, availableForSale: Boolean!, requiresSellingPlan: Boolean!, isGiftCard: Boolean!,
  createdAt: DateTime!, updatedAt: DateTime!, publishedAt: DateTime!, onlineStoreUrl: URL, seo: SEO!, totalInventory: Int,
  featuredImage: Image, images(first: Int, after: String, last: Int, before: String, reverse: Boolean): ImageConnection!,
  options(first: Int): [ProductOption!]!, variants(first: Int, after: String, last: Int, before: String, reverse: Boolean): ProductVariantConnection!,
  variantBySelectedOptions(selectedOptions: [SelectedOptionInput!]!, ignoreUnknownOptions: Boolean, caseInsensitiveMatch: Boolean): ProductVariant,
  priceRange: ProductPriceRange!, compareAtPriceRange: ProductPriceRange!, collections(first: Int, after: String): CollectionConnection!, media(first: Int): JSON, sellingPlanGroups(first: Int): JSON, metafield(namespace: String, key: String!): JSON, metafields(identifiers: [JSON!]!): [JSON]!
}
type ProductEdge { cursor: String!, node: Product! }
type ProductConnection { edges: [ProductEdge!]!, nodes: [Product!]!, pageInfo: PageInfo!, filters: [JSON!]!, totalCount: Int }
type Collection implements Node {
  id: ID!, handle: String!, title: String!, description(truncateAt: Int): String!, descriptionHtml: HTML!, image: Image, updatedAt: DateTime!, onlineStoreUrl: URL, seo: SEO!,
  products(first: Int, after: String, last: Int, before: String, reverse: Boolean, sortKey: ProductCollectionSortKeys, filters: [JSON!]): ProductConnection!, metafield(namespace: String, key: String!): JSON, metafields(identifiers: [JSON!]!): [JSON]!
}
type CollectionEdge { cursor: String!, node: Collection! }
type CollectionConnection { edges: [CollectionEdge!]!, nodes: [Collection!]!, pageInfo: PageInfo!, totalCount: Int }
type Attribute { key: String!, value: String }
input AttributeInput { key: String!, value: String! }
type CartLineCost { totalAmount: MoneyV2!, subtotalAmount: MoneyV2!, amountPerQuantity: MoneyV2!, compareAtAmountPerQuantity: MoneyV2 }
union Merchandise = ProductVariant
interface BaseCartLine { id: ID!, quantity: Int!, merchandise: Merchandise!, attributes: [Attribute!]!, attribute(key: String!): Attribute, cost: CartLineCost!, discountAllocations: [JSON!]!, sellingPlanAllocation: JSON }
type CartLine implements BaseCartLine & Node { id: ID!, quantity: Int!, merchandise: Merchandise!, attributes: [Attribute!]!, attribute(key: String!): Attribute, cost: CartLineCost!, discountAllocations: [JSON!]!, sellingPlanAllocation: JSON }
type BaseCartLineEdge { cursor: String!, node: BaseCartLine! }
type BaseCartLineConnection { edges: [BaseCartLineEdge!]!, nodes: [BaseCartLine!]!, pageInfo: PageInfo! }
type CartCost { totalAmount: MoneyV2!, subtotalAmount: MoneyV2!, totalTaxAmount: MoneyV2, totalDutyAmount: MoneyV2, checkoutChargeAmount: MoneyV2!, totalAmountEstimated: Boolean!, subtotalAmountEstimated: Boolean! }
type CartBuyerIdentity { email: String, phone: String, countryCode: CountryCode, customer: JSON, deliveryAddressPreferences: [JSON!]!, preferences: JSON }
type Cart implements Node {
  id: ID!, checkoutUrl: URL!, createdAt: DateTime!, updatedAt: DateTime!, totalQuantity: Int!, note: String, attributes: [Attribute!]!, attribute(key: String!): Attribute,
  lines(first: Int, after: String, last: Int, before: String, reverse: Boolean): BaseCartLineConnection!, cost: CartCost!, buyerIdentity: CartBuyerIdentity!,
  discountCodes: [JSON!]!, discountAllocations: [JSON!]!, appliedGiftCards: [JSON!]!, deliveryGroups(first: Int): JSON, metafield(namespace: String, key: String!): JSON
}
type CartUserError { code: CartErrorCode, field: [String!], message: String! }
input CartLineInput { merchandiseId: ID!, quantity: Int, attributes: [AttributeInput!], sellingPlanId: ID }
input CartLineUpdateInput { id: ID!, merchandiseId: ID, quantity: Int, attributes: [AttributeInput!], sellingPlanId: ID }
input CartBuyerIdentityInput { email: String, phone: String, countryCode: CountryCode, customerAccessToken: String, deliveryAddressPreferences: [JSON!], preferences: JSON }
input CartInput { lines: [CartLineInput!], buyerIdentity: CartBuyerIdentityInput, attributes: [AttributeInput!], note: String, discountCodes: [String!], metafields: [JSON!] }
type CartCreatePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartLinesAddPayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartLinesUpdatePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartLinesRemovePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartBuyerIdentityUpdatePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartAttributesUpdatePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type CartNoteUpdatePayload { cart: Cart, userErrors: [CartUserError!]!, warnings: [JSON!]! }
type QueryRoot {
  shop: Shop!
  product(id: ID, handle: String): Product
  productByHandle(handle: String!): Product
  products(first: Int, after: String, last: Int, before: String, reverse: Boolean, sortKey: ProductSortKeys, query: String): ProductConnection!
  collection(id: ID, handle: String): Collection
  collectionByHandle(handle: String!): Collection
  collections(first: Int, after: String, last: Int, before: String, reverse: Boolean, sortKey: CollectionSortKeys, query: String): CollectionConnection!
  cart(id: ID!): Cart
  node(id: ID!): Node
  nodes(ids: [ID!]!): [Node]!
  productRecommendations(productId: ID, productHandle: String): [Product!]
  localization: JSON
}
type Mutation {
  cartCreate(input: CartInput): CartCreatePayload
  cartLinesAdd(cartId: ID!, lines: [CartLineInput!]!): CartLinesAddPayload
  cartLinesUpdate(cartId: ID!, lines: [CartLineUpdateInput!]!): CartLinesUpdatePayload
  cartLinesRemove(cartId: ID!, lineIds: [ID!]!): CartLinesRemovePayload
  cartBuyerIdentityUpdate(cartId: ID!, buyerIdentity: CartBuyerIdentityInput!): CartBuyerIdentityUpdatePayload
  cartAttributesUpdate(cartId: ID!, attributes: [AttributeInput!]!): CartAttributesUpdatePayload
  cartNoteUpdate(cartId: ID!, note: String!): CartNoteUpdatePayload
}
schema { query: QueryRoot, mutation: Mutation }
`
let schema = null
export const schemaOf = () => (schema ||= buildSchema(SDL))

/* the objects the default resolver reads: a connection field is a method taking the arguments */
const conn = (list, args, opts) => { const p = pageOf(list, args, opts); return { edges: p.edges, nodes: p.nodes, pageInfo: p.pageInfo, totalCount: p.totalCount, filters: [] } }
const withMethods = (store, o = {}) => {
  const site = o.site || ''
  const image = (i) => (i ? { ...i, url: () => i.url, transformedSrc: () => i.url, __typename: 'Image' } : null)
  const wrapVariant = (v, product) => ({ ...v, __typename: 'ProductVariant', priceV2: v.price, compareAtPriceV2: v.compareAtPrice, image: image(v.image), product, metafield: () => null, metafields: () => [] })
  const wrapCollection = (c) => ({ ...c, __typename: 'Collection', image: image(c.image), description: ({ truncateAt }) => (truncateAt ? c.description.slice(0, truncateAt) : c.description), products: (args) => conn(c._products.map(wrapProduct), args, { search: (p) => p.title + ' ' + p.description, sort: productSort }), metafield: () => null, metafields: () => [] })
  const cacheP = new Map()
  function wrapProduct(p) {
    if (cacheP.has(p.id)) return cacheP.get(p.id)
    const w = { ...p, __typename: 'Product', featuredImage: image(p.featuredImage), description: ({ truncateAt }) => (truncateAt ? p.description.slice(0, truncateAt) : p.description), media: () => null, sellingPlanGroups: () => null, metafield: () => null, metafields: () => [] }
    w.images = (args) => conn(p.images.map(image), args)
    w.options = () => p.options
    w.variants = (args) => conn(p.variants.map((v) => wrapVariant(v, w)), args)
    w.variantBySelectedOptions = ({ selectedOptions, caseInsensitiveMatch }) => { const want = (selectedOptions || []).map((s) => [String(s.name), String(s.value)]); const eq = (a, b) => (caseInsensitiveMatch ? a.toLowerCase() === b.toLowerCase() : a === b); const v = p.variants.find((x) => want.every(([n, val]) => x.selectedOptions.some((so) => eq(so.name, n) && eq(so.value, val)))); return v ? wrapVariant(v, w) : null }
    w.collections = (args) => conn((p._collectionRefs || []).map(wrapCollection), args)
    cacheP.set(p.id, w); return w
  }
  const wrapCart = (row) => { if (!row) return null; const c = cartOf(store, row, { site }); return { ...c, __typename: 'Cart', lines: (args) => conn(c._lines.map((l) => ({ ...l, __typename: 'CartLine', merchandise: wrapVariant(l.merchandise, wrapProduct(l.merchandise.product)), attribute: ({ key }) => (l.attributes || []).find((a) => a.key === key) || null })), args), attribute: ({ key }) => (c.attributes || []).find((a) => a.key === key) || null, deliveryGroups: () => null, metafield: () => null } }
  return { wrapProduct, wrapCollection, wrapCart }
}

/**
 * Run a query. `carts` is { get(id) → row | null, create(row) → row, save(row) → row } over the function's table;
 * `o.site` the site's address for checkoutUrl; `o.keyId` the key the cart is filed under.
 */
export async function execute(store, { query, variables, operationName }, carts, o = {}) {
  const { wrapProduct, wrapCollection, wrapCart } = withMethods(store, o)
  const products = () => store.products.map(wrapProduct)
  const collections = () => store.collections.map(wrapCollection)
  const byId = (id) => { const s = String(id || ''); if (s.startsWith(GID.product)) { const p = findProduct(store, s); return p ? wrapProduct(p) : null } if (s.startsWith(GID.collection)) { const c = store.collections.find((x) => x.id === s); return c ? wrapCollection(c) : null } if (s.startsWith(GID.variant)) { const v = findVariant(store, s); return v ? { ...wrapProduct(v.product).variants({ first: 250 }).nodes.find((x) => x.id === s) } : null } return null }
  const cartId = (id) => String(id || '').replace(GID.cart, '')
  const mutate = async (id, fn) => { const row = await carts.get(cartId(id)); if (!row) return { cart: null, userErrors: [{ code: 'INVALID', field: ['cartId'], message: 'The cart does not exist.' }], warnings: [] }; const r = fn(row); if (r.errors.length) return { cart: wrapCart(row), userErrors: r.errors, warnings: [] }; const saved = await carts.save({ ...row, ...r.patch, updated_at: new Date().toISOString() }); return { cart: wrapCart(saved), userErrors: [], warnings: [] } }
  const rootValue = {
    shop: () => ({ ...store.shop, __typename: 'Shop' }),
    product: ({ id, handle }) => { const p = id ? findProduct(store, String(id)) : store.products.find((x) => x.handle === String(handle)); return p ? wrapProduct(p) : null },
    productByHandle: ({ handle }) => { const p = store.products.find((x) => x.handle === String(handle)); return p ? wrapProduct(p) : null },
    products: (args) => conn(products(), args, { search: (p) => p.title + ' ' + p.description + ' ' + (p.tags || []).join(' '), sort: productSort }),
    collection: ({ id, handle }) => { const c = store.collections.find((x) => (id ? x.id === String(id) : x.handle === String(handle))); return c ? wrapCollection(c) : null },
    collectionByHandle: ({ handle }) => { const c = store.collections.find((x) => x.handle === String(handle)); return c ? wrapCollection(c) : null },
    collections: (args) => conn(collections(), args, { search: (c) => c.title + ' ' + c.description }),
    cart: async ({ id }) => wrapCart(await carts.get(cartId(id))),
    node: ({ id }) => byId(id),
    nodes: ({ ids }) => (ids || []).map(byId),
    productRecommendations: ({ productId, productHandle }) => { const p = productId ? findProduct(store, String(productId)) : store.products.find((x) => x.handle === String(productHandle)); return p ? store.products.filter((x) => x !== p && x.productType === p.productType).slice(0, 10).map(wrapProduct) : null },
    localization: () => ({ country: { isoCode: 'US', currency: { isoCode: store.shop.paymentSettings.currencyCode } }, language: { isoCode: 'EN' } }),
    cartCreate: async ({ input }) => {
      const inp = input || {}
      const { rows, errors } = linesIn(store, inp.lines || [], [])
      if (errors.length) return { cart: null, userErrors: errors, warnings: [] }
      const now = new Date().toISOString()
      const row = await carts.create({ lines: rows, buyer: buyerIn(inp.buyerIdentity), attributes: attributesIn(inp.attributes), note: inp.note ? String(inp.note).slice(0, 2000) : null, key_id: o.keyId || null, created_at: now, updated_at: now })
      return { cart: wrapCart(row), userErrors: [], warnings: [] }
    },
    cartLinesAdd: ({ cartId: id, lines }) => mutate(id, (row) => { const r = linesIn(store, lines, row.lines || []); return { errors: r.errors, patch: { lines: r.rows } } }),
    cartLinesUpdate: ({ cartId: id, lines }) => mutate(id, (row) => { const r = linesUpdated(store, lines, row.lines || []); return { errors: r.errors, patch: { lines: r.rows } } }),
    cartLinesRemove: ({ cartId: id, lineIds }) => mutate(id, (row) => { const r = linesRemoved(row.lines || [], lineIds); return { errors: r.errors, patch: { lines: r.rows } } }),
    cartBuyerIdentityUpdate: ({ cartId: id, buyerIdentity }) => mutate(id, () => ({ errors: [], patch: { buyer: buyerIn(buyerIdentity) } })),
    cartAttributesUpdate: ({ cartId: id, attributes }) => mutate(id, () => ({ errors: [], patch: { attributes: attributesIn(attributes) } })),
    cartNoteUpdate: ({ cartId: id, note }) => mutate(id, () => ({ errors: [], patch: { note: String(note || '').slice(0, 2000) } })),
  }
  return graphql({ schema: schemaOf(), source: String(query || ''), variableValues: variables || {}, operationName: operationName || undefined, rootValue })
}
