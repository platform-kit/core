/* The demo's own build step: the books as one CSV, dist/data/books.csv — slug, title, author, chapters — from the
   compiled content, after the site is bundled. Registered in platformkit.config.js build.steps; nothing else names it. */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
export default {
  key: 'books-csv', title: 'The books as CSV', phase: 'site', after: ['models-json'],
  inputs: ['content/books/**'],
  run: async ({ site, log }) => {
    const { books } = await import('@platform-kit/kit/build/content-node.mjs')
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const rows = [['slug', 'title', 'author', 'chapters'].join(',')]
    for (const b of books || []) rows.push([b.slug || b.id, b.title, b.author || '', b.chapters ?? ''].map(q).join(','))
    mkdirSync(join(site.root, 'dist', 'data'), { recursive: true })
    writeFileSync(join(site.root, 'dist', 'data', 'books.csv'), rows.join('\n') + '\n')
    log(`  ${rows.length - 1} book(s) → dist/data/books.csv`)
  },
}
