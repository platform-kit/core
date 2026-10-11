wantToRate* = ChoiceInput(
  | question = Would you like to rate our service?
  | choices = Yes, No
)

::: [{$ wantToRate $}]
{% if wantToRate == "Yes" %}
serviceRating = RatingInput(
  | question = Rate our service
)
{% endif %}
:::
