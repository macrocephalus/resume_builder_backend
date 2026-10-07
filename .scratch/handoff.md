# Backend: handoff

The backend as built, for whoever picks it up next (2026-10-06, `main` after `5d2724c`). The
inside is in `docs/architecture.md`, the reasons in `docs/adr/`; this file is the short map and
what is not written down elsewhere.

## State

- Every server ticket is done: `.scratch/server/issues/01–12` (scaffold, auth, PDF intake, CVs,
  generation, verification, failures/Retry/recovery, answer/skip, PATCH, PDF, usage + hourly
  limit, CV for another role). After them: Swagger docs for development, logging by outcome.
- A whole-stack run with the real frontend and Claude passed: generation, questions, edits, PDF
  download and PDF upload. Its findings are fixed (list below).
- Not ticked in the tickets: the manual `pnpm stack` checks the run did not cover — a wrong key
  failing a CV at once (07), the usage line and limit notice (11), the "also fits" chip (12),
  logout and reload (02), delete (04), a `confirm` question and the verification counts (06).
- Checks: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` and
  `pnpm test:e2e` (172 unit, 145 e2e); all green.

## What it does

Two processes from one image: **api** (NestJS, `/api`, runs the migrations on start) and
**worker** (BullMQ processor, concurrency 8, queue recovery). Postgres is the source of truth,
Redis holds only the queue (adr/0001).

- **Auth** — email + password (argon2id), JWT `{ sub }` for 7 days in an httpOnly SameSite=Lax
  cookie, no session table (adr/0006). The signing secret is generated on the first start and
  kept in `app_secrets`, so `.env` needs only `ANTHROPIC_API_KEY`. Global guard, `@Public()` to
  open a route; login throttled 30/min per IP.
- **Intake** — `POST /api/ingest/pdf`: ≤ 5 MB, ≤ 10 pages, ≥ 50 visible chars, text layer only
  (unpdf), nothing stored; 20/min per user.
- **CVs** — create from text or from another CV (`fromCvId`: its source and facts are copied),
  list with open-question counts, poll statuses with the queue position, get, PATCH with
  optimistic `version`, delete, Retry. Another user's CV is `404`. Only `CvStatusService` writes
  `cvs.status` (compare-and-set on the machine's from-statuses).
- **Generation** — one `ToolLoopAgent` with one tool, `submit_draft`; ≤ 3 steps; the tool runs the
  verifier and sends the problems back, the model resubmits the whole draft (adr/0003). Prompt is
  static first (cacheable), user data last in escaped tags; `PROMPT_VERSION` is a hash of the
  static part. Model `claude-sonnet-5-5`, 120 s per step, 300 s per attempt.
- **Verification** — every claim needs an evidence quote in the source language or must appear
  in the source/answers; numbers, contacts and tech names are checked directly (adr/0004). What
  still fails after the loop is removed and turned into a question: `confirm` for a bullet,
  `text`/`choice` for a cleared field, one `multi` for skills.
- **Questions** — auto (missing required fields, texts from `@cv/shared`), verifier and model;
  ≤ 12 open. Answers are applied by the shared `applyAnswer` (no model call) and kept as `facts`
  for every later generation; the last one closed makes the CV `ready`.
- **Failures** — `classifyError` → `LLM_UNAVAILABLE` / `TIMEOUT` / `LLM_INVALID_OUTPUT` retried
  (3 attempts, backoff 5 s ×2), `LLM_CONFIG` / `INTERNAL` failed at once. Stalled jobs re-run and
  take the CV over; a 60 s recovery re-enqueues jobs Redis lost and fails CVs whose job BullMQ gave
  up on. Only a CV's latest job may touch it.
- **Limits** — 10 generations per user per sliding hour (a create or a Retry, counted from
  `generation_jobs`), 4 in progress per user; both checked in the start transaction under the
  user's row lock. `GET /api/usage` shows them.
- **PDF** — `GET /api/cvs/:id/pdf`: pdfkit, A4, Liberation Sans (Cyrillic), selectable text,
  rendered on the fly from the saved draft (adr/0005).
- **Logs** — pino JSON; level by outcome; user text and model output only under `content`,
  redacted unless `LOG_CONTENT` (README "Logging").
- **API docs** — Swagger at `/api/docs` only with `API_DOCS=true` (on in `pnpm dev`; adr/0007).

## Decisions that changed after the grilling

`.scratch/server/decisions.md` is the log as grilled; these moved later:

- Worker concurrency 8, not 4, and 4 CVs in progress per user, so one user never takes every slot.
- The PDF route lives in `cvs/` (it needs the owner check); `pdf/` only draws.
- Two starts of one user at the same moment are counted one after the other: the start
  transaction locks the user's row.
- JSON body limit 512 KB (`JSON_BODY` in `config/limits.ts`): a full draft is ~217 KB in Cyrillic,
  Express's 100 KB default refused it.
- The queue position orders by each CV's latest job, not its creation, so a retried CV goes last
  as BullMQ runs it (root `docs/cv-statuses.md` changed with it).
- With a verifier `multi` on the skills, the model's question about the whole skills block is
  dropped (it asked the same thing twice in the whole-stack run).
- The list's open-question count is a left join + `count`; the earlier subquery always gave 0.

## Rules that are easy to break

- Read `CLAUDE.md` here first: no `any`, contract types only from `@cv/shared`, one-way module
  graph (`agents/` imports only `@cv/shared`, the AI SDK and zod), `AppError` for errors, config
  only through `parseEnv` / `config/limits.ts`, logs through `PinoLogger` with content under
  `CONTENT`.
- The contract (`docs/api.md`, `docs/cv-statuses.md`, `shared/`) belongs to the root: change it
  with a root ticket, not from here.
- Tests replace the model only through the `LANGUAGE_MODEL` token, the timing and limits through
  `GENERATION_TIMING` / `GENERATION_LIMITS`; e2e use the `cv_test` database and run file by file.

## Open

- The "Known simplifications" that `docs/architecture.md` points to the README for are not in
  any README yet (the root `readme.txt` is empty): JWT not revocable, signup reveals a taken
  email, no hourly answer limit, pdf.js on the api's event loop, translation faithfulness trusted
  to the model.
- The manual checks listed under "State".
- `cvs.parent_cv_id` (FK, on delete set null) has no index, so deleting a CV scans `cvs` for its
  children; one `index()` + a migration.
- The model chooses `sectionOrder` ("most relevant first") and it is saved unchecked, while the
  comment on `DEFAULT_SECTION_ORDER` in `shared/src/cv-data.ts` says the order is never the
  model's; the comment is the root's to fix.
