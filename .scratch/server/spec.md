# Spec: the server, built to the contract

Status: done
Package: backend
Sources: `docs/api.md`, `docs/cv-statuses.md`, `@cv/shared` (`shared/`), root decisions log
`.scratch/backend/decisions.md`, frontend mocks `frontend/src/mocks` (how the server behaves),
[handoff.md](handoff.md)
Decisions behind this spec: [decisions.md](decisions.md) (Q1–Q28)
Design: `backend/docs/architecture.md`, `backend/docs/adr/`, `backend/GLOSSARY.md`

## Problem Statement

The frontend is finished and runs against mock handlers in the browser: sign up, create a CV for a
target role, watch the generation, answer questions, edit, download a PDF. None of it works for
real, because there is no server. `backend/` holds only a Dockerfile, a compose file and the
design. A reviewer who runs `docker compose up` with an Anthropic key gets an api container that
doesn't start.

A server written "roughly like the mocks" isn't enough. The task is graded on reliability. A
generation must survive a page reload, an api restart, a worker crash, a lost Redis and a flaky AI
service. The AI must not invent facts about the person. One user must never see another user's
CV. All of this has to match the contract the frontend already uses, down to status codes and
error codes.

## Solution

A NestJS api and a BullMQ worker, built from one image, that implement every endpoint in
`docs/api.md` and every status rule in `docs/cv-statuses.md`, with Postgres as the only source of
truth:

1. **Accounts and isolation.** Email + password sign-up and login set a JWT in an httpOnly cookie;
   every CV query is scoped to the signed-in user, and someone else's CV is indistinguishable from
   a missing one.
