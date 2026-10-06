# DraftAgent is a bounded tool loop with one validating tool

The model gets one tool, `submit_draft`, and the instructions require answering only through it.
Its `execute` runs the pure verifier and returns the problems it found, so the model can fix its
own unconfirmed claims; the loop stops on accept, after 3 steps or on a step without a tool call,
and whatever still fails is removed and turned into questions. The verifier's feedback means fewer
questions for the user than removing everything on the first failure, and since the only tool
validates, a prompt injection in the source cannot make the agent *do* anything.

## Considered Options

- **A single `generateText` / structured-output call, then sanitise** — simpler, but every
  claim the model could have fixed becomes a question for the user.
- **`ToolLoopAgent` with `output: Output.object(DraftSchema)`** — the object comes typed, but AI SDK
  v7 parses it only from the final step and *throws* `NoObjectGeneratedError` on a schema error
  instead of sending it back to the model; verifier feedback would need a second tool and the
  model would write the draft twice, with nothing tying the final object to the checked one.
- **Forcing the tool with `toolChoice: { type: 'tool' }`** — `claude-sonnet-5-5` rejects forced
  tool use; the SDK then sends `auto` and throws `ToolChoiceViolationError` on a text reply, which
  would throw away a valid draft from an earlier step.

## Consequences

- Each tool lives in its own file (`agents/draft/tools/<name>.tool.ts`) as a factory that takes the
  attempt's context, so a second tool is a new file, not a change to the agent.
- A step that answers in text ends the loop; the attempt keeps the last schema-valid submission.
