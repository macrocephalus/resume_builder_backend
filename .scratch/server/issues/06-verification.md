# 06: Verification: no invented facts

**Blocked by:** 05 (generation happy path)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md) · design: `backend/docs/architecture.md` §3–§4, ADR 0004

**What to build:** A user whose source says nothing about "led a team of 12" never sees it in the
draft as a fact: the model is told what it could not prove and gets to fix it; what still fails is
removed and comes back as a yes/no question showing the claim, a cleared field becomes a question,
unconfirmed skills go to a tick-what-applies question, and the editor shows "12 bullets confirmed
by quotes from your text, 2 sent to you to confirm, 1 skill moved to suggestions". This works for a
Ukrainian source and an English CV. Never cut.

- [x] `verifyDraft(submission, source, facts)` is pure and returns problems by path, with the normalisation (lower-case, collapsed whitespace, unified quotes and dashes, phones by digits) and the per-field rules of architecture §4: bullets need an evidence quote ≥ 8 chars found in source or facts with every number of the bullet inside it; titles, companies, institutions, degrees, project names, certification names/issuers and language names need a substring or a quote; periods and years need every number present; language levels present; email, phone, links verbatim; skills present or quoted; the summary's numbers and skill-like tokens already verified; question targets exist; requirements bounded with ≥ 1 keyword; suggested roles ≤ 3 and ≤ 100 chars
- [x] `submit_draft.execute` runs the verifier and returns `{ accepted: false, problems }` with one readable line per problem ("experience[1].bullets[2]: quote not found in source — quote verbatim or drop the claim"); the loop continues to a revision step and stops on `accepted`
- [x] `sanitise` is pure and turns the last schema-valid submission's remaining problems into changes: a failed bullet is removed and becomes a `confirm` question with the claim; a cleared field becomes a `text` question (a `choice` for a language level); unconfirmed skills are removed and, together with uncovered `skill` requirements (via the shared `computeMatch`), form one `multi` question with ≤ 8 options; invalid requirements and over-long roles are dropped or trimmed; the summary loses unverified numbers and tokens and gets an auto question if it ends empty
- [x] `selectQuestions` is pure: at most 12 open questions, kept in the order auto → `confirm` (≤ 5) → the `multi` → model (≤ 7, in the model's order); a question with a missing target is dropped
- [x] `verification` counts `{ verified, sentToConfirm, skillsToConfirm, cleared }` are stored and returned
- [x] Unit tests (highest priority of the backend): invented bullet → `confirm`; bullet with a wrong number → `confirm`; unknown skill → `multi` option; wrong year → cleared + `text`; a Ukrainian source with an English CV passes with Ukrainian quotes and intact numbers, and fails when a quote is paraphrased; caps and priority of `selectQuestions`
- [x] e2e with the fake model: a first submission with an unprovable bullet gets problems and a second corrected one is accepted (two steps, `stage` went through `revising`); a submission that stays wrong after three steps ends `needs_input` with a `confirm` question and the counts
- [ ] Manual check on `pnpm stack` with a real key: a source with a deliberately vague bullet produces a `confirm` question, and the counts show in the editor — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet
