import assert from 'node:assert/strict'
import {
  matchSocialAutomations,
  socialBotAllowsAnonymousSubject,
  socialKeywordMatches,
} from '../supabase/functions/_shared/social/automation-rules.mjs'
import {
  automationDeliveryOutcome,
  sendInstagramPrivateReply,
} from '../supabase/functions/_shared/social/automation-delivery.mjs'

assert.equal(socialKeywordMatches('Send me the GUIDE, please.', 'guide'), true)
assert.equal(socialKeywordMatches('Send me a guidebook.', 'guide'), false)
assert.equal(socialKeywordMatches('Guided meditation, please.', 'guide'), false)
assert.equal(socialKeywordMatches('Could I get the FREE\nGUIDE?', 'free guide'), true)
assert.equal(socialKeywordMatches('Could I get the free guides?', 'free guide'), false)
assert.equal(socialKeywordMatches('CAFÉ please', 'café'), true)
assert.equal(socialKeywordMatches('decafécup', 'café'), false)
assert.equal(socialKeywordMatches('anything', '  '), false)

const bot = { slug: 'helper', published: true, surfaces: ['social'], serves: [] }
assert.equal(socialBotAllowsAnonymousSubject(bot), true)
assert.equal(socialBotAllowsAnonymousSubject({ ...bot, surfaces: ['spaces'] }), false)
assert.equal(socialBotAllowsAnonymousSubject({ ...bot, serves: [{ signed_in: true }] }), false)
assert.equal(socialBotAllowsAnonymousSubject({ ...bot, published: false }), false)

const account = { id: 'account-1', external_id: 'provider-account-1' }
const event = {
  id: 'event-1',
  account_id: 'account-1',
  event_kind: 'comment',
  provider_author_id: 'external-author-1',
  body: 'Please send the guide.',
}
const automation = {
  id: 'rule-1',
  account_id: 'account-1',
  event_kind: 'comment',
  keyword: 'guide',
  bot_slug: 'helper',
  enabled: true,
}
const matching = matchSocialAutomations({
  event,
  account,
  automations: [automation, automation],
  bots: [bot],
})
assert.equal(matching.length, 1, 'a rule creates at most one match for the event')
assert.equal(matching[0].automation.id, automation.id)
assert.equal(matching[0].bot.slug, bot.slug)
assert.equal(matchSocialAutomations({
  event: { ...event, body: 'guidebook' },
  account,
  automations: [automation],
  bots: [bot],
}).length, 0)
assert.equal(matchSocialAutomations({
  event,
  account,
  automations: [{ ...automation, enabled: false }],
  bots: [bot],
}).length, 0)
assert.equal(matchSocialAutomations({
  event,
  account,
  automations: [{ ...automation, event_kind: 'dm' }],
  bots: [bot],
}).length, 0)
assert.equal(matchSocialAutomations({
  event: { ...event, provider_author_id: account.external_id },
  account,
  automations: [automation],
  bots: [bot],
}).length, 0, 'events authored by the connected account are ignored')
assert.equal(matchSocialAutomations({
  event,
  account,
  automations: [{ ...automation, account_id: 'account-2' }],
  bots: [bot],
}).length, 0, 'a rule cannot match an event from another account')
assert.equal(matchSocialAutomations({
  event,
  account,
  automations: [automation],
  bots: [{ ...bot, serves: [{ signed_in: true }] }],
}).length, 0, 'a bot requiring an identified subject cannot serve provider authors')

const privateReply = await sendInstagramPrivateReply({
  accountId: 'ig-account',
  commentId: 'comment-1',
  text: 'Here is the guide.',
  accessToken: 'secret-token',
  fetcher: async (url, options) => {
    assert.equal(url, 'https://graph.instagram.com/v25.0/ig-account/messages')
    assert.equal(options.headers.Authorization, 'Bearer secret-token')
    assert.deepEqual(JSON.parse(options.body), {
      recipient: { comment_id: 'comment-1' },
      message: { text: 'Here is the guide.' },
    })
    return Response.json({ message_id: 'message-1' })
  },
})
assert.deepEqual(privateReply, { providerResponseId: 'message-1' })
assert.deepEqual(automationDeliveryOutcome({ result: privateReply }), {
  status: 'sent',
  providerResponseId: 'message-1',
})
assert.deepEqual(automationDeliveryOutcome({
  error: Object.assign(new Error('provider rejected'), { code: 'provider_rejected_reply', definite: true }),
}), { status: 'failed', errorCode: 'provider_rejected_reply' })
assert.deepEqual(automationDeliveryOutcome({ error: new Error('connection closed') }), {
  status: 'uncertain',
  errorCode: 'provider_outcome_uncertain',
})
await assert.rejects(() => sendInstagramPrivateReply({
  accountId: 'ig-account',
  commentId: 'comment-1',
  text: 'Here is the guide.',
  accessToken: 'secret-token',
  fetcher: async () => new Response('rate limited', { status: 429 }),
}), (error) => error.definite === true)
await assert.rejects(() => sendInstagramPrivateReply({
  accountId: 'ig-account',
  commentId: 'comment-1',
  text: 'Here is the guide.',
  accessToken: 'secret-token',
  fetcher: async () => new Response('upstream timeout', { status: 503 }),
}), (error) => error.definite === false)

console.log('social-automation: whole-word matching, account scope, self-event exclusion and anonymous bot eligibility passed')
