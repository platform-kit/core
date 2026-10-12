import assert from 'node:assert/strict'
import { markupFor } from './inference-config.mjs'
import { normalizeProviderUsage, providerCostMicros, tariffFor } from '../supabase/functions/_shared/inference-meter.mjs'
import { providersFrom, ask } from '../supabase/functions/_shared/agents/provider.js'
import { resolveUsageOperation } from '../supabase/functions/_shared/usage-gate.mjs'
import { inferenceOf, pipeSiteConfigSource, publicSite, usageOf } from './site.mjs'

const site = (id, model, input, markup = 1.25) => ({
  name: id,
  usage: { operations: {
    'agent.staff': { mode: 'site-funded' },
    'agent.game': { mode: 'offer', offerKey: 'abcdef12' },
  } },
  inference: {
    providers: [{
      id, protocol: 'openai-chat', secret: `env:${id.toUpperCase().replaceAll('-', '_')}_KEY`, model,
      baseUrl: 'https://api.example.test/v1',
      models: { [model]: { inputPerMillionUsd: input, outputPerMillionUsd: input * 2 } },
    }],
    markup: { default: markup, offers: { abcdef12: markup + 0.25 } },
  },
})

const north = inferenceOf(site('north', 'same-model', 0.4))
const south = inferenceOf(site('south', 'same-model', 1.6))
assert.equal(north.providers[0].models['same-model'].input, 400_000)
assert.equal(south.providers[0].models['same-model'].input, 1_600_000)
assert.equal(north.markup.default, 1_250_000)
assert.equal(north.markup.offers.abcdef12, 1_500_000)
assert.notEqual(north.providers[0].id, south.providers[0].id)
assert.equal(inferenceOf({}), null, 'sites without the optional declaration retain their current unconfigured behavior')
assert.deepEqual(usageOf(site('north', 'same-model', 0.4)).operations, {
  'agent.staff': { mode: 'site-funded' },
  'agent.game': { mode: 'offer', offerKey: 'abcdef12' },
})
const usageConfig = usageOf(site('north', 'same-model', 0.4))
assert.equal(markupFor(north, usageConfig, 'agent.game'), 1_500_000, 'site offer markup applies when an operation has none')
assert.equal(markupFor(inferenceOf(site('north', 'same-model', 0.4, 1.25)), {
  operations: { 'agent.game': { mode: 'offer', offerKey: 'abcdef12', markup_micros: 1_750_000 } },
}, 'agent.game'), 1_750_000, 'operation markup overrides site offer markup')
assert.equal(markupFor(north, usageConfig, 'agent.staff'), null, 'site-funded operations do not consume reader units')

assert.deepEqual(resolveUsageOperation(usageConfig.operations, 'agent.staff'), {
  operationId: 'agent.staff', mode: 'site-funded', offerKey: null,
})
assert.throws(() => resolveUsageOperation(usageConfig.operations, 'agent.missing'), /has no site policy/)
assert.throws(() => resolveUsageOperation(usageConfig.operations, 'agent.game;free'), /stable server identifier/)

