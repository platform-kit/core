/* The embed: dist/form.js and dist/form.css, a form on another site (build/form-embed.mjs) */
export default {
  key: 'form-embed', title: 'The form embed', phase: 'site', module: 'forms',
  inputs: ['content/forms/**'],
  run: ({ script }) => script('form-embed.mjs'),
}
