position* = ChoiceInput(
  | question = What is your position?
  | choices = Developer, Designer, Manager
)

::: [{$ position $}]
{% if position == "Developer" %}
languages = ChoiceInput(
  | question = Which programming languages do you use?
  | choices = JavaScript, Python, Java, C++
  | multiple
)
{% endif %}
:::
