hasDocument* = ChoiceInput(
  | question = Do you have any supporting document?
  | choices = Yes, No
)

::: [{$ hasDocument $}]
{% if hasDocument == "Yes" %}
supportingDoc = FileInput(
  | question = Upload supporting document
  | description = You can upload PDF, image, or a Word document
)
{% endif %}
:::
