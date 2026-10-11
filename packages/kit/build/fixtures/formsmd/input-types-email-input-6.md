wantAlternateEmail* = ChoiceInput(
  | question = Would you like to provide an alternate email?
  | choices = Yes, No
)

::: [{$ wantAlternateEmail $}]
{% if wantAlternateEmail == "Yes" %}
alternateEmail = EmailInput(
  | question = Alternate email address
)
{% endif %}
:::
