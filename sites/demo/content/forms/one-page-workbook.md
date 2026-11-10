#! title = One page, plainly
#! meta-description = Your notes on cutting a page down: what went, and what the page says now.
#! workbook = true
#! page-progress = hide
#! slide-controls = show

cuts* = ListInput(
  | question = Which words did you cut? Put the ones you miss least first.
  | placeholder = The first word you cut
)

---

left = TextInput(
  | question = What does the page say now, in one sentence?
  | multiline
)
