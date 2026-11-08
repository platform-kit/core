/*
 * Markdown as Contentful's Rich Text document — plain JavaScript over marked's lexer (Deno-clean, the site's own
 * parser), so the function and the build make the same document. The node types are Contentful's: document,
 * paragraph, heading-1…6, unordered-list, ordered-list, list-item, blockquote, hr, table with its rows and cells,
 * hyperlink and text with the marks bold, italic, underline, code (strikethrough is dropped to text: Contentful has no
 * such mark); a fenced or indented code block is a paragraph of code-marked text, as Contentful's editor writes one;
 * a picture at a library address is an embedded-asset-block on that asset, a picture elsewhere a hyperlink to it;
 * raw html is kept as text. Every node carries `data: {}` and every text node `marks: []`, as Contentful writes them.
 */
import { Lexer } from 'marked'
import { assetId } from './ids.ts'

const text = (value: any, marks = []) => ({ nodeType: 'text', value: String(value), marks: marks.map((type) => ({ type })), data: {} })
const node = (nodeType: any, content: any, data = {}) => ({ nodeType, content, data })
const unescape = (s: any) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => (({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" } as any)[e]))

function inline(tokens: any, marks: any, ctx: any, out = []) {
  for (const t of tokens || []) {
    switch (t.type) {
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: string; value: string; marks: { type: never; }[]; data: {}; }' is not assignable to parameter of type 'never'.
      case 'text': case 'escape': if (t.tokens) inline(t.tokens, marks, ctx, out); else out.push(text(unescape(t.text), marks)); break
      case 'strong': inline(t.tokens, [...marks, 'bold'], ctx, out); break
      case 'em': inline(t.tokens, [...marks, 'italic'], ctx, out); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: string; value: string; marks: { type: never; }[]; data: {}; }' is not assignable to parameter of type 'never'.
      case 'codespan': out.push(text(unescape(t.text), [...marks, 'code'])); break
      case 'del': inline(t.tokens, marks, ctx, out); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: string; value: string; marks: { type: never; }[]; data: {}; }' is not assignable to parameter of type 'never'.
      case 'br': out.push(text('\n', marks)); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'link': out.push(node('hyperlink', inline(t.tokens, marks, ctx), { uri: t.href })); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'image': { const a = ctx && ctx.assetsByAddress && ctx.assetsByAddress.get(t.href); if (a) out.push(node('embedded-asset-block', [], { target: { sys: { type: 'Link', linkType: 'Asset', id: assetId(a.address) } } })); else out.push(node('hyperlink', [text(t.text || t.href, marks)], { uri: t.href })); break }
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: string; value: string; marks: { type: never; }[]; data: {}; }' is not assignable to parameter of type 'never'.
      case 'html': out.push(text(t.text, marks)); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: string; value: string; marks: { type: never; }[]; data: {}; }' is not assignable to parameter of type 'never'.
      default: if (t.tokens) inline(t.tokens, marks, ctx, out); else if (t.text != null) out.push(text(unescape(t.text), marks))
    }
  }
  return out
}
/* a paragraph's inline run, with any embedded asset lifted out as its own block */
function para(tokens: any, ctx: any) {
  const run = inline(tokens, [], ctx), out: any = [], cur: any = []
  const flush = () => { if (cur.length) { out.push(node('paragraph', cur.splice(0))) } }
  for (const n of run) { if ((n as any).nodeType === 'embedded-asset-block') { flush(); out.push(n) } else cur.push(n) }
  flush()
  return out.length ? out : [node('paragraph', [text('')])]
}
function blocks(tokens: any, ctx: any, out = []) {
  for (const t of tokens || []) {
    switch (t.type) {
      case 'space': break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'heading': out.push(node('heading-' + Math.min(6, Math.max(1, t.depth)), inline(t.tokens, [], ctx))); break
      // @ts-expect-error TS2345, from the conversion: Argument of type 'any' is not assignable to parameter of type 'never'.
      case 'paragraph': out.push(...para(t.tokens, ctx)); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'text': out.push(node('paragraph', inline(t.tokens || [{ type: 'text', text: t.text }], [], ctx))); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'blockquote': out.push(node('blockquote', blocks(t.tokens, ctx))); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'code': out.push(node('paragraph', [text(t.text, ['code'])])); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'hr': out.push(node('hr', [])); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'html': out.push(node('paragraph', [text(t.text)])); break
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      case 'list': out.push(node(t.ordered ? 'ordered-list' : 'unordered-list', t.items.map((it) => node('list-item', blocks(it.tokens, ctx).length ? blocks(it.tokens, ctx) : [node('paragraph', [text(it.text || '')])])))); break
      case 'table': {
        const cell = (c: any, head: any) => node(head ? 'table-header-cell' : 'table-cell', [node('paragraph', inline(c.tokens, [], ctx))])
        const rows = [node('table-row', t.header.map((c: any) => cell(c, true))), ...t.rows.map((r: any) => node('table-row', r.map((c: any) => cell(c, false))))]
        // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
        out.push(node('table', rows)); break
      }
      // @ts-expect-error TS2345, from the conversion: Argument of type '{ nodeType: any; content: any; data: {}; }' is not assignable to parameter of type 'never'.
      default: if (t.tokens) out.push(...blocks(t.tokens, ctx)); else if (t.text) out.push(node('paragraph', [text(t.text)]))
    }
  }
  return out
}
export function richTextFromMarkdown(md: any, ctx: any) {
  const tokens = new Lexer({ gfm: true }).lex(String(md == null ? '' : md))
  return node('document', blocks(tokens, ctx))
}
