price* = NumberInput(
  | question = Price
  | subfield
  | min = 1
  | unitend = $
)

quantity* = NumberInput(
  | question = Quantity
  | subfield
  | min = 1
)

::: [.fs-lead .col-8 {$ price quantity $}]

{% if price and quantity -%}
  Total: ${{ price }} × {{ quantity }} = ${{ price * quantity }}
{% else -%}
  Total: Set price and quantity
{% endif %}

:::
