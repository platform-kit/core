tripType* = ChoiceInput(
  | question = What type of trip would you like to book?
  | choices = One-way, Round trip
)

::: [{$ tripType $}]
{% if tripType == "Round trip" %}
returnDate = DateInput(
  | question = Return date
)
{% endif %}
:::
