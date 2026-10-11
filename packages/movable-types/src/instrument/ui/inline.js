/*
 * The little markdown a statement may carry: **bold**, *italic* (or _italic_)
 * and __underline__ — nothing else. A statement is one sentence, so this is
 * all the formatting it needs, and it is applied everywhere the sentence is
 * shown: the round's screens, the sheet's statement list, the area reads.
 *
 * The text is HTML-escaped first, then the marks are turned into tags, so a
 * sentence can never carry markup of its own. `__` is underline here rather
 * than CommonMark's second bold, because bold already has `**` and a sentence
 * has no other way to say underline.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* escaped text with the marks as tags */
export function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>')
}

/* the sentence with its marks removed, for anywhere that shows plain text */
export function plain(text) {
  return String(text == null ? '' : text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1$2')
}
