/* The words the functions carry: the chat's lines and the emails' subjects, beside them (build/chat-email-strings.mjs) */
export default {
  key: 'chat-email-strings', title: "The functions' words", phase: 'functions',
  inputs: ['content/app/ui/chat.md', 'content/app/ui/emails.md', 'content/app/ui/store.md'],
  run: ({ script }) => script('chat-email-strings.mjs'),
}
