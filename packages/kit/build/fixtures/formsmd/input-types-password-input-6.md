createAccount* = ChoiceInput(
  | question = Would you like to create an account?
  | choices = Yes, No
)

::: [{$ createAccount $}]
{% if createAccount == "Yes" %}
accountPassword = PasswordInput(
  | question = Create a password
  | description = Must be at least 8 characters long
)
{% endif %}
:::
