# Backend

Words the server uses for generating, verifying and storing CVs. Product terms (CV, Source, Draft,
Question, Fact…) live in [shared/GLOSSARY.md](../shared/GLOSSARY.md).

## Language

**Generation job**:
The queued work of turning one CV's source into its draft; it runs as one or more attempts.
_Avoid_: task, run, generation request

**Attempt**:
One try of a generation job; a failed attempt is retried automatically until the limit, and each one is recorded.
_Avoid_: retry, run, try

**Evidence**:
A verbatim quote from the source or the user's facts, in their own language, that a claim in the draft rests on.
_Avoid_: proof, citation, reference
