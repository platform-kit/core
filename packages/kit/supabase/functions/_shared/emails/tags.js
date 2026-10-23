/*
 * Every email the site sends, and what each may say — the merge tags a design may use, with a
 * sample value for the editor's preview and a test send. Plain JavaScript, no imports: the
 * admin's editor reads it (the tag picker, the sample data), the send-email function reads it
 * (a test send), and _shared/email.ts shapes a real order to the same names. Handlebars syntax:
 * `{{name}}`; a section repeated per line or shown on a condition wears a pair from PAIRS as its
 * display condition (`{{#each lines}} … {{/each}}`, `{{#if ships}} … {{/if}}`).
 *
 * Three of them are not ours to fill: the address's confirmation (also the magic-link sign-in),
 * the password reset, and the publisher invitation are sent by Supabase Auth from its own templates, which the build
 * hands it compiled (auth-config.mjs on deploy, supabase/templates locally); their tags are Go
 * templates — `{{ .ConfirmationURL }}` — left intact by fill.js and filled by Supabase.
 */
export const KINDS = ['order', 'shipped', 'files', 'chat', 'support', 'support-digest', 'magic-link', 'recovery', 'invitation', 'campaign', 'session-booked', 'session-held', 'session-to-confirm', 'session-declined', 'session-moved', 'session-cancelled', 'session-reminder', 'event-reminder', 'provider-terms', 'course-lesson', 'course-complete']
/* the ones Supabase Auth sends, from the compiled design: never filled here */
export const GOTRUE = ['magic-link', 'recovery', 'invitation']

const person = [
  { label: 'First name', value: '{{name}}', group: 'Buyer', sample: 'Ada', description: 'the buyer\'s first name, from the address they gave — may be empty' },
]
const book = [
  { label: 'Book title', value: '{{title}}', group: 'Order', sample: 'The Kybalion' },
  { label: 'Link to the book', value: '{{url}}', group: 'Order', sample: 'https://example.com/store/products/the-kybalion-print', description: 'the book\'s page in the store' },
]
export const TAGS = {
  order: [
    ...person, ...book,
    { label: 'Subtotal', value: '{{subtotal}}', group: 'Order', sample: '$15.00' },
    { label: 'Shipping', value: '{{shipping}}', group: 'Order', sample: '$5.00' },
    { label: 'Total', value: '{{total}}', group: 'Order', sample: '$20.00' },
    { label: 'Line — title', value: '{{title}}', group: 'Each line', sample: 'The Kybalion', description: 'inside a section repeated per line' },
    { label: 'Line — what it is', value: '{{detail}}', group: 'Each line', sample: 'Paperback · Both — the modern edition, then the original full text' },
    { label: 'Line — quantity', value: '{{qty}}', group: 'Each line', sample: '1' },
    { label: 'Line — amount', value: '{{amount}}', group: 'Each line', sample: '$15.00' },
    { label: 'Address line', value: '{{this}}', group: 'Each address line', sample: '1 Example Street', description: 'inside {{#each address}}' },
  ],
  shipped: [
    ...person, ...book,
    { label: 'Carrier', value: '{{carrier}}', group: 'Parcel', sample: 'USPS' },
    { label: 'Tracking number', value: '{{tracking_id}}', group: 'Parcel', sample: '9400 1000 0000 0000 0000 00' },
    { label: 'Tracking link', value: '{{tracking_url}}', group: 'Parcel', sample: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000' },
    { label: 'Address line', value: '{{this}}', group: 'Each address line', sample: '1 Example Street', description: 'inside {{#each address}}' },
  ],
  files: [
    ...person, ...book,
    { label: 'The files', value: '{{files}}', group: 'Order', sample: 'PDF and EPUB' },
  ],
  /* the coaching chat's away email: who wrote, where the conversation is */
  chat: [
    { label: 'Who wrote', value: '{{name}}', group: 'Chat', sample: 'Ada', description: 'the sender\'s name, or the start of their address' },
    { label: 'What they wrote', value: '{{message}}', group: 'Chat', sample: 'Could you take a look at the print run before Friday?' },
    { label: 'Where', value: '{{where}}', group: 'Chat', sample: '#general', description: 'the channel it was said in, where there is one' },
    { label: 'Link to the conversation', value: '{{url}}', group: 'Chat', sample: 'https://example.com/channels/0000' },
  ],
  /* the support chat's emails: a reply the contact was not there to see */
  support: [
    { label: 'Who wrote', value: '{{name}}', group: 'Support', sample: 'Ada', description: 'the agent who replied, or the person who wrote in' },
    { label: 'What they wrote', value: '{{message}}', group: 'Support', sample: 'Hi — my parcel has not arrived yet. Is there a tracking number?' },
    { label: 'Link to the conversation', value: '{{url}}', group: 'Support', sample: 'https://example.com/?support=0000', description: 'the site with the conversation open' },
  ],
  /* the staff's escalation: the threads that have waited too long with no one at the desk, in one letter */
  'support-digest': [
    { label: 'How many', value: '{{count}}', group: 'Desk', sample: '2' },
    { label: 'The threads (html)', value: '{{{body}}}', group: 'Desk', sample: '<p>The waiting conversations go here.</p>', description: 'who is waiting and for how long, with their first line — keep it in an HTML block' },
    { label: 'Link to the inbox', value: '{{url}}', group: 'Desk', sample: 'https://example.com/admin/support' },
  ],
  /* NEW TERMS TO AGREE TO. It is sent to a provider on the old version and says the one thing that
     changes if they do nothing: nothing NEW goes on sale. Their page stays, their live offerings stay,
     what they have earned is still paid, and calls already booked still happen. */
  'provider-terms': [
    { label: 'First name', value: '{{name}}', group: 'Terms', sample: 'Ada' },
    { label: 'The new version', value: '{{version}}', group: 'Terms', sample: 'v2' },
    { label: 'The version they signed', value: '{{signed}}', group: 'Terms', sample: 'v1', description: 'blank for somebody who has never signed any' },
    { label: 'The terms (html)', value: '{{{body}}}', group: 'Terms', sample: '<p>The terms go here, from content/providers.md.</p>', description: 'the whole wording — keep it in an HTML block' },
    { label: 'Where to agree', value: '{{url}}', group: 'Terms', sample: 'https://example.com/app/coaching?terms=1' },
  ],
  /* the site's own emails around a session it scheduled: booked, moved, cancelled, the reminder — to the reader and to the host alike */
  'session-booked': [
    { label: 'First name', value: '{{name}}', group: 'Session', sample: 'Ada', description: 'whoever this copy goes to — the reader, or the host' },
    { label: 'The session', value: '{{title}}', group: 'Session', sample: 'One on one' },
    { label: 'When', value: '{{when}}', group: 'Session', sample: 'Tuesday 7 July, 09:00 (Amsterdam)', description: 'in the reader\'s own zone' },
    { label: 'With whom', value: '{{with}}', group: 'Session', sample: 'Coach Person', description: 'the other side: the host for the reader, the reader for the host' },
    { label: 'Where', value: '{{where}}', group: 'Session', sample: 'In person at The studio, Keizersgracht 123, Amsterdam', description: 'the place as the type says it — a room, a link, an address, a number; empty when nowhere in particular' },
    { label: 'Link to join', value: '{{join}}', group: 'Session', sample: 'https://example.com/app/call/ns_0000', description: 'a room or a link; empty otherwise' },
    { label: 'Manage the session', value: '{{manage}}', group: 'Session', sample: 'https://example.com/app/coaching', description: 'the Coaching tab, to move or cancel' },
    /* WHAT THEY ANSWERED ON THE WAY IN, where the type asked a form. The HOST'S copy alone carries
       them — the reader wrote them and does not need them read back — so a design that shows them
       shows nothing in the reader's copy, which is what the repeat does with an empty list. */
    { label: 'The question', value: '{{label}}', group: 'Each answer', sample: 'What would you like to work on?', description: 'inside {{#each answers}}; the host\'s copy only' },
    { label: 'Their answer', value: '{{value}}', group: 'Each answer', sample: 'Deciding whether to take the job', description: 'inside {{#each answers}}' },
  ],
  /* the same facts as a booking, about a different moment: held, waiting on the host, declined */
  'session-held': null, 'session-to-confirm': null, 'session-declined': null,
  'session-moved': null, 'session-cancelled': null, 'session-reminder': null,
  /* what is on, before it is on: for everybody who said they were coming */
  'event-reminder': null,
  /* a course's lesson that has just opened, and a course finished (the courses module) */
  'course-lesson': [
    { label: 'First name', value: '{{name}}', group: 'Reader', sample: 'Ada' },
    { label: 'The course', value: '{{course}}', group: 'Course', sample: 'Writing well' },
    { label: 'The lesson', value: '{{lesson}}', group: 'Course', sample: 'Finding the first line' },
    { label: 'Link to the lesson', value: '{{url}}', group: 'Course', sample: 'https://example.com/courses/writing-well/first-line' },
  ],
  'course-complete': [
    { label: 'First name', value: '{{name}}', group: 'Reader', sample: 'Ada' },
    { label: 'The course', value: '{{course}}', group: 'Course', sample: 'Writing well' },
    { label: 'Link to the course', value: '{{url}}', group: 'Course', sample: 'https://example.com/courses/writing-well' },
    { label: 'Link to the certificate', value: '{{certificate}}', group: 'Course', sample: 'https://example.com/certificates/3f2a9c', description: 'empty when the course gives none' },
  ],
  /* the frame every funnel step and blast is piped through: the markdown's html goes into an html block as {{{body}}} */
  campaign: [
    { label: 'First name', value: '{{name}}', group: 'Reader', sample: 'Ada' },
    { label: 'Subject', value: '{{subject}}', group: 'Email', sample: 'A note from the shelf' },
    { label: 'The body (html)', value: '{{{body}}}', group: 'Email', sample: '<p>The written email goes here.</p>', description: 'the step\'s or blast\'s markdown, as html — keep it in an HTML block' },
    { label: 'Unsubscribe link', value: '{{unsubscribe_url}}', group: 'Email', sample: 'https://example.com/functions/v1/email-unsubscribe?u=…', description: 'every marketing email must carry it' },
  ],
  /* Supabase Auth's: its link, and the address it was sent to */
  'magic-link': [
    { label: 'The link', value: '{{ .ConfirmationURL }}', group: 'Supabase', sample: 'https://example.com/#confirmed', description: 'the one-click link Supabase made for this reader — the button goes here' },
    { label: 'The address', value: '{{ .Email }}', group: 'Supabase', sample: 'ada@example.com' },
  ],
  recovery: [
    { label: 'The link', value: '{{ .ConfirmationURL }}', group: 'Supabase', sample: 'https://example.com/?recovery=1', description: 'the link that opens the new-password form — the button goes here' },
    { label: 'The address', value: '{{ .Email }}', group: 'Supabase', sample: 'ada@example.com' },
  ],
  invitation: [
    { label: 'The invitation link', value: '{{ .ConfirmationURL }}', group: 'Supabase', sample: 'https://example.com/admin/social?invitation=accepted', description: 'the one-time invitation link Supabase made for this recipient — the button goes here' },
    { label: 'The address', value: '{{ .Email }}', group: 'Supabase', sample: 'ada@example.com' },
  ],
}
/* the pairs a section may wear: repeated per item, or shown on a condition */
export const PAIRS = {
  order: [
    { label: 'Each line of the order', before: '{{#each lines}}', after: '{{/each}}', group: 'Repeat' },
    { label: 'Each line of the address', before: '{{#each address}}', after: '{{/each}}', group: 'Repeat' },
    { label: 'Only when it ships', before: '{{#if ships}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only when files come with it', before: '{{#if files}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only for a guest (no account)', before: '{{#if guest}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only for a signed-in buyer', before: '{{#unless guest}}', after: '{{/unless}}', group: 'Show when' },
    { label: 'Only when there is a subtotal', before: '{{#if subtotal}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only when there is shipping', before: '{{#if shipping}}', after: '{{/if}}', group: 'Show when' },
  ],
  'session-booked': [
    { label: 'Each answer they gave', before: '{{#each answers}}', after: '{{/each}}', group: 'Repeat' },
    { label: 'Only when they answered something', before: '{{#if answers}}', after: '{{/if}}', group: 'Show when' },
  ],
  shipped: [
    { label: 'Each line of the address', before: '{{#each address}}', after: '{{/each}}', group: 'Repeat' },
    { label: 'Only with a tracking number', before: '{{#if tracking_id}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only without a tracking number', before: '{{#unless tracking_id}}', after: '{{/unless}}', group: 'Show when' },
  ],
  files: [
    { label: 'Only for a guest (no account)', before: '{{#if guest}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only for a signed-in buyer', before: '{{#unless guest}}', after: '{{/unless}}', group: 'Show when' },
  ],
  chat: [], support: [], 'support-digest': [], 'magic-link': [], recovery: [], invitation: [], campaign: [],
  'session-booked': [
    { label: 'Only when there is a place', before: '{{#if where}}', after: '{{/if}}', group: 'Show when' },
    { label: 'Only with a link to join', before: '{{#if join}}', after: '{{/if}}', group: 'Show when' },
  ],
  'session-moved': null, 'session-cancelled': null, 'session-reminder': null,
  'course-lesson': [],
  'course-complete': [{ label: 'Only with a certificate', before: '{{#if certificate}}', after: '{{/if}}', group: 'Show when' }],
  'provider-terms': [{ label: 'Only for somebody who signed an earlier version', before: '{{#if signed}}', after: '{{/if}}', group: 'Show when' }, { label: 'Only for somebody who has never signed', before: '{{#unless signed}}', after: '{{/unless}}', group: 'Show when' }],
}
/* the four session emails share their tags and pairs; the reminder adds how soon */
for (const k of ['session-moved', 'session-cancelled', 'session-reminder', 'event-reminder']) { TAGS[k] = TAGS['session-booked'].slice(); PAIRS[k] = PAIRS['session-booked'].slice() }
TAGS['session-reminder'].push({ label: 'How soon', value: '{{in}}', group: 'Session', sample: 'in 24 hours' })
TAGS['event-reminder'].push({ label: 'How soon', value: '{{in}}', group: 'Session', sample: 'in 24 hours' })
TAGS['event-reminder'].push({ label: 'What it is', value: '{{what}}', group: 'Session', sample: 'The members\' call' })
/* one sample order per email, for the editor's preview and a test send */
export const SAMPLES = {
  order: { name: 'Ada', title: 'The Kybalion', url: 'https://example.com/store/products/the-kybalion-print', lines: [{ title: 'The Kybalion', detail: 'Paperback · Both — the modern edition, then the original full text', qty: 1, amount: '$15.00' }], subtotal: '$15.00', shipping: '$5.00', total: '$20.00', address: ['Ada Lovelace', '1 Example Street', 'Anytown NY 10001', 'US'], ships: true, files: true, guest: false },
  shipped: { name: 'Ada', title: 'The Kybalion', url: 'https://example.com/store/products/the-kybalion-print', carrier: 'USPS', tracking_id: '9400 1000 0000 0000 0000 00', tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000', address: ['Ada Lovelace', '1 Example Street', 'Anytown NY 10001', 'US'] },
  files: { name: 'Ada', title: 'The Kybalion', url: 'https://example.com/store/products/the-kybalion-print', files: 'PDF and EPUB', guest: false },
  chat: { name: 'Ada', url: 'https://example.com/app/chat/0000' },
  support: { name: 'Ada', message: 'Hi — my parcel has not arrived yet. Is there a tracking number?', url: 'https://example.com/?support=0000' },
  'support-digest': { count: '2', body: '<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#0c0d0b"><b>Ada</b> · waiting 24m<br><span style="color:#6c6f69">Hi — my parcel has not arrived yet. Is there a tracking number?</span></p><p style="margin:0 0 12px;font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#0c0d0b"><b>Grace</b> · waiting 18m<br><span style="color:#6c6f69">Does the hardcover come with the PDF too?</span></p>', url: 'https://example.com/admin/support' },
  'provider-terms': { name: 'Ada', version: 'v2', signed: 'v1', body: '<p style=\"margin:0 0 14px;font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#0c0d0b\">The terms go here, from the body of content/providers.md.</p>', url: 'https://example.com/app/coaching?terms=1' },
  campaign: { name: 'Ada', subject: 'A note from the shelf', body: '<p style="margin:0 0 14px;font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#0c0d0b">The written email goes here — a step of a funnel, or a blast, from its markdown.</p>', unsubscribe_url: 'https://example.com/functions/v1/email-unsubscribe?u=0000&t=0000' },
  'session-booked': { name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' },
  /* the three moments a booking that waits passes through, with the same facts as one that does not */
  'session-held': { name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' },
  'session-to-confirm': { name: 'Coach Person', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Ada', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching', answers: [{ label: 'What would you like to work on?', value: 'Deciding whether to take the job' }] },
  'session-declined': { name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' },
  'session-moved': { name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' },
  'session-cancelled': { name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' },
  'session-reminder': { ...{ name: 'Ada', title: 'One on one', when: 'Tuesday 7 July, 09:00 (Amsterdam)', with: 'Coach Person', where: 'In person at The studio, Keizersgracht 123, Amsterdam', join: '', manage: 'https://example.com/app/coaching' }, in: 'in 24 hours' },
  'event-reminder': { name: 'Ada', title: "The members' call", what: "The members' call", when: 'Tuesday 7 July, 18:00 (London)', with: 'Coach Person', where: 'Online', join: 'https://example.com/spaces/the-practice', manage: 'https://example.com/spaces/the-practice', in: 'in 24 hours' },
  'course-lesson': { name: 'Ada', course: 'Writing well', lesson: 'Finding the first line', url: 'https://example.com/courses/writing-well/first-line' },
  'course-complete': { name: 'Ada', course: 'Writing well', url: 'https://example.com/courses/writing-well', certificate: 'https://example.com/certificates/3f2a9c' },
  /* a Go token is filled from $go in a preview or a test; Supabase fills the real one */
  'magic-link': { $go: { ConfirmationURL: 'https://example.com/#confirmed', Email: 'ada@example.com' } },
  recovery: { $go: { ConfirmationURL: 'https://example.com/?recovery=1', Email: 'ada@example.com' } },
  invitation: { $go: { ConfirmationURL: 'https://example.com/admin/social?invitation=accepted', Email: 'ada@example.com' } },
}
