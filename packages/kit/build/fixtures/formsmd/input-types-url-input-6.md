hasPortfolio* = ChoiceInput(
  | question = Do you have a portfolio website?
  | choices = Yes, No
)

::: [{$ hasPortfolio $}]
{% if hasPortfolio == "Yes" %}
portfolioUrl = URLInput(
  | question = Portfolio website URL
)
{% endif %}
:::