2. **Intake.** A PDF is checked and its text is extracted for the user to review; nothing is
   stored. A CV is created from text (or from another of the user's CVs for a new role) and its
   **generation job** is queued; the request returns at once.
3. **Generation.** The worker runs the DraftAgent, an AI SDK v7 tool loop with one validating tool
   `submit_draft`. Every **claim** in the draft must rest on the source or on the user's facts,
   through an **evidence** quote or a direct check. The verifier's problems go back to the model,
   which gets up to two revisions. What still fails is removed and turned into a question.
   Required fields that are still missing become auto questions. The draft, the questions and the
   status are saved in one transaction.
4. **Failures.** Transient AI failures are retried by **attempts** with backoff and are visible
   to the user as `retrying`. Configuration errors fail at once. A stalled or lost job is picked
   up again. A deleted CV discards its in-flight result.
5. **Questions, edits, PDF.** Answers go into the CV as written, through the shared `applyAnswer`.
   Manual edits use optimistic versioning. The PDF is rendered on the fly from the saved draft as
   A4 with selectable text.
6. **Limits.** At most 4 generations in progress per user, 10 started generations per hour, PDF
   intake 20 a minute, login 30 a minute.

The work is delivered as vertical slices. After each slice the real frontend works without mocks
against `pnpm stack`, a bit further than before.

## User Stories

### Running it

1. As a reviewer, I want `docker compose up` with only `ANTHROPIC_API_KEY` in `.env` to start the whole stack, so that I can try the product without any other setup.
2. As a reviewer, I want compose to stop with a clear error when `ANTHROPIC_API_KEY` is missing, so that I don't get a half-working app.
3. As a reviewer, I want the api to apply database migrations on its own at start, so that a fresh clone works without manual steps.
4. As a reviewer, I want the worker to start only after the api is healthy, so that it never runs against an unmigrated database.
5. As a reviewer, I want `GET /api/health` to report whether the api is up and the database answers, so that the container healthcheck is meaningful.
6. As a reviewer, I want my session to survive an api restart, so that restarting containers doesn't log me out.
7. As a reviewer, I want the backend to start on its own (`pnpm stack:backend`), so that it can be developed and checked without the frontend.
8. As an operator, I want a process with an invalid environment to stop at start with a message naming the bad variable, so that misconfiguration is found before the first request.
9. As an operator, I want structured JSON logs carrying request, user, CV and job ids, so that I can follow one generation across the api and the worker.
10. As a user, I want my source text, my answers and my password never to appear in logs, so that my data is not leaked through operations.
11. As an operator, I want `docker compose stop` to shut both processes down cleanly, so that a stop never corrupts data or leaves a CV stuck.

### Accounts

12. As a visitor, I want to sign up with an email and a password of 8–128 characters, so that I get my own space for CVs.
13. As a visitor, I want my email trimmed and lower-cased, so that "Ann@Example.com " and "ann@example.com" are the same account.
14. As a visitor, I want a clear `EMAIL_TAKEN` error when the email already has an account, so that I know to log in instead.
15. As a user, I want to log in and stay logged in for 7 days, so that I don't re-enter my password on every visit.
16. As a user, I want the same error for an unknown email and a wrong password, so that nobody can probe which emails have accounts by logging in.
17. As a user, I want repeated login attempts from one IP to be throttled at 30 a minute, so that my password cannot be brute-forced quickly.
18. As a user, I want logout to always succeed and clear my session cookie, even if it has already expired, so that logging out never fails.
19. As a user, I want `GET /api/auth/me` to tell the app whether I'm signed in, so that protected screens load correctly.
20. As a user, I want my session token kept in an httpOnly cookie the page script can't read, so that an injected script cannot steal it.

### Isolation

21. As a user, I want to see only my own CVs in the list, so that my data stays private.
22. As a user, I want every action on a CV that isn't mine (read, edit, answer, skip, retry, download, delete, poll, copy for a new role) to behave exactly as if it didn't exist, so that nobody can even confirm another user's CV exists.
23. As a user, I want a `userId` or other unknown field in a request body to be ignored, so that nobody can act as another user by editing a request.
24. As a user, I want the worker to take my identity from the stored job, never from a request, so that a generation is always saved into the right account.

### PDF intake

25. As a user, I want to upload a PDF CV and get its text back to review before generating, so that I can fix extraction mistakes.
26. As a user, I want a file that isn't a PDF to be rejected by its content, not its name, so that a renamed file can't slip through.
27. As a user, I want a PDF over 5 MB or over 10 pages rejected with `INPUT_TOO_LARGE`, so that I know to trim it.
28. As a user, I want a scanned or broken PDF rejected with `PDF_UNREADABLE`, so that I know to paste the text instead.
29. As a user, I want the response to show the page count, the character count and my file name, so that the form can show what was read.
30. As a user, I want nothing from an uploaded PDF stored on the server, so that a file I decided not to use is gone.
31. As an operator, I want PDF uploads throttled to 20 a minute per user, so that parsing can't be used to load the server.

### Creating a CV

32. As a user, I want to create a CV from my text, a target role, an optional role context and a CV language, so that the draft is aimed at the job I want.
33. As a user, I want invalid input (role under 2 or over 100 chars, source under 80 or over 20 000 chars, role context over 5 000, unknown language) answered with `VALIDATION_ERROR` naming the field, so that the form can point at it.
34. As a user, I want the request to return at once with my CV `queued`, so that the UI never waits on the AI.
35. As a user, I want the CV language to default to English, so that I don't have to pick one.
36. As a user, I want my CV's title to default to the target role, so that the list is readable without extra input.
37. As a user, I want `TOO_MANY_ACTIVE` when I already have 4 CVs generating, so that one account can't flood the queue.
38. As a user, I want `RATE_LIMITED` with `Retry-After` after 10 started generations in the last 60 minutes, so that I know exactly when I can start another.
39. As a user, I want only what I started (a CV created or a Retry pressed) to count toward the hourly limit, not the automatic retries, so that the server's own retries don't use up my allowance.
40. As the product owner, I want deleting a CV not to give back its generation from the hourly limit, so that create-and-delete can't get around the limit.
41. As a user, I want to see my usage (generations this hour with when the next one frees up, CVs in progress), so that I see a limit before I hit it.
42. As a user, I want my CV saved even if the queue is briefly unavailable when I press Create, so that I never lose my input and the generation starts once the queue is back.

### Following the generation

43. As a user, I want to see my CVs listed newest-changed first, with status, open-question count and match, so that I can find the one I need.
44. As a user, I want to poll the statuses of several CVs in one light request, so that the progress card updates every 3 seconds cheaply.
45. As a user, I want to see how many CVs are ahead of mine while it's queued, so that I know it's moving.
46. As a user, I want to see the current stage (writing, checking facts, fixing unconfirmed facts, saving), so that I know what the AI is doing.
47. As a user, I want to see "attempt 2 of 3" when an attempt failed and is being retried, so that I know the server is handling it.
48. As a user, I want to close the tab or reload during generation and find the result later, on any device, so that nothing is lost.
49. As a user, I want to delete a CV in any status, including while it generates, so that I'm never stuck with an unwanted CV.
50. As a user, I want a generation for a deleted CV to be silently discarded, so that a deleted CV never comes back.

### The draft and not inventing facts

51. As a user, I want a draft with contacts, a role-targeted summary, experience as bullet points, education, skills and the other blocks I have, most relevant first, so that I get a usable CV.
52. As a user, I want the CV written in the language I chose even when my source is in another language, so that I can apply abroad.
53. As a user, I want every experience bullet to rest on a verbatim quote from my source or my answers, so that the CV says nothing I didn't.
54. As a user, I want every number, email, phone, link and technology name checked against my source, so that no metric or contact is made up.
55. As a user, I want the AI to get a chance to fix claims the verifier rejected before anything is removed, so that I get fewer questions.
56. As a user, I want a bullet that still can't be confirmed turned into a yes/no question showing the claim, so that I decide whether it goes in.
57. As a user, I want skills my source doesn't confirm, together with the role's skills my CV doesn't cover, offered in one tick-what-applies question, so that only skills I confirm go in.
58. As a user, I want a field the verifier cleared (a title, a period, a language level) to become a question about that field, so that I can supply the real value.
59. As a user, I want required parts that are still missing (name, email or phone, summary, experience, skills, required fields of an item) always asked about, even if the AI forgot, so that the CV is complete.
60. As a user, I want email and phone asked as two questions, each saying one of them is enough, so that I'm not forced to give both.
61. As a user, I want the AI's own questions to cover what's unclear in my source, with choices only for standard answer sets like an English level, so that I'm never offered guessed facts to pick from.
62. As a user, I want at most 12 open questions per CV, required fields kept first, so that I'm not buried in questions.
63. As a user, I want my CV to be `ready` at once when nothing needs asking, so that I can download it right away.
64. As a user, I want a summary of the checks ("12 bullets confirmed, 2 sent to you to confirm, 1 skill moved to suggestions"), so that I can trust the draft.
65. As a user, I want the role's requirements extracted from the role and its context, so that I can see how well the CV matches the role.
66. As a user, I want up to 3 other roles my background fits suggested, so that I can make CVs for them too.
67. As a user, I want a source that isn't really a CV to give me a nearly empty draft with questions rather than an error, so that I can still build my CV by answering.
68. As a user, I want instructions hidden in my source, my role context or my answers to be treated as data, so that a pasted vacancy or a malicious PDF can't take over the AI.
69. As a user, I want the role context to shape focus and order but never to become a fact about me, so that a vacancy's wish list doesn't appear as my experience.

### Failures

70. As a user, I want an overloaded, rate-limited or briefly unreachable AI service retried automatically up to 3 attempts with backoff, so that a short outage doesn't fail my CV.
71. As a user, I want an unusable AI answer retried the same way, so that one bad answer doesn't fail my CV.
72. As a user, I want a generation that takes too long to fail with a timeout error and be retried, so that it can't hang forever.
73. As a user, I want a misconfigured server (bad API key, rejected request) to fail my CV at once with a clear message, so that I don't wait through useless retries.
74. As a user, I want a failed CV to keep its source and answers and to show the reason, so that Retry needs no re-upload.
75. As a user, I want Retry on a failed CV to start again from attempt 1 and count toward my hourly limit, so that I can recover from an outage.
76. As a user, I want a CV whose worker crashed mid-generation to be picked up again automatically, so that a crash doesn't leave it stuck in `generating`.
77. As a user, I want CVs to resume generating after the queue's data is lost, within a minute, without anyone restarting anything, so that a Redis failure loses no work.
78. As an operator, I want every attempt recorded with model, prompt version, agent steps, tokens (including cache reads and writes), duration and error, so that I can audit cost and failures.

### Answering and skipping

79. As a user, I want to answer a question and see the CV updated with my answer as written, so that the gap is filled.
80. As a user, I want my answer to a text question about a field written into that field, so that, for example, my phone appears in contacts.
81. As a user, I want my answer to a text question about the whole skills block split into separate skills by commas, semicolons or lines, without duplicates, so that "Node.js, Docker" becomes two skills.
82. As a user, I want my answer to the question about my experience to become a new job entry, one bullet per line, with title, company and dates left for me to fill in the editor, so that my experience shows up in the CV.
83. As a user, I want ticked skills from the tick-what-applies question added without duplicates, plus my own comma-separated ones, so that only confirmed skills go in.
84. As a user, I want "yes" on a confirm question to add the claim and "no" to add nothing, so that I control every unconfirmed statement.
85. As a user, I want to skip any question except a confirm question, leaving the field empty, so that I'm not forced to make something up.
86. As a user, I want my answers kept as facts for later generations (Retry, a CV for another role), so that I never answer the same thing twice.
87. As a user, I want the CV to become `ready` as soon as the last open question is answered or skipped, so that the status reflects reality.
88. As a user, I want an answer of the wrong kind, too long, or not among the options rejected with a validation error, so that bad input never reaches the CV.
89. As a user, I want answering a question that's closed, or on a CV that isn't waiting for answers, or whose item I deleted, to give `INVALID_STATE`, so that a stale screen can't corrupt the CV.
90. As a user, I want answers to have no hourly limit, so that I'm never blocked from finishing my CV.

### Editing

91. As a user, I want to save the whole edited draft and title with the version I loaded, so that my changes are stored.
92. As a user, I want a save from a stale tab or another device rejected with `VERSION_CONFLICT` and the current version, so that I never silently overwrite newer changes.
93. As a user, I want empty items and blank bullets, skills and links dropped when I save, so that the CV stays clean.
94. As a user, I want new items to keep the ids my browser gave them, with duplicate or malformed ids rejected, so that the editor keeps track of them.
95. As a user, I want open questions about an item I removed to be skipped, and the CV to become `ready` if none are left, so that I'm not asked about things I deleted.
96. As a user, I want filling a field by hand not to close the question about it, so that a question closes only when I answer or skip it.
97. As a user, I want editing to be refused while the CV has no draft, so that I can't edit something still being generated.

### PDF download

98. As a user, I want to download my CV as an A4 PDF with selectable text, so that applicant tracking systems can read it.
99. As a user, I want Cyrillic and other Latin-script languages rendered correctly in the PDF, so that a Ukrainian or Polish CV looks right.
100. As a user, I want the PDF's section headings in my CV's language and the blocks in my chosen order, with contacts first, so that it matches the preview.
101. As a user, I want empty fields and blocks left out of the PDF, with no "undefined" or bare headings, so that it looks finished.
102. As a user, I want the PDF named after my CV's title, so that downloads are easy to tell apart.
103. As a user, I want a damaged stored draft to give a clear server error instead of a broken PDF or a broken screen, so that corruption is visible, not hidden.

### Another role

104. As a user, I want to start a CV for a suggested role from a CV that has a draft, reusing its source and my answers, so that I don't re-enter anything.
105. As a user, I want that new CV to be a separate CV with its own generation, so that the original stays as it is.
106. As a user, I want copying from a CV that has no draft yet to be refused with `INVALID_STATE`, so that I don't copy something unfinished.

## Implementation Decisions

### Processes, packaging, tooling

- One image, two processes. The **api** is NestJS HTTP. On start it applies the committed Drizzle migrations and loads the JWT secret, then listens on 3000. The **worker** is a Nest application context without HTTP. It runs the BullMQ processor (concurrency 8, from the env) and the queue recovery.
- NestJS 11, CommonJS, built by `nest build` with SWC; `tsc --noEmit` for typecheck; oxlint; prettier. The stray `"type": "module"` package stub is replaced by the scaffold.
- The package ships `dist`, the migrations folder and the bundled fonts. Otherwise the deployed image lacks migrations and fonts.
- The environment is parsed by a Zod schema at start: database URL, Redis URL, Anthropic key, model (default `claude-sonnet-5-5`), worker concurrency, optional JWT secret override.
- Logging: nestjs-pino, JSON to stdout. Request, user, CV and job ids are attached where known, and AI errors are logged in full. Source text, answers, passwords and the cookie are redacted or never logged.
- Graceful shutdown: shutdown hooks on. On SIGTERM the worker closes without waiting out a long attempt, and BullMQ's stalled-job check recovers it. The api closes the Postgres pool and the Redis connection.
- Every request and response schema comes from `@cv/shared`. A single Zod validation pipe turns failures into `400 VALIDATION_ERROR` with `details.fields`. A single error filter produces the `{ error: { code, message, details } }` shape. Unexpected errors become `500 INTERNAL` with a generic message.

### Modules (deep modules, small interfaces)

- **Config** — env schema and limits: generations per hour, active per user, ingest per minute, login per minute, timeouts, question caps.
- **Database** — Drizzle schema, migration runner, the DB provider.
- **Auth** — signup, login, logout, me; argon2id; the JWT secret service; the session cookie (httpOnly, SameSite=Lax, Secure behind HTTPS, 7 days); a global guard that *verifies* the token, with an explicit public marker for signup, login, logout and health.
- **Ingest** — PDF checks and text extraction (unpdf): size, magic bytes, page count, minimum text. Stores nothing.
- **Cvs** — create, list, statuses, get, PATCH, delete, retry. `getOwned(id, userId)` is the only way any module reaches a CV, and a CV that is foreign or missing gives `404`. The mapper turns a row into `Cv` / `CvSummary` / `CvStatusInfo`, with the match from the shared `computeMatch`. Queue position = the number of `queued` CVs created earlier, all users, + 1. A pure PATCH step drops empty content and skips questions about removed items.
- **CvStatusService** — the only writer of `cvs.status`. It checks `canTransition` from `@cv/shared`, and every transition is a compare-and-set on the allowed from-statuses. 0 rows updated means the caller drops its result.
- **Limits** — counts started generations over a sliding 60 minutes from `generation_jobs` and CVs in progress. It answers `429 RATE_LIMITED` with `Retry-After` and `details.limit`, or `429 TOO_MANY_ACTIVE`. Serves `GET /api/usage`. `resetsAt` and `Retry-After` point at the moment the oldest counted generation leaves the window. The count-then-insert race is accepted.
- **Generation** — the producer writes the CV and its **generation job** row in one transaction, then adds the BullMQ job (jobId = job row id). If adding fails, it logs and still answers `202`. The processor moves the CV to `generating` with the attempt number, opens an **attempt** row, runs the DraftAgent and saves the result. A pure classifier maps errors to `{ code, retryable }`. The recovery runs on start and every 60 s: it re-enqueues CVs in `queued`, `generating` or `retrying` that have no live BullMQ job, and closes attempt rows left `running` as `failed` (`stalled`).
- **Questions** — answer and skip. The answer body is validated with the shared `answerSchemaFor`. The answer is applied with the shared `applyAnswer`, the result is re-parsed as `CvData`, and the question and answer are appended to `facts`. Data, question status, `version + 1` and the possible move to `ready` are written in one transaction. Pure auto-question building uses the shared `findMissing` and `autoQuestionText`, so the server never words an auto question itself. Pure question selection applies the caps and the priority.
- **Agents** — the LLM layer. It imports only `@cv/shared` and the AI SDK, and knows nothing about the DB, HTTP or the queue.
  - A model factory behind a DI token.
  - The prompt builder.
  - The DraftAgent.
  - One file per tool. A tool is a factory that takes the attempt's context; `submit_draft` takes `{ source, facts }`.
  - The pure verifier and sanitiser.
- **PDF** — pdfkit, A4 595×842 pt, 50 pt margins, embedded Liberation Sans Regular and Bold. Contacts first, then the blocks in `sectionOrder`, with headings from the CV language. Empty parts are skipped. One template behind a template type. The file name is the sanitised title.
- **Health** — `SELECT 1`, `200 { status: "ok" }` or `503`.

### Schema

- `users`: id, email (unique, lower-cased), password hash, created_at.
- `cvs`, as in the backend architecture:
  - owner, `parent_cv_id`;
  - title, `target_role`, `role_context`, language;
  - source type, filename and text, facts;
  - status, stage, attempt, max_attempts, error code and text;
  - `data`, requirements, suggested roles, verification;
  - version, timestamps;
  - index on `(status, created_at)`.
- `cv_questions`: kind, origin, text, label, options, claim, target, status, answer, position, created_at, answered_at; cascade from the CV.
- `generation_jobs` — one per started generation (a CV created or a Retry): id = BullMQ jobId, `cv_id` **set null** on CV delete, `user_id` cascade from the user, created_at. The hourly limit counts these rows.
- `generation_attempts` — one per attempt, cascade from the job: attempt number, status (`running|succeeded|failed`), model, prompt version, agent steps, input, output, cache-read and cache-write tokens, duration, error, timestamps. Audit only.
- `app_secrets` — name → value. The JWT secret is generated on the first start with insert-on-conflict-do-nothing, then read. A `JWT_SECRET` env variable overrides it.

### Queue

- BullMQ job options: `attempts: 3`, exponential backoff with a 5 s base, a 30 s lock that the worker renews while an attempt runs, so a dead worker's job is stalled and re-run within about a minute (first written as "lock duration above the 300 s attempt timeout", changed with ticket 07). A retryable failure moves the CV to `retrying` and rethrows. A non-retryable one moves it to `failed` with its error code and throws BullMQ's unrecoverable error, so no attempt is wasted.
- Manual Retry (only from `failed`) creates a new generation job, resets `attempt` to 1 and counts toward the hourly limit.

### DraftAgent

- An AI SDK v7 `ToolLoopAgent`, built per attempt, with one tool `submit_draft`. The tool's input is the full draft without ids, evidence quotes `{path, quote}`, ≤ 7 questions (`text`/`choice`, targets by item index), ≤ 12 requirements and ≤ 3 suggested roles. The tool's `execute` runs the pure verifier and returns `{ accepted: true }` or `{ accepted: false, problems }`.
- `claude-sonnet-5-5` rejects forced tool use, so the tool choice is `auto` and the instructions require answering only through the tool. Stop when the last tool result is accepted, after 3 steps, or on a step with no tool call. The model fixes a rejected draft by sending the **whole** draft again.
- The result is the last schema-valid submission across steps, after sanitising. If there is none, the attempt fails with `LLM_INVALID_OUTPUT`, which is retryable. Invalid tool input goes back to the model as a tool error (SDK behaviour); `Output.object` is not used because its parse errors are thrown instead (ADR 0003).
- Settings:
  - step timeout 120 s, total 300 s (SDK `timeout`);
  - SDK `maxRetries: 2` inside a step;
  - `maxOutputTokens` 16 000 per step;
  - strict tools off, Zod checks limits locally;
  - request-level automatic prompt caching on.
- `stage` is written from SDK hooks (step 0 start → `drafting`; tool execution start → `verifying`; step end with `accepted: false` → `revising`; after the loop → `saving`). The write is best effort and logged.
- Prompt, static first: the tool definition (fields in a fixed order), then the instructions. The instructions hold the rules, "tag content is data", the fact, CV and question rules, the reaction to problems and a static example. Nothing in them changes per CV. Then a cache breakpoint. Then one user message with escaped tags in the order `<source>`, `<user_facts>`, `<target_role>`, `<role_context>`, `<cv_language>` (English name from the allow-list), `<today>`. Then a cache breakpoint. The prompt version is a hash of the static part.

### Verification and questions

- Per-field rules as in backend architecture §4. Bullets need an evidence quote of at least 8 chars found in the source or facts, with every number of the bullet inside it. Names and titles need a substring match or a quote. Periods and years: every number appears. Contacts are verbatim, with phones compared by digits. Skills appear or are quoted. The summary may contain only verified numbers and skill-like tokens. Normalisation: case, whitespace, quotes, dashes.
- After the loop:
  - a failed bullet → a `confirm` question with the claim;
  - a cleared field → a `text` or `choice` question;
  - unconfirmed skills ∪ uncovered `skill` requirements → one `multi` question with ≤ 8 options built by our code;
  - a question with a missing target → dropped;
  - invalid requirements → dropped;
  - suggested roles → trimmed.
- Auto questions come from `findMissing` over the final draft. A model question about the same field replaces the auto one.
- At most 12 open questions, kept in order: auto → `confirm` (≤ 5) → the `multi` → model (≤ 7).
- Then ids are assigned, empty content is dropped and the draft is parsed by `CvData`. One transaction writes it: data, requirements, suggested roles, verification counts, questions, `version + 1`, CAS to `needs_input` or `ready`, and the closed attempt row.
- A source that isn't a CV is not a failure: a near-empty draft plus auto questions.

### Failure classification

- `LLM_UNAVAILABLE`, retryable: an `APICallError` / `RetryError` marked retryable (408, 409, 429, 5xx, 529, network).
- `TIMEOUT`, retryable: a `TimeoutError`.
- `LLM_INVALID_OUTPUT`, retryable: no schema-valid submission.
- `LLM_CONFIG`, not retryable: 401 or 403.
- `INTERNAL`, not retryable: any other 4xx or an unexpected error.
- The user-facing messages are the ones in `docs/cv-statuses.md`.

### Contract dependencies (root ticket, blocks two server tickets)

These are root-owned changes made during this grilling. They go in **one root ticket**:
- `applyAnswer` moves into `@cv/shared` with the block-level rules. A `text` answer to the whole `skills` block is split into separate skills. The answer to the `experience` block question becomes a new job entry, one bullet per non-empty line.
- The experience auto-question text changes in all six languages.
- The hourly answer limit is removed from `usageResponseSchema` and `api.md`.
- `docs/cv-statuses.md` §4/§5 (jobs vs attempts) and its `docs/uk` copy are updated.
- The frontend mocks switch to the shared `applyAnswer`.

The server's answer/skip ticket and usage ticket are blocked by it.

### Delivery order (vertical slices, each checked by the real frontend on `pnpm stack`)

1. Scaffold: package, api + worker, config, database + migrations, health, error shape, logging, e2e harness; the stack turns green.
2. Auth: signup, login (throttled), logout, me, JWT secret, guard.
3. Intake: PDF ingest with its limits and throttle.
4. CVs without generation: create (queued + job row + enqueue), list, statuses with queue position, get, delete, ≤ 2 active.
5. Generation happy path: worker, status service, prompt builder, DraftAgent with `submit_draft`, saving, auto questions.
6. Verification: verifier, revision loop, sanitise, verifier questions, question selection, verification counts. Never cut.
7. Failures: classification, `retrying`, `failed`, manual Retry, recovery, stalled attempts, shutdown.
8. Answer and skip, on the shared `applyAnswer` (blocked by the root ticket).
9. PATCH with versions.
10. PDF.
11. Usage and the hourly generation limit (blocked by the root ticket).
12. `fromCvId`: last, and first to cut.

## Testing Decisions

- **A good test checks behaviour through the highest seam.**
  - Over HTTP: status codes, error codes, response bodies.
  - In the database: the CV's status and draft.
  - Through pure function interfaces: inputs to outputs.
  - Internal calls, private helpers and SDK internals are never asserted. Tests read like the user stories above.
- **Seam 1 — the HTTP API (primary).** Supertest drives the api with the worker running in the same test process, against real Postgres and Redis from the backend compose file: a separate `cv_test` database, its own BullMQ prefix, migrations once per run, tables truncated between tests. Without those services the run fails with a clear message. Covers auth, isolation, intake, CV lifecycle, generation end to end, failures and recovery, answers, PATCH, PDF, limits.
- **Seam 2 — the model factory (the only new seam).** In tests, the DI token of the model factory is bound to the AI SDK's `MockLanguageModelV4` with a scripted sequence of step results: a tool call with an invalid or unverifiable draft, then a valid one; thrown `APICallError`s with 529, 401 and so on; a call that respects the abort signal so timeouts can be tested. There is no runtime fake. A missing key still stops compose.
- **Pure modules, unit-tested directly:**
  - `verifyDraft` + `sanitise`: invented bullet → `confirm`; unknown skill → `multi`; wrong year → cleared + question; a Ukrainian source with an English CV passes with Ukrainian quotes and the numbers intact.
  - `PromptBuilder`: tags escaped; the instructions contain no byte of user data and are identical for two different CVs.
  - `selectQuestions` (caps and priority).
  - `buildAutoQuestions`.
  - `classifyError`.
  - The PATCH cleanup.
  - `renderCvPdf`: text extractable, 595×842, an empty CV has no headings and no "undefined".
  - Ingest checks: non-PDF, scan, too big, too many pages.
- **Priority** (backend architecture §8):
  1. Verifier.
  2. Isolation e2e: user B gets `404` on read, edit, answer, skip, retry, download, delete, poll and copy of user A's CV.
  3. Status machine and CAS, including delete mid-generation and a stale result dropped.
  4. Generation with the fake model:
     - accepted on step 2 after feedback;
     - retry on a transient error;
     - `failed` after 3 attempts;
     - non-retryable → `failed` at once.
  5. Prompt builder.
  6. Answers and auto questions.
  7. PDF.
  8. Intake limits.
- **Prior art:**
  - `@cv/shared` unit tests next to each module (Vitest), and its draft fixtures in `shared/src/testing`, reused for server fixtures.
  - The frontend's behaviour-level tests in `frontend/src/tests`, which drive the app through MSW the way these tests drive the api through HTTP.
  - The frontend mocks themselves, as the expected behaviour for each endpoint.
- Vitest everywhere, `unplugin-swc` for decorators, supertest for e2e. Unit tests sit next to the file; e2e in a separate test folder with its own config.

## Out of Scope

- The AnswerAgent: answers go in as written; the README lists it under "with more time".
- An hourly limit on answers (an answer makes no model call).
- A runtime fake model or running without `ANTHROPIC_API_KEY`.
- Regenerating an existing CV for a new role in place: another role is always a new CV.
- Revoking a JWT before it expires, a session table, password reset, email verification.
- OCR for scanned PDFs; storing uploaded files.
- Pagination of the CV list.
- Horizontal scaling of the api: the throttler store is in memory, for one instance.
- Push updates (SSE/WebSocket): the client polls (root ADR 0001).
- More PDF templates, and fonts beyond Liberation Sans (Latin, Cyrillic, Greek).
- Strict tool mode and a second agent tool (e.g. a source search tool).
- Any change to the contract beyond the one root ticket listed above.

## Further Notes

- **Known simplifications** for the README:
  - a JWT can't be revoked before expiry;
  - signup reveals that an email is taken;
  - the count-then-insert race on limits is accepted;
  - answers have no hourly limit;
  - a quote proves a fact exists in the source, not that its translation is faithful;
  - model confidence scores are not used.
- `claude-sonnet-5-5` can't turn thinking off and ignores `temperature`. If latency is a problem, the model is changed through `ANTHROPIC_MODEL` without code changes.
- Not verified against the live API: which JSON-schema keywords Anthropic's strict tool mode rejects (strict is off, so it doesn't block us), and the minimum cacheable prefix for Sonnet 5.5 (the static part is expected to exceed it). A live smoke run in the generation slice should confirm that caching takes effect (cache-read tokens on steps 2–3).
- If time runs short, cut in this order: `fromCvId` → usage → (frontend) match panel. Verification, isolation, failure handling and recovery are never cut.
- The frontend's own gaps (usage not refreshed after a retry or an answer, no `Retry-After` on a retry's `429`, the AnswerAgent mentioned in the mocks) belong to the frontend tracker.
