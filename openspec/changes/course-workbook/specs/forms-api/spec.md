## ADDED Requirements

### Requirement: An ordered list input

A form SHALL be able to ask for an ordered list: any number of single-line text rows, which the respondent can add, remove and reorder by dragging or with the keyboard. A required ordered list SHALL need at least one non-empty row. The answer SHALL be stored as the rows in the respondent's order, with empty rows dropped, and shown in that order wherever the response is shown.

#### Scenario: ranking what is going well

- **WHEN** a respondent answers "What parts of your life are going well? Highest first" with my work, my love life, my friendships, my health, then drags my health to the top
- **THEN** the stored answer is my health, my work, my love life, my friendships, in that order, and it reopens in that order

Verified by: `build/forms.test.mts` (parse and compose), `build/forms-db.test.mts` (stored order) and the input driven in a browser at 1280 and 390 px

### Requirement: A workbook form keeps the respondent's answers

A form SHALL be able to declare itself a workbook form. A signed-in respondent SHALL have one response to it, which reopens with their answers every time and which their changes revise. A workbook form SHALL have no score. Its answers SHALL be readable by the respondent and by the coaches they share them with (see `courses`), and by no one else. An administrator SHALL NOT read them, in the admin or the API, unless they are also a coach the respondent has shared them with.

#### Scenario: coming back to change an answer

- **WHEN** a reader finishes a workbook form, comes back a week later and changes one answer
- **THEN** the same response opens with every earlier answer, the changed answer replaces the old one, and there is still one response

Verified by: `build/forms-db.test.mts`
