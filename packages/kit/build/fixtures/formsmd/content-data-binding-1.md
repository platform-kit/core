#! id = my-form

email* = EmailInput(
  | question = What's your email address?
)

---
# Welcome, {$ email $}!

Order confirmation will be sent to {$ email $}.
