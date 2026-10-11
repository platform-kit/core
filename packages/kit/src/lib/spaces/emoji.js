/*
 * THE EMOJI A ROOM OFFERS.
 *
 * Not the whole of Unicode. A full set is 1,800 characters and a megabyte of keywords, and what
 * anybody actually reaches for in a place of work is a couple of hundred — so this is a curated
 * set with the words people search by, which costs nothing to ship and can be read by a person.
 * A site that wants more adds to this file; there is no dataset to keep in step with a vendor.
 *
 * Pure: no imports, no DOM, no storage. The picker draws it, the composer inserts from it, a
 * message reacts with it, and `build/spaces.test.mjs` pins the searching.
 */

/* group → [emoji, the words somebody would type to find it] */
export const GROUPS = [
  ['reactions', [
    ['👍', 'yes ok agree thumbs up good'], ['👎', 'no disagree thumbs down bad'],
    ['🎉', 'party celebrate congratulations well done'], ['🙌', 'praise hands celebrate yes'],
    ['👏', 'clap applause well done bravo'], ['🙏', 'thanks please pray grateful'],
    ['❤️', 'love heart red'], ['🔥', 'fire hot great burning'],
    ['✅', 'done tick check yes complete'], ['❌', 'no cross wrong stop'],
    ['👀', 'eyes looking watching seen'], ['💯', 'hundred perfect exactly'],
    ['⭐', 'star favourite good'], ['🚀', 'rocket ship launch fast shipping'],
    ['💡', 'idea light bulb thought'], ['⚡', 'lightning fast quick power'],
    ['🏆', 'trophy win won best'], ['🎯', 'target bullseye exactly right'],
    ['👌', 'ok perfect fine good'], ['🤝', 'handshake deal agreed'],
    ['✨', 'sparkles magic new shiny'], ['💪', 'strong muscle effort'],
  ]],
  ['faces', [
    ['😀', 'smile happy grin'], ['😄', 'happy laugh smile'], ['😅', 'sweat laugh nervous phew relief awkward'],
    ['😂', 'laugh crying funny lol'], ['🙂', 'slight smile fine'], ['😉', 'wink joking'],
    ['😊', 'blush happy pleased'], ['😍', 'love hearts adore'], ['🤔', 'thinking hmm wondering'],
    ['🤨', 'raised eyebrow doubt suspicious'], ['😐', 'neutral no comment'],
    ['😴', 'sleep tired bored'], ['😭', 'cry sob sad'],
    ['😬', 'grimace awkward yikes'], ['🤯', 'mind blown exploding head wow'],
    ['🥳', 'party face celebrate birthday'], ['😎', 'cool sunglasses'],
    ['🤷', 'shrug dont know whatever'], ['🫠', 'melting overwhelmed'],
    ['😤', 'determined frustrated steam'], ['🥺', 'pleading please begging'],
  ]],
  ['work', [
    ['📌', 'pin pinned important'], ['📎', 'clip attachment file'], ['📝', 'note write memo'],
    ['📄', 'document page file'], ['📊', 'chart figures numbers data'], ['📈', 'growth up chart rising'],
    ['📉', 'down chart falling loss'], ['🗓️', 'calendar date schedule'], ['⏰', 'alarm time deadline'],
    ['⏳', 'waiting hourglass time'], ['🔗', 'link url'], ['🔒', 'locked private secure'],
    ['🔓', 'unlocked open'], ['🔑', 'key access password'], ['🛠️', 'tools fix build'],
    ['🐛', 'bug broken defect'], ['🚨', 'alert urgent siren emergency'], ['⚠️', 'warning careful caution'],
    ['📣', 'announce shout news megaphone'], ['💬', 'chat message talk speech'],
    ['📥', 'inbox received'], ['📤', 'outbox sent'], ['🗑️', 'bin delete trash rubbish'],
    ['💰', 'money paid sale revenue'], ['💳', 'card payment checkout'], ['📦', 'parcel package shipping order'],
    ['🚚', 'delivery van shipped'], ['🧾', 'receipt invoice bill'],
  ]],
  ['things', [
    ['📚', 'books library reading'], ['📖', 'book open reading'], ['✏️', 'pencil edit write'],
    ['🎧', 'headphones audio listening'], ['🎙️', 'microphone recording podcast'],
    ['☕', 'coffee break morning'], ['🍵', 'tea'], ['🍰', 'cake birthday'],
    ['🌱', 'seedling growth new'], ['🌞', 'sun day bright'], ['🌙', 'moon night'],
    ['🌊', 'wave water ocean'], ['🏔️', 'mountain peak'], ['🧘', 'meditate calm practice yoga'],
    ['🕯️', 'candle light quiet'], ['🔔', 'bell notification'], ['🔕', 'muted no notifications'],
    ['🎵', 'music note'], ['🖼️', 'picture image frame'], ['🗺️', 'map plan journey'],
  ]],
]

/* every one, flat, in the order the groups declare them */
export const ALL = GROUPS.flatMap(([group, list]) => list.map(([emoji, words]) => ({ emoji, words, group })))

/*
 * Searching is on the WORDS, not on the character: nobody types 🔥 to find 🔥. A query matches
 * when every word of it is the start of one of an emoji's words — so "fi" finds fire and "well
 * done" finds both 🎉 and 👏, and a stray letter narrows rather than widening.
 */
export function search(q, { limit = 60 } = {}) {
  const terms = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return ALL.slice(0, limit)
  const out = []
  for (const e of ALL) {
    const words = e.words.split(' ')
    if (terms.every((t) => words.some((w) => w.startsWith(t)))) out.push(e)
    if (out.length >= limit) break
  }
  return out
}

/* what somebody reached for last, newest first and never twice — the list a picker opens on */
export function remember(recent, emoji, { keep = 16 } = {}) {
  const e = String(emoji || '')
  if (!e) return recent || []
  return [e, ...(recent || []).filter((x) => x !== e)].slice(0, keep)
}
