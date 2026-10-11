#! title = Every kind
#! page-progress = show
#! once = true
#! respond = anyone
#! embed-origins = https://example.com, http://localhost:3000
#! webhook = https://example.com/hook
#! pass = 1
#! score = pick: b
#! accent = #0066ff

```data
{
  "brand": "Acme",
  "plans": ["Free", "Pro"]
}
```

-> start -> Go

# Hello from {$ brand $}

[.text-center]
A start slide.

---
|> 1/4

name* = TextInput(
	| question = Your name
	| placeholder = Name
	| maxlength = 40
)

email = EmailInput(| question = Email | placeholder = a@b.c)
site = UrlInput(| question = Site)
phone = TelInput(| question = Phone | country = GB | availableCountries = GB, US)
secret = PasswordInput(| question = Secret)
age = NumberInput(| question = Age | min = 0 | max = 120 | unitEnd = years)
about = TextInput(| question = About | multiline)

---
|> 2/4

plan* = SelectBox(
	| question = Plan
	| options = "free" Free, "pro" Pro, Other
	| selected = free
)

pick* = ChoiceInput(
	| question = Pick one
	| choices = "a" A, "b" B, C
)

many = ChoiceInput(
	| question = Pick several
	| choices = One, Two, Three
	| multiple
	| horizontal
)

::: [{$ pick $}]
{% if pick == 'C' %}
pickOther* = TextInput(
	| question = Which?
	| labelStyle = classic
)
{% endif %}
:::

---
-> plan == 'pro'
|> 3/4

picture = PictureChoice(
	| question = A picture
	| choices = Sun && https://example.com/sun.png, Moon && https://example.com/moon.png
	| supersize
)

stars = RatingInput(| question = Stars | outOf = 7 | icon = heart)
nps = OpinionScale(| question = Likely? | startAt = 1 | outOf = 5 | labelStart = No | labelEnd = Yes)

---
|> 4/4

when = DateInput(| question = When | min = 2024-01-01)
at = TimeInput(| question = At)
stamp = DatetimeInput(| question = Stamp)
file = FileInput(| question = File | sizeLimit = 2 | imageOnly)
said = VoiceInput(| question = Say it | maxLength = 90)
seen = VideoInput(| question = Show me | maxLength = 30)

::: [.col-6 #half]
Half a row, kept as it is.
:::

{% if plan == 'pro' %}
A line for pros only.
{% else %}
A line for everyone else.
{% endif %}

---
-> end -> https://example.com/done

# Thanks, {$ name $}
