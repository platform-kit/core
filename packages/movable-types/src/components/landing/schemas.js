/*
 * What each landing section can be told — as zod schemas. The page builder
 * draws a form from them (shadcn-vue AutoForm), the admin server validates a
 * saved page against them, and `defaults` seeds a freshly added section. Keys
 * match SECTIONS in ./index.js; adding a section type means one component, one
 * registry line, and one entry here.
 *
 * zod/v3: AutoForm reads zod's v3 internals, and this file is imported by the
 * admin server too, so it stays on the v3 API deliberately.
 */
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import { z } from 'zod/v3'
import { SECTION_SCHEMAS as SITE_SCHEMAS, STAGE_SCHEMAS } from '#site/landing'   /* the site's own section types' schemas, and its stages' for the hero's visual (platformkit.config.js landing.schemas) */
import { forms as FORMS, models as MODELS } from '#content'   /* the forms a Form section may choose from; the models an Entries section may */
import { modules } from '#site'

const line = (label) => z.string().min(1, 'Required').describe(label)
const text = (label) => z.string().min(1, 'Required').describe(label)
const opt = (label) => z.string().describe(label).optional()   /* may be blank */
const bar = (label) => z.number().int().min(0).max(100).describe(label)
const pic = (label) => z.string().describe(label).optional()   /* a picture: a url, or an upload */
const cols = (label, dflt) => z.number().int().min(2).max(4).describe(label).default(dflt)
const head = { badge: opt('Badge (a pill above the eyebrow)'), eyebrow: opt('Eyebrow'), heading: opt('Heading'), lead: opt('Lead') }   /* the words above a section */
const headCfg = { badge: { half: true }, eyebrow: { half: true }, heading: { component: 'textarea' }, lead: { component: 'textarea' } }
const link = { cta: opt('Button text'), href: opt('Button link') }
const linkCfg = { cta: { half: true }, href: { half: true, placeholder: '/…' } }
/* a glyph is a name — the theme's own (glyphs.js) or any of Lucide's the icons build step draws; the builder's picker searches them all */
const glyph = (label) => z.string().describe(label).default('spark')

/* the hero's visual: the kit's kinds, then the site's stages (landing.stages), each a component the hero mounts with `stage` as its props */
const STAGE_KEYS = Object.keys(STAGE_SCHEMAS || {})
const VISUAL_KINDS = ['none', 'image', 'video', 'frame', 'phone', 'laptop', ...STAGE_KEYS]

/* the forms by slug, for the Form section's choice; with none (or the module off) the section is not offered */
const FORM_SLUGS = (FORMS || []).map((f) => f.slug)
const FORM_SECTION = moduleOn('forms') && FORM_SLUGS.length ? {
  Form: {
    group: 'People',
    label: 'Form',
    description: 'One of the site\'s forms, inline on the page — its slides run here, its answers land in Forms → Responses',
    summary: (p) => p.form || '',
    defaults: { eyebrow: '', heading: '', lead: '', form: FORM_SLUGS[0] },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: opt('Heading'),
      lead: opt('Lead'),
      form: z.enum(FORM_SLUGS).describe('Form'),
    }),
    fieldConfig: { lead: { component: 'textarea' } },
  },
} : {}

/* the content models with the section delivery on, for the Entries section's choice; with none (or the module off) the section is not offered */
const ENTRY_MODELS = moduleOn('models') ? (MODELS || []).filter((m) => m.deliver && m.deliver.section).map((m) => m.key) : []
const ENTRIES_SECTION = ENTRY_MODELS.length ? {
  Entries: {
    group: 'From the site',
    label: 'Entries',
    description: 'A content model\'s entries — as cards or a list, as many as you say, in the model\'s order, each linking to its page when the model has pages',
    summary: (p) => p.model || '',
    defaults: { eyebrow: '', heading: '', lead: '', model: ENTRY_MODELS[0], layout: 'cards', limit: 0 },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: opt('Heading'),
      lead: opt('Lead'),
      model: z.enum(ENTRY_MODELS).describe('Model'),
      layout: z.enum(['cards', 'list']).describe('Layout'),
      limit: z.number().int().min(0).describe('How many (0 = all)'),
    }),
    fieldConfig: { lead: { component: 'textarea' } },
  },
} : {}

