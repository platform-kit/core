#! id = my-form
#! post-url = /api/verify-email

>> post

accountEmail* = EmailInput(
  | question = Enter your account email
)

---
verificationCode* = NumberInput(
  | question = Enter the verification code sent to your email
  | min = 100000
  | max = 999999
)
