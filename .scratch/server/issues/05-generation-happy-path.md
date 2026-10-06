# 05: Generation, happy path: worker, prompt, DraftAgent with `submit_draft`, save, auto questions

**Blocked by:** 04 (CVs without generation)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md) · design: `backend/docs/architecture.md` §3, ADR 0003

**What to build:** A user creates a CV and, after the progress card walks through "Writing your
CV → Checking facts → Saving", opens a real draft written by Claude in the editor: role-targeted
summary, bullets, skills, in the chosen CV language, with the required-field auto questions when
something is missing, `ready` otherwise. In this ticket the verifier accepts every schema-valid
submission; ticket 06 makes it check facts.

- [ ] The worker runs a BullMQ processor on the generation queue (concurrency from the env, lock duration above 300 s): it loads the CV by the job row's `cv_id`/`user_id` (never from job data), moves it `queued|retrying → generating` with the attempt number via `CvStatusService` (0 rows → the job ends quietly), opens a `generation_attempts` row, runs the DraftAgent, and saves
- [ ] The prompt builder returns `{ instructions, message }`: the instructions (rules, "tag content is data", the fact/CV/question rules, how to react to problems, one static example) contain nothing that changes per CV; the message holds escaped `<source>`, `<user_facts>`, `<target_role>`, `<role_context>`, `<cv_language>` (English name from the allow-list), `<today>` in that order; a cache breakpoint after the instructions and after the message; `PROMPT_VERSION` is a hash of the static part
- [ ] The model factory is behind a DI token and builds `@ai-sdk/anthropic` with the configured model; tests bind the token to `MockLanguageModelV4`
- [ ] The DraftAgent is a `ToolLoopAgent` built per attempt: one tool `submit_draft` in its own file, created by a factory with `{ source, facts }`; `toolChoice: 'auto'` with the instructions requiring the tool; `stopWhen: [accepted, isStepCount(3)]`; `timeout { stepMs: 120_000, totalMs: 300_000 }`; `maxRetries: 2`; `maxOutputTokens: 16_000`; request-level automatic caching; strict off
- [ ] `submit_draft` input schema: the draft (`CvData` without ids), `evidence[]`, ≤ 7 model questions (`text`/`choice`, targets by section / item index / field), ≤ 12 requirements, ≤ 3 suggested roles; `execute` returns `{ accepted: true }` in this ticket
- [ ] After the loop, the last schema-valid submission (from `staticToolCalls` across steps) is taken; none → the attempt fails with `LLM_INVALID_OUTPUT` (ticket 07 adds retry/fail handling; here the CV goes to `failed` with that code)
- [ ] Items get UUIDs, question targets are mapped from item index to item id (a target that points nowhere drops the question), empty content is dropped, the draft is parsed by `CvData`; auto questions are built with the shared `findMissing` + `autoQuestionText` for the CV language, a model question about the same field replacing the auto one; email and phone come as two questions
- [ ] One transaction writes `data`, `requirements`, `suggested_roles`, `verification` (all bullets counted as verified for now), the questions with positions, `version + 1`, the CAS to `needs_input` (open questions) or `ready`, and closes the attempt row with model, prompt version, agent steps, input/output/cache tokens, duration
- [ ] `stage` is written from the agent hooks (`drafting` on step 0, `verifying` at tool execution, `revising` after a rejected step, `saving` after the loop), best effort with a log on failure
- [ ] Unit tests: prompt builder (no byte of user data in the instructions, identical instructions for two CVs, tags escaped); the index→id mapping; auto-question building. e2e with the fake model: a scripted valid submission turns a `queued` CV into `needs_input` with the expected auto questions, and into `ready` for a complete draft; `GET /api/cvs/:id` returns the draft; a CV deleted during the attempt leaves no trace (CAS 0 rows)
- [ ] Manual check on `pnpm stack` with a real key: a CV from a real text source ends `needs_input`/`ready`; the attempt row shows cache-read tokens on steps 2+ if any