export const SECTION_SCHEMAS = {
  Hero: {
    group: 'Openers',
    label: 'Hero',
    description: 'The opening: a headline, a sub-line, a button and a quiet second one — and beside, below or behind the words a picture, a video, a screenshot in a browser window, a stage of the site\'s own, or nothing; with faces, a rating, stats, an email field, a floating card and a row of cards when the page has them',
    summary: (p) => (p.lines || []).join(' '),
    defaults: { layout: 'split', eyebrow: '', lines: ['A short line', 'that says what', 'this is for.'], sub: '', cta: 'Get started', href: '/app', cta2: '', href2: '', fine: '', visual: { kind: 'none', image: '', alt: '', video: '', poster: '' }, avatars: {}, rating: {}, stats: [], capture: {}, float: {}, cards: [] },
    schema: z.object({
      layout: z.enum(['split', 'centered', 'backdrop']).describe('Layout').default('split'),
      arrive: z.enum(['lines', 'words', 'none']).describe('The headline arrives').default('lines'),
      arrow: z.boolean().describe('A scroll arrow at the foot').default(false),
      eyebrow: opt('Eyebrow'),
      lines: z.array(z.string().min(1, 'Required')).min(1).describe('Headline lines'),
      sub: opt('Sub-line'),
      cta: line('Button text'),
      href: line('Button link'),
      cta2: opt('Second button text (quiet, beside the first)'),
      href2: opt('Second button link'),
      fine: opt('Fine print'),
      visual: z.object({
        kind: z.enum(VISUAL_KINDS).describe('What stands beside the words'),
        image: opt('Picture (for an image or a frame)'),
        alt: opt('What the picture shows, for a screen reader'),
        video: opt('Video — a file, or a YouTube, Vimeo or Loom address (plays muted, looping)'),
        poster: opt('Poster — a still shown before a file plays'),
      }).describe('The visual').optional(),
      avatars: z.object({ items: z.array(z.object({ image: pic('Face'), name: opt('Name') })).describe('The faces').optional(), line: opt('The line beside them') }).describe('Faces and a line, above the headline').optional(),
      rating: z.object({ stars: z.number().min(0).max(5).describe('Stars, 0 to 5').optional(), line: opt('The line beside the stars') }).describe('A rating, under the buttons').optional(),
      stats: z.array(z.object({ value: line('Number'), label: line('Label') })).describe('Stats under the words').optional(),
      capture: z.object({ form: opt('The form the address goes to'), button: opt('Button'), placeholder: opt('Placeholder'), fine: opt('Fine print') }).describe('An email field in place of the buttons').optional(),
      float: z.object({ value: opt('A number'), title: opt('A title'), line: opt('A line'), image: pic('A small picture') }).describe('A card floating over the visual').optional(),
      floats: z.array(z.object({ kind: z.enum(['card', 'chat', 'stat']).describe('Kind').default('card'), at: z.enum(['tl', 'tr', 'bl', 'br']).describe('Corner').default('br'), value: opt('A number'), title: opt('A title'), line: opt('A line'), image: pic('A small picture') })).describe('More cards over the visual').optional(),
      badges: z.object({ apple: opt('App Store link'), google: opt('Google Play link') }).describe('Store badges under the buttons').optional(),
      cards: z.array(z.object({ title: line('Title'), body: opt('One line'), image: pic('A small picture') })).describe('Cards under the hero').optional(),
    }),
    fieldConfig: {
      layout: { labels: { split: 'Split', centered: 'Centred, the visual below', backdrop: 'The visual behind the words' } },
      arrive: { half: true, labels: { lines: 'Line by line', words: 'Word by word', none: 'At once' } }, arrow: { half: true },
      lines: { item: 'line' },
      floats: { item: 'card', fields: { kind: { half: true, labels: { card: 'A card', chat: 'A chat bubble', stat: 'A number' } }, at: { half: true, labels: { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' } }, value: { half: true }, title: { half: true }, image: { component: 'image' } } },
      badges: { fields: { apple: { half: true }, google: { half: true } } },
      sub: { component: 'textarea', description: 'One or two sentences under the headline' },
      cta: { half: true }, href: { half: true, placeholder: '/app' },
      cta2: { half: true }, href2: { half: true, placeholder: '/pricing' },
      fine: { description: 'The small line beside the button' },
      visual: { fields: {
        kind: { labels: { none: 'Nothing', image: 'A picture', video: 'A video', frame: 'In a browser', phone: 'In a phone', laptop: 'On a laptop', ...Object.fromEntries(STAGE_KEYS.map((k) => [k, STAGE_SCHEMAS[k].label || k])) } },
        image: { component: 'image', when: (v) => ['image', 'frame', 'phone', 'laptop'].includes(v.kind) },
        alt: { when: (v) => ['image', 'frame', 'phone', 'laptop'].includes(v.kind) },
        video: { when: (v) => ['video', 'phone', 'laptop'].includes(v.kind), placeholder: 'https://www.youtube.com/watch?v=…' },
        poster: { component: 'image', when: (v) => v.kind === 'video' },
      } },
      avatars: { fields: { items: { item: 'face', fields: { image: { component: 'image' }, name: { half: true } } } } },
      rating: { fields: { stars: { half: true }, line: { half: true } } },
      stats: { item: 'stat', fields: { value: { half: true }, label: { half: true } } },
      capture: { fields: { form: { component: 'form', half: true }, button: { half: true }, placeholder: { half: true } } },
      float: { fields: { value: { half: true }, title: { half: true }, image: { component: 'image' } } },
      cards: { item: 'card', fields: { title: { half: true }, image: { component: 'image' }, body: { component: 'textarea' } } },
    },
    /* a stage's own words, under `stage`, drawn from that stage's schema only while it is the visual's kind */
    conditional: STAGE_KEYS.length ? { on: 'visual.kind', field: 'stage', schemas: STAGE_SCHEMAS } : null,
    presets: [
      { label: 'Words and a screenshot', props: { layout: 'split', visual: { kind: 'frame', image: '' } } },
      { label: 'Centred, the product below', props: { layout: 'centered', visual: { kind: 'frame', image: '' }, avatars: { items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], line: 'Loved by **2,000+** readers' } } },
      { label: 'Over a photograph', props: { layout: 'backdrop', visual: { kind: 'image', image: '' } } },
      { label: 'With an email field', props: { layout: 'split', capture: { form: '', button: 'Get the first chapter', placeholder: 'you@example.com', fine: 'No spam, ever.' }, rating: { stars: 5, line: '**4.9** from 1,200 readers' } } },
    ],
  },

  Marquee: {
    group: 'Openers',
    label: 'Marquee',
    description: 'The moving line between the hero and the rest: benefits and qualifiers taking turns (keep the two lists the same length)',
    summary: (p) => (p.benefits || []).slice(0, 3).join(' · '),
    defaults: { benefits: ['Read anywhere', 'Keep your place', 'Learn by chapter', 'Ask a coach'], qualifiers: ['Free to start', 'No credit card', 'Cancel anytime', 'Private & secure'] },
    schema: z.object({ benefits: z.array(line('A benefit')).describe('The benefits, one per slot'), qualifiers: z.array(line('A qualifier')).describe('The qualifiers, shown as badges between the benefits') }),
    fieldConfig: {},
  },


  How: {
    group: 'Content',
    label: 'How it works',
    description: 'An eyebrow, a heading, and three steps with an icon each',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: 'How it works', heading: 'Three steps, and you are reading.', steps: [{ icon: 'doc', tag: 'Step one', title: 'Pick a book', body: 'Open any title and read the first chapters free.' }, { icon: 'sun', tag: 'Step two', title: 'Keep what you learned', body: 'A short quiz after each chapter; your highlights kept.' }, { icon: 'bars', tag: 'Step three', title: 'Come back tomorrow', body: 'Your place is saved, on any device.' }] },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: text('Heading'),
      steps: z.array(z.object({
        icon: z.enum(['sun', 'bars', 'doc']).describe('Icon'),
        tag: line('Tag (small caps)'),
        title: line('Title'),
        body: text('Body'),
      })).describe('Steps').optional(),
    }),
    fieldConfig: { heading: { component: 'textarea' } },
  },



  Library: {
    group: 'From the site',
    label: 'The library, three ways in',
    description: 'A header, then one real chapter shown as the reader shows it — full text, modern summary, and the player — each with its promise',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: 'The library', heading: 'Every book, three ways in.', lead: '', book: '', chapter: '', formats: [], extras: [], bottomLabel: 'The bottom line', playerLabel: 'Listen to this chapter', fine: '', cta: '', href: '/content' },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: text('Heading'),
      lead: opt('Lead'),
      book: opt('Book slug'),
      chapter: opt('Chapter title (the first when empty)'),
      formats: z.array(z.object({ title: line('Format'), body: opt('Its promise, one line') })).describe('The three ways in: full text, summary, audiobook, in that order').optional(),
      extras: z.array(z.object({ title: line('Title'), body: opt('One line'), icon: opt('Glyph: lines, trophy, highlight, note, bookmark, search, type, place, audio') })).describe('What every book carries beyond its text, one callout each').optional(),
      bottomLabel: opt('Label over the summary card\'s bottom line'),
      playerLabel: opt('The player\'s eyebrow'),
      fine: opt('Fine print'),
      cta: opt('Button label'),
      href: opt('Button link'),
    }),
    fieldConfig: { heading: { component: 'textarea' }, lead: { component: 'textarea' } },
  },
  Coaching: {
    group: 'From the site',
    label: 'Coaching',
    description: 'Copy beside a picture of the session — a video call, coach and client — and the button that books one',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: 'One on one', heading: 'A coach, when you want one.', lead: '', call: { title: 'Session', live: 'Live', elapsed: '12:40', coach: 'Ada Finch', coachRole: 'Coach', coachVideo: '', client: 'You', clientRole: '', clientVideo: '', leave: 'Leave' }, cta: '', href: '/app/coaching', fine: '' },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: text('Heading'),
      lead: opt('Lead'),
      call: z.object({
        title: line('Window title'),
        live: opt('Live label'),
        elapsed: opt('Elapsed time'),
        coach: line('Coach name'),
        coachRole: opt('Coach role'),
        coachVideo: opt('Coach video (url of a short muted loop; blank = figure)'),
        coachImage: opt('Coach still, shown on phones instead of the video'),
        client: line('Client name'),
        clientRole: opt('Client role'),
        clientVideo: opt('Client video (url of a short muted loop; blank = figure)'),
        clientImage: opt('Client still, shown on phones instead of the video'),
        leave: opt('End-call button'),
      }).describe('The call mock').optional(),
      cta: opt('Button label'),
      href: opt('Booking link'),
      fine: opt('Line under the button'),
    }),
    fieldConfig: { heading: { component: 'textarea' }, lead: { component: 'textarea' } },
  },
  Pricing: {
    group: 'Commerce',
    label: 'Pricing',
    description: 'The value ladder: a column per rung — or a band across the row for a rung of another kind — each with a price, a line, what it includes, and a button',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: 'Pricing', heading: 'Simple, and you can leave.', lead: '', tiers: [], fine: '', featuredLabel: '', filter: { label: '', default: '', options: [] } },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: text('Heading'),
      lead: opt('Lead'),
      featuredLabel: opt('The flag on the featured rung (e.g. Most popular)'),
      layout: z.enum(['columns', 'rows', 'single', 'choice', 'selector']).describe('Layout').default('columns'),
      selectorLabel: opt('The word before the total (the selector)'),
      featuredTone: z.enum(['outline', 'ink', 'accent']).describe('The featured rung').default('outline'),
      compare: z.object({ heading: opt('Heading'), rows: z.array(z.object({ label: line('The row'), cells: z.array(z.string()).describe('A cell per rung: yes, no, or words') })).describe('The rows').optional() }).describe('A compare table under the rungs').optional(),
      filter: z.object({
        label: opt('What the toggle chooses, for a screen reader (e.g. Billing)'),
        default: opt('The tag shown first (else the first option)'),
        options: z.array(z.object({
          tag: line('Tag — the word the rungs carry'),
          label: line('Label on the toggle'),
        })).describe('Two or more make a toggle above the rungs; each shows the rungs tagged with it. Rungs with no tags show under every option.').optional(),
      }).describe('A toggle over the rungs by tag — weekly and monthly prices, say — or anything else the tags name').optional(),
      tiers: z.array(z.object({
        name: line('Name'),
        icon: opt('Glyph over the name'),
        from: opt('A word before the price ("from")'),
        price: opt('Price, as written (e.g. $333)'),
        per: opt('Billing period, optional (e.g. a month)'),
        tagline: opt('One line'),
        features: z.array(z.string()).describe('What it includes, one per line ("- " before a line it lacks: drawn crossed)').optional(),
        cta: opt('Button label'),
        sku: opt('Offer the button buys — a product file\'s sku (group-coaching-monthly); checkout starts here, whether or not the store is on'),
        href: opt('Button link, when the button does not buy'),
        featured: z.boolean().describe('The rung to draw attention to').optional(),
        wide: z.boolean().describe('Drawn as a band across the row, not a column — for a rung of a different kind (the free tier, a one-off)').optional(),
        tags: z.array(z.string()).describe('Words the toggle filters on (e.g. weekly); none means always shown').optional(),
      })).describe('The rungs, cheapest first; the columns run together, a wide rung breaks the row').optional(),
      fine: opt('Line under the columns'),
      ctaCurrent: opt('The button on the plan a subscriber is on (opens their billing portal), e.g. Subscribed'),
      ctaSwitch: opt('The button on the other plans for a subscriber, e.g. Switch to this plan'),
      switched: opt('Said after a switch; {name} is the plan'),
      ctaPending: opt('The button on the plan a step down is waiting for (pressing it calls the step down off); {date} is when it begins, e.g. From {date}'),
      switchedLater: opt('Said after a step down; {name} is the plan, {date} when it begins'),
      kept: opt('Said after a step down is called off; {name} is the plan they stay on'),
    }),
    fieldConfig: { heading: { component: 'textarea' }, lead: { component: 'textarea' }, layout: { half: true, labels: { columns: 'Columns', rows: 'Rows', single: 'One rung', choice: 'A choice list', selector: 'A selector that adds up' } }, selectorLabel: { half: true, when: (v) => v.layout === 'selector' }, featuredTone: { half: true, labels: { outline: 'Outlined', ink: 'In ink', accent: 'In the accent' } }, tiers: { item: 'rung', fields: { icon: { component: 'glyph' }, name: { half: true }, price: { half: true }, per: { half: true }, from: { half: true }, cta: { half: true }, sku: { half: true }, href: { half: true }, features: { item: 'line' }, tags: { item: 'tag' } } }, compare: { fields: { rows: { item: 'row', summary: (r) => r.label, fields: { cells: { item: 'cell', placeholder: 'yes · no · or words' } } } } } },
  },
  Creator: {
    group: 'People',
    label: 'The creator',
    description: 'A portrait and a name beside a statement in their own voice, a few facts, and the way to sit with them',
    summary: (p) => p.name || p.heading || '',
    defaults: { eyebrow: 'The editor', heading: 'Why I started this.', name: 'Ada Finch', role: 'Editor', image: '', statement: '', facts: [], cta: '', href: '', fine: '' },
    schema: z.object({
      eyebrow: opt('Eyebrow'),
      heading: text('Heading'),
      name: line('Name'),
      role: opt('Role (under the name)'),
      image: pic('Portrait (square works best)'),
      statement: opt('Statement, in the first person (markdown)'),
      facts: z.array(z.object({ label: line('Label'), body: opt('One line') })).describe('A few facts, label over line').optional(),
      cta: opt('Button label'),
      href: opt('Button link'),
      fine: opt('Line under the button'),
    }),
    fieldConfig: { heading: { component: 'textarea' }, statement: { component: 'textarea' }, image: { component: 'image' } },
  },
  Close: {
    group: 'Closers',
    label: 'Closing call',
    description: 'The last word and the button',
    summary: (p) => p.heading || '',
    defaults: { heading: 'Ready when you are.', cta: 'Get started', href: '/app' },
    schema: z.object({
      heading: text('Heading'),
      cta: line('Button text'),
      href: line('Button link'),
    }),
    fieldConfig: { heading: { component: 'textarea' }, href: { placeholder: '/app' } },
  },
}

