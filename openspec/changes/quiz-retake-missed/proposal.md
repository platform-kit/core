# Proposal

## Why

A reader who fails a long quiz has to answer every question again, including the ones they got right. For a quiz of twenty-five questions that is a chore rather than a second chance. Learning platforms commonly let the author choose: retake the whole quiz, or retake only the questions that were missed.

## What Changes

- **A quiz says what a failed attempt retakes.** A new form setting, `#! on-failure`, is `retake-all` (the default, the whole quiz again, as today) or `retake-missed`.
- **Retaking only what was missed.** With `retake-missed`, the next attempt after a failed one asks only the questions answered wrong in it. The right answers are carried into the new attempt, and the attempt is graded on every question, so the score and the pass mark mean what they always have.
- **The builder sets it.** The form builder's scoring card offers the choice once the form has a pass mark.

## Non-goals

- Limiting the number of attempts, or a waiting time between them.
- Showing which answers were wrong, or the right answers.
