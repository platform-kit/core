/* The search index: every piece of content embedded for the palette's search and the library's Find your book (build/embed-content.mjs) */
export default {
  key: 'embed-content', title: 'The search index', phase: 'prepare',
  inputs: ['content/articles/**', 'content/books/**', 'content/companions/**', 'content/wiki/**', 'content/docs/**', 'content/pages/**'],
  run: async () => { const { embedContent } = await import('../embed-content.mjs'); await embedContent() },
}
