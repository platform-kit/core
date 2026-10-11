#! id = my-form

-> start
=| center

# [.text-center] Welcome to our survey!

[.text-center]
We appreciate you taking the time to share your feedback with us.

---
experience* = ChoiceInput(
  | question = How was your experience with our product?
  | choices = Excellent, Good, Fair, Poor
)
