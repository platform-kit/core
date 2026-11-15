/* The funnels, the blasts and the policy compiled beside the functions, and the chat prompts for the widget (build/funnels.mjs) */
export default {
  key: 'funnels', title: 'The funnels', phase: 'prepare', module: 'funnels', after: ['embed-content'],
  inputs: ['content/funnels/**', 'content/blasts/**', 'content/emails/policy.md', 'content/store/products/**'],
  run: async () => { const { compileFunnels } = await import('../funnels.mjs'); await compileFunnels() },
}
