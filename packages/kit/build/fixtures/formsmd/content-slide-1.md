#! id = my-form

position* = ChoiceInput(
  | question = What's your position?
  | choices = Product Manager, Software Engineer, Founder, Other
)

---
|> 50%

referralSource* = ChoiceInput(
  | question = How did you hear about us?
  | choices = News, Search Engine, Social Media, Recommendation
)

---
-> referralSource == "Recommendation"
|> 75%

recommender = EmailInput(
  | question = Who recommended you?
)
