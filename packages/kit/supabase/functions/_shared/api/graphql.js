/*
 * Contentful's GraphQL Content API, generated from the content types — plain JavaScript on `graphql` (the reference
 * implementation), shared by the function and the build's test. A type per content type (its fields in GraphQL's
 * types: Symbol and Text as String, RichText as { json, links }, Integer as Int, Number as Float, Date as DateTime,
 * Boolean, Object as JSON, a Link as its type, an Array of links as a <Type><Field>Collection), `sys`,
 * `contentfulMetadata`, `linkedFrom`; a <Type>Collection with `limit`, `skip`, `where` (Contentful's filter suffixes),
 * `order` (an enum of the sortable fields), `locale`, `preview`; `asset` and `assetCollection`; `entryCollection`;
 * introspection, so graphql-codegen works; Contentful's complexity ceiling (11 000); errors with
 * extensions.contentful.code. The schema is built once per index and kept.
 */
import { graphql, GraphQLSchema, GraphQLObjectType, GraphQLInterfaceType, GraphQLInputObjectType, GraphQLEnumType, GraphQLList, GraphQLNonNull, GraphQLString, GraphQLInt, GraphQLFloat, GraphQLBoolean, GraphQLScalarType, Kind, parse as parseQuery, validate, specifiedRules } from 'graphql'
import { makeContext } from './context.js'
import { entryOf, assetOf, assetUrl } from './entry.js'
import { entryId, assetId, graphqlName } from './ids.js'

const CEILING = 11000
const pascal = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
const JSONScalar = new GraphQLScalarType({ name: 'JSON', serialize: (v) => v, parseValue: (v) => v, parseLiteral: (ast) => { const walk = (n) => n.kind === Kind.OBJECT ? Object.fromEntries(n.fields.map((f) => [f.name.value, walk(f.value)])) : n.kind === Kind.LIST ? n.values.map(walk) : n.kind === Kind.INT || n.kind === Kind.FLOAT ? Number(n.value) : n.kind === Kind.BOOLEAN ? n.value : n.kind === Kind.NULL ? null : n.value; return walk(ast) } })
const DateTime = new GraphQLScalarType({ name: 'DateTime', serialize: (v) => v, parseValue: (v) => v, parseLiteral: (ast) => ast.value })
const Dimension = new GraphQLScalarType({ name: 'Dimension', serialize: (v) => v, parseValue: (v) => v, parseLiteral: (ast) => Number(ast.value) })
const Quality = new GraphQLScalarType({ name: 'Quality', serialize: (v) => v, parseValue: (v) => v, parseLiteral: (ast) => Number(ast.value) })
const HexColor = new GraphQLScalarType({ name: 'HexColor', serialize: (v) => v, parseValue: (v) => v, parseLiteral: (ast) => ast.value })

let built = null   /* { key, schema } */

