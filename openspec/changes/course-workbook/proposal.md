# Proposal

## Why

Course lessons end with a practice and a journal prompt, and the reader is sent to a paper notebook to answer them. The answers are lost to the course: a lesson that says "you'll come back to this page at the end" has no page to come back to, and a coach working with the reader never sees what they wrote. Courses that work as workbooks keep the writing in the lesson, keep it with the reader, and let it be shared on the reader's terms.

## What Changes

- **A lesson can carry a form.** A text lesson names a form in the course file (`form: <slug>`). The form appears in the lesson, under its text, where the practice is. The course file also says whether answering is needed (`answers: required` or `answers: optional`, optional by default). With `required`, the lesson can't be completed until the form is finished. With `optional`, the lesson completes as a text lesson does, answered or not.
- **The form keeps the reader's answers and lets them change them.** A form can be marked as a workbook form. The reader's response opens again with everything they wrote, and changes replace the earlier answers rather than starting a new response. There are no scores, no right answers, and no "already submitted".
- **A new input: an ordered list.** The reader adds as many text rows as they like and drags them into order. The question can say what the order means ("highest first"). The answer is stored as the rows in their order. It works in any form, not only course forms.
- **A workbook page for each course** (`/courses/<slug>/workbook`, and the same in the community). It shows every answer the reader has given in the course, by module, with a print or save-as-PDF button. It's linked from the course page and the player.
- **One form per lesson holds both the practice and the journal prompt** as its questions; the lesson text keeps the teaching.
- **Answers are private to the reader.** Not even a site administrator reads them, unless they are also a coach the reader shared with. From the workbook page, the reader can share a course's workbook with a particular coach and later withdraw it. A coach sees the workbooks shared with them and no others. Each share is its own record (reader, coach, course, when granted, when withdrawn).

## Non-goals

- Sharing with anyone who isn't a coach on the site, or a public link.
- Coaches commenting on answers. That can come later on top of sharing.
- Showing an earlier answer inside a later lesson. That's worth doing once the workbook exists, as a separate change.

## Capabilities

### Modified Capabilities

- `courses`: a lesson's form, required or optional answers, the workbook page, and sharing with coaches.
- `forms-api`: the workbook form (answers kept and editable, private) and the ordered-list input.

## Impact

- Forms: the parser and composer (the new input in the forms language), the runner (rows, add, remove, reorder by drag and keyboard), the `form` function (a workbook response reopened and revised), and `25-forms.sql` (who can read a workbook form's answers).
- Courses: `courses-io` (`form`, `answers`), `46-courses.sql` (completion with required answers, the share record, the coach's read), the player, the overview, the workbook page, and the admin course builder.
- Documentation pages for forms and courses. The demo gets a workbook lesson with an ordered list.
- DharmaLab (its own repo): workbook forms for the first three modules, and the first module renamed "Your circumstances".
