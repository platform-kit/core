const WORD = /[\p{L}\p{N}_]/u

const value = (record, snake, camel) => record?.[snake] ?? record?.[camel]
const id = (record, snake, camel) => {
  const result = value(record, snake, camel)
  return typeof result === 'string' ? result : ''
}

function escapedPhrase(phrase) {
  return phrase.trim().split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
}

export function socialKeywordMatches(text, keyword) {
  if (typeof text !== 'string' || typeof keyword !== 'string') return false
  const phrase = keyword.normalize('NFC').trim()
  const content = text.normalize('NFC')
  if (!phrase || !content) return false

  const hasWord = WORD.test(phrase)
  const before = hasWord ? '(?:^|[^\\p{L}\\p{N}_])' : ''
  const after = hasWord ? '(?=$|[^\\p{L}\\p{N}_])' : ''
  return new RegExp(`${before}${escapedPhrase(phrase)}${after}`, 'iu').test(content)
}

export function socialBotAllowsAnonymousSubject(bot) {
  return Boolean(
    bot &&
    bot.published !== false &&
    Array.isArray(bot.surfaces) &&
    bot.surfaces.includes('social') &&
    Array.isArray(bot.serves) &&
    bot.serves.length === 0,
  )
}

export function socialAutomationPrompt(event, accountExternalId) {
  const eventKind = value(event, 'event_kind', 'eventKind')
  const body = value(event, 'body', 'body')
  if (!['comment', 'dm'].includes(eventKind) || typeof body !== 'string' || !body.trim()) return ''

  let remaining = 3400
  const lines = []
  const context = Array.isArray(event.context) ? event.context.slice(-8) : []
  for (const item of context) {
    const text = typeof item === 'string' ? item : value(item, 'body', 'text')
    if (typeof text !== 'string' || !text.trim() || remaining <= 0) continue
    const authorId = id(item, 'author_id', 'authorId')
    const speaker = authorId && authorId === accountExternalId ? 'Connected account' : 'Other participant'
    const line = `${speaker}: ${text.trim().slice(0, 900)}`
    const bounded = line.slice(0, remaining)
    if (bounded) lines.push(bounded)
    remaining -= bounded.length
  }
  const incoming = body.trim().slice(0, 1600)
  lines.push(`Incoming ${eventKind === 'comment' ? 'comment' : 'direct message'}: ${incoming}`)
  return lines.join('\n').slice(0, 6000)
}

export function matchSocialAutomations({ event, account, automations = [], bots = [] } = {}) {
  const accountId = id(account, 'id', 'id')
  const eventAccountId = id(event, 'account_id', 'accountId')
  const eventKind = value(event, 'event_kind', 'eventKind')
  const authorId = id(event, 'provider_author_id', 'authorId')
  const accountExternalId = id(account, 'external_id', 'externalId')
  const body = value(event, 'body', 'body')
  if (
    !accountId ||
    eventAccountId !== accountId ||
    !['comment', 'dm'].includes(eventKind) ||
    !authorId ||
    !accountExternalId ||
    authorId === accountExternalId ||
    typeof body !== 'string'
  ) return []

  const botBySlug = new Map(bots.map((bot) => [bot.slug, bot]))
  const matched = new Map()
  for (const automation of automations) {
    const automationId = id(automation, 'id', 'id')
    const automationAccountId = id(automation, 'account_id', 'accountId')
    const botSlug = id(automation, 'bot_slug', 'botSlug')
    const bot = botBySlug.get(botSlug)
    if (
      !automationId ||
      matched.has(automationId) ||
      automation.enabled !== true ||
      automationAccountId !== accountId ||
      value(automation, 'event_kind', 'eventKind') !== eventKind ||
      !socialBotAllowsAnonymousSubject(bot) ||
      !socialKeywordMatches(body, automation.keyword)
    ) continue
    matched.set(automationId, { automation, bot })
  }
  return [...matched.values()]
}
