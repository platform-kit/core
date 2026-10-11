---
scope: models
---

## admin

### page

title: Models
lead: Custom content types and their entries.
new: New model
empty: No models yet. Make one, and its entries get a place under Content.
delete: Delete model
delete-confirm: Delete the model "{name}"? Its file goes; the entries stay on disk.
delete-refused: "{name}" has {n} entries. Remove them first.
delete-refused-one: "{name}" has one entry. Remove it first.
delete-hint: The model's file goes; nothing else does.

### grid

col-name: Name
col-key: Key
col-fields: Fields
col-entries: Entries
col-deliver: Delivery
col-on: Published
col-kind: Kind
core: core
custom: custom
core-lead: A model the kit or the site declares in code — its fields as the drawer draws them, read here and edited nowhere.

### builder

back: Models
untitled: Untitled model
name: Name
name-help: what the entries are called, in the plural
singular: Singular
key: Key
key-help: the folder under content/models and the address under /c
published: Published
tab-fields: Fields
tab-options: Options
tab-delivery: Delivery
save: Save
saved: Saved
saving: Saving…
save-anyway: Save anyway
keep-editing: Keep editing
discard: Discard
dirty: Unsaved changes
unsaved: Not saved yet
new: New model
new-lead: Name it, add its fields, choose how it is delivered. Nothing is written until you save.
field: Field
no-field: Pick a field on the left to edit it.
mark-title: title
mark-unique: unique
mark-shown: if
needs: A name and at least one field, to save.
would-fail: {n} entries would no longer pass
would-fail-one: 1 entry would no longer pass
rename-carried: Renamed in {n} entries.
kind-changed: The kind was changed under entries: check them before saving.

### fields

add: Add a field
empty: No fields yet. Add one to start.
none-selected: Pick a field to edit it.
key: Key
key-help: how the value is named in the file; made from the label until saved
label: Label
help: Help
help-help: a line under the control in the drawer
default: Default
required: Required
unique: Unique
unique-help: no two entries may share this value
grid: In the grid
grid-help: shown as a column on the entries' grid
kind: Kind
options: Options
options-add: Add an option
option-value: Value
option-label: Label
model: Model
many: Several
one: One
of: Rows of
subfields: Fields in the group
subfields-add: Add a sub-field
remove: Remove field
remove-confirm: Remove the field "{label}"? Its values stay in the entries, ignored.
rename: Rename
rename-prompt: The new key — every entry is carried along
rename-refused: That key is already in use

### shown

label: Shown when
help: the field is shown, and checked, only while this holds
none: Always
add: Add a condition
field: Field
is: is
is-not: is not
empty: is empty
not-empty: is not empty
value: Value
clear: Always shown

### rules

label: Rules
add: Add a rule
none: No rules — the kind's own check only.
rule: Rule
remove: Remove rule

### options

title-field: Title field
title-help: what names an entry: the grid, the pages, the head
slug: Slug from
slug-title: The title
slug-help: the file's name, made from this on New and editable until the first save
singleton: Singleton
singleton-help: one entry, edited inline — settings, a page's copy
body: Body
body-help: markdown under the fields, in the editor
body-label: Body label
access: Access
access-help: who may open an entry's page — leave empty for everyone
order: Order
order-by: By
order-dir: Direction
asc: Ascending
desc: Descending

### delivery

data: Data
data-help: the collection in the build, for the site's own code and sections — always on
pages: Pages
pages-help: a plain index and a page per entry, in the site's design
json: JSON
json-help: the published entries as one static file
section: Section
section-help: an Entries section in the page builder
address: Address
address-json: The file

## kinds

### text

name: Text
group: Text
line: one line

### long-text

name: Long text
group: Text
line: a paragraph or two

### markdown

name: Markdown
group: Text
line: prose in the editor

### number

name: Number
group: Text
line: a number

### boolean

name: Yes / no
group: Text
line: a switch

### date

name: Date
group: Text
line: a day

### datetime

name: Date & time
group: Text
line: a day and a time

### url

name: Web address
group: Text
line: a link

### email

name: Email
group: Text
line: an address

### select

name: Select
group: Choices
line: one of the options

### multi-select

name: Multi-select
group: Choices
line: several of the options

### tags

name: Tags
group: Choices
line: free words

### reference

name: Reference
group: Choices
line: an entry of another model

### image

name: Image
group: Media
line: a picture, uploaded or chosen from the library

### file

name: File
group: Media
line: a file, uploaded or chosen from the library

### group

name: Group
group: Structure
line: named sub-fields

### list

name: List
group: Structure
line: rows of one kind or a group

## groups

### text

name: Text

### choices

name: Choices

### media

name: Media

### structure

name: Structure

## rules

### required

name: Required
message: {field} is required.

### unique

name: Unique
message: {field} must be unique — another entry has this value.

### reference

name: Reference
message: {field}: no entry "{value}".

### type

name: Type
message: {field}: {value}

### min

name: At least
message: {field} must be at least {n}.
param: Minimum

### max

name: At most
message: {field} must be at most {n}.
param: Maximum

### between

name: Between
message: {field} must be between {min} and {max}.
param-min: From
param-max: To

### size

name: Exactly
message: {field} must be exactly {n}.
param: Size

