wantMeeting* = ChoiceInput(
  | question = Would you like to schedule a meeting?
  | choices = Yes, No
)

::: [{$ wantMeeting $}]
{% if wantMeeting == "Yes" %}
meetingTime = TimeInput(
  | question = Preferred meeting time
)
{% endif %}
:::
