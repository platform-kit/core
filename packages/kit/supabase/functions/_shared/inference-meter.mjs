import { unitsForCost } from './usage-stripe.mjs'

const TOKEN_RATE_SCALE = 1_000_000n

function tokenCount(value, where) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${where} must be a non-negative whole token count`)
  return value
}

function addCounts(...counts) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (!Number.isSafeInteger(total)) throw new Error('provider usage token total exceeds the safe integer range')
  return total
}

function details(value, where, allowed) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}.${key} is an unsupported provider usage dimension`)
  }
  return value
}

function openAiUsage(raw) {
  const prompt = tokenCount(raw.prompt_tokens, 'OpenAI prompt_tokens')
  const completion = tokenCount(raw.completion_tokens, 'OpenAI completion_tokens')
  const promptDetails = details(raw.prompt_tokens_details, 'OpenAI prompt_tokens_details', [
    'cached_tokens', 'image_tokens', 'audio_tokens',
  ])
  const completionDetails = details(raw.completion_tokens_details, 'OpenAI completion_tokens_details', [
    'reasoning_tokens', 'audio_tokens', 'accepted_prediction_tokens', 'rejected_prediction_tokens',
  ])
  const cachedInput = tokenCount(promptDetails.cached_tokens ?? 0, 'OpenAI cached_tokens')
  const image = tokenCount(promptDetails.image_tokens ?? 0, 'OpenAI image_tokens')
  const audioInput = tokenCount(promptDetails.audio_tokens ?? 0, 'OpenAI input audio_tokens')
  const reasoning = tokenCount(completionDetails.reasoning_tokens ?? 0, 'OpenAI reasoning_tokens')
  const audioOutput = tokenCount(completionDetails.audio_tokens ?? 0, 'OpenAI output audio_tokens')
  if (addCounts(cachedInput, image, audioInput) > prompt || addCounts(reasoning, audioOutput) > completion) {
    throw new Error('OpenAI detailed usage exceeds its reported prompt or completion token total')
  }
  if (raw.total_tokens != null && tokenCount(raw.total_tokens, 'OpenAI total_tokens') !== prompt + completion) {
    throw new Error('OpenAI total_tokens does not match prompt_tokens plus completion_tokens')
  }
  return {
    input: prompt - cachedInput - image - audioInput,
    output: completion - reasoning - audioOutput,
    cachedInput,
    cacheWrite: 0,
    reasoning,
    image,
    audioInput,
    audioOutput,
  }
}

function anthropicUsage(raw) {
  const input = tokenCount(raw.input_tokens, 'Anthropic input_tokens')
  const outputTotal = tokenCount(raw.output_tokens, 'Anthropic output_tokens')
  const cachedInput = tokenCount(raw.cache_read_input_tokens ?? 0, 'Anthropic cache_read_input_tokens')
  const cacheWrite = tokenCount(raw.cache_creation_input_tokens ?? 0, 'Anthropic cache_creation_input_tokens')
  const reasoning = tokenCount(raw.thinking_tokens ?? 0, 'Anthropic thinking_tokens')
  if (reasoning > outputTotal) throw new Error('Anthropic thinking_tokens exceeds output_tokens')
  const allowed = [
    'input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
    'cache_creation', 'thinking_tokens',
  ]
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw new Error(`Anthropic usage.${key} is an unsupported provider usage dimension`)
  }
  return {
    input,
    output: outputTotal - reasoning,
    cachedInput,
    cacheWrite,
    reasoning,
    image: 0,
    audioInput: 0,
    audioOutput: 0,
  }
}

export function normalizeProviderUsage(protocol, raw) {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('provider usage must be an object')
  if (protocol === 'openai-chat') return openAiUsage(raw)
  if (protocol === 'anthropic') return anthropicUsage(raw)
  throw new Error(`provider protocol "${protocol}" has no usage adapter`)
}

export function tariffFor(inference, providerId, model) {
  const provider = inference?.providers?.find((entry) => entry.id === providerId)
  const tariff = provider?.models?.[model]
  if (!tariff) throw new Error(`no site tariff for provider "${providerId}" and model "${model}"`)
  return tariff
}

export function providerCostMicros(usage, tariff) {
  if (!usage || typeof usage !== 'object' || !tariff || typeof tariff !== 'object') {
    throw new Error('provider cost needs measured usage and a site tariff')
  }
  const fallbackRate = { cachedInput: tariff.input, reasoning: tariff.output }
  let cost = 0n
  for (const [dimension, count] of Object.entries(usage)) {
    tokenCount(count, `usage.${dimension}`)
    if (!count) continue
    const rate = tariff[dimension] ?? fallbackRate[dimension]
    if (!Number.isSafeInteger(rate) || rate <= 0) {
      throw new Error(`site tariff has no positive rate for measured ${dimension} usage`)
    }
    const amount = BigInt(count) * BigInt(rate)
    cost += (amount + TOKEN_RATE_SCALE - 1n) / TOKEN_RATE_SCALE
  }
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('provider cost exceeds the safe integer range')
  return Number(cost)
}

