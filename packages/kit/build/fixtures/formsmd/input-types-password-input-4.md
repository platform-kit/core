password* = PasswordInput(
  | question = Create a password
  | description = Must contain at least one uppercase letter, one lowercase letter, and one number
  | pattern = ^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$
)