const providerConfig = inferenceOf({
  inference: {
    providers: [
      { id: 'primary', protocol: 'openai-chat', secret: 'env:PRIMARY_KEY', model: 'primary-model', models: { 'primary-model': { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } } },
      { id: 'backup', protocol: 'anthropic', secret: 'env:BACKUP_KEY', model: 'backup-model', models: { 'backup-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 4 } } },
    ],
    fallback: { maxAttempts: 2 },
    markup: { default: 1.2 },
  },
})
const providerSet = providersFrom({
  AGENTS_LIVE: '1', PRIMARY_KEY: 'primary-secret', BACKUP_KEY: 'backup-secret',
}, providerConfig)
assert.deepEqual(providerSet.list.map(({ id }) => id), ['primary', 'backup'], 'providers follow the site-owned order')
assert.equal(providerSet.list[1].model, 'backup-model', 'fallback uses its own configured model')
assert.equal(providerSet.list[0].key, 'primary-secret', 'server resolves the referenced secret at runtime')
assert.equal(providersFrom({ AGENTS_LIVE: '1' }, providerConfig).error?.includes('PRIMARY_KEY'), true)
const originalFetch = globalThis.fetch
const providerRequests = []
try {
  globalThis.fetch = async (url, init) => {
    providerRequests.push({ url: String(url), body: JSON.parse(init.body) })
    if (String(url).includes('primary.test')) return new Response('provider unavailable', { status: 503 })
    return new Response(JSON.stringify({
      model: 'backup-model',
      content: [{ type: 'text', text: 'Answer' }],
      usage: { input_tokens: 7, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const fallbackResult = await ask({
    providers: { ...providerSet, list: providerSet.list.map((provider, i) => ({
      ...provider, base: i === 0 ? 'https://primary.test/v1' : 'https://backup.test',
    })) },
    model: 'primary-model',
    messages: [{ role: 'user', content: 'Question' }],
  })
  assert.equal(fallbackResult.provider, 'backup')
  assert.equal(fallbackResult.protocol, 'anthropic')
  assert.equal(fallbackResult.model, 'backup-model')
  assert.deepEqual(fallbackResult.attempts.map(({ provider, model, outcome, status }) =>
    ({ provider, model, outcome, status })), [
    { provider: 'primary', model: 'primary-model', outcome: 'failed', status: 503 },
    { provider: 'backup', model: 'backup-model', outcome: 'succeeded', status: 200 },
  ])
  assert.equal(providerRequests[0].body.model, 'primary-model')
  assert.equal(providerRequests[1].body.model, 'backup-model')
  assert.deepEqual(normalizeProviderUsage(fallbackResult.protocol, fallbackResult.usage.raw), {
    input: 7, output: 3, cachedInput: 0, cacheWrite: 0,
    reasoning: 0, image: 0, audioInput: 0, audioOutput: 0,
  })
  assert.equal(providerCostMicros(
    normalizeProviderUsage(fallbackResult.protocol, fallbackResult.usage.raw),
    tariffFor(providerConfig, fallbackResult.provider, fallbackResult.model),
  ), 33, 'fallback accounting uses the actual provider and model tariff')
  await assert.rejects(() => ask({
    providers: providerSet, model: 'unpriced-model', messages: [{ role: 'user', content: 'Question' }],
  }), /no tariff under provider/)
} finally {
  globalThis.fetch = originalFetch
}

const measured = normalizeProviderUsage('openai-chat', {
  prompt_tokens: 100, completion_tokens: 30, total_tokens: 130,
  prompt_tokens_details: { cached_tokens: 10, image_tokens: 20 },
  completion_tokens_details: { reasoning_tokens: 5 },
  cost_usd: 999,
})
assert.deepEqual(measured, {
  input: 70, output: 25, cachedInput: 10, cacheWrite: 0,
  reasoning: 5, image: 20, audioInput: 0, audioOutput: 0,
})
assert.equal(providerCostMicros(measured, {
  input: 400_000, output: 800_000, cachedInput: 100_000,
  reasoning: 1_200_000, image: 2_000_000,
}), 95, 'tariffs calculate micros from dimensions, ignoring untrusted provider dollar fields')
assert.equal(normalizeProviderUsage('openai-chat', null), null, 'absent usage is represented as unknown, not zero')
assert.throws(() => normalizeProviderUsage('openai-chat', {
  prompt_tokens: '100', completion_tokens: 30,
}), /non-negative whole token count/)
assert.throws(() => normalizeProviderUsage('openai-chat', {
  prompt_tokens: 100, completion_tokens: 30,
  prompt_tokens_details: { image_tokens: 101 },
}), /exceeds its reported/)
assert.throws(() => normalizeProviderUsage('openai-chat', {
  prompt_tokens: 100, completion_tokens: 30,
  prompt_tokens_details: { unpriced_modality_tokens: 10 },
}), /unsupported provider usage dimension/)
assert.throws(() => providerCostMicros({ ...measured, cacheWrite: 1 }, { input: 1, output: 1 }), /no positive rate for measured cacheWrite/)
assert.throws(() => tariffFor({ providers: [{ id: 'south', models: {} }] }, 'north', 'same-model'), /no site tariff/)

assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'sk-secret', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } } }], markup: { default: 1 } },
}), /secret must reference a deployment secret/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 1 } } }], markup: { default: 1 } },
}), /outputPerMillionUsd is required/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } } }], fallback: { maxAttempts: 5 }, markup: { default: 1 } },
}), /maxAttempts|providers/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } } }], fallback: { retryStatuses: [400] }, markup: { default: 1 } },
}), /retryStatuses/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } } }], markup: { default: 1, offers: { 'not-a-key': 1.2 } } },
}), /stable eight-character offer key/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 0.00000001, outputPerMillionUsd: 1 } } }], markup: { default: 1 } },
}), /positive USD rate/)
assert.throws(() => inferenceOf({
  inference: { providers: [{ id: 'provider', protocol: 'openai-chat', secret: 'env:KEY', model: 'm', models: { m: { inputPerMillionUsd: 1, outputPerMillionUsd: 1, videoPerMillionUsd: 2 } } }], markup: { default: 1 } },
}), /not a supported usage dimension/)
assert.throws(() => usageOf({ usage: { operations: { 'agent.staff': { mode: 'site-funded', markup: 2 } } } }), /site-funded policy cannot set reader markup/)

const generated = pipeSiteConfigSource(site('private-provider', 'secret-model', 0.5))
const testSecretName = 'PRIVATE_PROVIDER_KEY'
process.env[testSecretName] = 'sensitive-provider-value'
assert.match(generated, /export const inference = /)
assert.match(generated, /"agent\.staff":\{"mode":"site-funded"\}/)
assert.match(generated, /"secretEnv":"PRIVATE_PROVIDER_KEY"/)
assert.equal(Object.hasOwn(publicSite({ ...site('private-provider', 'secret-model', 0.5), looks: {} }), 'inference'), false)
assert.equal(generated.includes(process.env[testSecretName]), false)
delete process.env[testSecretName]

console.log('✔ inference config: site isolation, tariffs, markup, validation, and server-only export')