### in

name: One of
message: {field} must be one of {list}.
param: Values

### not_in

name: Not one of
message: {field} may not be one of {list}.
param: Values

### regex

name: Matches a pattern
message: {field} is not in the expected form.
param: Pattern

### alpha

name: Letters only
message: {field} may hold letters only.

### alpha_num

name: Letters and digits
message: {field} may hold letters and digits only.

### alpha_dash

name: Letters, digits, dashes
message: {field} may hold letters, digits, dashes and underscores only.

### numeric

name: Numeric
message: {field} must be a number.

### integer

name: Whole number
message: {field} must be a whole number.

### digits

name: Digits
message: {field} must be {n} digits.
param: Digits

### url

name: Web address
message: {field} must be a web address.

### email

name: Email address
message: {field} must be an email address.

### date

name: A date
message: {field} must be a date.

### after

name: After
message: {field} must be after {value}.
param: Date

### before

name: Before
message: {field} must be before {value}.
param: Date

### starts_with

name: Starts with
message: {field} must start with "{value}".
param: Text

### ends_with

name: Ends with
message: {field} must end with "{value}".
param: Text

## drawer

### entry

slug: Slug
slug-help: the file's name and the address; editable until the first save
published: Published
unique: This must be unique.
add-row: Add a row
remove-row: Remove
no-rows: No rows yet.
none: None
pick: Choose…
upload: Upload
replace: Replace
remove: Remove
rename: Rename
rename-prompt: The new slug — the file and its address move with it

### foot

save: Save
create: Create
saving: Saving…
delete: Delete
cancel: Cancel
save-draft: Save draft
publish: Publish
publishing: Publishing…
publish-confirm: Publish "{title}"? It goes live and to the repository now.
published: Published.
draft: Draft

## pages

### index

empty: Nothing here yet.
all: All {name}
count: {n} {things}
count-one: 1 {thing}

### entry

back: Back to {name}
yes: Yes
no: No
none: —

## section

### layout

cards: Cards
list: List
heading: Heading
model: Model
limit: How many
limit-help: 0 shows every entry

## nav

### main

says: What it says
where: Where it goes
icon: Icon
who: Who sees it
cta: Button
cta-help: draw this one as the button at the end of the header; only one may be
add: Add a link
remove: Remove this link
reorder: Drag to reorder
own-path: A path of my own…
inheriting: This site has not set its own header, so it shows these:
nothing: nothing yet
start-from: Start from these

## tokens

### main

note: Every colour this look names. Change what you like; anything you have not changed is left to the look, so when the look is retuned this site follows it.
put-back: Put back
put-all-back: Put them all back
show-night: Night…
hide-night: Day only
at-night: at night
# where a colour applies — the same name can mean different things in different places
scope-site: The site
scope-landing: The landing pages
scope-qz: The diagnostic
scope-sp-page: The community
scope-reader: The reader

## enrichment

### run

many: One book at a time here. A whole-library pass is run from a checkout, where somebody is watching the bill.
not-opted-in: This site has not said yes to spending on a job. A whole book is dozens of model calls and the bill arrives afterwards, so switch it on in Settings first.
no-provider: There is nowhere to buy a thought — set a model key for this site before enriching a book.
not-allowed: Only an administrator can enrich a book.
sign-in: Sign in to enrich a book.
what-job: Nothing to enrich — choose a book.
already: That book is already being enriched; this is the run that is going.
spent: {amount} spent
of: of {amount}
queued: Queued
running: Working…
done: Finished — read it under Companions before you trust it
failed: Stopped
stop: Stop
clear: Clear
step: {stage}

## options

### main

name: Name
values: Values
add: Add an option
remove: Remove this option
up: Move up
down: Move down
derived: The {n} shapes this is sold in follow from the options above. A shape with no price of its own is sold at the offer's price.
v-shape: Shape
v-price: Price
v-sku: Its own sku
v-sold: Sold
drop-option: Drop {name}? {n} of the shapes it appears in carry a price of their own or are marked unsold, and those settings go with it.
move-option: Moving an option rewrites every shape's key, and {n} of them carry a setting that is keyed on it. Anything already in a basket under the old key will no longer be recognised. Move it anyway?
add-value: Add a value
remove-value: Remove this value
drop-value: Drop {name}? {n} of the shapes it appears in carry a setting of their own, and those go with it.
refresh: Read the catalogue again
reading: Reading the catalogue…
from: From {name}
added: {n} new.
dropped: {n} no longer made: {names}. Those shapes are off sale; anything already ordered still reads.
no-change: Nothing has changed.
value-gone: The supplier no longer makes this. It stays so an order that names it still reads.
variant-gone: Off sale: the supplier no longer makes one of these values.

## stock

### main

one: Every one
stocked: How many there are
held: {n} held
left: {n} left
movements: What has moved
moved: Recorded as {n}
same: That is what it already said
whole-number: A count is a whole number, and never less than none
no-backend: This deployment keeps no counts.
reason-received: Received
reason-sold: Sold
reason-reserved: Held for a checkout
reason-released: Released
reason-returned: Returned
reason-refunded: Refunded
reason-adjusted: Adjusted
reason-damaged: Damaged
reason-counted: Stock take
