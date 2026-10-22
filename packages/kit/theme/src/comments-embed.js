/*
 * DISQUS'S UNIVERSAL EMBED, ANSWERED BY THIS SITE — AS A FRAME.
 *
 * Somebody with a Disqus thread on their page has this in it:
 *
 *   <div id="disqus_thread"></div>
 *   <script>
 *     var disqus_config = function () {
 *       this.page.url = 'https://their-site/a-post'
 *       this.page.identifier = 'a-post'
 *     }
 *     ;(function() {
 *       var d = document, s = d.createElement('script')
 *       s.src = 'https://THIS-SITE/packs/js/comments.js'
 *       ;(d.head || d.body).appendChild(s)
 *     })()
 *   </script>
 *
 * …and changing one line of it — the src — moves the conversation here. That is the whole point of
 * answering somebody else's shape rather than inventing one: nobody has to learn anything.
 *
 * WHAT THIS SCRIPT IS NOW. It draws an IFRAME of our own page (/embed/comments) and sizes it. It
 * used to mount the thread itself, and that could only ever be read: a script in somebody else's
 * page runs on THEIR origin, and the reader's session lives on ours, so everybody was a guest and a
 * guest may not comment. A thread nobody can join is half a comment system. Inside a frame of ours
 * the session is ours to read and the sign-in is ours to offer, every policy behaves exactly as it
 * does on the site, and — the part worth having for its own sake — no Vue, no stylesheet and no
 * code of ours runs in the host page at all. It is a few hundred bytes and an iframe.
 *
 * A browser partitions storage by the top-level site, so signing in inside the frame signs somebody
 * in for THAT site and no other. That is right rather than a shortcoming: a reader who signed in
 * under one publisher's article has not signed in everywhere the embed appears.
 *
 * What is honoured, because it is what people actually use:
 *   #disqus_thread                the element the frame is drawn into
 *   disqus_config                 a function called with this.page.{identifier, url, title}
 *   data-* on the script tag      data-kind, data-subject — ours, for a page that would rather say
 *                                 it outright than write a config function
 *   DISQUS.reset({ reload, config })   a single-page app telling it the page changed
 *   .disqus-comment-count         spans whose href or data-disqus-identifier names a thread; their
 *                                 text becomes the count, as Disqus's count.js does
 *
 * What is NOT honoured, and says so rather than pretending: Disqus's shortname (this site IS the
 * forum, so there is nothing to name), SSO, and the moderation API.
 *
 * ANYBODY WHO WOULD RATHER NOT RUN A SCRIPT AT ALL can write the frame themselves — it is a URL:
 *
 *   <iframe src="https://THIS-SITE/embed/comments?kind=page&subject=/a-post&title=A%20post"
 *           style="width:100%;border:0" height="600" loading="lazy"></iframe>
 *
 * …and size it themselves, or listen for the same message this script listens for.
 */

const SCRIPT = document.currentScript || [...document.querySelectorAll('script[src*="comments.js"]')].pop()
const D = (SCRIPT && SCRIPT.dataset) || {}

/* the site this script came from: the frame is a page of THAT site, whichever page we are on */
const BASE = (() => {
  try { return new URL(SCRIPT.src, location.href).origin } catch (e) { return '' }
})()

/* what Disqus's config function says, read the way Disqus reads it */
function pageConfig(fn) {
  const page = { identifier: '', url: '', title: '' }
  const f = fn || window.disqus_config
  if (typeof f === 'function') {
    try { f.call({ page, callbacks: {} }) } catch (e) { /* their function, their problem: carry on */ }
  }
  return page
}

const kindOf = () => String(D.kind || window.disqus_kind || 'page')
/* THE IDENTIFIER IS THE SUBJECT, and a page that gives none uses its own path — which is what
   Disqus falls back to as well, so two pages at the same address share a thread and moving a page
   moves its conversation, exactly as it does there. */
const subjectOf = (page) => String(D.subject || page.identifier || page.url || location.pathname)

let frame = null
function draw(el, page) {
  const q = new URLSearchParams({
    kind: kindOf(),
    subject: subjectOf(page),
    title: page.title || document.title || '',
    url: page.url || location.href || '',
  })
  const src = BASE + '/embed/comments?' + q.toString()
  if (frame && frame.isConnected) { frame.src = src; return }
  el.innerHTML = ''
  frame = document.createElement('iframe')
  frame.src = src
  frame.title = 'Comments'
  frame.loading = 'lazy'
  /* the frame is a page of ours and needs nothing of the host's: no top navigation, no downloads */
  frame.setAttribute('allow', 'clipboard-write')
  frame.style.cssText = 'width:100%;border:0;display:block;min-height:180px;color-scheme:normal'
  frame.height = '240'
  el.appendChild(frame)
}

/* HOW TALL IT IS. An iframe cannot size itself, so the page it is on does it: our own page inside
   says how tall it has become and this sets it, and a thread that grows as somebody types a reply
   grows with it. Messages from anywhere else are ignored, and so is anything that is not a number. */
window.addEventListener('message', (e) => {
  if (BASE && e.origin !== BASE) return
  const d = e.data
  if (!d || d.platformkitComments !== true) return
  const h = Number(d.height)
  if (frame && isFinite(h) && h > 0 && h < 20000) frame.height = String(Math.ceil(h))
})

function mount(opts = {}) {
  const el = document.getElementById('disqus_thread') || document.getElementById('platformkit_comments')
  if (!el) { console.warn('[comments] no #disqus_thread on this page'); return }
  draw(el, pageConfig(opts.config))
  counts()
}

/* THE COUNTS, as Disqus's count.js writes them: every span with the class, its thread named by
   data-disqus-identifier or by the #disqus_identifier fragment of its href.
   This one is not a frame — a number inside somebody's sentence cannot be — so it is a plain read
   of a public count, straight at the read that answers it, with no client library in the way. */
const DB = { url: import.meta.env.VITE_SUPABASE_URL || '', key: import.meta.env.VITE_SUPABASE_ANON_KEY || '' }
async function counts() {
  const spans = [...document.querySelectorAll('.disqus-comment-count, .platformkit-comment-count')]
  if (!spans.length || !DB.url || !DB.key) return
  const want = [...new Set(spans.map((s) => s.dataset.disqusIdentifier
    || (s.getAttribute('href') || '').split('#disqus_thread')[0].split('#')[1] || '').filter(Boolean))]
  if (!want.length) return
  let n = {}
  try {
    const r = await fetch(DB.url + '/rest/v1/rpc/comment_counts', {
      method: 'POST',
      headers: { apikey: DB.key, authorization: 'Bearer ' + DB.key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_kind: kindOf(), p_subjects: want }),
    })
    n = r.ok ? (await r.json()) || {} : {}
  } catch (e) { return }
  for (const s of spans) {
    const id = s.dataset.disqusIdentifier || (s.getAttribute('href') || '').split('#')[1] || ''
    if (id in n) s.textContent = String(n[id])
  }
}

/* DISQUS.reset, for a single-page app that has changed page under us */
window.DISQUS = window.DISQUS || {}
window.DISQUS.reset = (opts = {}) => { if (opts.reload !== false) mount(opts) }
/* and our own name for the same thing, so a page need not pretend to be somebody else's */
window.PlatformKitComments = { mount, reset: window.DISQUS.reset, counts }

if (window.disqus_shortname) console.info('[comments] disqus_shortname is ignored — this site is the forum')

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount())
else mount()
