import { fileURLToPath } from 'node:url'
/* The TYPE into the print bucket, where print-render can fetch it (modules/print/build/templates.mjs --fonts).
   A book set in an Edge Function has no filesystem to read a font off, and a book set in a fallback
   face is wrong in a way nobody notices until it is printed — so it is uploaded here, once, and the
   function refuses to set anything without it. Only what the bucket lacks is sent; the type changes
   almost never. */
export default {
  key: 'print-type', title: 'The type for the cloud', phase: 'functions', module: 'print', after: ['print'],
  inputs: ['packages/kit/modules/print/build/fonts/**'],
  run: ({ script }: any) => script(fileURLToPath(new URL('../templates.mjs', import.meta.url)), ['--fonts']),
}
