/*
 * Contentful's Rich Text document back to markdown — the reverse of richtext.js, for a write through the Management
 * API that carries a RichText field as a document rather than its `<field>Markdown` twin. The node types are
 * richtext.js's own (document, paragraph, heading-1…6, the lists, blockquote, hr, table, hyperlink, embedded-asset-block,
 * text with bold / italic / underline / code), so markdown → document → markdown comes back equal on well-formed
 * markdown; a node the reader never writes (an embedded entry, an inline asset) is dropped to its text. Plain
 * JavaScript, no imports: an asset's address comes from the caller (`assetAddress(id)`), a library picture as
 * `![](address)`.
 */
const esc = (s) => String(s)
const wrap = (value, marks) => {
  let v = esc(value)
  if (!v) return v
  const has = (m) => (marks || []).some((x) => x.type === m)
  if (has('code')) return '`' + v.replace(/`/g, '\\`') + '`'
  if (has('bold')) v = '**' + v + '**'
  if (has('italic')) v = '*' + v + '*'
  if (has('underline')) v = '__' + v + '__'
  return v
}
function inline(nodes, ctx) {
  let out = ''
  for (const n of nodes || []) {
    if (n.nodeType === 'text') out += wrap(n.value, n.marks)
    else if (n.nodeType === 'hyperlink') out += '[' + inline(n.content, ctx) + '](' + ((n.data || {}).uri || '') + ')'
    else if (n.nodeType === 'entry-hyperlink' || n.nodeType === 'asset-hyperlink') out += inline(n.content, ctx)
    else if (n.nodeType === 'embedded-asset-block' || n.nodeType === 'embedded-asset-inline') { const a = ctx.assetAddress ? ctx.assetAddress((((n.data || {}).target || {}).sys || {}).id) : null; if (a) out += '![](' + a + ')' }
    else if (n.content) out += inline(n.content, ctx)
  }
  return out
}
function block(n, ctx, depth = 0) {
  const t = n.nodeType
  const h = /^heading-(\d)$/.exec(t)
  if (h) return '#'.repeat(Number(h[1])) + ' ' + inline(n.content, ctx)
  if (t === 'paragraph') return inline(n.content, ctx)
  if (t === 'blockquote') return blocks(n.content, ctx, depth).split('\n').map((l) => '> ' + l).join('\n')
  if (t === 'hr') return '---'
  if (t === 'embedded-asset-block') { const a = ctx.assetAddress ? ctx.assetAddress((((n.data || {}).target || {}).sys || {}).id) : null; return a ? '![](' + a + ')' : '' }
  if (t === 'unordered-list' || t === 'ordered-list') {
    return (n.content || []).map((li, i) => {
      const mark = t === 'ordered-list' ? `${i + 1}. ` : '- '
      const inner = blocks(li.content, ctx, depth + 1)
      const [first, ...rest] = inner.split('\n')
      return '  '.repeat(depth) + mark + first + (rest.length ? '\n' + rest.map((l) => (l ? '  '.repeat(depth + 1) + l : l)).join('\n') : '')
    }).join('\n')
  }
  if (t === 'table') {
    const rows = (n.content || []).map((r) => (r.content || []).map((c) => inline((c.content || []).flatMap((p) => p.content || []), ctx).replace(/\|/g, '\\|')))
    if (!rows.length) return ''
    const head = rows[0], body = rows.slice(1)
    return ['| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- ').join('|') + '|', ...body.map((r) => '| ' + r.join(' | ') + ' |')].join('\n')
  }
  if (t === 'embedded-entry-block' || t === 'embedded-entry-inline') return ''
  return inline(n.content, ctx)
}
function blocks(nodes, ctx, depth = 0) {
  const out = []
  for (const n of nodes || []) {
    const b = block(n, ctx, depth)
    if (b !== '' || n.nodeType === 'paragraph') out.push(b)
  }
  const joinWith = depth ? '\n' : '\n\n'
  return out.join(joinWith)
}
/**
 * @param {object} doc   Contentful's document
 * @param {object} [ctx] { assetAddress: (id) => the library address of an asset, or null }
 */
export function markdownFromRichText(doc, ctx = {}) {
  if (!doc || doc.nodeType !== 'document') return ''
  return blocks(doc.content, ctx).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
