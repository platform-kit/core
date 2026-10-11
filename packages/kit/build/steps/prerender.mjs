/* The pages: every public route to dist/<route>/index.html, the share images and the favicon first, the sitemap (build/prerender.mjs) */
export default {
  key: 'prerender', title: 'The pages', phase: 'site', after: ['form-embed', 'support-sdk', 'analytics-sdk', 'models-json'],
  needs: { packages: ['playwright'] },
  run: ({ script }) => script('prerender.mjs'),
}
