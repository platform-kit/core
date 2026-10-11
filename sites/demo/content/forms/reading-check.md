#! title = Five questions on The Quiet Room
#! meta-description = Did the book stay with you? Five questions, four to keep it.
#! page-progress = show
#! restart-button = show
#! pass = 4
#! score = q1: Loud, q2: Once, q3: Away, q4: Ten, q5: Choice

-> start -> Begin

# How closely did you read?

Five questions from *The Quiet Room*. Four right and you have kept it.

---
|> 1/5

q1* = ChoiceInput(
	| question = The book says the modern day is not hard; it is…
	| choices = Long, Loud, Late, Lonely
)

---
|> 2/5

q2* = ChoiceInput(
	| question = A decision that becomes a door is one made…
	| choices = Once, Daily, Early, Together
)

---
|> 3/5

q3* = ChoiceInput(
	| question = In the quiet room, where does the phone go?
	| choices = Face down, On silent, Away, In a drawer nearby
)

---
|> 4/5

q4* = ChoiceInput(
	| question = How long is the room?
	| choices = Five, Ten, Twenty, As long as it takes
)

---
|> 5/5

q5* = ChoiceInput(
	| question = What the book says comes back, in the end, is not calm but…
	| choices = Sleep, Focus, Choice, Quiet
)

---
-> end

# That's the five.
