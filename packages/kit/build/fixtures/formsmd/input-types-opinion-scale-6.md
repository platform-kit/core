wantFeedback* = ChoiceInput(
  | question = Would you like to provide detailed feedback?
  | choices = Yes, No
)

::: [{$ wantFeedback $}]
{% if wantFeedback == "Yes" %}
detailedFeedback = OpinionScale(
  | question = Rate your overall satisfaction
)
{% endif %}
:::