function buildSchema(index) {
  const types = index.types
  const Sys = new GraphQLObjectType({ name: 'Sys', fields: { id: { type: new GraphQLNonNull(GraphQLString) }, spaceId: { type: new GraphQLNonNull(GraphQLString) }, environmentId: { type: new GraphQLNonNull(GraphQLString) }, publishedAt: { type: DateTime }, firstPublishedAt: { type: DateTime }, publishedVersion: { type: GraphQLInt }, locale: { type: GraphQLString } } })
  const Tag = new GraphQLObjectType({ name: 'ContentfulTag', fields: { id: { type: GraphQLString }, name: { type: GraphQLString } } })
  const Meta = new GraphQLObjectType({ name: 'ContentfulMetadata', fields: { tags: { type: new GraphQLNonNull(new GraphQLList(Tag)) }, concepts: { type: new GraphQLNonNull(new GraphQLList(Tag)) } } })
  const sysOf = (e) => ({ id: e.sys.id, spaceId: e.sys.space.sys.id, environmentId: 'master', publishedAt: e.sys.updatedAt, firstPublishedAt: e.sys.createdAt, publishedVersion: e.sys.revision, locale: e.sys.locale })
  const meta = () => ({ tags: [], concepts: [] })
  const ImageFormat = new GraphQLEnumType({ name: 'ImageFormat', values: { JPG: {}, JPG_PROGRESSIVE: {}, PNG: {}, PNG8: {}, WEBP: {}, AVIF: {} } })
  const ImageResizeStrategy = new GraphQLEnumType({ name: 'ImageResizeStrategy', values: { FIT: {}, PAD: {}, FILL: {}, SCALE: {}, CROP: {}, THUMB: {} } })
  const ImageResizeFocus = new GraphQLEnumType({ name: 'ImageResizeFocus', values: { CENTER: {}, TOP: {}, TOP_RIGHT: {}, RIGHT: {}, BOTTOM_RIGHT: {}, BOTTOM: {}, BOTTOM_LEFT: {}, LEFT: {}, TOP_LEFT: {}, FACE: {}, FACES: {} } })
  const ImageTransformOptions = new GraphQLInputObjectType({ name: 'ImageTransformOptions', fields: { width: { type: Dimension }, height: { type: Dimension }, quality: { type: Quality }, cornerRadius: { type: GraphQLInt }, resizeStrategy: { type: ImageResizeStrategy }, resizeFocus: { type: ImageResizeFocus }, backgroundColor: { type: HexColor }, format: { type: ImageFormat } } })
  const Entry = new GraphQLInterfaceType({ name: 'Entry', fields: { sys: { type: new GraphQLNonNull(Sys) }, contentfulMetadata: { type: new GraphQLNonNull(Meta) } }, resolveType: (v) => v.__typename })
  const EntryCollection = new GraphQLObjectType({ name: 'EntryCollection', fields: { total: { type: new GraphQLNonNull(GraphQLInt) }, skip: { type: new GraphQLNonNull(GraphQLInt) }, limit: { type: new GraphQLNonNull(GraphQLInt) }, items: { type: new GraphQLNonNull(new GraphQLList(Entry)) } } })
  const transformUrl = (url, t) => { /* a transform only means something on this site's own media door; a picture kept elsewhere is
     returned as it is */
    if (!t || /^https?:\/\//i.test(url) && !url.includes('/api/media/')) return url; const p = new URLSearchParams(); if (t.width) p.set('w', t.width); if (t.height) p.set('h', t.height); if (t.quality) p.set('q', t.quality); if (t.cornerRadius) p.set('r', t.cornerRadius); if (t.resizeStrategy) p.set('fit', String(t.resizeStrategy).toLowerCase()); if (t.resizeFocus) p.set('f', String(t.resizeFocus).toLowerCase()); if (t.backgroundColor) p.set('bg', 'rgb:' + t.backgroundColor); if (t.format) p.set('fm', String(t.format).toLowerCase().replace('_progressive', '')); const s = p.toString(); return s ? url + (url.includes('?') ? '&' : '?') + s : url }
  const Asset = new GraphQLObjectType({ name: 'Asset', fields: () => ({
    sys: { type: new GraphQLNonNull(Sys), resolve: (a) => sysOf(a) }, contentfulMetadata: { type: new GraphQLNonNull(Meta), resolve: meta },
    title: { type: GraphQLString, resolve: (a) => a.fields.title }, description: { type: GraphQLString, resolve: (a) => a.fields.description },
    contentType: { type: GraphQLString, resolve: (a) => a.fields.file.contentType }, fileName: { type: GraphQLString, resolve: (a) => a.fields.file.fileName },
    size: { type: GraphQLInt, resolve: (a) => a.fields.file.details.size }, url: { type: GraphQLString, args: { transform: { type: ImageTransformOptions } }, resolve: (a, args) => transformUrl(a.fields.file.url.startsWith('//') ? 'https:' + a.fields.file.url : a.fields.file.url, args.transform) },
    width: { type: GraphQLInt, resolve: (a) => a.fields.file.details.image ? a.fields.file.details.image.width : null }, height: { type: GraphQLInt, resolve: (a) => a.fields.file.details.image ? a.fields.file.details.image.height : null },
    linkedFrom: { type: AssetLinking, resolve: (a, _args, c) => ({ id: a.sys.id, kind: 'Asset', ctx: c }) },
  }) })
  const AssetCollection = new GraphQLObjectType({ name: 'AssetCollection', fields: { total: { type: new GraphQLNonNull(GraphQLInt) }, skip: { type: new GraphQLNonNull(GraphQLInt) }, limit: { type: new GraphQLNonNull(GraphQLInt) }, items: { type: new GraphQLNonNull(new GraphQLList(Asset)) } } })
  const AssetLinking = new GraphQLObjectType({ name: 'AssetLinkingCollections', fields: () => ({ entryCollection: { type: EntryCollection, args: pageArgs(), resolve: (src, args, c) => linkedFrom(src, args, c, null) }, ...Object.fromEntries(types.map((t) => [t.sys.id + 'Collection', { type: collections[t.sys.id], args: pageArgs(), resolve: (src, args, c) => linkedFrom(src, args, c, t.sys.id) }])) }) })
  const pageArgs = () => ({ skip: { type: GraphQLInt, defaultValue: 0 }, limit: { type: GraphQLInt, defaultValue: 100 }, preview: { type: GraphQLBoolean }, locale: { type: GraphQLString } })

  const objects = {}, collections = {}, filters = {}, orders = {}
  const fieldGql = (t, f) => {
    const name = graphqlName(f.id)
    if (f.type === 'RichText') return { name, gtype: richType(t, f) }
    if (f.type === 'Link' && f.linkType === 'Asset') return { name, gtype: Asset }
    if (f.type === 'Link' && f.linkType === 'Entry') { const target = (f.validations.find((v) => v.linkContentType) || {}).linkContentType || []; return { name, gtype: target.length === 1 && objects[target[0]] ? objects[target[0]] : Entry } }
    if (f.type === 'Array' && f.items && f.items.linkType === 'Entry') { const target = ((f.items.validations || []).find((v) => v.linkContentType) || {}).linkContentType || []; return { name: name + 'Collection', gtype: linkColl(t, f, target.length === 1 && objects[target[0]] ? objects[target[0]] : Entry), collection: true } }
    if (f.type === 'Array' && f.items && f.items.linkType === 'Asset') return { name: name + 'Collection', gtype: AssetCollection, collection: true, asset: true }
    if (f.type === 'Array') return { name, gtype: new GraphQLList(f.items && f.items.type === 'Object' ? JSONScalar : GraphQLString) }
    if (f.type === 'Integer') return { name, gtype: GraphQLInt }
    if (f.type === 'Number') return { name, gtype: GraphQLFloat }
    if (f.type === 'Boolean') return { name, gtype: GraphQLBoolean }
    if (f.type === 'Date') return { name, gtype: DateTime }
    if (f.type === 'Object') return { name, gtype: JSONScalar }
    return { name, gtype: GraphQLString }
  }
  const richTypes = {}
  const richType = (t, f) => { const n = pascal(t.sys.id) + pascal(graphqlName(f.id)); if (richTypes[n]) return richTypes[n]; const Entries = new GraphQLObjectType({ name: n + 'Entries', fields: { inline: { type: new GraphQLNonNull(new GraphQLList(Entry)) }, hyperlink: { type: new GraphQLNonNull(new GraphQLList(Entry)) }, block: { type: new GraphQLNonNull(new GraphQLList(Entry)) } } }); const Assets = new GraphQLObjectType({ name: n + 'Assets', fields: { hyperlink: { type: new GraphQLNonNull(new GraphQLList(Asset)) }, block: { type: new GraphQLNonNull(new GraphQLList(Asset)) } } }); const Links = new GraphQLObjectType({ name: n + 'Links', fields: { entries: { type: new GraphQLNonNull(Entries) }, assets: { type: new GraphQLNonNull(Assets) } } }); richTypes[n] = new GraphQLObjectType({ name: n, fields: { json: { type: new GraphQLNonNull(JSONScalar) }, links: { type: new GraphQLNonNull(Links), resolve: () => ({ entries: { inline: [], hyperlink: [], block: [] }, assets: { hyperlink: [], block: [] } }) } } }); return richTypes[n] }
  const linkCollTypes = {}
  const linkColl = (t, f, target) => { const n = pascal(t.sys.id) + pascal(graphqlName(f.id)) + 'Collection'; if (!linkCollTypes[n]) linkCollTypes[n] = new GraphQLObjectType({ name: n, fields: { total: { type: new GraphQLNonNull(GraphQLInt) }, skip: { type: new GraphQLNonNull(GraphQLInt) }, limit: { type: new GraphQLNonNull(GraphQLInt) }, items: { type: new GraphQLNonNull(new GraphQLList(target)) } } }); return linkCollTypes[n] }

  /* the objects, in two passes so links can name each other */
  for (const t of types) objects[t.sys.id] = new GraphQLObjectType({ name: pascal(t.sys.id), interfaces: [Entry], fields: () => {
    const out = { sys: { type: new GraphQLNonNull(Sys), resolve: (e) => sysOf(e) }, contentfulMetadata: { type: new GraphQLNonNull(Meta), resolve: meta }, linkedFrom: { type: linking[t.sys.id], resolve: (e, _a, c) => ({ id: e.sys.id, kind: 'Entry', ctx: c }) } }
    for (const f of t.fields) {
      const g = fieldGql(t, f)
      if (g.collection) out[g.name] = { type: g.gtype, args: pageArgs(), resolve: async (e, args, c) => { const links = e.fields[f.id] || []; const items = []; for (const l of links) { if (g.asset) { const a = c.ctx.assetsById.get(l.sys.id); if (a) items.push(assetOf(a, c.ctx)) } else { const r = c.ctx.recordsById.get(l.sys.id); if (r) items.push(await shaped(r, c)) } } return { total: items.length, skip: args.skip, limit: args.limit, items: items.slice(args.skip, args.skip + args.limit) } } }
      else if (f.type === 'Link' && f.linkType === 'Asset') out[g.name] = { type: g.gtype, resolve: (e, _a, c) => { const l = e.fields[f.id]; const a = l && c.ctx.assetsById.get(l.sys.id); return a ? assetOf(a, c.ctx) : null } }
      else if (f.type === 'Link') out[g.name] = { type: g.gtype, resolve: async (e, _a, c) => { const l = e.fields[f.id]; const r = l && c.ctx.recordsById.get(l.sys.id); return r ? shaped(r, c) : null } }
      else if (f.type === 'RichText') out[g.name] = { type: g.gtype, resolve: (e) => (e.fields[f.id] ? { json: e.fields[f.id] } : null) }
      else out[g.name] = { type: g.gtype, resolve: (e) => (e.fields[f.id] === undefined ? null : e.fields[f.id]) }
    }
    return out
  } })
  for (const t of types) collections[t.sys.id] = new GraphQLObjectType({ name: pascal(t.sys.id) + 'Collection', fields: { total: { type: new GraphQLNonNull(GraphQLInt) }, skip: { type: new GraphQLNonNull(GraphQLInt) }, limit: { type: new GraphQLNonNull(GraphQLInt) }, items: { type: new GraphQLNonNull(new GraphQLList(objects[t.sys.id])) } } })
  const linking = {}
  for (const t of types) linking[t.sys.id] = new GraphQLObjectType({ name: pascal(t.sys.id) + 'LinkingCollections', fields: () => ({ entryCollection: { type: EntryCollection, args: pageArgs(), resolve: (src, args, c) => linkedFrom(src, args, c, null) }, ...Object.fromEntries(types.map((x) => [x.sys.id + 'Collection', { type: collections[x.sys.id], args: pageArgs(), resolve: (src, args, c) => linkedFrom(src, args, c, x.sys.id) }])) }) })

  /* filters and orders */
  const SysFilter = new GraphQLInputObjectType({ name: 'SysFilter', fields: { id: { type: GraphQLString }, id_not: { type: GraphQLString }, id_in: { type: new GraphQLList(GraphQLString) }, id_not_in: { type: new GraphQLList(GraphQLString) }, id_contains: { type: GraphQLString }, id_exists: { type: GraphQLBoolean }, publishedAt: { type: DateTime }, publishedAt_gt: { type: DateTime }, publishedAt_gte: { type: DateTime }, publishedAt_lt: { type: DateTime }, publishedAt_lte: { type: DateTime }, firstPublishedAt_gt: { type: DateTime }, firstPublishedAt_gte: { type: DateTime }, firstPublishedAt_lt: { type: DateTime }, firstPublishedAt_lte: { type: DateTime }, publishedVersion: { type: GraphQLFloat }, publishedVersion_gt: { type: GraphQLFloat }, publishedVersion_lt: { type: GraphQLFloat } } })
  const MetaFilter = new GraphQLInputObjectType({ name: 'ContentfulMetadataFilter', fields: { tags_exists: { type: GraphQLBoolean } } })
  for (const t of types) {
    const fname = pascal(t.sys.id) + 'Filter'
    filters[t.sys.id] = new GraphQLInputObjectType({ name: fname, fields: () => {
      const out = { sys: { type: SysFilter }, contentfulMetadata: { type: MetaFilter }, AND: { type: new GraphQLList(filters[t.sys.id]) }, OR: { type: new GraphQLList(filters[t.sys.id]) } }
      for (const f of t.fields) {
        const n = graphqlName(f.id)
        out[n + '_exists'] = { type: GraphQLBoolean }
        if (f.type === 'Symbol' || f.type === 'Text' || f.type === 'Date' || f.type === 'Integer' || f.type === 'Number' || f.type === 'Boolean') {
          const gt = f.type === 'Date' ? DateTime : f.type === 'Integer' ? GraphQLInt : f.type === 'Number' ? GraphQLFloat : f.type === 'Boolean' ? GraphQLBoolean : GraphQLString
          out[n] = { type: gt }; out[n + '_not'] = { type: gt }; out[n + '_in'] = { type: new GraphQLList(gt) }; out[n + '_not_in'] = { type: new GraphQLList(gt) }
          if (f.type === 'Symbol' || f.type === 'Text') { out[n + '_contains'] = { type: GraphQLString }; out[n + '_not_contains'] = { type: GraphQLString } }
          if (f.type === 'Date' || f.type === 'Integer' || f.type === 'Number') { out[n + '_gt'] = { type: gt }; out[n + '_gte'] = { type: gt }; out[n + '_lt'] = { type: gt }; out[n + '_lte'] = { type: gt } }
        } else if (f.type === 'RichText') { out[n + '_contains'] = { type: GraphQLString }; out[n + '_not_contains'] = { type: GraphQLString } }
        else if (f.type === 'Array' && (!f.items || f.items.type === 'Symbol')) { out[n + '_contains_all'] = { type: new GraphQLList(GraphQLString) }; out[n + '_contains_some'] = { type: new GraphQLList(GraphQLString) }; out[n + '_contains_none'] = { type: new GraphQLList(GraphQLString) } }
        else if (f.type === 'Link' && f.linkType === 'Entry') { const target = (f.validations.find((v) => v.linkContentType) || {}).linkContentType || []; if (target.length === 1 && filters[target[0]]) out[n] = { type: filters[target[0]] } }
      }
      return out
    } })
    const values = { sys_id_ASC: {}, sys_id_DESC: {}, sys_publishedAt_ASC: {}, sys_publishedAt_DESC: {}, sys_firstPublishedAt_ASC: {}, sys_firstPublishedAt_DESC: {}, sys_publishedVersion_ASC: {}, sys_publishedVersion_DESC: {} }
    for (const f of t.fields) if (['Symbol', 'Date', 'Integer', 'Number', 'Boolean'].includes(f.type)) { values[graphqlName(f.id) + '_ASC'] = {}; values[graphqlName(f.id) + '_DESC'] = {} }
    orders[t.sys.id] = new GraphQLEnumType({ name: pascal(t.sys.id) + 'Order', values })
  }
  const AssetFilter = new GraphQLInputObjectType({ name: 'AssetFilter', fields: () => ({ sys: { type: SysFilter }, title: { type: GraphQLString }, title_contains: { type: GraphQLString }, title_exists: { type: GraphQLBoolean }, fileName: { type: GraphQLString }, fileName_contains: { type: GraphQLString }, contentType: { type: GraphQLString }, contentType_in: { type: new GraphQLList(GraphQLString) }, width_gt: { type: GraphQLInt }, width_lt: { type: GraphQLInt }, height_gt: { type: GraphQLInt }, height_lt: { type: GraphQLInt }, AND: { type: new GraphQLList(AssetFilter) }, OR: { type: new GraphQLList(AssetFilter) } }) })
  const AssetOrder = new GraphQLEnumType({ name: 'AssetOrder', values: { sys_id_ASC: {}, sys_id_DESC: {}, sys_publishedAt_ASC: {}, sys_publishedAt_DESC: {}, sys_firstPublishedAt_ASC: {}, sys_firstPublishedAt_DESC: {}, title_ASC: {}, title_DESC: {}, fileName_ASC: {}, fileName_DESC: {}, contentType_ASC: {}, contentType_DESC: {}, size_ASC: {}, size_DESC: {}, width_ASC: {}, width_DESC: {}, height_ASC: {}, height_DESC: {} } })
  const EntryFilter = new GraphQLInputObjectType({ name: 'EntryFilter', fields: { sys: { type: SysFilter }, contentfulMetadata: { type: MetaFilter } } })
  const EntryOrder = new GraphQLEnumType({ name: 'EntryOrder', values: { sys_id_ASC: {}, sys_id_DESC: {}, sys_publishedAt_ASC: {}, sys_publishedAt_DESC: {}, sys_firstPublishedAt_ASC: {}, sys_firstPublishedAt_DESC: {}, sys_publishedVersion_ASC: {}, sys_publishedVersion_DESC: {} } })

  /* ---- the resolvers' arithmetic ---- */
  const scope = (c, args) => { if (args && args.preview && !c.canPreview) throw Object.assign(new Error('Preview is not allowed with this access token.'), { code: 'ACCESS_DENIED' }); if (args && args.preview && !c.previewCtx) c.previewCtx = makeContext(c.previewIndex, { preview: true, gated: c.caller.gated, locale: args.locale ?? c.locale, imagesBase: c.imagesBase }); return args && args.preview ? { ...c, ctx: c.previewCtx } : c }
  const shaped = async (r, c) => { const k = (c.ctx.preview ? 'p:' : 'l:') + r.model + ':' + r.path; if (!c.memo.has(k)) c.memo.set(k, entryOf(r, c.ctx).then((e) => ({ ...e, __typename: pascal(r.typeId) }))); return c.memo.get(k) }
  const raw = (r, fieldId) => (fieldId === 'body' || fieldId === 'bodyMarkdown' ? r.body : r.data ? r.data[fieldId.replace(/Markdown$/, '')] : undefined)
  const fieldById = (t, n) => t.fields.find((f) => graphqlName(f.id) === n)
  const matches = (r, where, t, c) => {
    if (!where) return true
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue
      if (k === 'AND') { if (!v.every((w) => matches(r, w, t, c))) return false; continue }
      if (k === 'OR') { if (!v.some((w) => matches(r, w, t, c))) return false; continue }
      if (k === 'sys') { const s = { id: entryId(r.typeId, r.path), publishedAt: r.updated, firstPublishedAt: r.created, publishedVersion: r.revision }; for (const [sk, sv] of Object.entries(v)) { const [base, op] = splitOp(sk); if (!cmp(s[base], op, sv)) return false } continue }
      if (k === 'contentfulMetadata') continue
      const [base, op] = splitOp(k)
      const f = fieldById(t, base); if (!f) continue
      const val = raw(r, f.id)
      if (f.type === 'Link' && f.linkType === 'Entry' && op === 'eq' && v && typeof v === 'object') { const target = c.ctx.recordsById.get(entryId(targetOf(f), String(val ?? ''))); const tt = target && c.ctx.types.find((x) => x.sys.id === target.typeId); if (!target || !tt || !matches(target, v, tt, c)) return false; continue }
      if (!cmp(f.type === 'Link' || (f.type === 'Array' && f.items && f.items.linkType) ? (val == null ? null : (Array.isArray(val) ? val : [val]).map((x) => entryId(targetOf(f), String(x)))) : val, op, v)) return false
    }
    return true
  }
  const targetOf = (f) => { const vs = f.type === 'Array' ? (f.items.validations || []) : (f.validations || []); return ((vs.find((v) => v.linkContentType) || {}).linkContentType || [])[0] || '' }
  const splitOp = (k) => { const m = /^(.*?)_(not_in|not_contains|contains_all|contains_some|contains_none|contains|exists|not|in|gte|gt|lte|lt)$/.exec(k); return m ? [m[1], m[2]] : [k, 'eq'] }
  const cmp = (val, op, v) => {
    const arr = val == null ? [] : Array.isArray(val) ? val.map(String) : [String(val)]
    const num = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? Date.parse(x) : Number(x))
    switch (op) {
      case 'exists': return v === (val != null && val !== '' && !(Array.isArray(val) && !val.length))
      case 'eq': return typeof val === 'boolean' ? val === v : arr.includes(String(v))
      case 'not': return typeof val === 'boolean' ? val !== v : !arr.includes(String(v))
      case 'in': return (v || []).some((x) => arr.includes(String(x)))
      case 'not_in': return !(v || []).some((x) => arr.includes(String(x)))
      case 'contains': return arr.some((x) => x.toLowerCase().includes(String(v).toLowerCase()))
      case 'not_contains': return !arr.some((x) => x.toLowerCase().includes(String(v).toLowerCase()))
      case 'contains_all': return (v || []).every((x) => arr.includes(String(x)))
      case 'contains_some': return (v || []).some((x) => arr.includes(String(x)))
      case 'contains_none': return !(v || []).some((x) => arr.includes(String(x)))
      case 'gt': return val != null && num(val) > num(v)
      case 'gte': return val != null && num(val) >= num(v)
      case 'lt': return val != null && num(val) < num(v)
      case 'lte': return val != null && num(val) <= num(v)
      default: return true
    }
  }
  const ordered = (rows, order, t) => { if (!order || !order.length) return rows; const keys = order.map((o) => { const m = /^(.*)_(ASC|DESC)$/.exec(o); const k = m[1], desc = m[2] === 'DESC'; const fn = k === 'sys_id' ? (r) => entryId(r.typeId, r.path) : k === 'sys_publishedAt' ? (r) => r.updated : k === 'sys_firstPublishedAt' ? (r) => r.created : k === 'sys_publishedVersion' ? (r) => r.revision : (r) => { const f = fieldById(t, k); return f ? raw(r, f.id) : undefined }; return { fn, desc } }); return [...rows].sort((x, y) => { for (const { fn, desc } of keys) { const a = fn(x), b = fn(y); const av = a == null ? '' : typeof a === 'number' ? a : String(a).toLowerCase(), bv = b == null ? '' : typeof b === 'number' ? b : String(b).toLowerCase(); if (av < bv) return desc ? 1 : -1; if (av > bv) return desc ? -1 : 1 } return 0 }) }
  const collectionOf = (t) => async (_src, args, c0) => { const c = scope(c0, args); const rows = ordered(c.ctx.records.filter((r) => r.typeId === t.sys.id && matches(r, args.where, t, c)), args.order, t); const items = []; for (const r of rows.slice(args.skip, args.skip + args.limit)) items.push(await shaped(r, c)); return { total: rows.length, skip: args.skip, limit: args.limit, items } }
  async function linkedFrom(src, args, c0, typeId) {
    const c = scope(c0, args); const rows = c.ctx.records.filter((r) => (typeId ? r.typeId === typeId : true) && linksTo(r, src.id, src.kind, c))
    const items = []; for (const r of rows.slice(args.skip, args.skip + args.limit)) items.push(await shaped(r, c))
    return { total: rows.length, skip: args.skip, limit: args.limit, items }
  }
  const linksTo = (r, id, kind, c) => { const t = c.ctx.typesByModel.get(r.model); for (const f of t.fields) { const v = raw(r, f.id); if (v == null) continue; if (kind === 'Entry' && ((f.type === 'Link' && f.linkType === 'Entry') || (f.type === 'Array' && f.items && f.items.linkType === 'Entry'))) { if ((Array.isArray(v) ? v : [v]).some((x) => entryId(targetOf(f), String(x)) === id)) return true } if (kind === 'Asset' && f.type === 'Link' && f.linkType === 'Asset') { const a = c.ctx.assetsByAddress.get(String(v)); if (a && assetId(a.address) === id) return true } } return false }

  const queryFields = { asset: { type: Asset, args: { id: { type: new GraphQLNonNull(GraphQLString) }, preview: { type: GraphQLBoolean }, locale: { type: GraphQLString } }, resolve: (_s, args, c0) => { const c = scope(c0, args); const a = c.ctx.assetsById.get(args.id); return a ? assetOf(a, c.ctx) : null } },
    assetCollection: { type: AssetCollection, args: { ...pageArgs(), where: { type: AssetFilter }, order: { type: new GraphQLList(AssetOrder) } }, resolve: (_s, args, c0) => { const c = scope(c0, args); let rows = c.ctx.assets; const w = args.where || {}; if (w.title) rows = rows.filter((a) => a.name.replace(/\.[a-z0-9]+$/i, '') === w.title); if (w.title_contains) rows = rows.filter((a) => a.name.toLowerCase().includes(w.title_contains.toLowerCase())); if (w.contentType) rows = rows.filter((a) => a.mime === w.contentType); if (w.contentType_in) rows = rows.filter((a) => w.contentType_in.includes(a.mime)); if (w.fileName) rows = rows.filter((a) => a.name === w.fileName); if (w.fileName_contains) rows = rows.filter((a) => a.name.includes(w.fileName_contains)); return { total: rows.length, skip: args.skip, limit: args.limit, items: rows.slice(args.skip, args.skip + args.limit).map((a) => assetOf(a, c.ctx)) } } },
    entryCollection: { type: EntryCollection, args: { ...pageArgs(), where: { type: EntryFilter }, order: { type: new GraphQLList(EntryOrder) } }, resolve: async (_s, args, c0) => { const c = scope(c0, args); const rows = c.ctx.records.filter((r) => !args.where || !args.where.sys || cmpSys(r, args.where.sys)); const items = []; for (const r of rows.slice(args.skip, args.skip + args.limit)) items.push(await shaped(r, c)); return { total: rows.length, skip: args.skip, limit: args.limit, items } } },
  }
  const cmpSys = (r, s) => { const v = { id: entryId(r.typeId, r.path), publishedAt: r.updated, firstPublishedAt: r.created, publishedVersion: r.revision }; return Object.entries(s).every(([k, val]) => { const [b, op] = splitOp(k); return cmp(v[b], op, val) }) }
  for (const t of types) {
    queryFields[t.sys.id] = { type: objects[t.sys.id], args: { id: { type: new GraphQLNonNull(GraphQLString) }, preview: { type: GraphQLBoolean }, locale: { type: GraphQLString } }, resolve: async (_s, args, c0) => { const c = scope(c0, args); const r = c.ctx.recordsById.get(args.id); return r && r.typeId === t.sys.id ? shaped(r, c) : null } }
    queryFields[t.sys.id + 'Collection'] = { type: collections[t.sys.id], args: { ...pageArgs(), where: { type: filters[t.sys.id] }, order: { type: new GraphQLList(orders[t.sys.id]) } }, resolve: collectionOf(t) }
  }
  return new GraphQLSchema({ query: new GraphQLObjectType({ name: 'Query', fields: queryFields }), types: [...Object.values(objects), Asset, EntryCollection] })
}

