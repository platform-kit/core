wantSMS* = ChoiceInput(
  | question = Would you like to receive SMS notifications?
  | choices = Yes, No
)

::: [{$ wantSMS $}]
{% if wantSMS == "Yes" %}
mobilePhone = TelInput(
  | question = Mobile phone number
)
{% endif %}
:::
