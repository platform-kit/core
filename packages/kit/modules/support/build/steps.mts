import { fileURLToPath } from 'node:url'
/* The snippet's script: dist/packs/js/sdk.js, the support widget on another site through Chatwoot's website snippet (build/support-sdk.mjs) */
/* support's build step, placed in the kit's list where it stood */
export default [{
  key: 'support-sdk', title: 'The support snippet', phase: 'site', module: 'support', after: ['form-embed'],
  inputs: ['content/funnels/**', 'content/app/ui/support.md'],
  run: ({ script }: any) => script(fileURLToPath(new URL('./support-sdk.mjs', import.meta.url))),
}]
