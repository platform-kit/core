/* The email designs compiled to html beside the functions, and the auth templates for the local stack (build/emails.mjs) */
export default {
  key: 'emails', title: 'The email designs', phase: 'functions', module: 'emails', after: ['chat-email-strings'],
  inputs: ['content/emails/**'],
  needs: { packages: ['mjml'] },
  run: ({ script }) => script('emails.mjs'),
}
