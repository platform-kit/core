/*
 * A machine without Typst's native compiler cannot set a book, and says so in words: the print editor shows the
 * refusal's message, where a failed import used to answer a bare 500. Where the compiler is installed this has nothing
 * to prove, and says so.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const installed = (() => { try { import.meta.resolve('@myriaddreamin/typst-ts-node-compiler'); return true } catch { return false } })()
if (installed) { console.log('render-refusal: Typst\'s native compiler is installed here, so a render is the real one (nothing to refuse)'); process.exit(0) }

const books = path.join(process.cwd(), 'content', 'books')
const slug = fs.existsSync(books) ? (fs.readdirSync(books).find((n) => n.endsWith('.md')) || '').replace(/\.md$/, '') : ''
if (!slug) { console.log('render-refusal: this site has no books to set'); process.exit(0) }
const { default: model } = await import('../build/model.mjs')
const { asStore } = await import('../../../build/store/index.mjs')
let refused: any = null
try { await (model as any).actions.render({ book: slug }, { root: process.cwd(), store: asStore(process.cwd()) }) } catch (e) { refused = e }
assert.ok(refused, 'a render with no native compiler was not refused')
assert.equal(refused.code, 503, 'refused with ' + refused.code + ': ' + refused.message)
assert.match(refused.message, /cannot set books: Typst's native compiler is not installed/)
console.log('render-refusal: a machine without the native compiler refuses to set a book, in words (1 passed)')
