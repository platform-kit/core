#! title = Say hello
#! meta-description = A note to Northlight Press: what you are reading, what you are after.
#! page-progress = show
#! slide-controls = show
#! autofocus = all-slides

```data
{
  "press": "Northlight Press"
}
```

-> start -> Write to us

# A note to {$ press $}

Two minutes. Tell us who you are, what you're reading, and what you're after — a person reads every one.

---
|> 1/5

name* = TextInput(
	| question = What should we call you?
	| placeholder = Your name
)

email* = EmailInput(
	| question = And where do we write back?
	| description = We answer within two working days.
	| placeholder = you@example.com
)

---
|> 2/5

topic* = ChoiceInput(
	| question = What is this about?
	| choices = A book, An order, Membership, Something else
)

::: [{$ topic $}]
{% if topic == 'Something else' %}
topicOther* = TextInput(
	| question = Go on
	| labelStyle = classic
	| placeholder = In a few words
)
{% endif %}
:::

---
-> topic == 'An order'
|> 3/5

order* = TextInput(
	| question = The order number, if you have it
	| description = It is on the confirmation email.
	| placeholder = NP-0000
)

shipping = SelectBox(
	| question = How did it arrive?
	| options = On time, Late, Damaged, Not at all
)

---
|> 4/5

message* = TextInput(
	| question = Your message, {$ name $}
	| multiline
	| maxlength = 2000
)

mood = OpinionScale(
	| question = How are you finding the press so far?
	| startAt = 1
	| outOf = 5
	| labelStart = Cold
	| labelEnd = Warm
)

---
|> 5/5

when = DateInput(
	| question = Is there a day you'd like to hear back by?
	| description = Leave it blank and we answer as we go.
)

attachment = FileInput(
	| question = Anything to show us?
	| description = A picture of a damaged copy, a page you loved.
	| sizeLimit = 5
)

---
-> end

# Thank you, {$ name $}.

Your note is in. Someone will write to **{$ email $}** — and if you asked about an order, they will bring it with them.
