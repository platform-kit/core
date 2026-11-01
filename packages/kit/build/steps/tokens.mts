/* Every colour each look names, read from the stylesheets so the admin's Colours form can never
   offer a list that has drifted from what a look actually states (build/tokens.mjs) */
export default {
  key: 'tokens', title: 'The looks’ colours', phase: 'prepare',
  inputs: ['src/looks/**'],
  run: async () => { const { compileTokens } = await import('../tokens.mjs'); await compileTokens() },
}