/* the catalogue a marketing site expects — each generic, its defaults a plain example any site could ship */
/* the pieces a section may carry: proof, a capture, pictures */
const capture = z.object({ form: opt('The form the address goes to (one with an email field)'), button: opt('Button'), placeholder: opt('Placeholder'), fine: opt('Fine print under the field') }).describe('An email field').optional()
const captureCfg = { fields: { form: { component: 'form', half: true }, button: { half: true }, placeholder: { half: true } } }
const avatars = z.object({ items: z.array(z.object({ image: pic('Face'), name: opt('Name') })).describe('The faces').optional(), line: opt('The line beside them') }).describe('Faces and a line').optional()
const avatarsCfg = { fields: { items: { item: 'face', fields: { image: { component: 'image' }, name: { half: true } } } } }
const rating = z.object({ stars: z.number().min(0).max(5).describe('Stars, 0 to 5').optional(), line: opt('The line beside the stars') }).describe('A rating').optional()
const ratingCfg = { fields: { stars: { half: true }, line: { half: true } } }
const logosList = z.array(z.object({ name: line('Name'), image: pic('Logo'), href: opt('Link') })).describe('The logos').optional()
const logosCfg = { item: 'logo', fields: { image: { component: 'image' }, name: { half: true }, href: { half: true } } }
const points = z.array(z.object({ icon: glyph('Glyph'), text: line('Point') })).describe('Ticked points').optional()
const pointsCfg = { item: 'point', fields: { icon: { component: 'glyph' } } }

