/* The comment thread as a drop-in script: dist/packs/js/comments.js, at Disqus's own address, so a
   page that already has Disqus's snippet moves its conversation here by changing one line —
   build/comments-sdk.mjs */
export default {
  key: 'comments-sdk', title: 'The comments script', phase: 'site', after: ['support-sdk'],
  inputs: ['platformkit.config.js'],
  run: ({ script }) => script('comments-sdk.mjs'),
}
