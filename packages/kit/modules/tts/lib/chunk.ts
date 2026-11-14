/* text cut into the lengths the voice speaks at once: pure, so it is cheap to import where the engine is not wanted */
/* the Node example's chunkText, verbatim */
export function chunkText(text: string, maxLen = 300) {
  const paragraphs = text.trim().split(/\n\s*\n+/).filter((p: string) => p.trim())
  const chunks = []
  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim()
    if (!paragraph) continue
    const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/)
    let current = ''
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) current += (current ? ' ' : '') + sentence
      else { if (current) chunks.push(current.trim()); current = sentence }
    }
    if (current) chunks.push(current.trim())
  }
  return chunks
}