const CATALOGUE = {
  Cta: {
    group: 'Closers', label: 'Call to action', sketch: 'Cta',
    description: 'The ask — centred, split with a picture, a band, a slim bar, or two cards — with a button, an email field, ticks, faces, a rating, logos, store badges, whatever it needs',
    summary: (p) => p.heading || (p.cards || []).map((c) => c.title).join(' · '),
    defaults: { layout: 'centered', eyebrow: '', heading: 'Ready when you are.', lead: 'Read the first chapters of any book, free. Keep the rest when you like.', cta: 'Get started', href: '/app', cta2: '', href2: '', fine: '', capture: {}, points: [], avatars: {}, rating: {}, logos: [], badges: {}, image: '', alt: '', frame: false, cards: [] },
    schema: z.object({
      layout: z.enum(['centered', 'split', 'band', 'bar', 'cards', 'promo']).describe('Layout').default('centered'),
      from: opt('A "from" line beside the button (the promo)'),
      ...head, ...link, cta2: opt('Second button text'), href2: opt('Second button link'), fine: opt('Fine print'),
      capture, points, avatars, rating, logos: logosList,
      badges: z.object({ apple: opt('App Store link'), google: opt('Google Play link') }).describe('Store badges').optional(),
      image: pic('Picture (the split layout)'), alt: opt('What the picture shows'), frame: z.boolean().describe('The picture in a browser window').optional(),
      cards: z.array(z.object({ icon: glyph('Glyph'), title: line('Title'), body: opt('One line'), cta: opt('Button text'), href: opt('Button link') })).describe('The two cards (the cards layout)').optional(),
    }),
    fieldConfig: { ...headCfg, layout: { labels: { centered: 'Centred', split: 'Split', band: 'Band', bar: 'Bar', cards: 'Two cards', promo: 'A promo over a photograph' } }, from: { half: true, when: (v) => v.layout === 'promo' }, ...linkCfg, cta2: { half: true }, href2: { half: true }, capture: captureCfg, points: pointsCfg, avatars: avatarsCfg, rating: ratingCfg, logos: logosCfg, badges: { fields: { apple: { half: true }, google: { half: true } } },
      image: { component: 'image', when: (v) => v.layout === 'split' || v.layout === 'promo' }, alt: { when: (v) => v.layout === 'split' || v.layout === 'promo' }, frame: { when: (v) => v.layout === 'split' }, cards: { item: 'card', when: (v) => v.layout === 'cards', fields: { icon: { component: 'glyph' }, title: { half: true }, cta: { half: true }, href: { half: true }, body: { component: 'textarea' } } } },
    presets: [
      { label: 'Button', props: { layout: 'centered', heading: 'Ready when you are.', lead: 'Read the first chapters of any book, free.', cta: 'Get started', href: '/app' } },
      { label: 'Email field', props: { layout: 'centered', heading: 'Get the next chapter by email.', lead: 'One a week, on Sunday. Unsubscribe any time.', cta: '', capture: { form: '', button: 'Subscribe', placeholder: 'you@example.com', fine: 'No spam. Unsubscribe any time.' } } },
      { label: 'Band with ticks', props: { layout: 'band', tone: 'ink', heading: 'Everything, for one price.', cta: 'See the pricing', href: '/pricing', points: [{ icon: 'check', text: 'Every book, whole' }, { icon: 'check', text: 'Cancel any time' }, { icon: 'check', text: 'Read on any device' }] } },
      { label: 'Two cards', props: { layout: 'cards', cards: [{ icon: 'users', title: 'Join the community', body: 'Readers who finish books, talking about them.', cta: 'Join', href: '/app' }, { icon: 'mail', title: 'Write to us', body: 'A manuscript, a question, a note.', cta: 'Say hello', href: '/about' }] } },
    ],
  },
  Logos: {
    group: 'Proof', label: 'Logos',
    description: 'Names a reader trusts — "as seen in", "trusted by" — as a row, chips, beside the words, or a marquee; a rating line under them',
    summary: (p) => (p.logos || []).map((l) => l.name).filter(Boolean).slice(0, 4).join(' · '),
    defaults: { heading: 'Trusted by teams at', lead: '', layout: 'row', mono: true, rating: {}, logos: [{ name: 'Northwind', image: '' }, { name: 'Contoso', image: '' }, { name: 'Fabrikam', image: '' }, { name: 'Lakeshore', image: '' }, { name: 'Alpine', image: '' }] },
    schema: z.object({
      heading: opt('Heading (small, above the row)'), lead: opt('A line under it (the beside layout)'),
      layout: z.enum(['row', 'chips', 'beside', 'marquee', 'tiles']).describe('Layout').default('row'),
      mono: z.boolean().describe('One ink until hovered').default(true),
      rating, logos: logosList,
    }),
    fieldConfig: { layout: { labels: { row: 'A row', chips: 'Chips', beside: 'Beside the words', marquee: 'A marquee', tiles: 'Tiles' } }, rating: ratingCfg, logos: logosCfg },
  },
  Features: {
    group: 'Content', label: 'Features',
    description: 'What it does — as cards, plain columns, a bordered grid, a ticked list beside a screenshot, or a showcase under one big picture — a glyph, a title, a line each, a picture and a link when it has one',
    summary: (p) => p.heading || (p.items || []).map((f) => f.title).slice(0, 3).join(' · '),
    defaults: { eyebrow: 'What you get', heading: 'Everything you need, nothing you don\'t.', lead: '', columns: 3, variant: 'cards', image: '', alt: '', side: 'right', cta: '', href: '',
      items: [{ icon: 'bolt', title: 'Fast to start', body: 'Up and running in an afternoon, with sensible defaults for everything.' }, { icon: 'shield', title: 'Safe by default', body: 'Your data stays yours. Nothing leaves without your say-so.' }, { icon: 'users', title: 'Made for teams', body: 'Invite the whole team; everyone sees the same thing.' }] },
    schema: z.object({
      ...head,
      variant: z.enum(['cards', 'plain', 'bordered', 'list', 'showcase', 'flip', 'around']).describe('Drawn as').default('cards'),
      tilt: z.boolean().describe('The cards turn toward the pointer').default(false),
      columns: cols('Across', 3),
      image: pic('The screenshot (the list and showcase layouts)'), alt: opt('What it shows'),
      side: z.enum(['left', 'right']).describe('The screenshot\'s side (the list)').default('right'),
      ...link,
      items: z.array(z.object({ icon: glyph('Glyph'), title: line('Title'), body: opt('One line'), image: pic('Picture at the top'), href: opt('Link'), link: opt('Link text'), highlight: z.boolean().describe('Highlighted').optional() })).describe('The features').optional(),
    }),
    fieldConfig: { ...headCfg, variant: { labels: { cards: 'Cards', plain: 'Plain columns', bordered: 'A bordered grid', list: 'A list beside a screenshot', showcase: 'A showcase', flip: 'Flip cards', around: 'Around a picture' } }, tilt: { half: true, when: (v) => v.variant === 'cards' }, columns: { half: true, when: (v) => v.variant !== 'list' && v.variant !== 'around' }, side: { half: true, labels: { left: 'Left', right: 'Right' }, when: (v) => v.variant === 'list' },
      image: { component: 'image', when: (v) => ['list', 'showcase', 'around'].includes(v.variant) }, alt: { when: (v) => ['list', 'showcase', 'around'].includes(v.variant) }, cta: { half: true, when: (v) => v.variant === 'list' }, href: { half: true, when: (v) => v.variant === 'list' },
      items: { item: 'feature', fields: { icon: { component: 'glyph' }, title: { half: true }, href: { half: true }, link: { half: true }, body: { component: 'textarea' }, image: { component: 'image' } } } },
  },
  Split: {
    group: 'Content', label: 'Split',
    description: 'One thing said large: a picture beside a passage, the picture left or right, a few points and a button',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: '', heading: 'Write it once. Publish it everywhere.', body: 'Draft in the editor, press publish, and the page, the feed and the newsletter all say the same thing.', image: '', alt: '', side: 'left', points: [{ icon: 'check', text: 'One source of truth' }, { icon: 'check', text: 'Every channel, the same words' }], cta: '', href: '' },
    schema: z.object({
      eyebrow: opt('Eyebrow'), heading: opt('Heading'),
      body: opt('The passage (markdown)'),
      image: pic('Picture'), alt: opt('What the picture shows'),
      side: z.enum(['left', 'right']).describe('The picture\'s side').default('left'),
      points, ...link,
    }),
    fieldConfig: { heading: { component: 'textarea' }, body: { component: 'markdown' }, image: { component: 'image' }, side: { half: true, labels: { left: 'Left', right: 'Right' } }, alt: { half: true }, points: pointsCfg, ...linkCfg },
  },
  Stats: {
    group: 'Proof', label: 'Stats',
    description: 'Three or four numbers with a label each — as a row, as cards, or beside the words — and a line under them',
    summary: (p) => (p.stats || []).map((s) => (s.stars ? s.stars + '★' : s.value) + ' ' + (s.label || '')).slice(0, 3).join(' · '),
    defaults: { eyebrow: '', heading: '', lead: '', layout: 'row', stats: [{ value: '12,000+', label: 'Readers' }, { value: '48', label: 'Books' }, { value: '4.9', label: 'Average rating', note: 'from 1,200 reviews' }], fine: '' },
    schema: z.object({ ...head, layout: z.enum(['row', 'cards', 'beside', 'serif']).describe('Layout').default('row'), animate: z.boolean().describe('The numbers count up as they come into view').default(false), stats: z.array(z.object({ value: opt('The number, as written'), stars: z.number().min(0).max(5).describe('Or stars, 0 to 5').optional(), label: line('Label'), note: opt('A note under it'), icon: glyph('Glyph (the cards)') })).describe('The numbers').optional(), fine: opt('Line under the numbers') }),
    fieldConfig: { ...headCfg, layout: { labels: { row: 'A row', cards: 'Cards', beside: 'Beside the words', serif: 'Number and word' } }, animate: { half: true }, stats: { item: 'number', fields: { value: { half: true }, stars: { half: true }, label: { half: true }, note: { half: true }, icon: { component: 'glyph' } } } },
  },
  Testimonials: {
    group: 'Proof', label: 'Testimonials',
    description: 'What readers say — a grid, a wall, one at a time, a switcher with the faces, or a marquee — a quote, a name, a role, a face, stars, a logo each; a stat or two beside the big one',
    summary: (p) => (p.items || []).map((t) => t.name).filter(Boolean).slice(0, 3).join(' · '),
    defaults: { eyebrow: 'In their words', heading: '', lead: '', layout: 'grid', columns: 3, more: '', moreHref: '', items: [{ quote: 'I finished a book for the first time in years — in one evening.', name: 'Maya Chen', role: 'Reader since 2024', image: '', stars: 5 }, { quote: 'The summaries are honest. Nothing is dumbed down.', name: 'Ola Berg', role: 'Teacher', image: '', stars: 5 }, { quote: 'Every chapter ends with something I can actually do.', name: 'Sam Reyes', role: 'Designer', image: '', stars: 5 }] },
    schema: z.object({ ...head, layout: z.enum(['grid', 'wall', 'one', 'switcher', 'marquee', 'tweets', 'bubbles', 'photo', 'faces', 'stack']).describe('Shown as').default('grid'), columns: cols('Across (the grid)', 3), more: opt('A link under them ("See all 120 reviews")'), moreHref: opt('Where it goes'),
      items: z.array(z.object({ quote: text('The quote (**bold** the phrase to highlight)'), name: line('Name'), role: opt('Role'), handle: opt('Handle (the tweets)'), video: opt('A video (the faces: a file, or an embed address)'), image: pic('Face'), stars: z.number().min(0).max(5).describe('Stars').optional(), logo: pic('Their company\'s logo'), stats: z.array(z.object({ value: line('Number'), label: line('Label') })).describe('Stats beside the quote (one at a time)').optional() })).describe('The quotes').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { grid: 'A grid', wall: 'A wall', one: 'One at a time', switcher: 'A switcher', marquee: 'A marquee', tweets: 'Tweets', bubbles: 'Bubbles', photo: 'A photo beside', faces: 'A grid of faces', stack: 'A stack' } }, columns: { half: true, when: (v) => v.layout === 'grid' }, more: { half: true }, moreHref: { half: true },
      items: { item: 'quote', fields: { quote: { component: 'textarea' }, name: { half: true }, role: { half: true }, handle: { half: true }, stars: { half: true }, video: { half: true }, image: { component: 'image' }, logo: { component: 'image' }, stats: { item: 'stat', fields: { value: { half: true }, label: { half: true } } } } } },
  },
  FAQ: {
    group: 'Proof', label: 'FAQ',
    description: 'Questions that open to their answers — beside the words, stacked, laid open in two columns, or beside a picture — and a "still have questions?" card',
    summary: (p) => p.heading || ((p.items || []).length + ' questions'),
    defaults: { eyebrow: 'Questions', heading: 'Asked often', lead: '', layout: 'beside', image: '', alt: '', more: {}, items: [{ question: 'Do I need an account to read?', answer: 'Not for the first chapters. An account keeps your place and your highlights.' }, { question: 'Can I cancel any time?', answer: 'Yes. Cancel from your account and you keep access to the end of the period.' }] },
    schema: z.object({ ...head, layout: z.enum(['beside', 'stacked', 'columns', 'picture', 'icons', 'gallery']).describe('Layout').default('beside'), prefix: opt('A mark before each question ("Q.")'), image: pic('Picture (the picture and gallery layouts)'), alt: opt('What it shows'),
      items: z.array(z.object({ question: line('Question'), answer: text('Answer (markdown)'), image: pic('Its own picture (the gallery)') })).describe('The questions').optional(),
      more: z.object({ heading: opt('Heading'), body: opt('One line'), cta: opt('Button text'), href: opt('Button link'), faces: z.array(z.object({ image: pic('Face'), name: opt('Name') })).describe('Faces above the words').optional() }).describe('Still have questions?').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { beside: 'Words beside the list', stacked: 'Words above', columns: 'Laid open, two columns', picture: 'Beside a picture', icons: 'Two columns with a mark', gallery: 'A picture per question' } }, prefix: { half: true }, image: { component: 'image', when: (v) => v.layout === 'picture' || v.layout === 'gallery' }, alt: { when: (v) => v.layout === 'picture' || v.layout === 'gallery' }, items: { item: 'question', summary: (q) => q.question, fields: { answer: { component: 'textarea' }, image: { component: 'image' } } }, more: { fields: { heading: { half: true }, body: { half: true }, cta: { half: true }, href: { half: true }, faces: { item: 'face', fields: { image: { component: 'image' }, name: { half: true } } } } } },
  },
  Team: {
    group: 'People', label: 'Team',
    description: 'The people — a grid of portraits, a row of circles, rows with a bio, or one photograph of everyone — a name, a role, a line, links each',
    summary: (p) => (p.people || []).map((x) => x.name).filter(Boolean).slice(0, 4).join(' · '),
    defaults: { eyebrow: 'The team', heading: '', lead: '', layout: 'grid', columns: 3, image: '', alt: '', cta: '', href: '', people: [{ name: 'Ada Finch', role: 'Editor', image: '', bio: '', links: [] }, { name: 'Tomas Reyes', role: 'Design', image: '', bio: '', links: [] }, { name: 'Maren Ekholm', role: 'Words', image: '', bio: '', links: [] }] },
    schema: z.object({ ...head, layout: z.enum(['grid', 'circles', 'rows', 'photo', 'mono', 'tiles', 'marquee', 'solo']).describe('Layout').default('grid'), columns: cols('Across', 3), image: pic('The photograph (the photo layout)'), alt: opt('What it shows'), ...link, logos: z.array(z.object({ name: line('Name'), image: pic('Logo') })).describe('Logos under the people (mono)').optional(),
      people: z.array(z.object({ name: line('Name'), role: opt('Role'), image: pic('Portrait'), bio: opt('A line about them'), links: z.array(z.object({ label: line('Label (LinkedIn, X, GitHub, Instagram, Mail draw a glyph)'), href: line('Link') })).describe('Links').optional() })).describe('The people').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { grid: 'A grid', circles: 'Circles', rows: 'Rows', photo: 'One photograph', mono: 'Black and white, logos under', tiles: 'Tiles with names', marquee: 'A marquee of circles', solo: 'One person, large' } }, logos: { item: 'logo', when: (v) => v.layout === 'mono', fields: { image: { component: 'image' } } }, columns: { half: true, when: (v) => v.layout === 'grid' || v.layout === 'circles' }, image: { component: 'image', when: (v) => v.layout === 'photo' }, alt: { when: (v) => v.layout === 'photo' }, cta: { half: true, when: (v) => v.layout === 'photo' }, href: { half: true, when: (v) => v.layout === 'photo' },
      people: { item: 'person', items: 'people', fields: { name: { half: true }, role: { half: true }, image: { component: 'image' }, bio: { component: 'textarea' }, links: { item: 'link', fields: { label: { half: true }, href: { half: true } } } } } },
  },
  Compare: {
    group: 'Proof', label: 'Compare',
    description: 'A table: a column per plan or product, a row per thing, a tick, a cross or words in each cell',
    summary: (p) => (p.columns || []).map((c) => c.name).join(' vs '),
    defaults: { eyebrow: '', heading: 'Which one is for you?', lead: '', columns: [{ name: 'Free', note: '$0' }, { name: 'Member', note: '$9 a month', featured: true, cta: 'Join', href: '/pricing' }, { name: 'Print', note: 'from $24' }],
      rows: [{ label: 'The first chapters', cells: ['yes', 'yes', 'yes'] }, { label: 'Every book, whole', cells: ['no', 'yes', 'One book'] }, { label: 'Highlights kept', cells: ['no', 'yes', 'no'] }, { label: 'On the shelf', cells: ['no', 'no', 'yes'] }] },
    schema: z.object({ ...head,
      columns: z.array(z.object({ name: line('Name'), note: opt('Under the name'), featured: z.boolean().describe('Marked').optional(), cta: opt('Button text'), href: opt('Button link') })).describe('The columns').optional(),
      rows: z.array(z.object({ label: line('The row'), cells: z.array(z.string()).describe('A cell per column: yes, no, or words') })).describe('The rows').optional() }),
    fieldConfig: { ...headCfg, columns: { item: 'column', fields: { name: { half: true }, note: { half: true }, cta: { half: true }, href: { half: true } } }, rows: { item: 'row', summary: (r) => r.label, fields: { cells: { item: 'cell', placeholder: 'yes · no · or words' } } } },
  },
  Steps: {
    group: 'Content', label: 'Steps', sketch: 'Steps',
    description: 'The process, numbered — across on a dotted line, down with one step lit, alternating with a picture each, or along a curved path of picture cards',
    summary: (p) => p.heading || (p.items || []).map((s) => s.title).slice(0, 4).join(' → '),
    defaults: { eyebrow: 'How it works', heading: 'Three steps, and you are reading.', lead: '', layout: 'across', highlight: 0, items: [{ title: 'Pick a book', body: 'Open any title and read the first chapters free.' }, { title: 'Keep what you learned', body: 'A short quiz after each chapter; your highlights kept.' }, { title: 'Come back tomorrow', body: 'Your place is saved, on any device.' }] },
    schema: z.object({ ...head, layout: z.enum(['across', 'down', 'alternating', 'path', 'numbered', 'beside', 'spine', 'timeline']).describe('Layout').default('across'), image: pic('The screenshot (beside)'), device: z.enum(['none', 'browser', 'phone', 'laptop']).describe('In a device').default('none'), highlight: z.number().int().min(0).describe('The step lit (the down layout; 0 for none)').default(0),
      items: z.array(z.object({ title: line('Title'), body: opt('The passage (markdown)'), icon: opt('Glyph in place of the number'), image: pic('Picture (alternating, path)'), href: opt('Link (path)') })).describe('The steps').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { across: 'Across', down: 'Down', alternating: 'Alternating pictures', path: 'A path of cards', numbered: 'Numbered cards', beside: 'Beside a screenshot', spine: 'A spine', timeline: 'A timeline' } }, highlight: { half: true, when: (v) => ['down', 'beside', 'timeline'].includes(v.layout) }, image: { component: 'image', when: (v) => v.layout === 'beside' }, device: { half: true, when: (v) => v.layout === 'beside' }, items: { item: 'step', fields: { body: { component: 'textarea' }, image: { component: 'image' }, icon: { half: true }, href: { half: true } } } },
  },
  Gallery: {
    group: 'Content', label: 'Gallery',
    description: 'Pictures in a grid, a caption each, opened large on a click',
    summary: (p) => p.heading || ((p.items || []).length + ' pictures'),
    defaults: { eyebrow: '', heading: '', lead: '', columns: 3, shape: 'square', items: [] },
    schema: z.object({ ...head, layout: z.enum(['grid', 'masonry', 'polaroids', 'scatter', 'arc', 'mosaic', 'lookbook']).describe('Layout').default('grid'), columns: cols('Across', 3), shape: z.enum(['square', 'wide', 'tall', 'natural']).describe('Every picture\'s shape').default('square'), filters: z.boolean().describe('Buttons to filter by tag').default(false), items: z.array(z.object({ image: line('Picture'), alt: opt('What it shows'), caption: opt('Caption'), tag: opt('Tag (for the filters)'), title: opt('Title (the lookbook)'), price: opt('Price, as written (the lookbook)'), href: opt('Link (the lookbook)') })).describe('The pictures').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { grid: 'A grid', masonry: 'Masonry', polaroids: 'Polaroids on a rail', scatter: 'Strewn on the table', arc: 'An arc', mosaic: 'A mosaic that widens', lookbook: 'A lookbook' } }, columns: { half: true, when: (v) => ['grid', 'lookbook'].includes(v.layout) }, shape: { half: true, when: (v) => v.layout === 'grid', labels: { square: 'Square', wide: 'Wide', tall: 'Tall', natural: 'As they are' } }, filters: { half: true }, items: { item: 'picture', summary: (x) => x.title || x.caption || x.alt || x.image, fields: { image: { component: 'image' }, alt: { half: true }, caption: { half: true }, tag: { half: true }, title: { half: true }, price: { half: true }, href: { half: true } } } },
  },
  Video: {
    group: 'Content', label: 'Video',
    description: 'One video — a file, or YouTube, Vimeo or Loom — with a poster and a caption; nothing loads until it is played',
    summary: (p) => p.heading || p.caption || p.video || '',
    defaults: { eyebrow: '', heading: '', lead: '', video: '', poster: '', caption: '', size: 'wide' },
    schema: z.object({ ...head, video: opt('Video — a file, or a YouTube, Vimeo or Loom address'), poster: pic('Poster'), caption: opt('Caption'), size: z.enum(['wide', 'narrow']).describe('Size').default('wide') }),
    fieldConfig: { ...headCfg, video: { placeholder: 'https://www.youtube.com/watch?v=…' }, poster: { component: 'image' }, size: { labels: { wide: 'Wide', narrow: 'Narrow' } } },
  },
  Prose: {
    group: 'Content', label: 'Prose',
    description: 'A heading and a passage of markdown — for anything the other sections do not say',
    summary: (p) => p.heading || String(p.body || '').split('\n')[0].slice(0, 80),
    defaults: { eyebrow: '', heading: 'A note from the press', body: 'We publish short books because a short book gets read. Every title here can be finished in an evening and used for a year.', align: 'left', measure: 'reading' },
    schema: z.object({ eyebrow: opt('Eyebrow'), heading: opt('Heading'), body: opt('The passage (markdown)'), align: z.enum(['left', 'center']).describe('Aligned').default('left'), measure: z.enum(['reading', 'wide']).describe('Measure').default('reading') }),
    fieldConfig: { heading: { component: 'textarea' }, body: { component: 'markdown' }, align: { half: true, labels: { left: 'Left', center: 'Centred' } }, measure: { half: true, labels: { reading: 'A reading measure', wide: 'The full width' } } },
  },
  Timeline: {
    group: 'Content', label: 'Timeline',
    description: 'Dated milestones — down the page, or as a column per phase (a roadmap) — a title, a passage and ticked points each',
    summary: (p) => p.heading || (p.items || []).map((x) => x.date).slice(0, 4).join(' → '),
    defaults: { eyebrow: '', heading: 'How we got here', lead: '', layout: 'list', items: [{ date: '2021', title: 'The first book', body: 'One title, printed on demand, sold from a table at the market.' }, { date: '2023', title: 'Online', body: 'The library opens: read a chapter free, keep the rest as a member.' }, { date: 'Soon', title: 'Audio', body: 'Every chapter, read aloud.', upcoming: true }] },
    schema: z.object({ ...head, layout: z.enum(['list', 'columns']).describe('Layout').default('list'), items: z.array(z.object({ date: line('When (as written)'), title: line('Title'), body: opt('The passage (markdown)'), points: z.array(z.string()).describe('Ticked points').optional(), upcoming: z.boolean().describe('Still to come').optional(), percent: opt('A percentage in place of the date (a roadmap)') })).describe('The milestones').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { list: 'Down the page', columns: 'A column per phase' } }, items: { item: 'milestone', fields: { date: { half: true }, title: { half: true }, percent: { half: true }, body: { component: 'textarea' }, points: { item: 'point' } } } },
  },
  Bento: {
    group: 'Content', label: 'Bento',
    description: 'A grid of tiles of four sizes and six kinds — a feature, a picture, a stat, a quote, a list, a loop — each with a tone of its own, a spotlight under the pointer; or a cascade that never stops, beside the words',
    summary: (p) => p.heading || (p.items || []).map((x) => x.title || x.value || x.name).filter(Boolean).slice(0, 3).join(' · '),
    defaults: { eyebrow: '', heading: '', lead: '', columns: 3, layout: 'stacked', cascade: false, gap: 'normal', items: [{ kind: 'feature', icon: 'book', title: 'Read', body: 'Chapter by chapter, at your pace.', size: '2x1' }, { kind: 'stat', value: '82%', label: 'finish the book', size: '1x1', tone: 'ink' }, { kind: 'feature', icon: 'headphones', title: 'Listen', body: 'Every chapter, spoken.', size: '1x1' }, { kind: 'list', icon: 'pen', title: 'Keep', points: ['Highlights', 'Notes', 'Your place'], size: '1x1' }, { kind: 'quote', quote: 'A book is a conversation you can have at any hour.', name: 'Ada Finch', label: 'Editor', size: '1x1', tone: 'wash' }] },
    schema: z.object({ ...head, columns: z.number().int().min(3).max(4).describe('Columns').default(3), layout: z.enum(['stacked', 'beside']).describe('The words').default('stacked'), cascade: z.boolean().describe('The tiles scroll up forever').default(false), gap: z.enum(['normal', 'tight']).describe('Gap').default('normal'),
      items: z.array(z.object({ kind: z.enum(['feature', 'picture', 'stat', 'quote', 'list', 'video']).describe('Kind').default('feature'), size: z.enum(['1x1', '2x1', '1x2', '2x2']).describe('Size').default('1x1'), tone: z.enum(['paper', 'wash', 'accent', 'ink']).describe('Tone').default('paper'),
        icon: glyph('Glyph'), title: opt('Title'), body: opt('One line'), image: pic('Picture'), video: opt('Video file'), href: opt('Link'), label: opt('Label (a stat\'s, a link\'s, a quote\'s role)'), value: opt('The number (a stat)'), quote: opt('The quote'), name: opt('Who said it'), points: z.array(z.string()).describe('Ticked points (a list)').optional() })).describe('The tiles').optional() }),
    fieldConfig: { ...headCfg, columns: { half: true }, layout: { half: true, labels: { stacked: 'Above the grid', beside: 'Beside the grid' } }, cascade: { half: true }, gap: { half: true, labels: { normal: 'Normal', tight: 'Tight' } },
      items: { item: 'tile', summary: (t) => t.title || t.value || t.name || t.kind, fields: { kind: { labels: { feature: 'Feature', picture: 'Picture', stat: 'Stat', quote: 'Quote', list: 'List', video: 'Loop' } }, size: { half: true, labels: { '1x1': '1 × 1', '2x1': '2 wide', '1x2': '2 tall', '2x2': '2 × 2' } }, tone: { half: true, labels: { paper: 'Paper', wash: 'Wash', accent: 'Accent', ink: 'Ink' } },
        icon: { component: 'glyph', when: (t) => t.kind === 'feature' || t.kind === 'list' }, title: { when: (t) => t.kind !== 'stat' && t.kind !== 'quote' }, body: { component: 'textarea', when: (t) => t.kind !== 'list' && t.kind !== 'quote' },
        image: { component: 'image', when: (t) => t.kind === 'picture' || t.kind === 'feature' || t.kind === 'video' || t.kind === 'quote' }, video: { when: (t) => t.kind === 'video' }, href: { half: true }, label: { half: true },
        value: { half: true, when: (t) => t.kind === 'stat' }, quote: { component: 'textarea', when: (t) => t.kind === 'quote' }, name: { half: true, when: (t) => t.kind === 'quote' }, points: { item: 'point', when: (t) => t.kind === 'list' } } } },
    presets: [
      { label: '3 × 2 classic', props: { columns: 3, items: [{ kind: 'feature', icon: 'book', title: 'Read', body: 'Chapter by chapter, at your pace.', size: '2x1' }, { kind: 'stat', value: '82%', label: 'finish the book', size: '1x1', tone: 'ink' }, { kind: 'feature', icon: 'headphones', title: 'Listen', body: 'Every chapter, spoken.', size: '1x1' }, { kind: 'feature', icon: 'pen', title: 'Keep', body: 'Highlights and notes, yours.', size: '1x1' }, { kind: 'quote', quote: 'A book is a conversation you can have at any hour.', name: 'Ada Finch', label: 'Editor', size: '1x1', tone: 'wash' }] } },
      { label: 'One large + four', props: { columns: 4, items: [{ kind: 'picture', title: 'On the shelf', body: 'Printed on demand, shipped worldwide.', image: '', size: '2x2' }, { kind: 'feature', icon: 'bolt', title: 'Fast', body: 'An evening, not a fortnight.', size: '1x1' }, { kind: 'feature', icon: 'shield', title: 'Yours', body: 'Nothing leaves without your say-so.', size: '1x1' }, { kind: 'stat', value: '4.9', label: 'average rating', size: '1x1', tone: 'accent' }, { kind: 'list', icon: 'check', title: 'Included', points: ['Every book', 'Every chapter read aloud', 'A coach when you want one'], size: '1x1' }] } },
      { label: 'Stats row', props: { columns: 4, items: [{ kind: 'stat', value: '12,000+', label: 'readers', size: '1x1', tone: 'ink' }, { kind: 'stat', value: '48', label: 'books', size: '1x1', tone: 'ink' }, { kind: 'stat', value: '11', label: 'minutes a chapter', size: '1x1', tone: 'ink' }, { kind: 'stat', value: '4.9', label: 'average rating', size: '1x1', tone: 'accent' }] } },
      { label: 'Cascade beside the words', props: { layout: 'beside', cascade: true, columns: 3, gap: 'tight', eyebrow: 'The shelf', heading: 'Short books, read whole.', lead: 'Every title here can be finished in an evening.', items: [{ kind: 'picture', image: '', size: '1x1' }, { kind: 'picture', image: '', size: '2x1' }, { kind: 'stat', value: '48', label: 'books', size: '1x1', tone: 'ink' }, { kind: 'picture', image: '', size: '1x2' }, { kind: 'picture', image: '', size: '1x1' }, { kind: 'picture', image: '', size: '1x1' }] } },
    ],
  },
  Quote: {
    group: 'Proof', label: 'Quote',
    description: 'One pull quote, large, with its source',
    summary: (p) => String(p.quote || '').slice(0, 80),
    defaults: { quote: 'A book is a conversation you can have at any hour.', name: 'Ada Finch', role: 'Editor', image: '' },
    schema: z.object({ quote: text('The quote'), name: opt('Who said it'), role: opt('Their role'), image: pic('Their face') }),
    fieldConfig: { quote: { component: 'textarea' }, name: { half: true }, role: { half: true }, image: { component: 'image' } },
  },
  Newsletter: {
    group: 'People', label: 'Newsletter', sketch: 'Newsletter',
    description: 'A heading, a line and one field that takes an address into one of the site\'s forms — centred, split with a picture, or a card; faces or a rating beside it',
    summary: (p) => p.heading || '',
    defaults: { eyebrow: '', heading: 'The next chapter, by email.', lead: 'One letter a week, on Sunday. Unsubscribe any time.', layout: 'centered', form: '', button: 'Subscribe', placeholder: '', fine: 'No spam, ever.', image: '', alt: '', avatars: {}, rating: {} },
    schema: z.object({ ...head, layout: z.enum(['centered', 'split', 'card']).describe('Layout').default('centered'), form: opt('The form the address goes to (one with an email field)'), name: z.boolean().describe('Ask a first name too (to a form with a field named name)').default(false), button: opt('Button'), placeholder: opt('Placeholder'), fine: opt('Fine print under the field'), image: pic('Picture (the split layout)'), alt: opt('What it shows'), avatars, rating }),
    fieldConfig: { ...headCfg, layout: { labels: { centered: 'Centred', split: 'Split', card: 'A card' } }, form: { component: 'form', half: true }, name: { half: true }, button: { half: true }, placeholder: { half: true }, fine: { half: true }, image: { component: 'image', when: (v) => v.layout === 'split' }, alt: { when: (v) => v.layout === 'split' }, avatars: avatarsCfg, rating: ratingCfg },
  },
  Integrations: {
    group: 'Proof', label: 'Integrations', sketch: 'Integrations',
    description: 'What it connects to — tiles with a name and a line, an orbit of marks around the site\'s own, or a marquee of chips',
    summary: (p) => p.heading || (p.items || []).map((x) => x.name).slice(0, 4).join(' · '),
    defaults: { eyebrow: 'Works with', heading: 'Connects to what you already use.', lead: '', layout: 'tiles', columns: 3, centre: '', cta: '', href: '', items: [{ name: 'Slack', body: 'A note in the channel when a chapter is done.' }, { name: 'Notion', body: 'Your highlights, in your pages.' }, { name: 'Kindle', body: 'Send any book to the device.' }] },
    schema: z.object({ ...head, layout: z.enum(['tiles', 'orbit', 'marquee', 'scatter']).describe('Layout').default('tiles'), columns: cols('Across (the tiles)', 3), centre: pic('The centre mark (the orbit)'), ...link, items: z.array(z.object({ name: line('Name'), body: opt('One line'), image: pic('Mark'), href: opt('Link') })).describe('The integrations').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { tiles: 'Tiles', orbit: 'An orbit', marquee: 'A marquee', scatter: 'Strewn about the words' } }, columns: { half: true, when: (v) => v.layout === 'tiles' }, centre: { component: 'image', when: (v) => v.layout === 'orbit' }, ...linkCfg, items: { item: 'integration', fields: { name: { half: true }, href: { half: true }, image: { component: 'image' } } } },
  },
  Perks: {
    group: 'Commerce', label: 'Perks', sketch: 'Perks',
    description: 'The slim strip of reasons — free shipping, secure payment, thirty days to return — a glyph, a title and a line each',
    summary: (p) => (p.items || []).map((x) => x.title).slice(0, 4).join(' · '),
    defaults: { align: 'center', items: [{ icon: 'globe', title: 'Ships worldwide', body: 'From $5' }, { icon: 'lock', title: 'Secure payment', body: 'Cards and wallets' }, { icon: 'clock', title: '30 days to return', body: 'No questions' }, { icon: 'chat', title: 'A person answers', body: 'Weekdays, 9 to 5' }] },
    schema: z.object({ layout: z.enum(['strip', 'cards', 'grid', 'inline']).describe('Layout').default('strip'), align: z.enum(['center', 'left']).describe('Aligned').default('center'), items: z.array(z.object({ icon: glyph('Glyph'), image: pic('Or a picture (a payment method\'s mark)'), title: line('Title'), body: opt('One line') })).describe('The perks').optional() }),
    fieldConfig: { layout: { half: true, labels: { strip: 'A strip', cards: 'Cards', grid: 'Two by two', inline: 'One line' } }, align: { half: true, labels: { center: 'Centred', left: 'Left' } }, items: { item: 'perk', fields: { icon: { component: 'glyph' }, image: { component: 'image' }, title: { half: true }, body: { half: true } } } },
  },
  Contact: {
    group: 'People', label: 'Contact',
    description: 'An address, an email, a phone, hours and a map link — and one of the site\'s forms beside them',
    summary: (p) => p.heading || p.email || '',
    defaults: { eyebrow: 'Contact', heading: 'Say hello', lead: '', address: '', email: '', phone: '', hours: '', map: '', mapLabel: '', form: '' },
    schema: z.object({ ...head, address: opt('Address (a line per line)'), email: opt('Email'), phone: opt('Phone'), hours: opt('Hours (a line per line)'), map: opt('Map link'), mapLabel: opt('Map link text'), form: opt('A form beside the details'), layout: z.enum(['beside', 'card', 'cards', 'quote']).describe('Layout').default('beside'), quote: z.object({ text: opt('The quote'), name: opt('Who said it'), role: opt('Their role'), image: pic('Their face') }).describe('A quote beside the form (the quote layout)').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { beside: 'Details beside the form', card: 'The form in a card', cards: 'Info cards above the form', quote: 'A quote beside the form' } }, address: { component: 'textarea' }, hours: { component: 'textarea' }, email: { half: true }, phone: { half: true }, map: { half: true }, mapLabel: { half: true }, form: { component: 'form' }, quote: { when: (v) => v.layout === 'quote', fields: { text: { component: 'textarea' }, name: { half: true }, role: { half: true }, image: { component: 'image' } } } },
  },
}
/* the sections added in the second pass: the effects, the new blocks, the store's */
const CATALOGUE2 = {
  Announcement: {
    group: 'Openers', label: 'Announcement', sketch: 'Announcement',
    description: 'The slim strip at the top — a badge, a line, a link, a coupon to copy — dismissible, sticky when asked',
    summary: (p) => p.text || '',
    defaults: { badge: 'New', text: 'The autumn list is out — **two new books**, and the print run is small.', cta: 'See the list', href: '/store', code: '', sticky: false, dismiss: true },
    schema: z.object({ badge: opt('Badge'), text: line('The line'), cta: opt('Link text'), href: opt('Link'), code: opt('A coupon code, copied on a click'), sticky: z.boolean().describe('Stays at the top as the page scrolls').default(false), dismiss: z.boolean().describe('Can be closed').default(true) }),
    fieldConfig: { badge: { half: true }, code: { half: true }, cta: { half: true }, href: { half: true }, sticky: { half: true }, dismiss: { half: true } },
  },
  Countdown: {
    group: 'Closers', label: 'Countdown', sketch: 'Countdown',
    description: 'Days, hours, minutes, seconds to a moment — or a span that runs for each visitor from their first look — with a line and a button',
    summary: (p) => p.heading || p.until || (p.fomo ? p.fomo + 'h' : ''),
    defaults: { badge: '', eyebrow: 'The launch', heading: 'The autumn list arrives in', lead: '', until: '', fomo: 48, layout: 'centered', cta: 'Reserve a copy', href: '/store', over: 'It is here.' },
    schema: z.object({ ...head, until: opt('Until (a date and time, e.g. 2026-10-01T09:00)'), fomo: z.number().min(0).describe('Or a span from each visitor\'s first look, in hours').default(0), layout: z.enum(['centered', 'strip']).describe('Layout').default('centered'), ...link, over: opt('The line when the time is up') }),
    fieldConfig: { ...headCfg, until: { half: true, placeholder: '2026-10-01T09:00' }, fomo: { half: true }, layout: { labels: { centered: 'Centred', strip: 'A strip' } }, ...linkCfg },
  },
  BeforeAfter: {
    group: 'Content', label: 'Before / after', sketch: 'BeforeAfter',
    description: 'Two pictures of the same size with a handle to drag between them, a label on each side',
    summary: (p) => p.heading || [p.beforeLabel, p.afterLabel].filter(Boolean).join(' / '),
    defaults: { badge: '', eyebrow: '', heading: '', lead: '', before: '', after: '', beforeLabel: 'Before', afterLabel: 'After', start: 50, size: 'wide' },
    schema: z.object({ ...head, before: pic('Before'), after: pic('After'), beforeLabel: opt('Label, before'), afterLabel: opt('Label, after'), start: z.number().min(0).max(100).describe('Where the handle starts, 0–100').default(50), size: z.enum(['wide', 'narrow']).describe('Size').default('wide') }),
    fieldConfig: { ...headCfg, before: { component: 'image' }, after: { component: 'image' }, beforeLabel: { half: true }, afterLabel: { half: true }, start: { half: true }, size: { half: true, labels: { wide: 'Wide', narrow: 'Narrow' } } },
  },
  Showcase: {
    group: 'Content', label: 'Showcase', sketch: 'Showcase',
    description: 'Features told one at a time with a picture each — the pictures stay while the features scroll past, or as tabs, or as flip cards',
    summary: (p) => p.heading || (p.items || []).map((x) => x.title).slice(0, 3).join(' · '),
    defaults: { badge: '', eyebrow: 'A closer look', heading: 'Everything in its place.', lead: '', layout: 'scroll', device: 'browser', side: 'right', hover: true, items: [{ icon: 'book', title: 'Read', body: 'Chapter by chapter, your place kept.', image: '' }, { icon: 'pen', title: 'Keep', body: 'Highlights and notes, yours for good.', image: '' }, { icon: 'headphones', title: 'Listen', body: 'Every chapter, spoken.', image: '' }] },
    schema: z.object({ ...head, layout: z.enum(['scroll', 'tabs', 'flip']).describe('Layout').default('scroll'), device: z.enum(['none', 'browser', 'phone', 'laptop']).describe('The pictures in a device').default('none'), side: z.enum(['left', 'right']).describe('The pictures\' side').default('right'), hover: z.boolean().describe('Tabs switch on hover').default(true),
      items: z.array(z.object({ icon: glyph('Glyph'), title: line('Title'), body: opt('The passage (markdown)'), image: pic('Picture'), video: opt('Or a video file (a muted loop)') })).describe('The features').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { scroll: 'Scroll (the picture stays)', tabs: 'Tabs', flip: 'Flip cards' } }, device: { half: true, labels: { none: 'None', browser: 'Browser', phone: 'Phone', laptop: 'Laptop' } }, side: { half: true, labels: { left: 'Left', right: 'Right' } }, hover: { when: (v) => v.layout === 'tabs' }, items: { item: 'feature', fields: { icon: { component: 'glyph' }, title: { half: true }, video: { half: true }, body: { component: 'textarea' }, image: { component: 'image' } } } },
  },
  Carousel: {
    group: 'Content', label: 'Carousel', sketch: 'Carousel',
    description: 'Slides — a picture, a title, a line, a link each — by arrows, dots, a drag; as cards, an arc, a coverflow, or one large with thumbnails',
    summary: (p) => p.heading || ((p.items || []).length + ' slides'),
    defaults: { badge: '', eyebrow: '', heading: '', lead: '', layout: 'cards', across: 3, autoplay: 0, items: [] },
    schema: z.object({ ...head, layout: z.enum(['cards', 'arc', 'coverflow', 'strip']).describe('Layout').default('cards'), across: cols('Across (the cards)', 3), autoplay: z.number().min(0).max(60).describe('Autoplay, seconds (0 off)').default(0),
      items: z.array(z.object({ image: line('Picture'), title: opt('Title'), body: opt('One line'), href: opt('Link') })).describe('The slides').optional() }),
    fieldConfig: { ...headCfg, layout: { labels: { cards: 'Cards', arc: 'An arc', coverflow: 'Coverflow', strip: 'One large, thumbnails under' } }, across: { half: true, when: (v) => v.layout === 'cards' }, autoplay: { half: true }, items: { item: 'slide', summary: (x) => x.title || x.image, fields: { image: { component: 'image' }, title: { half: true }, href: { half: true } } } },
  },
  Tabs: {
    group: 'Content', label: 'Tabs', sketch: 'Tabs',
    description: 'A few panels under a row of tabs — a label, a glyph, a passage and a picture each — as pills or an underline',
    summary: (p) => (p.items || []).map((x) => x.label).join(' · '),
    defaults: { badge: '', eyebrow: '', heading: '', lead: '', variant: 'pills', items: [{ label: 'Overview', icon: 'book', body: 'What it is, in a paragraph.' }, { label: 'Details', icon: 'doc', body: 'The particulars.' }, { label: 'Shipping', icon: 'globe', body: 'Where it goes and how fast.' }] },
    schema: z.object({ ...head, variant: z.enum(['pills', 'underline']).describe('Drawn as').default('pills'), items: z.array(z.object({ label: line('Tab'), icon: opt('Glyph'), body: text('The passage (markdown)'), image: pic('Picture beside it') })).describe('The tabs').optional() }),
    fieldConfig: { ...headCfg, variant: { labels: { pills: 'Pills', underline: 'Underline' } }, items: { item: 'tab', summary: (x) => x.label, fields: { icon: { component: 'glyph' }, label: { half: true }, body: { component: 'markdown' }, image: { component: 'image' } } } },
  },
  Divider: {
    group: 'Content', label: 'Divider', sketch: 'Divider',
    description: 'A hairline, three dots, the ornament, plain space, or a wave, a curve, an angle between two sections',
    summary: (p) => p.kind || 'line',
    defaults: { kind: 'line', size: 'normal' },
    schema: z.object({ kind: z.enum(['line', 'dots', 'ornament', 'space', 'wave', 'curve', 'angle']).describe('Kind').default('line'), size: z.enum(['small', 'normal', 'large']).describe('Size').default('normal') }),
    fieldConfig: { kind: { labels: { line: 'A line', dots: 'Three dots', ornament: 'The ornament', space: 'Space', wave: 'A wave', curve: 'A curve', angle: 'An angle' } }, size: { labels: { small: 'Small', normal: 'Normal', large: 'Large' } } },
  },
  Footer: {
    group: 'Closers', label: 'Footer', sketch: 'Footer',
    description: 'The foot of the page: the mark and a line, columns of links, an email field, the social links, the legal line — as columns, a mega footer with a call above, or minimal',
    summary: (p) => (p.columns || []).map((c) => c.title).join(' · ') || p.legal || '',
    defaults: { layout: 'columns', about: 'A small press for short, practical books.', columns: [{ title: 'Read', links: [{ label: 'The library', href: '/content' }, { label: 'Pricing', href: '/pricing' }] }, { title: 'The press', links: [{ label: 'About', href: '/about' }, { label: 'Contact', href: '/about#contact' }] }], capture: {}, social: [], legal: '© {year} — All rights reserved.', small: [{ label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }], call: {} },
    schema: z.object({ layout: z.enum(['columns', 'mega', 'minimal']).describe('Layout').default('columns'), about: opt('A line about the site (under the mark)'),
      columns: z.array(z.object({ title: line('Column title'), links: z.array(z.object({ label: line('Label'), href: line('Link') })).describe('Links').optional() })).describe('The columns').optional(),
      capture: z.object({ heading: opt('Heading over the field'), form: opt('The form the address goes to'), button: opt('Button'), placeholder: opt('Placeholder'), fine: opt('Fine print') }).describe('An email field').optional(),
      social: z.array(z.object({ label: line('Network (LinkedIn, X, GitHub, Instagram, YouTube, Facebook, Mail)'), href: line('Link') })).describe('Social links').optional(),
      legal: opt('The legal line ({year} is the year)'), small: z.array(z.object({ label: line('Label'), href: line('Link') })).describe('The small links (privacy, terms)').optional(),
      call: z.object({ heading: opt('Heading'), cta: opt('Button text'), href: opt('Button link') }).describe('A call above the columns (the mega layout)').optional() }),
    fieldConfig: { layout: { labels: { columns: 'Columns', mega: 'Mega, a call above', minimal: 'Minimal' } }, about: { component: 'textarea' }, columns: { item: 'column', fields: { links: { item: 'link', fields: { label: { half: true }, href: { half: true } } } } }, capture: { fields: { form: { component: 'form', half: true }, heading: { half: true }, button: { half: true }, placeholder: { half: true } } }, social: { item: 'link', fields: { label: { half: true }, href: { half: true } } }, small: { item: 'link', fields: { label: { half: true }, href: { half: true } } }, call: { when: (v) => v.layout === 'mega', fields: { cta: { half: true }, href: { half: true } } } },
  },
}
/* the store's own sections, with the module on */
const STORE_SECTIONS = moduleOn('store') ? {
  Products: {
    group: 'Commerce', label: 'Products', sketch: 'Products',
    description: 'The site\'s products — a collection\'s, a tag\'s, the featured, hand-picked, or every one — as cards, a bordered grid, a rail, or a list; a quick add where nothing needs choosing',
    summary: (p) => p.heading || (p.source === 'collection' ? p.collection : p.source),
    defaults: { badge: '', eyebrow: 'The shelf', heading: 'Books in print', lead: '', source: 'all', collection: '', tag: '', skus: [], layout: 'cards', columns: 4, limit: 8, sort: 'order', cta: 'Everything', href: '' },
    schema: z.object({ ...head, source: z.enum(['all', 'featured', 'collection', 'tag', 'skus']).describe('Which products').default('all'), collection: opt('The collection (its id)'), tag: opt('The tag'), skus: z.array(z.string()).describe('The skus, in order').optional(),
      layout: z.enum(['cards', 'bordered', 'rail', 'list']).describe('Layout').default('cards'), columns: z.number().int().min(2).max(5).describe('Across').default(4), limit: z.number().int().min(0).describe('How many (0 = all)').default(8), sort: z.enum(['order', 'price-asc', 'price-desc']).describe('Order').default('order'), ...link }),
    fieldConfig: { ...headCfg, source: { labels: { all: 'Every product', featured: 'The featured', collection: 'A collection', tag: 'A tag', skus: 'Hand-picked' } }, collection: { half: true, when: (v) => v.source === 'collection' }, tag: { half: true, when: (v) => v.source === 'tag' }, skus: { item: 'sku', when: (v) => v.source === 'skus' }, layout: { labels: { cards: 'Cards', bordered: 'A bordered grid', rail: 'A rail', list: 'A list' } }, columns: { half: true }, limit: { half: true }, sort: { labels: { order: 'The store\'s order', 'price-asc': 'Cheapest first', 'price-desc': 'Dearest first' } }, ...linkCfg },
  },
  Spotlight: {
    group: 'Commerce', label: 'Product spotlight', sketch: 'Spotlight',
    description: 'One product, large — its gallery, the price, a passage, sizes and a quantity, Add to bag, the trust line — and a drop\'s countdown and stock when the page says',
    summary: (p) => p.sku || '',
    defaults: { badge: '', eyebrow: '', heading: '', lead: '', sku: '', side: 'left', body: '', points: [], trust: [{ icon: 'globe', text: 'Ships worldwide' }, { icon: 'lock', text: 'Secure payment' }, { icon: 'clock', text: '30 days to return' }], compare: '', until: '', stock: {}, cta: '' },
    schema: z.object({ ...head, sku: z.string().describe('The product (its sku)').default(''), side: z.enum(['left', 'right']).describe('The pictures\' side').default('left'), body: opt('The passage (markdown; blank = the product\'s own opening)'), points, trust: z.array(z.object({ icon: glyph('Glyph'), text: line('Line') })).describe('The trust line under the button').optional(), compare: opt('An old price, as written'), until: opt('A drop: until (a date and time)'), stock: z.object({ left: opt('Left'), total: opt('Of') }).describe('What is left of the drop').optional(), cta: opt('The button\'s words (blank = Add to bag)') }),
    fieldConfig: { ...headCfg, sku: { half: true }, side: { half: true, labels: { left: 'Left', right: 'Right' } }, body: { component: 'markdown' }, points: pointsCfg, trust: { item: 'line', fields: { icon: { component: 'glyph' } } }, compare: { half: true }, until: { half: true, placeholder: '2026-10-01T09:00' }, stock: { fields: { left: { half: true }, total: { half: true } } }, cta: { half: true } },
  },
  Collections: {
    group: 'Commerce', label: 'Collections', sketch: 'Collections',
    description: 'The store\'s collections as ways in — tiles with a picture and a count, icon tiles, two big banners, or circles',
    summary: (p) => p.heading || (p.ids || []).join(' · ') || 'every collection',
    defaults: { badge: '', eyebrow: '', heading: 'Shop by kind', lead: '', layout: 'tiles', ids: [], icons: {}, limit: 0, cta: 'All collections', href: '' },
    schema: z.object({ ...head, layout: z.enum(['tiles', 'icons', 'banners', 'circles']).describe('Layout').default('tiles'), ids: z.array(z.string()).describe('The collections (their ids), in order; none = every one').optional(), limit: z.number().int().min(0).describe('How many (0 = all)').default(0), ...link }),
    fieldConfig: { ...headCfg, layout: { labels: { tiles: 'Tiles', icons: 'Icon tiles', banners: 'Two banners', circles: 'Circles' } }, ids: { item: 'collection' }, limit: { half: true }, ...linkCfg },
  },
} : {}

