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

### Requirement: An ordered list offers common answers and keeps within its bounds

An ordered list SHALL be able to offer preset answers (`options`) and answers the respondent gave earlier (`optionsfrom`, naming fields or references), shown as choices the respondent taps to add as a row. The respondent SHALL also be able to add rows of their own. A list SHALL be able to set the fewest rows (`min`) and the most (`max`). It SHALL refuse fewer than `min` rows, and offer no way to add a row past `max`. A choice input SHALL be able to take its choices from an earlier answer (`choicesfrom`).

#### Scenario: picking from common answers

- **WHEN** a list offers work, money and relationships with `min = 1` and `max = 5`, and the respondent taps money, adds "my sister" and drags it to the top
- **THEN** the answer is my sister, money; a sixth row can't be added; and an empty list is refused

Verified by: `build/forms.test.mts` and the input driven in a browser

### Requirement: A workbook form follows up on earlier answers

A workbook form SHALL be able to name earlier answers by reference (`#! uses = <name>: <form>.<field>`, or `[0]` for a list's top row), and use them in its questions and choices. It SHALL be able to be about each row of an earlier list in turn (`#! about = <name>: <form>.<field>`). Then the respondent has one response per row. The form asks about the top row first, and offers each further row as a choice. A reference from a form about a row SHALL read the answers given about the same row. When an answer a form refers to hasn't been given, the form SHALL ask for it first, in place, and keep it as the earlier form's answer.

#### Scenario: a follow-up on the situation chosen first

- **WHEN** a reader whose most-wanted change is money opens a later form that is about each of those situations
- **THEN** its questions name money; once it is finished, it offers to do the same for their second situation; and each situation's answers are kept apart

Verified by: `build/course-workbook-db.test.mts` and the course in a browser

#### Scenario: an earlier answer not given yet

- **WHEN** a reader opens a later form before answering the question it refers to
- **THEN** that question is asked first, in place, and the answer is kept as the earlier form's

Verified by: the course in a browser
