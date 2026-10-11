interest* = ChoiceInput(
  | question = What is your interest?
  | choices = Interior Design, Photography, Cooking
)

::: [{$ interest $}]
{% if interest == "Interior Design" %}
roomStyle = PictureChoice(
  | question = Which room style appeals to you most?
  | choices = Contemporary && /rooms/contemporary.jpg, Traditional && /rooms/traditional.jpg, Industrial && /rooms/industrial.jpg
)
{% endif %}
:::
