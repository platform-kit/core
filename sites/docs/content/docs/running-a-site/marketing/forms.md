---
title: Forms
description: A form is a document — its slides, fields and logic — built in the admin, answered on its own page, on a landing page or on another site, every answer kept the moment it is given.
order: 34
sources: [packages/movable-types/src/components/FormAnalytics.vue, packages/movable-types/src/components/admin/FormBuilder.vue, packages/movable-types/src/components/admin/FieldInspector.vue, packages/movable-types/src/components/admin/ConditionEditor.vue, packages/movable-types/src/components/admin/FormsAdmin.vue, packages/movable-types/src/components/admin/FormResponses.vue, packages/movable-types/src/components/forms/FormRun.vue, packages/movable-types/src/content/ui/forms.md]
reviewed: 2026-10-01
---

A form is a few questions on slides — a contact form, a survey, an application, a quiz — that somebody answers one slide at a time, in the site's design. Every answer lands in the site's own database the moment a slide is finished, so a form left half-done is picked up where it was left, on any device; a finished response can be sent on to another system; and the admin shows every response and the numbers. Module: `forms`.

The form itself is a document in [forms.md](https://docs.forms.md)'s language, `content/forms/<name>.md`. You never see that language in the admin — the builder writes it — but a form written by hand in that language works too, and everything forms.md documents works here: its fifteen kinds of field, start and end slides, conditions, bindings, data blocks and free copy. What forms.md leaves to a Google Sheet, the site does itself.

## Building a form

**Forms → Forms** lists every form in the collections' grid (search, filter and sort as any index); **New form** asks for a title and opens the builder on a starter document (a start slide, one question, the end).

The builder has three views.

**Build** is the slides down the left — the start slide, the numbered slides, the end — each holding its blocks in order: a piece of **text** (a heading, a paragraph, a list), a **field**, or a construct written by hand that the builder has no control for (shown as *Kept as written*, and left exactly as it was). Pick a slide to edit what it says about itself; pick a block to edit it on the right. Drag a block by its grip to reorder it; **+ Field**, **+ Text** and **+ Slide** add to a slide.

A **slide** is a start slide (its button text), a slide, or the end (an address to send them to once done). A slide may be *shown only when* something earlier holds — a jump: the person goes past it when the condition fails. It may set its own progress (a percentage; blank lets the form count), the button's alignment, whether the person may go back from it, and whether to post the answers so far here.

A **field** is a kind from the list — Text, Email, Web address, Phone, Password, Number, Drop-down, Choice, Picture choice, Rating, Opinion scale, Date, Time, Date and time, File, **Voice answer**, **Video answer** — its question, a description under it, whether it is required, and the controls that kind has: a placeholder and a starting value; several lines, a most-characters, a pattern to match; a phone's country and the countries offered; a recording's longest run in seconds (a minute by default, because an unbounded recording is a file nobody meant to upload); a number's least, most, step and units; a drop-down's options and the one chosen at first; a choice's choices (each a label, and a value when it should differ), whether several may be chosen, in a row, large; a picture choice's pictures, by address or uploaded; a rating's count and icon; an opinion scale's ends and their labels; a date's earliest and latest; a file's size limit and whether pictures only. Every field may be *shown only when* — rows of a field, a comparison (is, is not, contains, is more than, is less than, is answered, is not answered) and a value, joined by *and*. A condition written by hand that rows cannot say is shown as it is and can only be cleared.

The field's **name** is what its answer is filed under: set from the question the first time, and editable after as an identifier. Change a name and the answers already given under the old one stay under it.

A piece of **text** is edited in the markdown editor. `{$ name $}` in it shows what somebody answered under that name — *Thank you, {$ name $}* on the end slide.

**Settings** holds what the document says about itself: its title and description (the page's head); how it is shown — a form slide by slide (the default), slides with nothing posted (a presentation), or one page; the progress bar (shown, hidden, or decorative); the Previous and Next controls; a restart at the end; the button text on a form slide; whether the first field takes focus on every slide; the button alignment. Then the site's own: **Published**; **One answer per person** (a second attempt from the same person is refused, and the end shows *You've already answered this one*); **Who may answer** (anyone, or signed-in people — a guest is asked to sign in first); the **sites that may embed it**; a **webhook** — an address every finished response is sent to. Under **Scoring**, mark the right answer on any choice, drop-down, picture, rating or scale field and the form is a quiz: the end slide says *4 of 5* and *Passed* or *Not this time* against the pass mark you set.

**Share** shows the three ways to a form — its own page, the snippet for another site, the landing section — every address the one the admin is open on — with a copy button each.

The save bar at the foot says whether there are unsaved changes; **Save** writes the file (and refuses, naming the line, a document that would not build); **Discard** reloads it.


## A form that raises a ticket

A desk that spends its first three replies asking *what version, what did you try, how urgent is it* is a desk doing work a form could have done. So a form may **be** the way a ticket is raised:

```
#! ticket = true              # or a category to file it under
#! ticket-title = summary     # the field whose answer titles it
#! ticket-priority = urgency  # the field whose answer sets the priority
```

When the answer is finished the ticket exists, carrying the **response** — so the answers stay where every other form answer lives and the desk reads them through it. One answer raises one ticket; a retry raises none.

On the desk this pays twice over. The answers are shown **at the head of the ticket**, so nobody asks for them again. And the list offers **a filter per field** built from the values the site's own questions actually got back — *the urgent ones*, *the ones about the person* — for fields this kit has never heard of. Nothing in the desk knows what a field means; it offers whatever was asked.

A long answer is left out of the filters: a paragraph is not a thing anybody filters by.

### Getting there with no chatbot in sight

A chat prompt's choices may point somewhere. An arrow at the end of a choice takes the person to a form or a page, and the choice is still recorded as any other:

```
- My item has not arrived yet.
- Something is not working -> form:report
- Read the refunds policy -> /content/docs/refunds
```

That is the whole of what a desk with no language model needs: a prompt somebody wrote by hand that still collects the four things nobody wants to ask one at a time over three days.

## A form somebody pays to answer

Some answers are worth money to have looked at. A coach reading a whole diagnostic — every answer, not the summary — and writing back is a thing a site can sell, and the form is where it is sold.

```
#! paid = diagnostic-reading
```

The form names an **offer by its sku** and says nothing about money: no price, no currency, no Stripe. A thing that is sold is a product file (`kind: form`), and there is one place that is true. Naming one makes the form answerable only by somebody signed in, because somebody has to be charged and told.

**It is a credit, not a flag.** Each purchase grants one — the shape a paid session uses — so paying twice means answering twice, which is what somebody buying a second reading has bought. It is checked before the first slide is taken and **spent when the answer is finished**, so a form somebody paid for and abandoned is still theirs to come back to.

The runner says so before the first question rather than after it: the pay screen, a button to the checkout, and a return straight back to the form so the answer is the next thing they see.

## Where a form appears

**Its own page**, `/form/<name>`: the form fills the window in the site's design — day and night, on a phone — with no site chrome. The page carries the form's title and description, is in the sitemap, and is prerendered.

**On a landing page**: in the page builder, add a **Form** section, choose the form, and give it an eyebrow, a heading and a lead if you like. The form runs inline, in the page.

**On another site**: put the snippet from Share where the form should appear —

```html
<div data-platformkit-form="contact"></div>
<script src="https://your-site/form.js" data-site="https://your-site" async></script>
```

— and add that site's address under Settings → *Sites that may embed it*. The form mounts in the page (no frame), in your site's design, and posts to your site; a page on a site not listed sees the form refuse.

**With Typeform's embed**: the same Share tab gives a snippet for Typeform's own embed library, pointed at this site (`data-tf-widget` with `data-tf-domain`) — the form appears in Typeform's frame, sized as Typeform's would be, and its callbacks fire. The form's responses and webhooks are also served to Typeform's client and to anything written for Typeform's API (see [the Forms API](/content/docs/building-a-site/forms-api)); the subscriptions made that way are listed, read-only, under the form's Settings.

## Answering

Somebody sees one slide at a time: its copy, its fields, and a button (*OK* on a form slide, *Next* otherwise, the start slide's own words first). Every field on the slide that is shown is checked before the slide goes — required, an address that is one, a number in its range, a date in its format, a file under its limit — and a line under the field says what is wrong. Enter in a text field goes on; the Previous and Next controls sit in the corner. A field or a slide behind a condition appears and disappears as the answers change. Progress runs along the top.

Each slide's answers are posted as it goes. A guest is known by their browser; a signed-in person by their account. Coming back — on the same device for a guest, on any for somebody — opens the form on the slide after the last one answered. The last slide closes the response; the end slide shows the document's own words, or *Thank you — your response has been recorded*, with a quiz's score, and a restart when the settings offer one.

## Responses and numbers

**Forms → Responses** is every response as it came in, in the same grid — the form, who (a person's name, or *Guest*), started, finished, a quiz's score — filtered by form and by finished or not above it (and by any column in it), with **Export CSV** for the rows shown (every answer a column). A row opens to its answers in the form's order, each with the moment it was given, files as links, and what became of the webhook.

**Forms → Form analytics** is the numbers, one form at a time: a card per form on the index (started, finished, completion, the last response), and the form's own page — the numbers with their sparks, started and finished a day (bars, or a line by the switch every analytics page shares), where people drop off step by step (reached, and how many left at each), and every question in the form's order with its answers counted by value: a choice's spread, a scale's distribution and average; a written answer is counted and read in Responses, never listed there.

## The words

Everything somebody reads on a form that is not the document's own — the buttons, the messages a field shows, the end slide's default words, *You've already answered this one* — is the `forms` strings scope, `content/app/ui/forms.md`, edited under Settings → UI strings. The builder's own labels are there too, under `## admin`.