/* the latest articles: the articles module's section */
const ARTICLES_SECTION = moduleOn('articles') ? {
  Articles: {
    group: 'From the site', label: 'Articles', sketch: 'Articles',
    description: 'The latest writing from the site\'s own articles — as cards, a list, or one featured large — as many as you say, a tag to keep to',
    summary: (p) => p.heading || (p.limit + ' latest'),
    defaults: { eyebrow: 'From the journal', heading: 'Latest', lead: '', layout: 'cards', limit: 3, tag: '', cta: 'All articles', href: '' },
    schema: z.object({ ...head, layout: z.enum(['cards', 'list', 'featured']).describe('Layout').default('cards'), limit: z.number().int().min(1).max(12).describe('How many').default(3), tag: opt('Only articles tagged'), ...link }),
    fieldConfig: { ...headCfg, layout: { half: true, labels: { cards: 'Cards', list: 'A list', featured: 'One featured' } }, limit: { half: true }, tag: { half: true }, ...linkCfg },
  },
} : {}

/* every section may wear a tone and carry an anchor (the page stamps them on the section's root; LandingPage.vue) — every one but the Marquee and the Close, whose roots are their own */
const TONE = {
  tone: z.enum(['paper', 'wash', 'accent', 'ink']).describe('Tone').default('paper'),
  glow: z.enum(['none', 'cards', 'visual', 'foot', 'corner']).describe('Glow').default('none'),
  ground: z.enum(['none', 'grain', 'dots', 'grid', 'gradient', 'aurora']).describe('Ground').default('none'),
  spacing: z.enum(['tight', 'normal', 'roomy']).describe('Spacing').default('normal'),
  width: z.enum(['narrow', 'normal', 'full']).describe('Width').default('normal'),
  reveal: z.enum(['none', 'fade', 'blur', 'zoom', 'tiles']).describe('Pictures arrive').default('none'),
  anchor: opt('Anchor id (for a link to this section: /#pricing)'),
}
const TONE_CFG = {
  tone: { group: 'look', labels: { paper: 'Paper', wash: 'Wash', accent: 'Accent', ink: 'Ink' } },
  glow: { group: 'look', labels: { none: 'None', cards: 'Behind the cards', visual: 'Behind the visual', foot: 'From the foot', corner: 'From a corner' } },
  ground: { group: 'look', description: 'A texture under the section, from the look\'s colours' },
  spacing: { group: 'look', half: true }, width: { group: 'look', half: true },
  reveal: { group: 'look', labels: { none: 'As they are', fade: 'Fade in', blur: 'From a blur', zoom: 'Settle from a zoom', tiles: 'Tile by tile' } },
  anchor: { group: 'look', placeholder: 'pricing' },
}
Object.assign(SECTION_SCHEMAS, CATALOGUE, CATALOGUE2, STORE_SECTIONS, ARTICLES_SECTION, FORM_SECTION, ENTRIES_SECTION)
for (const k of Object.keys(SECTION_SCHEMAS)) { if (k === 'Marquee' || k === 'Close' || k === 'Divider' || k === 'Announcement') continue; const d = SECTION_SCHEMAS[k]; d.schema = d.schema.extend(TONE); d.fieldConfig = { ...(d.fieldConfig || {}), ...TONE_CFG } }
Object.assign(SECTION_SCHEMAS, SITE_SCHEMAS)
export const SECTION_KEYS = Object.keys(SECTION_SCHEMAS)

