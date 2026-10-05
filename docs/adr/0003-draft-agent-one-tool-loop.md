# DraftAgent is a bounded tool loop with one validating tool

The model gets one tool, `submit_draft`, forced via `toolChoice`. Its `execute` runs the pure
verifier and returns the problems it found, so the model can fix its own unconfirmed claims; the
loop stops on accept or after 3 steps, and whatever still fails is removed and turned into
questions. The verifier's feedback means fewer questions for the user than removing everything
on the first failure, and since the only tool validates, a prompt injection in the source cannot
make the agent *do* anything.

## Considered Options

- **A single `generateText` / structured-output call, then sanitise** — simpler, but every
  claim the model could have fixed becomes a question for the user.
