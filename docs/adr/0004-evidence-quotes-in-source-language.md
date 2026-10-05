# Facts are verified through evidence quotes in the source language

The CV may be written in another language than the source, so a translated bullet can't be
found in the source as a substring. The model must back every text fact with a verbatim quote
from the source (or the user's facts) in the source's language, and the verifier checks the
quote is really there; numbers, emails, phones, URLs and technology names are language-neutral
and are checked directly against the source.

## Consequences

- A quote proves the fact exists in the source, not that its translation is faithful:
  translation quality is trusted to the model, numbers and names are not. The README says so.
- Confidence scores from the model are not used — there is nothing to check them against.
