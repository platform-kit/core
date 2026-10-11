import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import {
  normalizeRedditOptions,
  redditSubmissionFromApi,
  validateRedditSubmission,
} from '../supabase/functions/_shared/social/reddit-content.mjs'
import {
  completeRedditOAuth,
  createRedditBackend,
  redditAuthorizationUrl,
  refreshRedditOAuth,
} from '../supabase/functions/_shared/social/reddit-adapter.mjs'

const direct = fs.readFileSync(new URL('../supabase/functions/_shared/social/direct-sdk.mjs', import.meta.url), 'utf8')
const redditAdapter = fs.readFileSync(new URL('../supabase/functions/_shared/social/reddit-adapter.mjs', import.meta.url), 'utf8')
const registry = fs.readFileSync(new URL('../supabase/functions/_shared/social/registry.ts', import.meta.url), 'utf8')
const socialFunction = fs.readFileSync(new URL('../supabase/functions/social/index.ts', import.meta.url), 'utf8')
const publisher = fs.readFileSync(new URL('../supabase/functions/social-publish/index.ts', import.meta.url), 'utf8')
const schema = fs.readFileSync(new URL('../supabase/schemas/99-social.sql', import.meta.url), 'utf8')

for (const provider of ['threads', 'bluesky', 'youtube', 'tiktok', 'instagram', 'linkedin', 'reddit']) {
  assert.match(direct, new RegExp(`createAdapter\\('${provider}'`), `${provider} has a direct adapter`)
}
assert.match(registry, /DIRECT_SOCIAL_ADAPTERS/)
assert.match(redditAdapter, /platform: 'reddit', availability: 'unsupported-by-platform'/)
assert.match(redditAdapter, /\/api\/submit/)
assert.match(redditAdapter, /submitted\.json/)
assert.match(socialFunction, /options: targetOptions\[account\.id\]/)
assert.match(socialFunction, /p_target_options: targetOptions/)
assert.match(publisher, /options: delivery\.target_options \|\| \{\}/)
assert.match(schema, /"target_options" "jsonb" DEFAULT '\{\}'::"jsonb" NOT NULL/)
assert.match(schema, /p_target_options" "jsonb" DEFAULT '\{\}'::"jsonb"/)

assert.deepEqual(normalizeRedditOptions({ subreddit: ' r/AskReddit ', title: '  A question  ' }), {
  subreddit: 'AskReddit',
  title: 'A question',
})
assert.deepEqual(validateRedditSubmission({
  text: 'A text post.',
  media: [],
  options: { subreddit: 'AskReddit', title: 'A question' },
}), [])
assert.deepEqual(validateRedditSubmission({
  text: 'x'.repeat(40001),
  media: [{ kind: 'image' }],
  options: { subreddit: 'r/invalid name', title: '' },
}).map((issue) => issue.code), [
  'reddit.subreddit_invalid',
  'reddit.title_invalid',
  'reddit.body_too_long',
  'reddit.media_unsupported',
])
assert.deepEqual(redditSubmissionFromApi({ json: { data: { id: 'abc', url: 'https://reddit.com/r/test/abc' } } }), {
  error: null,
  id: 'abc',
  url: 'https://reddit.com/r/test/abc',
})
assert.deepEqual(redditSubmissionFromApi({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'Not allowed']] } }), {
  error: { code: 'SUBREDDIT_NOTALLOWED', message: 'Not allowed' },
})
assert.deepEqual(redditSubmissionFromApi({ json: { data: {} } }), { error: null })

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const authorizationUrl = new URL(redditAuthorizationUrl({
  clientId: 'client-id',
  redirectUri: 'https://site.invalid/social/callback',
  scopes: ['identity', 'read', 'submit'],
  state: 'single-use-state',
}))
assert.equal(authorizationUrl.origin, 'https://www.reddit.com')
assert.equal(authorizationUrl.pathname, '/api/v1/authorize')
assert.equal(authorizationUrl.searchParams.get('state'), 'single-use-state')
assert.equal(authorizationUrl.searchParams.get('scope'), 'identity read submit')
assert.equal(authorizationUrl.searchParams.get('duration'), 'permanent')

