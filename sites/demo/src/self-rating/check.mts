/*
 * A self-rating lesson's ref, checked at build time: the question the reader rates themselves on, asked as a question.
 */
export default function check(ref: string): string | null {
  const q = String(ref || '').trim()
  if (!q.endsWith('?')) return `a self-rating asks a question; "${q}" does not end in one`
  if (q.length > 140) return 'a self-rating question is at most 140 characters'
  return null
}
