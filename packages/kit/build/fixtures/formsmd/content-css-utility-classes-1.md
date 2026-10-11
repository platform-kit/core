#! id = my-form

# [.form-question] Enter your address

[.col-6]
house* = NumberInput(
  | question = House #
  | subfield
)

[.col-6]
road* = NumberInput(
  | question = Road #
  | subfield
)

city* = TextInput(
  | question = City
  | subfield
)
