/* The TYPE into the print bucket, where print-render can fetch it (build/print/templates.mjs --fonts).
   A book set in an Edge Function has no filesystem to read a font off, and a book set in a fallback
   face is wrong in a way nobody notices until it is printed — so it is uploaded here, once, and the
   function refuses to set anything without it. Only what the bucket lacks is sent; the type changes
   almost never. */
export default {
  key: 'print-type', title: 'The type for the cloud', phase: 'functions', module: 'print', after: ['print'],
  inputs: ['packages/kit/build/print/fonts/**'],
  run: ({ script }) => script('print/templates.mjs', ['--fonts']),
}