const oauthCalls = []
const oauthFetch = async (url, init) => {
  oauthCalls.push({ url: String(url), init })
  return oauthCalls.length === 1
    ? jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'identity read submit' })
    : jsonResponse({ id: 'account-id', name: 'publisher', icon_img: 'https://reddit.invalid/avatar.png' })
}
const connected = await completeRedditOAuth({
  callbackUrl: 'https://site.invalid/callback?code=oauth-code&state=single-use-state',
  attempt: {
    codeVerifier: 'verifier',
    redirectUri: 'https://site.invalid/callback',
    scopes: ['identity', 'read', 'submit'],
  },
  credentials: { clientId: 'client-id', clientSecret: 'client-secret' },
  fetchImpl: oauthFetch,
})
assert.equal(connected[0].account.id, 'account-id')
assert.equal(connected[0].account.username, 'publisher')
assert.equal(connected[0].tokens.accessToken, 'access')
assert.equal(connected[0].tokens.refreshToken, 'refresh')
assert.equal(oauthCalls[0].url, 'https://www.reddit.com/api/v1/access_token')
assert.equal(new URLSearchParams(oauthCalls[0].init.body).get('code'), 'oauth-code')
assert.equal(oauthCalls[1].url, 'https://oauth.reddit.com/api/v1/me')
assert.match(oauthCalls[1].init.headers.Authorization, /^Bearer access$/)

let refreshRequest
const refreshed = await refreshRedditOAuth({
  tokens: { accessToken: 'old-access', refreshToken: 'old-refresh', scopes: ['identity'] },
  credentials: { clientId: 'client-id', clientSecret: 'client-secret' },
  fetchImpl: async (url, init) => {
    refreshRequest = { url: String(url), init }
    return jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 1800, scope: 'identity submit' })
  },
})
assert.equal(refreshRequest.url, 'https://www.reddit.com/api/v1/access_token')
assert.equal(new URLSearchParams(refreshRequest.init.body).get('grant_type'), 'refresh_token')
assert.equal(refreshed.accessToken, 'new-access')
assert.equal(refreshed.refreshToken, 'new-refresh')
assert.deepEqual(refreshed.scopes, ['identity', 'submit'])

const redditAccount = { id: 'account-id', username: 'publisher' }
const redditTokens = { accessToken: 'access' }
const redditBackend = createRedditBackend(redditAccount, redditTokens, {
  defineAdapter: (definition) => definition,
  connectedAccountRef: (ref) => ref,
  fetchImpl: async () => jsonResponse({ json: { data: { id: 'post-id', url: 'https://reddit.invalid/r/test/post-id' } } }),
})
const accountRef = { backend: 'default', platform: 'reddit', accountId: 'account-id' }
const publishTarget = {
  targetIndex: 0,
  account: accountRef,
  options: { subreddit: 'AskReddit', title: 'A question' },
  content: { text: 'A text post.', media: [] },
}
assert.deepEqual(redditBackend.posts.prepareTarget(publishTarget), [])
const publishResult = await redditBackend.posts.publishTarget(publishTarget)
assert.equal(publishResult.state, 'published')
assert.equal(publishResult.post.postId, 'post-id')
assert.equal(publishResult.url, 'https://reddit.invalid/r/test/post-id')

const rejectionAdapter = createRedditBackend(redditAccount, redditTokens, {
  defineAdapter: (definition) => definition,
  connectedAccountRef: (ref) => ref,
  fetchImpl: async () => jsonResponse({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'Not allowed']] } }),
})
const rejection = await rejectionAdapter.posts.publishTarget(publishTarget)
assert.equal(rejection.state, 'failed')
assert.equal(rejection.code, 'SUBREDDIT_NOTALLOWED')

