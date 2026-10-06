# 08: Answer and skip questions

**Blocked by:** 05 (generation happy path); root `.scratch/server-contract/issues/01-apply-answer-and-limits.md` (shared `applyAnswer`)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md)

**What to build:** A user answers "What's your phone number?" and sees it in the contacts; ticks
two skills and sees them in the skills block; says "yes" to an unconfirmed bullet and it returns;
skips a question and the field stays empty; after the last question the CV is `ready`. The answer
is also kept as a fact for the next generation.

- [x] `POST /api/cvs/:id/questions/:questionId/answer`: `404` for a foreign CV or an unknown question; `409 INVALID_STATE` when the CV is not `needs_input`, the question is not `open`, the body's `kind` differs from the question's, or the question's target item no longer exists; body validated by the shared `answerSchemaFor(question)` → `400 VALIDATION_ERROR`
- [x] A `confirm` "yes" is kept as a fact whose answer is the claim itself (the verifier reads only the answers of facts, backend architecture §4), so a confirmed bullet passes verification in later generations
- [x] The answer is applied with the shared `applyAnswer`, the result parsed by `CvData`; in one transaction: `data`, `facts` appended with `{ question, answer }`, question `answered` with `answered_at`, `version + 1`, and CAS `needs_input → ready` when no open question is left; `200 { cv }`
- [x] `POST …/skip`: `text`/`choice`/`multi` only (`confirm` → `409 INVALID_STATE`); question `skipped`, data unchanged, `version` unchanged, CAS to `ready` when it was the last open one; `200 { cv }`
- [x] No hourly limit on answers (an answer makes no model call; nothing counts it)
- [x] e2e: a text answer lands in its field; a `skills`-block text answer "Node.js, Docker" becomes two skills; the experience-block answer becomes a new job entry with bullets; `multi` with ticked + other appends without duplicates; `confirm` yes restores the bullet and no doesn't; skipping the last question makes the CV `ready`; answering an answered question is `409`; the fact appears in the next generation's `<user_facts>` (fake model records the prompt); isolation matrix extended
- [ ] Manual check on `pnpm stack`: answer and skip from the questions panel, status badge flips to Ready — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet, so no draft to answer
