/* The snippet's script: dist/packs/js/sdk.js, the support widget on another site through Chatwoot's website snippet (build/support-sdk.mjs) */
export default {
  key: 'support-sdk', title: 'The support snippet', phase: 'site', module: 'support', after: ['form-embed'],
  inputs: ['content/funnels/**', 'content/app/ui/support.md'],
  run: ({ script }) => script('support-sdk.mjs'),
}
