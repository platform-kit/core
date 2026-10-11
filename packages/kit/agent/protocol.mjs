export const INPUT_TOPIC = 'copilot.input'
export const OUTPUT_TOPIC = 'copilot.output'

export function inputOf(payload) {
  let value
  try {
    value = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    return null
  }
  if (!value || typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id)) return null
  if (typeof value.text !== 'string' || !value.text.trim()) return null
  return { id: value.id, text: value.text.trim().slice(0, 4000) }
}

export function assistantText(item) {
  if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) return ''
  return item.content.filter((part) => typeof part === 'string').join('').trim()
}