const ambiguousAdapter = createRedditBackend(redditAccount, redditTokens, {
  defineAdapter: (definition) => definition,
  connectedAccountRef: (ref) => ref,
  fetchImpl: async () => { throw new TypeError('connection lost') },
})
const ambiguous = await ambiguousAdapter.posts.publishTarget(publishTarget)
assert.equal(ambiguous.state, 'unknown')
assert.equal(ambiguous.reason, 'ambiguous-submission')

const listingAdapter = createRedditBackend(redditAccount, redditTokens, {
  defineAdapter: (definition) => definition,
  connectedAccountRef: (ref) => ref,
  fetchImpl: async (url) => {
    assert.match(String(url), /\/user\/publisher\/submitted\.json\?limit=100&sort=new$/)
    return jsonResponse({ data: { children: [{ data: {
      id: 'post-id',
      selftext: 'A text post.',
      title: 'A question',
      created_utc: 1_800_000_000,
      url: 'https://reddit.invalid/r/test/post-id',
    } }] } })
  },
})
const listing = await listingAdapter.posts.list(accountRef, { limit: 100 })
assert.equal(listing.items[0].id, 'post-id')
assert.equal(listing.items[0].text, 'A text post.')

const probe = `
import { createSocial } from "npm:@opencoredev/social-sdk@0.5.0";
import { instagram } from "npm:@opencoredev/social-sdk@0.5.0/instagram";
import { threads } from "npm:@opencoredev/social-sdk@0.5.0/threads";
import { youtube } from "npm:@opencoredev/social-sdk@0.5.0/youtube";
import { tiktok } from "npm:@opencoredev/social-sdk@0.5.0/tiktok";
import { linkedin } from "npm:@opencoredev/social-sdk@0.5.0/linkedin";
import { zernio } from "npm:@opencoredev/social-sdk@0.5.0/cloud/zernio";
import { postForMe } from "npm:@opencoredev/social-sdk@0.5.0/cloud/post-for-me";
import { decodePlatformWebhook } from "npm:@opencoredev/social-sdk@0.5.0/server";

const direct = {
  instagram: instagram({ auth: { accessToken: "probe", accountId: "probe" }, webhookSecret: "probe" }),
  threads: threads({ auth: { accessToken: "probe", userId: "probe" }, webhookSecret: "probe" }),
  youtube: youtube({ auth: { accessToken: "probe", channelId: "probe" }, webhookSecret: "probe" }),
  tiktok: tiktok({ auth: { accessToken: "probe", openId: "probe" }, webhookSecret: "probe", verifiedMediaOrigins: [] }),
  linkedin: linkedin({ auth: { accessToken: "probe", author: "urn:li:person:probe" }, webhookSecret: "probe", apiVersion: "202609" }),
};
const managed = {
  zernio: zernio({ apiKey: "probe", webhookSecret: "probe" }),
  "post-for-me": postForMe({ apiKey: "probe", webhookSecret: "probe" }),
};
const operations = ["webhooks.verify", "comments.read", "comments.write", "messages.read", "messages.write"];
const summary = (client, backend = "default") => {
  const capabilities = client.capabilities()[backend]?.capabilities ?? Object.values(client.capabilities())[0]?.capabilities ?? [];
  return Object.fromEntries(operations.map((operation) => [
    operation,
    capabilities.find((capability) => capability.operation === operation)?.availability ?? "absent",
  ]));
};
const directClients = Object.fromEntries(
  Object.entries(direct).map(([platform, adapter]) => [platform, createSocial({ backend: adapter })]),
);
const managedClients = Object.fromEntries(
  Object.entries(managed).map(([backend, adapter]) => [backend, createSocial({ backends: { [backend]: adapter } })]),
);
const raw = {
  instagram: JSON.stringify({ object: "instagram", entry: [{ id: "account", changes: [{ field: "comments", value: { id: "comment", text: "guide" } }] }] }),
  threads: JSON.stringify({ values: { field: "replies", value: { id: "reply", text: "guide", root_post: { id: "post", owner_id: "account" } } } }),
  linkedin: JSON.stringify({ type: "ORGANIZATION_SOCIAL_ACTION_NOTIFICATIONS", notifications: [{ action: "COMMENT", organizationalEntity: "urn:li:organization:1" }] }),
  tiktok: JSON.stringify({ event: "comment.created", user_openid: "account", content: "{}" }),
  youtube: '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>video</yt:videoId><yt:channelId>channel</yt:channelId></entry></feed>',
};
const decoded = {};
for (const platform of Object.keys(raw)) {
  const event = await decodePlatformWebhook({
    platform,
    backend: "default",
    body: new TextEncoder().encode(raw[platform]),
  });
  decoded[platform] = event.type;
}
const managedRaw = {
  zernio: JSON.stringify({ id: "event-1", event: "comment.received", data: { accountId: "account", comment: { id: "comment", text: "guide" } } }),
  "post-for-me": JSON.stringify({ event_type: "comment.received", data: { accountId: "account", comment: { id: "comment", text: "guide" } } }),
};
for (const [backend, client] of Object.entries(managedClients)) {
  const event = await client.adapter(backend, { acknowledgeUnsafe: true }).webhooks.decode(
    { headers: new Headers(), body: new TextEncoder().encode(managedRaw[backend]) },
    { backendInstance: backend, correlationId: "probe", retryBudget: { maxAttempts: 1, maxElapsedMs: 1000 } },
  );
  decoded[backend] = event.type;
}
const body = new TextEncoder().encode(raw.instagram);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("probe"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
const verified = await directClients.instagram.adapter("default", { acknowledgeUnsafe: true }).webhooks.verify({
  headers: new Headers({ "X-Hub-Signature-256": "sha256=" + signature }),
  body,
});
if (!verified.valid) throw new Error("The direct Instagram HMAC probe did not verify.");
let rejected = false;
try {
  await directClients.instagram.adapter("default", { acknowledgeUnsafe: true }).webhooks.verify({
    headers: new Headers({ "X-Hub-Signature-256": "sha256=" + "0".repeat(64) }),
    body,
  });
} catch {
  rejected = true;
}
if (!rejected) throw new Error("The direct Instagram verifier accepted a forged signature.");
console.log(JSON.stringify({
  capabilities: {
    ...Object.fromEntries(Object.entries(directClients).map(([platform, client]) => [platform, summary(client)])),
    ...Object.fromEntries(Object.entries(managedClients).map(([backend, client]) => [backend, summary(client, backend)])),
  },
  decoded,
  signature: { validAccepted: verified.valid, forgedRejected: rejected },
}));
`
const sdkProbe = JSON.parse(execFileSync('deno', ['eval', '--no-check', probe], { encoding: 'utf8' }))
const capability = (route, operation) => sdkProbe.capabilities[route][operation]
assert.equal(capability('instagram', 'webhooks.verify'), 'available')
assert.equal(capability('instagram', 'comments.write'), 'available')
assert.equal(capability('instagram', 'messages.write'), 'absent')
assert.equal(capability('threads', 'webhooks.verify'), 'available')
assert.equal(capability('threads', 'comments.write'), 'available')
assert.equal(capability('linkedin', 'webhooks.verify'), 'approval-dependent')
assert.equal(capability('zernio', 'webhooks.verify'), 'available')
assert.equal(capability('zernio', 'comments.write'), 'available')
assert.equal(capability('zernio', 'messages.write'), 'available')
assert.equal(capability('post-for-me', 'webhooks.verify'), 'available')
assert.equal(capability('post-for-me', 'comments.write'), 'absent')
assert.deepEqual(sdkProbe.decoded, {
  instagram: 'comment.received',
  threads: 'comment.received',
  linkedin: 'comment.received',
  tiktok: 'unknown',
  youtube: 'unknown',
  zernio: 'comment.received',
  'post-for-me': 'comment.received',
})
assert.deepEqual(sdkProbe.signature, { validAccepted: true, forgedRejected: true })

console.log('social-provider-matrix: registered direct providers and Reddit OAuth, publish, error, ambiguity and listing fixtures passed')