export function customerCostMicros(providerCost, markupMicros) {
  if (!Number.isSafeInteger(providerCost) || providerCost < 0 ||
      !Number.isSafeInteger(markupMicros) || markupMicros < 1) {
    throw new Error('provider cost and markup must be non-negative/positive safe integers')
  }
  const amount = (BigInt(providerCost) * BigInt(markupMicros) + TOKEN_RATE_SCALE - 1n) / TOKEN_RATE_SCALE
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('marked-up provider cost exceeds the safe integer range')
  return Number(amount)
}

export function boundedInferenceUsage({ messages, tools = [], providers, model, remainingCostMicros, maxOutputTokens = 4096 }) {
  if (!Array.isArray(messages) || !Array.isArray(tools) || !Array.isArray(providers) || !providers.length ||
      !Number.isSafeInteger(remainingCostMicros) || remainingCostMicros <= 0 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('inference reservation needs a request, configured providers, and a positive spend limit')
  }
  const inputBytes = new TextEncoder().encode(JSON.stringify({ messages, tools })).length
  const inputTokens = inputBytes + messages.length * 32 + tools.length * 64 + 128
  if (!Number.isSafeInteger(inputTokens)) throw new Error('inference input estimate exceeds the safe integer range')
  const chain = providers.map((provider, index) => {
    const selectedModel = index === 0 ? (model || provider.model) : provider.model
    const tariff = provider.models?.[selectedModel]
    if (!tariff) throw new Error(`no site tariff for provider "${provider.id}" and model "${selectedModel}"`)
    const inRate = Math.max(
      tariff.input,
      tariff.cachedInput ?? tariff.input,
      tariff.cacheWrite ?? tariff.input,
      tariff.image ?? tariff.input,
      tariff.audioInput ?? tariff.input,
    )
    const outRate = Math.max(tariff.output, tariff.reasoning ?? tariff.output, tariff.audioOutput ?? tariff.output)
    if (!Number.isSafeInteger(inRate) || inRate <= 0 || !Number.isSafeInteger(outRate) || outRate <= 0) {
      throw new Error(`provider "${provider.id}" model "${selectedModel}" has no complete reservation tariff`)
    }
    return { provider: provider.id, model: selectedModel, tariff, inRate, outRate }
  })
  const outputLimit = Math.min(maxOutputTokens, ...providers.map((provider) => provider.maxTokens || maxOutputTokens))
  const costAt = (outputTokens) => {
    const total = chain.reduce((sum, item) => {
    const attemptCost = providerCostMicros(
      { input: inputTokens, output: outputTokens, cachedInput: 0, cacheWrite: 0, reasoning: 0, image: 0, audioInput: 0, audioOutput: 0 },
      { input: item.inRate, output: item.outRate },
    )
      return sum + BigInt(attemptCost)
    }, 0n)
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('inference fallback reservation exceeds the safe integer range')
    return Number(total)
  }
  if (costAt(1) > remainingCostMicros) throw new Error('inference fallback chain exceeds the remaining provider spend limit')
  let low = 1
  let high = outputLimit
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (costAt(middle) <= remainingCostMicros) low = middle
    else high = middle - 1
  }
  return {
    inputTokens,
    maxOutputTokens: low,
    attempts: chain.map(({ provider, model: selectedModel, inRate, outRate }) => ({
      provider, model: selectedModel,
      maxCostMicros: providerCostMicros(
        { input: inputTokens, output: low, cachedInput: 0, cacheWrite: 0, reasoning: 0, image: 0, audioInput: 0, audioOutput: 0 },
        { input: inRate, output: outRate },
      ),
    })),
    maxCostMicros: costAt(low),
  }
}

