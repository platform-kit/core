accountType* = ChoiceInput(
  | question = What type of account would you like to create?
  | choices = personal, business
)

---
-> accountType == "business"
|> 75%
=| end

businessName* = TextInput(
  | question = What is your business name?
)
