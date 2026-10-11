/*
 * A MESSAGE THAT OFFERS CHOICES — one grammar, every surface.
 *
 * A support prompt's markdown may end with a `- ` list, and the widget draws each as a button. It
 * was a finished, tested mechanism living in one place: the prompts' compile. A bot could not use
 * it, so everything a bot wanted somebody to do next — pick a book, choose a format, say which
 * order — had to be typed back in prose and guessed at.
 *
 * So the grammar lives here instead, under nobody's surface, and the desk's prompts, a bot's
 * answer in a room and a bot's answer on a desk all read and write it with these functions.
 *
 * The grammar is markdown: a closing list, nested by two spaces, each line optionally pointing
 * somewhere with an arrow. A model writing one is writing markdown rather than learning a syntax,
 * and a bot that writes a list by accident gets buttons that say exactly what its list said —
 * which is the right failure. Nothing here knows about a database, a component or a request.
 */

/* WHAT WILL BE DRAWN AS BUTTONS, and what is left as a list. A cap is not a style rule: eleven
   options is not a choice, and a paragraph on a button is not a label. Over either, the list is
   not cut at all — the reader still reads it, as a list, which is the honest failure. */
export const CHOICE_CAP = { many: 6, chars: 70, deep: 3 }

/* the markdown's closing `- ` list → { text, choices: [{ key, text }] }; the key is the words, slugged */
export const choiceKey = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
/* A prompt's choices are a tree: a `- ` list closing its markdown, nested by two spaces —
 *   - I have questions about coaching
 *     - how much does it cost?
 *   - Other
 * each choice { key, text, children }, the key a slug of its words under its parent's
 * (`i-have-questions-about-coaching/how-much-does-it-cost`), so a pick anywhere in the tree is one
 * name in the analytics and one line the function can look up (findChoice). A click sends the
 * choice's words as the reader's line and, when it has children, offers those next. */
export function joinChoices(text, choices) {
  const line = String(text || '').replace(/\s+$/, '')
  const rows = []
  const walk = (list, depth) => { for (const c of list || []) { const t = String(typeof c === 'string' ? c : c && c.text || '').trim(); if (!t) continue; rows.push('  '.repeat(depth) + '- ' + t); walk(typeof c === 'string' ? [] : c.children, depth + 1) } }
  walk(choices, 0)
  return line + (rows.length ? '\n\n' + rows.join('\n') : '')
}
export function splitChoices(body) {
  const lines = String(body || '').replace(/\s+$/, '').split('\n')
  const rows = []
  while (lines.length && /^\s*[-*]\s+\S/.test(lines[lines.length - 1])) { const l = lines.pop(); const m = /^(\s*)[-*]\s+(.*)$/.exec(l); rows.unshift({ depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), text: m[2].trim() }) }
  const root = { children: [], key: '' }
  const stack = [root]
  for (const r of rows) {
    const depth = Math.min(r.depth, stack.length - 1)
    stack.length = depth + 1
    const parent = stack[depth]
    /* A CHOICE MAY OPEN A FORM, or go somewhere. "Report a problem → the form" is the whole of
       what a desk with no chatbot needs: a statically written prompt that still collects the four
       things nobody wants to ask one at a time over three days.
           - Report a problem -> form:report
           - Read the refund policy -> /content/docs/refunds
       The arrow and what follows come off the text, so the button still says what it says. */
    const m2 = /^(.*?)\s*->\s*(\S+)\s*$/.exec(r.text)
    const label = m2 ? m2[1].trim() : r.text
    const to = m2 ? m2[2] : ''
    const node = { key: (parent.key ? parent.key + '/' : '') + choiceKey(label), text: label, children: [] }
    if (to.startsWith('form:')) node.form = to.slice(5)
    else if (to) node.href = to
    parent.children.push(node)
    stack.push(node)
  }
  return { text: lines.join('\n').replace(/\s+$/, ''), choices: root.children }
}
/* a choice by its key path, anywhere in the tree */
export function findChoice(choices, key) {
  for (const c of choices || []) { if (c.key === key) return c; const d = findChoice(c.children, key); if (d) return d }
  return null
}


/*
 * A BOT'S ANSWER MAY END IN CHOICES, in this same grammar. Which set is live is a rule rather than
 * a flag on a row: it is the LAST thing said, it was the bot, and its last lines are a list.
 *
 * Only the last, because a button under an answer from last Tuesday offers a route the conversation
 * has long since left — and because the reader typing anything at all is how they decline, so the
 * buttons must go when they do. Nothing is stored: the same answer read again tomorrow offers the
/*
 * THE CUT, as the server makes it on the way into the row. The text is stored as text and the
 * choices apart from it, so nothing downstream reparses markdown to know what was offered and no
 * reader is ever shown the grammar — the arrow that points a choice at a form read as an arrow and
 * a path, the one time the widget cut at render.
 *
 * Over the cap it is not a list of choices, it is a list, and it stays in the text.
 */
export function cutAnswer(body, cap = CHOICE_CAP) {
  const out = splitChoices(body)
  if (!out.choices.length) return { text: String(body || ''), choices: [] }
  /* AND A LIST IS NOT AN OFFER ON ITS OWN. An answer that is all list — a summary in bullets, a set
     of steps — has nothing for the buttons to sit under, and cutting it leaves a message with no
     words at all: the insert is refused, or worse it is not and the room shows an empty line.
     Something has to have been said before there is anything to answer. */
  if (!out.text.trim()) return { text: String(body || ''), choices: [] }
  let many = 0, worst = 0, deep = 0
  const walk = (list, d) => { deep = Math.max(deep, d); for (const c of list) { many++; worst = Math.max(worst, c.text.length); walk(c.children || [], d + 1) } }
  walk(out.choices, 1)
  if (many > cap.many || worst > cap.chars || deep > cap.deep) return { text: String(body || ''), choices: [] }
  return out
}

/*
 * WHICH OFFER IS LIVE. A set is spent once it has been answered — the row says so, written by one
 * function, so two tabs and two people in a room cannot both take the same offer — and also once
 * anybody has said anything after it, because a button under an answer from last Tuesday offers a
 * route the conversation left long ago. Spent is not hidden: the buttons stay under their own
 * answer, dead, so the thread still reads as what was offered and what was taken.
 */
export function offerOf(messages, { at = null, answered = (m) => m.choice_at } = {}) {
  const list = messages || []
  const i = at == null ? list.length - 1 : list.findIndex((m) => m.id === at)
  const m = list[i]
  if (!m || !(m.choices && m.choices.length)) return null
  const after = list.slice(i + 1).some((x) => x && !x.deleted_at)
  return { id: m.id, choices: m.choices, live: !answered(m) && !after && !m.deleted_at }
}
