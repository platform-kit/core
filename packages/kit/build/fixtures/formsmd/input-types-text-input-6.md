reason* = ChoiceInput(
  | question = What is your reason?
  | choices = A, B, C, Other
)

::: [{$ reason $}]
{% if reason == "Other" %}
otherReason = TextInput(
  | question = Please specify other reason
)
{% endif %}
:::
