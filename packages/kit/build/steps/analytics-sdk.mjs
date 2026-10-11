/* The drop-in analytics script: dist/analytics.js (and dist/static/array.js for PostHog's snippet) — build/analytics-sdk.mjs */
export default {
  key: 'analytics-sdk', title: 'The analytics script', phase: 'site', after: ['form-embed'],
  inputs: ['platformkit.config.js'],
  run: ({ script }) => script('analytics-sdk.mjs'),
}