/* a page's sections against the schemas: [{ path, message }], empty when fine.
   Used by the admin server on save — the same schema that drew the form. */
/* `key:` with nothing after it is null in YAML; the forms and the components treat it as blank */
const blankNulls = (v) => (v === null ? undefined : Array.isArray(v) ? v.map(blankNulls) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankNulls(x)])) : v)

/* the schema a section's conditional sub-record is drawn from for these props (the stage the hero's visual names), or null */
export function subSchema(def, props) {
  const c = def && def.conditional
  if (!c) return null
  const key = c.on.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), props || {})
  return (key && c.schemas[key]) || null
}

export function validateSections(sections) {
  const issues = []
  if (sections == null) return issues
  if (!Array.isArray(sections)) return [{ path: 'sections', message: 'must be a list of sections' }]
  sections.forEach((s, i) => {
    const at = 'sections.' + i
    if (!s || typeof s !== 'object') { issues.push({ path: at, message: 'not a section' }); return }
    const def = SECTION_SCHEMAS[s.component]
    if (!def) { issues.push({ path: at + '.component', message: 'unknown section "' + s.component + '"' }); return }
    const props = blankNulls(s.props || {})
    const r = def.schema.safeParse(props)
    if (!r.success) for (const e of r.error.issues) issues.push({ path: at + '.props.' + e.path.join('.'), message: e.message })
    /* a conditional sub-record (the hero's stage): checked against the chosen kind's schema, and only then */
    const sub = subSchema(def, props)
    if (sub) {
      const q = sub.schema.safeParse(props[def.conditional.field] || {})
      if (!q.success) for (const e of q.error.issues) issues.push({ path: at + '.props.' + def.conditional.field + '.' + e.path.join('.'), message: e.message })
    }
  })
  return issues
}