export function billableInferenceAttempts({
  attempts, bounds, inference, sponsor, markupMicros = null, usageRateMicros = null,
}) {
  if (!Array.isArray(attempts) || !Array.isArray(bounds) ||
      !['site', 'reader'].includes(sponsor) ||
      (sponsor === 'reader' && (!Number.isSafeInteger(markupMicros) || markupMicros < 1 ||
        !Number.isSafeInteger(usageRateMicros) || usageRateMicros <= 0))) {
    throw new Error('inference attempt accounting needs bounded attempts and a valid sponsor pricing policy')
  }
  const accounted = attempts.map((attempt, index) => {
    if (!['succeeded', 'failed', 'not_sent'].includes(attempt?.outcome)) {
      throw new Error(`inference attempt ${index + 1} has an invalid outcome`)
    }
    const reserved = bounds.find((bound) =>
      bound.provider === attempt.provider && bound.model === (attempt.requestedModel || attempt.model))
    if (!reserved || !Number.isSafeInteger(reserved.maxCostMicros) || reserved.maxCostMicros < 0) {
      throw new Error(`provider attempt ${attempt.provider}/${attempt.model} was not covered by its reservation`)
    }

    let dimensions = {}
    let providerCostMicros = 0
    let measurementStatus = attempt.outcome === 'not_sent' ? 'not_sent' : 'estimated'
    if (attempt.outcome !== 'not_sent') {
      try {
        const measured = normalizeProviderUsage(attempt.protocol, attempt.usage)
        if (!measured) throw new Error('provider omitted usage')
        dimensions = measured
        const measuredCost = providerCostMicrosFor(inference, attempt, measured)
        providerCostMicros = Math.min(measuredCost, reserved.maxCostMicros)
        measurementStatus = measuredCost <= reserved.maxCostMicros ? 'measured' : 'estimated'
      } catch {
        providerCostMicros = reserved.maxCostMicros
        measurementStatus = 'estimated'
      }
    }
    const customerCostMicros = sponsor === 'reader'
      ? customerCostMicrosFor(providerCostMicros, markupMicros)
      : 0
    const customerUnitsMicros = sponsor === 'reader'
      ? unitsForCost(customerCostMicros, usageRateMicros)
      : 0
    const retailValueMicros = sponsor === 'reader'
      ? valueForUnits(customerUnitsMicros, usageRateMicros)
      : null
    return {
      attemptNo: index + 1,
      provider: attempt.provider,
      model: attempt.model,
      protocol: attempt.protocol,
      outcome: attempt.outcome,
      measurementStatus,
      usageDimensions: dimensions,
      providerCostMicros,
      markupMicros: sponsor === 'reader' ? markupMicros : null,
      customerCostMicros,
      customerUnitsMicros,
      retailValueMicros,
      httpStatus: Number.isInteger(attempt.status) && attempt.status >= 100 && attempt.status <= 599
        ? attempt.status
        : null,
    }
  })
  const totals = accounted.reduce((sum, attempt) => ({
    providerCostMicros: sum.providerCostMicros + attempt.providerCostMicros,
    customerCostMicros: sum.customerCostMicros + attempt.customerCostMicros,
    customerUnitsMicros: sum.customerUnitsMicros + attempt.customerUnitsMicros,
    retailValueMicros: sum.retailValueMicros + (attempt.retailValueMicros || 0),
  }), { providerCostMicros: 0, customerCostMicros: 0, customerUnitsMicros: 0, retailValueMicros: 0 })
  if (Object.values(totals).some((value) => !Number.isSafeInteger(value))) {
    throw new Error('inference usage totals exceed the safe integer range')
  }
  return {
    attempts: accounted,
    ...totals,
    measurementStatus: accounted.some((attempt) => attempt.measurementStatus === 'estimated') ? 'estimated' : 'measured',
  }
}

function providerCostMicrosFor(inference, attempt, dimensions) {
  return providerCostMicros(dimensions, tariffFor(inference, attempt.provider, attempt.model))
}

function customerCostMicrosFor(providerCost, markup) {
  return customerCostMicros(providerCost, markup)
}

function valueForUnits(units, rate) {
  const value = (BigInt(units) * BigInt(rate) + TOKEN_RATE_SCALE - 1n) / TOKEN_RATE_SCALE
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('inference retail value exceeds the safe integer range')
  return Number(value)
}

/* THE MARKUP AN OPERATION'S READER PAYS AT, as a multiplier in millionths: the operation's own, else its offer's, else the
   site's default; null for a site-funded operation, which consumes no reader units. Shared by the build's config check
   (build/inference-config.mjs re-exports it) and the agent worker, which imported it from here before it lived here. */
export function markupFor(inference, usage, operationId) {
  const policy = usage?.operations?.[operationId]
  if (!policy) throw new Error(`usage operation "${operationId}" has no site policy`)
  if (policy.mode === 'site-funded') return null
  if (policy.mode !== 'offer' || !/^[0-9a-f]{8}$/.test(String(policy.offerKey || ''))) {
    throw new Error(`usage operation "${operationId}" has an invalid offer policy`)
  }
  const multiplier = policy.markup_micros
    ?? inference?.markup?.offers?.[policy.offerKey]
    ?? inference?.markup?.default
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
    throw new Error(`usage operation "${operationId}" has no valid markup multiplier`)
  }
  return multiplier
}
