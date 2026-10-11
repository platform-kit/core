---
scope: forms
---

## runner

### buttons

next: Next
ok: OK
start: Start
previous: Previous
restart: Restart
submit: Submit

### messages

required: This is required.
choice-required: Please select an item in the list.
number-choice-required: Please make a selection.
select-required: Select an option
invalid-email: Please enter an email address.
invalid-url: Please enter a web address (https://…).
invalid-phone: Please enter a phone number.
invalid-number: Please enter a number.
number-min: At least {min}.
number-max: At most {max}.
invalid-date: Please use the YYYY-MM-DD format.
invalid-datetime: Please use the YYYY-MM-DDTHH:mm format.
invalid-time: Please use the HH:mm format.
date-min: On or after {min}.
date-max: On or before {max}.
too-long: At most {n} characters.
invalid-pattern: Please match the requested format.
file-size-error: File exceeds the size limit.
file-image-only: Choose an image.
slide-error: Something above needs your attention.
not-sent: Your answers could not be sent. Try again.
try-again: Try again

### fields

text-placeholder: Type your answer here...
number-placeholder: Type a number here...
select-placeholder: Select an option
choose-many: Choose as many as you like
textarea-new-line: to add a new line
star-singular: star
star-plural: stars
nps-label-start: Not likely at all
nps-label-end: Extremely likely
file-choose: choose a file
file-drag: or drag it here
record-voice: Record an answer
record-video: Record a video
record-again: Record it again
record-stop: Stop
record-discard: Throw it away
record-left: {time} left
record-denied: We could not reach your microphone or camera. Check what this site is allowed to use.
record-unavailable: This browser cannot record. Answer another way, or come back on a desktop.
file-change: Change
file-remove: Remove the chosen file
file-size-limit: Size limit
file-currently: Currently
country-calling-code: Country calling code
phone-number: Phone number
page-progress: Page progress (%)
loading: Loading
required-mark: required

## end

### form

title: Thank you
subtitle: Your response has been recorded.

### page

title: Thank you
subtitle: You've reached the end.

### state

already: You've already answered this one.
closed: This form is closed.
signin: Sign in to answer this form.
signin-button: Sign in
pay: This one is paid for before it is answered.
pay-line: Somebody reads every word of it, which is why.
pay-button: Pay and begin
pay-going: Taking you to the checkout…
score: {score} of {total}
passed: Passed
failed: Not this time
off: There is no such form.

## embed

### refused

heading: This form cannot be shown here.
body: The page it is on is not one the form allows.

## admin

### list

title: Forms
lead: Build forms and collect responses.
new: New form
empty-title: No form yet
empty-body: A form is a few questions on slides — a contact form, a survey, a quiz, an application — answered on its own page, on a landing page or on another site, every answer kept the moment it is given.
empty-cta: Make the first
col-title: Form
col-on: On
col-fields: Fields
col-slides: Slides
col-state: State
on: On
off: Off
quiz: quiz
once: once
warnings: {n} warnings
errors: will not build

### views

build: Build
settings: Settings
share: Share
responses: Responses

### slides

heading: Slides
add-slide: + Slide
add-field: + Field
add-text: + Text
start: Start
body: Slide {n}
end: End
single: The page
shown-when: shown when {cond}
progress-line: {p}%
empty: Nothing on this slide yet.
raw: Kept as written

### slide

heading: This slide
type: Kind of slide
type-start: A start slide
type-body: A slide
type-end: The end
button: Button text
redirect: Send them to (a url, once done)
jump: Show this slide only when
progress: Progress
progress-hint: percent; blank lets the form count
align: Button alignment
align-start: Left
align-center: Centre
align-end: Right
align-stretch: Full width
disable-prev: No going back from here
post: Post the answers so far here
remove: Remove this slide

### field

heading: This field
kind: Kind
name: Name
name-hint: what the answer is filed under; letters and numbers
question: Question
description: Description
required: Required
placeholder: Placeholder
label-classic: Small label
size-small: Small field
multiline: Several lines
maxlength: Most characters
record-length: Longest recording (seconds)
pattern: Must match (a pattern)
value: Starts as
country: Country
countries: Countries offered
min: Least
max: Most
step: Step
unit: Unit before
unitend: Unit after
options: Options
option-label: Label
option-value: Value (if different)
add-option: + Option
selected: Chosen at first
choices: Choices
add-choice: + Choice
image: Picture (a url)
upload: Upload
multiple: Several may be chosen
horizontal: In a row
supersize: Large
hidelabels: Hide the labels
hideformtext: Hide "choose as many"
checked: Chosen at first
outof: Out of
icon: Icon
icon-star: Stars
icon-heart: Hearts
startat: Starts at
labelstart: Label at the start
labelend: Label at the end
sizelimit: Size limit (MB)
imageonly: Pictures only
condition: Show this field only when
condition-none: always
bind: Add an answer to the question
remove: Remove this field
move-up: Earlier
move-down: Later

### condition

field: Field
op: Is
value: Value
add: + And
none: Always shown
is: is
isnot: is not
contains: contains
gt: is more than
lt: is less than
set: is answered
unset: is not answered
custom: A condition written by hand: {cond}
clear: Clear it
and: and

### text

heading: Text
hint: Copy between the fields — a heading, a paragraph, a list.
bind: Show an answer in the text
bind-pick: Pick a field to add its answer at the end

### kinds

text: Text
email: Email
url: Web address
tel: Phone
password: Password
number: Number
select: Drop-down
choice: Choice
picture: Picture choice
rating: Rating
scale: Opinion scale
date: Date
time: Time
datetime: Date and time
file: File
voice: Voice answer
video: Video answer

### settings

heading: Settings
title: Title
meta-description: Description (for the page's head)
name: File name
name-hint: given once
page: Shown as
page-form-slides: A form, slide by slide
page-slides: Slides, nothing posted
page-single: One page
page-progress: Progress bar
progress-show: Shown
progress-hide: Hidden
progress-decorative: Decorative
slide-controls: Previous and Next
controls-show: Shown
controls-hide: Hidden
restart: Offer a restart at the end
submit-text: Button text on a form slide
autofocus: Focus the first field on every slide
align: Button alignment
published: Published
once: One answer per person
respond: Who may answer
respond-anyone: Anyone
respond-authenticated: Anyone signed in
embed-origins: Sites that may embed it
embed-origin-placeholder: https://example.com
webhook: Send each finished response to (a url)
webhooks-api: Webhooks made through the Forms API
webhooks-none: None yet. A subscription is made through the Forms API, with a key of kind Forms.
webhooks-on: On
webhooks-off: Off
webhooks-last: last delivered {at}
quiz-heading: Scoring
quiz-lead: Mark the right answer on a choice field to make the form a quiz.
pass: Pass mark (right answers)
right: Right answer
right-none: not scored
delete: Delete this form
delete-hint: The file goes; the responses stay.

### share

heading: Share
page: Its own page
page-hint: no site chrome, in the site's design
embed: On another site
embed-hint: Put this where the form should appear. Add that site under Settings → Sites that may embed it.
typeform: With Typeform's embed
typeform-hint: Typeform's own embed library, pointed at this site: the form's id and this domain. The Forms API answers Typeform's client the same way.
section: On a landing page
section-hint: Add a Form section in the page builder and choose this form.
copy: Copy
copied: Copied

### save

dirty: Unsaved changes
clean: All changes saved
discard: Discard
save: Save
saving: Saving…
saved: Saved

## responses

### list

title: Responses
lead: Every response, as it came in.
form: Form
who: Who
started: Started
finished: Finished
score: Score
guest: Guest
unfinished: unfinished
all-forms: Every form
status: Status
status-all: Every response
status-done: Finished
status-open: Unfinished
export: Export CSV
empty: No responses yet.
count: {n} responses

### one

back: ‹ Responses
heading: Response
answers: Answers
files: Files
meta: Started {started} · finished {finished}
not-finished: not finished
webhook: Webhook
webhook-sent: delivered {at}
webhook-failed: failed: {error}
delete: Delete this response
