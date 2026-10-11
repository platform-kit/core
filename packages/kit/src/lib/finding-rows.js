/* Find your book, from the session's rows: the latest text for each sentence, and the latest finding
   (the ranked slugs the round wrote when it closed). Apart from finding.js so a reader of the rows
   (the hub, a results model) never loads the teachings index. */
import { S } from '../instrument/engine/session.js'
export function findingAnswers() {
  const out = {}
  for (const r of S.resp.books || []) {
    if (!r.key) continue
    if (r.choice) { out[r.key] = r.choice; out[r.key + '_text'] = r.text || '' }
    else if (typeof r.text === 'string') { out[r.key] = r.text; if (r.prompt) out[r.key + '_prompt'] = r.prompt }
  }
  return out
}
export function findingResult() {
  let found = null
  for (const r of S.resp.books || []) if (r.id === 'found' && Array.isArray(r.books)) found = r
  return found ? { books: found.books, at: found.ts } : null
}
