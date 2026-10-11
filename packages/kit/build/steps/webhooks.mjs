/* The webhook subscriptions a deployment ships, declared (build/webhooks-config.mjs) and then made
   real against the project (build/webhooks-push.mjs), with the secrets read from the environment */
export const webhooksConfigStep = {
  key: 'webhooks-config', title: 'The shipped webhook subscriptions', phase: 'functions',
  inputs: ['platformkit.config.js'],
  run: ({ script }) => script('webhooks-config.mjs'),
}
export const webhooksPushStep = {
  key: 'webhooks-push', title: 'The shipped subscriptions, made real', phase: 'after',
  after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  run: ({ script }) => script('webhooks-push.mjs'),
}
export default webhooksConfigStep
