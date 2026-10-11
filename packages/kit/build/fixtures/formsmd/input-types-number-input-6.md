wantToPurchase* = ChoiceInput(
  | question = Would you like to make a purchase?
  | choices = Yes, No
)

::: [{$ wantToPurchase $}]
{% if wantToPurchase == "Yes" %}
quantity = NumberInput(
  | question = How many would you like to purchase?
  | min = 1
)
{% endif %}
:::
