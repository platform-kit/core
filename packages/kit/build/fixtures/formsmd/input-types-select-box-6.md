jobTitle* = SelectBox(
  | question = What is your job title?
  | options = Developer, Designer, Manager
)

::: [{$ jobTitle $}]
{% if jobTitle == "Developer" %}
framework = SelectBox(
  | question = Which framework do you primarily use?
  | options = React, Vue, Angular
)
{% endif %}
:::