/* Contentful's complexity: a collection costs its limit times the fields under it; over the ceiling is refused */
function complexity(doc) {
  const cost = (sel, mult) => { let n = 0; for (const s of sel.selections) { if (s.kind !== 'Field') { if (s.selectionSet) n += cost(s.selectionSet, mult); continue } const isColl = /Collection$/.test(s.name.value); const lim = isColl ? Number(((s.arguments || []).find((a) => a.name.value === 'limit') || {}).value?.value ?? 100) : 1; n += mult * (s.selectionSet ? cost(s.selectionSet, isColl ? lim : 1) : 1) } return n }
  let total = 0
  for (const d of doc.definitions) if (d.kind === 'OperationDefinition') total += cost(d.selectionSet, 1)
  return total
}

export async function runGraphQL({ query, variables, operationName, index, live, previewIndex, caller, imagesBase }) {
  const key = index.built + ':' + index.types.length
  if (!built || built.key !== key) built = { key, schema: buildSchema(index) }
  let doc
  try { doc = parseQuery(query) } catch (e) { return { status: 400, body: { errors: [{ message: e.message, extensions: { contentful: { code: 'INVALID_QUERY' } } }] } } }
  const errs = validate(built.schema, doc, specifiedRules)
  if (errs.length) return { status: 400, body: { errors: errs.map((e) => ({ message: e.message, locations: e.locations, extensions: { contentful: { code: 'INVALID_QUERY' } } })) } }
  const cx = complexity(doc)
  if (cx > CEILING) return { status: 400, body: { errors: [{ message: `Query too complex. The maximum allowed complexity for a query is ${CEILING} but it was ${cx}. Simplify the query e.g. by setting lower limits for collections.`, extensions: { contentful: { code: 'TOO_COMPLEX_QUERY', requestId: '', details: { maximumCost: CEILING, cost: cx } } } }] } }
  const canPreview = caller.kind === 'preview' || caller.kind === 'management'
  const ctx = makeContext(live, { preview: false, gated: caller.gated, locale: null, imagesBase })
  const contextValue = { ctx, memo: new Map(), caller, canPreview, previewIndex, previewCtx: null, locale: null, imagesBase }
  const res = await graphql({ schema: built.schema, source: doc.loc ? doc.loc.source : query, variableValues: variables, operationName, contextValue })
  const body = { data: res.data ?? null }
  if (res.errors && res.errors.length) body.errors = res.errors.map((e) => ({ message: e.message, locations: e.locations, path: e.path, extensions: { contentful: { code: e.originalError && e.originalError.code ? e.originalError.code : 'UNKNOWN', requestId: '' } } }))
  const denied = res.errors && res.errors.some((e) => e.originalError && e.originalError.code === 'ACCESS_DENIED')
  return { status: denied ? 403 : 200, body }
}
export const schemaFor = (index) => buildSchema(index)
