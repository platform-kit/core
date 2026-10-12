const ID = /^[a-z][a-z0-9-]{0,47}$/
const SECRET = /^env:([A-Z][A-Z0-9_]{0,127})$/
const OFFER_KEY = /^[0-9a-f]{8}$/
const DEFAULT_RETRY_STATUSES = [0, 401, 402, 403, 404, 408, 409, 425, 429, ...Array.from({ length: 100 }, (_, i) => 500 + i)]
const MAX_PROVIDERS = 4
const RATE_SCALE = 1_000_000

function fail(message) {
  throw new Error(`inference.${message}`)
}

function rate(value, where) {
  const amount = Number(value)
  const scaled = amount * RATE_SCALE
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(scaled) < 1 || !Number.isSafeInteger(Math.round(scaled))) {
    fail(`${where} must be a positive USD rate per million tokens`)
  }
  return Math.round(scaled)
}

function multiplier(value, where) {
  const amount = Number(value)
  const scaled = amount * RATE_SCALE
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(scaled) < 1 || !Number.isSafeInteger(Math.round(scaled))) {
    fail(`${where} must be a positive markup multiplier`)
  }
  return Math.round(scaled)
}

function ratesFor(models, providerId) {
  if (!models || typeof models !== 'object' || Array.isArray(models) || !Object.keys(models).length) {
    fail(`providers.${providerId}.models must declare at least one priced model`)
  }
  const rates = {}
  for (const [model, value] of Object.entries(models)) {
    if (!model.trim() || !value || typeof value !== 'object' || Array.isArray(value)) {
      fail(`providers.${providerId}.models.${model} must declare input and output rates`)
    }
    const dimensions = {
      inputPerMillionUsd: 'input',
      outputPerMillionUsd: 'output',
      cachedInputPerMillionUsd: 'cachedInput',
      cacheWritePerMillionUsd: 'cacheWrite',
      reasoningPerMillionUsd: 'reasoning',
      imagePerMillionUsd: 'image',
      audioInputPerMillionUsd: 'audioInput',
      audioOutputPerMillionUsd: 'audioOutput',
    }
    for (const field of Object.keys(value)) {
      if (!Object.hasOwn(dimensions, field)) fail(`providers.${providerId}.models.${model}.${field} is not a supported usage dimension`)
    }
    for (const field of ['inputPerMillionUsd', 'outputPerMillionUsd']) {
      if (value[field] == null) fail(`providers.${providerId}.models.${model}.${field} is required`)
    }
    const normalized = {}
    for (const [field, dimension] of Object.entries(dimensions)) {
      if (value[field] != null) normalized[dimension] = rate(value[field], `providers.${providerId}.models.${model}.${field}`)
    }
    rates[model] = normalized
  }
  return rates
}

function baseUrl(value, where) {
  let parsed
  try { parsed = new URL(String(value)) } catch { fail(`${where} must be an absolute HTTP(S) URL`) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${where} must be an absolute HTTP(S) URL without credentials, query, or fragment`)
  }
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    fail(`${where} may use HTTP only for localhost`)
  }
  return parsed.toString().replace(/\/+$/, '')
}

export function inferenceOf(config = {}) {
  const source = config.inference
  if (source == null) return null
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('must be a group of fields')
  if (!Array.isArray(source.providers) || source.providers.length < 1 || source.providers.length > MAX_PROVIDERS) {
    fail(`providers must contain between 1 and ${MAX_PROVIDERS} ordered providers`)
  }

  const ids = new Set()
  const providers = source.providers.map((provider, index) => {
    const where = `providers[${index}]`
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) fail(`${where} must be a group of fields`)
    const id = String(provider.id || '')
    if (!ID.test(id) || ids.has(id)) fail(`${where}.id must be unique and use lower-case letters, digits, or hyphens`)
    ids.add(id)
    const protocol = String(provider.protocol || '')
    if (!['openai-chat', 'anthropic'].includes(protocol)) fail(`${where}.protocol must be openai-chat or anthropic`)
    const secret = String(provider.secret || '')
    const secretMatch = SECRET.exec(secret)
    if (!secretMatch) fail(`${where}.secret must reference a deployment secret as env:UPPERCASE_NAME`)
    const models = ratesFor(provider.models, id)
    const model = String(provider.model || '')
    if (!Object.hasOwn(models, model)) fail(`${where}.model must name a model with declared rates`)
    if (provider.maxOutputTokens != null &&
        (!Number.isInteger(provider.maxOutputTokens) || provider.maxOutputTokens < 1 || provider.maxOutputTokens > 32_000)) {
      fail(`${where}.maxOutputTokens must be a whole number from 1 through 32000`)
    }
    return {
      id,
      protocol,
      baseUrl: baseUrl(provider.baseUrl || (protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'), `${where}.baseUrl`),
      secretEnv: secretMatch[1],
      model,
      models,
      maxOutputTokens: provider.maxOutputTokens ?? 4096,
    }
  })

  const fallbackSource = source.fallback ?? {}
  if (!fallbackSource || typeof fallbackSource !== 'object' || Array.isArray(fallbackSource)) {
    fail('fallback must be a group of fields')
  }
  if (fallbackSource.enabled != null && typeof fallbackSource.enabled !== 'boolean') {
    fail('fallback.enabled must be true or false')
  }
  const retryStatuses = fallbackSource.retryStatuses == null ? DEFAULT_RETRY_STATUSES : fallbackSource.retryStatuses
  if (!Array.isArray(retryStatuses) || retryStatuses.some((status) =>
    !Number.isInteger(status) || status < 0 || status > 599 || status === 400 || status === 422)) {
    fail('fallback.retryStatuses must be HTTP status codes other than request errors 400 and 422')
  }
  const maxAttempts = fallbackSource.maxAttempts == null ? providers.length : fallbackSource.maxAttempts
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > providers.length) {
    fail(`fallback.maxAttempts must be from 1 through the configured provider count (${providers.length})`)
  }
  const defaultMarkup = source.markup?.default
  if (defaultMarkup == null) fail('markup.default is required')
  const offerMarkups = source.markup?.offers ?? {}
  if (!offerMarkups || typeof offerMarkups !== 'object' || Array.isArray(offerMarkups)) {
    fail('markup.offers must map stable offer keys to multipliers')
  }
  const markups = {}
  for (const [key, value] of Object.entries(offerMarkups)) {
    if (!OFFER_KEY.test(key)) fail(`markup.offers key ${key} must be a stable eight-character offer key`)
    markups[key] = multiplier(value, `markup.offers.${key}`)
  }

  return {
    providers,
    fallback: {
      enabled: fallbackSource.enabled !== false,
      retryStatuses: [...new Set(retryStatuses)],
      maxAttempts,
    },
    markup: { default: multiplier(defaultMarkup, 'markup.default'), offers: markups },
  }
}

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
