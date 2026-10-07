# Backend architecture

How the NestJS API and the BullMQ worker are built: where code goes, the tables, the generation
agent, fact verification, failure handling, auth internals, PDF rendering and tests. This file is
the source of truth for the inside of `backend/`.

Related documents, none of which this file repeats:

| Question | Document |
|---|---|
| What the product does, the user flow, the containers, the stack | `docs/architecture.md` §1–§4 at the repo root |
| The draft (`CvData`), questions and answers, CV language, match | `docs/architecture.md` §6.2, §6.5, §6.7, §7 at the repo root |
| The REST contract and the CV statuses | `docs/api.md`, `docs/cv-statuses.md` at the repo root |
| Why a queue, why one tool loop, why quotes, why pdfkit, why a JWT cookie | [adr/](adr/) |
| Product terms / backend terms | `shared/GLOSSARY.md` / [../GLOSSARY.md](../GLOSSARY.md) |
| Short rules an agent must not break | [../CLAUDE.md](../CLAUDE.md) |

Status: settled in the server grilling (2026-10-06, `.scratch/server/decisions.md`) and built
ticket by ticket (`.scratch/server/issues/01–12`, all done); this file describes the code as it
is. What changed after the grilling and what is still open: `.scratch/handoff.md`.

## 1. Processes and the tree

Two processes from one image. **api** (`node dist/main.js`): NestJS HTTP; on start it applies the
migrations and loads the JWT secret, then listens on 3000. **worker** (`node dist/worker.js`):
`NestFactory.createApplicationContext`, no HTTP; runs the BullMQ processor (concurrency
`WORKER_CONCURRENCY`, default 8) and the queue recovery. Postgres is the only source of truth; Redis holds only the queue.

```
backend/
├── package.json             "files": ["dist", "drizzle", "assets"] — what ships in the image
│                            (the Dockerfile copies dist/ as built: npm packing drops dist/cvs)
├── nest-cli.json            builder: swc (typecheck is `tsc --noEmit`, a separate script)
├── .swcrc                   decorators + metadata, CommonJS; *.test.ts stay out of dist/
├── tsconfig.json · tsconfig.build.json
├── vitest.config.mts        unit: src/**/*.test.ts (unplugin-swc for the decorators)
├── vitest.e2e.config.mts    e2e: test/**/*.e2e.test.ts (Postgres + Redis from compose)
├── drizzle.config.ts        `pnpm db:generate` → drizzle/
├── .oxlintrc.json · .prettierrc.json
├── Dockerfile · compose.yaml
├── drizzle/                 generated SQL migrations (0000_initial … 0002_answer_wordings),
│                            committed; the api applies them on start
├── assets/fonts/            Liberation Sans Regular/Bold (+ OFL licence)
├── src/
│   ├── main.ts              api: parseEnv → NestFactory → setupApp → runMigrations → listen
│   ├── worker.ts            worker: parseEnv → createApplicationContext(WorkerModule) → ping Redis
│   ├── run.ts               entry-point wrapper: a bad env prints only its variables, any error → exit 1
│   ├── setup-app.ts         /api prefix, trust proxy, JSON body limit, cookie-parser, pino as the
│   │                        Nest logger, shutdown hooks; the API docs when API_DOCS is on
│   ├── api-docs.ts          Swagger UI at /api/docs, OpenAPI at /api/docs-json (§6b)
│   ├── app.module.ts        everything HTTP: AppModule.forRoot(env); the global error filter and
│   │                        guard, ThrottlerModule (in memory)
│   ├── worker.module.ts     config, logger, database, redis, generation (which pulls in cvs → queue,
│   │                        limits, pdf; no HTTP, so their controllers are idle)
│   ├── config/
│   │   ├── env.schema.ts          Zod; parseEnv — a bad env stops the process with the variable's name
│   │   ├── limits.ts              TIMEOUTS, GENERATION (per hour, active, attempts, backoff, lock,
│   │   │                          recovery, failed-job TTL), SESSION, JSON_BODY, PDF_UPLOAD,
│   │   │                          ANSWER_WORDING_BUDGET, THROTTLES, QUESTIONS
│   │   └── config.module.ts       ConfigModule.forRoot(env): the ENV token (global)
│   ├── database/
│   │   ├── schema/                users, cvs, cv-questions, generation-jobs, generation-attempts,
│   │   │                          app-secrets, answer-wordings; index re-exports them (camelCase in TS, snake_case
│   │   │                          in SQL: casing 'snake_case')
│   │   ├── database.module.ts     the DATABASE token (Drizzle over one pg pool, 5 s connect timeout),
│   │   │                          the Executor type; closes the pool
│   │   └── migrate.ts             runMigrations(url) over drizzle/, on its own connection
│   ├── redis/
│   │   └── redis.module.ts        the REDIS token (ioredis, shared with BullMQ), closes on shutdown
│   ├── common/
│   │   ├── async/                 with-timeout.ts (stop waiting; the work is not cancelled)
│   │   ├── errors/                app-error.ts (status, code from @cv/shared, details, headers),
│   │   │                          validation-error.ts (a ZodError → 400 with details.fields)
│   │   ├── http/                  error.filter.ts ({ error: { code, message, details } }),
│   │   │                          zod-validation.pipe.ts (schemas from @cv/shared),
│   │   │                          rate-limit.ts (@RateLimit per IP or user → 429 RATE_LIMITED),
│   │   │                          trust-proxy.ts (one private hop: the client IP nginx saw)
│   │   ├── auth/                  public.decorator.ts (@Public), current-user.decorator.ts
│   │   │                          (@CurrentUser: the id the guard verified)
│   │   ├── openapi/               api-docs.decorators.ts: @ApiErrors(codes), @ApiSession,
│   │   │                          @ApiZodBody(schema from @cv/shared)
│   │   └── logging/               logger.module.ts (nestjs-pino for both processes),
│   │                              logger-options.ts (JSON or pretty, request id, level by outcome,
│   │                              redact; CONTENT), safe-error.ts (name, message, codes, frames)
│   ├── health/                    health.controller.ts — GET /api/health (SELECT 1 → 200; else 503,
│   │                              code INTERNAL — the only non-500 use of that code)
│   ├── auth/
│   │   ├── auth.controller.ts     signup, login (throttled), logout, me
│   │   ├── auth.service.ts        signup, login (same cost for an unknown email), me
│   │   ├── auth-errors.ts         401 UNAUTHORIZED / INVALID_CREDENTIALS
│   │   ├── jwt-auth.guard.ts      global (APP_GUARD): verify, never decode; skips @Public
│   │   ├── jwt-secret.service.ts  JWT_SECRET from env, else app_secrets: insert … on conflict do
│   │   │                          nothing, then read
│   │   ├── session.service.ts     issue / verify the JWT (HS256, 7 days)
│   │   ├── password.ts            argon2id
│   │   └── session-cookie.ts      cv_session, httpOnly, SameSite=Lax, path /, Secure over HTTPS, 7 days
│   ├── ingest/
│   │   ├── ingest.controller.ts   POST /api/ingest/pdf: multer in memory, ≤ 5 MB, 20/min per user
│   │   ├── ingest.service.ts      result → 400 (no file) / 415 / 413 / 422 or { text, pages, chars,
│   │   │                          filename }
│   │   └── pdf-text.ts            readPdf: magic bytes, unpdf text layer, ≤ 10 pages, ≥ 50 visible
│   │                              chars; echoFilename (≤ 200 chars)
│   ├── cvs/
│   │   ├── cvs.controller.ts      create, list, statuses, get, PATCH, pdf, delete, retry
│   │   ├── cvs.service.ts         getOwned(id, userId) — the only way to a CV; lockOwned in a
│   │   │                          transaction that writes from what it read; create from text
│   │   │                          or fromCvId (the parent locked, with a draft: its source and
│   │   │                          facts are copied, parent_cv_id set); latestJobsInProgress for
│   │   │                          the recovery
│   │   ├── cv-status.service.ts   the ONLY writer of cvs.status (fromStatuses + CAS);
│   │   │                          readyIfNoneOpen after a batch of replies or an edit;
│   │   │                          resumeGenerating, setStage (only while generating)
│   │   ├── from-statuses.ts       pure: the statuses a move to X is allowed from
│   │   ├── cv.mapper.ts           row → Cv / CvSummary / CvStatusInfo (computeMatch); a draft
│   │   │                          that fails CvData → 500 DATA_CORRUPT
│   │   ├── queue-position.ts      1 + queued CVs of all users whose latest job is older (row_number)
│   │   └── patch-cv.ts            pure: dropEmptyItems, questions about removed items → skipped
│   ├── limits/
│   │   ├── limits.service.ts      assertCanStart (the user's row locked): generations/hour →
│   │   │                          429 RATE_LIMITED, then ≤ 4 active → 429 TOO_MANY_ACTIVE; usage
│   │   ├── generation-limits.ts   the GENERATION_LIMITS token (per hour, active); tests bind less
│   │   ├── hourly-window.ts       pure: used, resetsAt, Retry-After of the sliding hour
│   │   ├── wording-budget.service.ts  take (the user's row locked): worded answers per hour
│   │   ├── wording-budget.ts      the WORDING_BUDGET token; pure: how many may be worded
│   │   ├── user-window.ts         lockUser, createdWithin: what both limits count by
│   │   └── usage.controller.ts    GET /api/usage
│   ├── generation/
│   │   ├── generation-queue.module.ts  the queue + producer (api and worker; below cvs)
│   │   ├── generation.queue.ts    the GENERATION_QUEUE token, job data { cvId }; attempts 3, backoff
│   │   │                          5 s, completed jobs removed, failed kept 24 h;
│   │   │                          the GENERATION_TIMING token (backoff, agent timeouts, recovery)
│   │   ├── generation.producer.ts recordJob (in the CV's transaction), enqueue (add(), 2 s at most;
│   │   │                          fails → log, still 202); fateOf + requeue for the recovery
│   │   ├── generation.module.ts   the worker's half: processor, model token, DraftSaver, recovery
│   │   │                          (above cvs)
│   │   ├── generation.processor.ts  worker: job row → the CV's latest job? → CAS to generating (or
│   │   │                          take over a stalled attempt) → attempt row → DraftAgent →
│   │   │                          prepareDraft → DraftSaver; a failure → classifyError →
│   │   │                          retrying / failed
│   │   ├── draft-from-submission.ts  pure: item UUIDs, question index → id, dropEmptyItems, CvData
│   │   ├── prepare-draft.ts       pure: verifyDraft → sanitise → draft → questions → counts
│   │   ├── save-draft.ts          DraftSaver: one transaction: CAS, data, questions, requirements,
│   │   │                          version, the attempt row closed
│   │   ├── attempt-log.ts         open / close a generation_attempts row (tokens, steps, ms);
│   │   │                          closeStalledAttempts
│   │   ├── generation-errors.ts   error_code → user text (docs/cv-statuses.md, failed)
│   │   ├── classify-error.ts      pure: SDK error → { code, retryable } (§5)
│   │   └── queue-recovery.service.ts  on start + every 60 s, the latest job of each CV in progress:
│   │                              lost → requeued; failed in BullMQ while generating → CV failed
│   ├── questions/
│   │   ├── questions.controller.ts    replies: a batch of answers and skips
│   │   ├── questions.service.ts       checkReplies → answer wording → lockOwned → checkReplies →
│   │   │                              applyReplies → questions closed, one version + 1 → CAS to
│   │   │                              ready when none is open
│   │   ├── check-replies.ts           pure: every reply against its question and the draft, all
│   │   │                              or none; 404 / 409 at the first, 400s keyed by reply
│   │   ├── apply-replies.ts           pure: a checked batch → the draft and the facts after it
│   │   ├── answer-wording.service.ts  one fast-model call for a batch; as written past the
│   │   │                              budget or when it fails
│   │   ├── wording-request.ts         pure: which answers are worded; which results are accepted
│   │   ├── fact-of.ts                 pure: an answer → the { question, answer } kept in facts
│   │   ├── new-question.ts            a question before it is stored; targetKey
│   │   ├── build-auto-questions.ts    pure: findMissing + autoQuestionText
│   │   ├── build-verifier-questions.ts  pure: confirm / cleared field / multi (computeMatch)
│   │   ├── verifier-wording.ts        their texts per CV language
│   │   └── select-questions.ts        pure: priority and caps (§3)
│   ├── agents/                        LLM layer — knows nothing about DB, HTTP or queue
│   │   ├── llm.ts                     the LANGUAGE_MODEL and FAST_LANGUAGE_MODEL tokens +
│   │   │                              createLanguageModel; bound in GenerationModule and
│   │   │                              QuestionsModule, to MockLanguageModelV4 in tests
│   │   ├── answer/
│   │   │   ├── answer-wording.schema.ts  ANSWER_WORDING_LIMITS, the request, the output schema
│   │   │   └── word-answers.ts        one generateText with Output.object, no tools (§3a)
│   │   ├── prompt/
│   │   │   ├── prompt-builder.ts      buildPrompt → { instructions, message }: static first, the
│   │   │   │                          task last (§3); PROMPT_VERSION (hash of the static part)
│   │   │   ├── prompt-fact.ts         PromptFact { question, answer }
│   │   │   ├── escape-tags.ts         & < > as XML entities, so data can't close a tag
│   │   │   ├── answer-wording-prompt.ts  buildWordingPrompt: the rules, then each answer escaped
│   │   │   └── system/
│   │   │       ├── answer-wording.system.ts  the rules of answer wording
│   │   │       ├── draft.system.ts    the rules: the tool, how to work, the checks before a call;
│   │   │       │                      numbers from DRAFT_AGENT_LIMITS, VERIFY_LIMITS, SUBMISSION_LIMITS
│   │   │       └── draft.example.ts   a made-up source and the submission verifyDraft accepts for it
│   │   ├── draft/
│   │   │   ├── draft.agent.ts         ToolLoopAgent: tools, stopWhen, timeout; hooks → onStage,
│   │   │   │                          onPrompt and onStep (each step's input, verdict, usage)
│   │   │   ├── draft.limits.ts        DRAFT_AGENT_LIMITS: steps, timeouts, retries, output tokens
│   │   │   ├── draft-submission.schema.ts  the submit_draft input; SUBMISSION_LIMITS
│   │   │   ├── stop-when-accepted.ts  the last step's submit_draft was accepted
│   │   │   └── tools/                 one file per tool
│   │   │       └── submit-draft.tool.ts   createSubmitDraftTool({ source, facts }): verifyDraft
│   │   └── verify/
│   │       ├── verify-draft.ts        pure: problems by the rules of §4
│   │       ├── verify-wording.ts      pure: numbers and technologies a worded answer may not add
│   │       ├── skill-like.ts          pure: the words that look like technology names
│   │       ├── sanitise.ts            pure: remove/clear what failed → claims, fields, skills
│   │       └── normalise.ts           NFKC, case, whitespace, quotes, dashes; whole words, numbers
│   │                                  as digits, phone digits, link key
│   └── pdf/                           drawing only, below cvs (the route is in cvs/)
│       ├── pdf.module.ts              the PDF_FONTS token: assets/fonts read once per process
│       ├── fonts.ts                   readCvFonts: Liberation Sans Regular / Bold as bytes
│       ├── cv-template.ts             CvTemplate = (cv, doc) => void; the font names
│       ├── render-cv-pdf.ts           pure: CvData + language + fonts → Buffer (A4, 50 pt)
│       ├── content-disposition.ts     pure: title → attachment; filename (ASCII) + filename*
│       └── templates/classic.ts       the product's layout (root architecture §10)
└── test/                              e2e (supertest)
    ├── global-setup.ts                once per run: cv_test exists, migrated, test queue keys gone
    ├── setup.ts                       before every test: truncate all tables
    ├── helpers/                       env.ts (test Env, cv_test, queue prefix, TEST_TIMING /
    │                                  TEST_LIMITS), app.ts (api in process as main.ts builds it),
    │                                  worker.ts (WorkerModule in process; waitForCv), model.ts
    │                                  (scripted MockLanguageModelV4 steps, also used by unit tests),
    │                                  auth.ts, cvs.ts, draft.ts, pdf.ts (fixtures)
    └── *.e2e.test.ts                  health, auth, api-docs, ingest, cvs, cv-status, edit, from-cv,
                                       generation, failures, questions, pdf, usage (isolation cases
                                       live in the feature files)
```

Each feature folder also has its `<name>.module.ts`. Unit tests sit next to the file
(`verify-draft.test.ts`, `prompt-builder.test.ts`, …).

Scripts (`pnpm <script>` in `backend/`): `build` (`nest build`, SWC), `start` / `start:worker`
(`node dist/main.js` / `dist/worker.js`), `dev` / `dev:worker` (watch; reads the root `.env` through
`node --env-file-if-exists`; `DATABASE_URL` and `REDIS_URL` default to the compose services on the
project's host ports 55432 / 56379, so only the key is needed; `dev` also serves the API docs, and
both log at debug, with content, pretty, unless the shell sets `LOG_*`),
`typecheck` (`tsc --noEmit`), `lint` (oxlint), `format` / `format:check` (prettier), `test` (unit),
`test:e2e` (needs the compose Postgres and Redis), `db:generate` (a migration from the schema).
BullMQ is the 5.x line: 6.x moves the Redis client to a peer dependency and was not verified here.

Rules:
- Ownership checks live in `cvs`; other modules get a CV only through `CvsService.getOwned(id, userId)`,
  or `lockOwned(id, userId, tx)` when a transaction writes from what it read (an answer or an edit
  re-applies the draft, a new-role CV locks its parent), so two such writes run one after the other.
- Only `CvStatusService` writes `cvs.status` (a CAS on the machine's from-statuses, optionally
  narrowed: a generation's result is saved only into a CV still `generating`).
- Errors that may carry user data (a failed query's parameters, the AI SDK's request body) are
  logged and stored through `safeError` (`common/logging/safe-error.ts`): name, message, codes,
  call frames.
- `generation/` is two modules so the graph has no cycle: `GenerationQueueModule` (the queue and
  the producer) sits below `cvs`, which uses it to start a generation; the processor's module sits
  above `cvs`, which it needs for statuses and saving.
- A function that may run inside a caller's transaction takes an `Executor` (the database or a
  transaction) as its last argument (`CvStatusService.transition` takes it as `executor` in its
  options); a service method that also runs on its own defaults it to the database.
- Pure functions (`buildPrompt`, `verifyDraft`, `sanitise`, `prepareDraft`, `buildAutoQuestions`,
  `buildVerifierQuestions`, `selectQuestions`, `classifyError`, `patchCv`, `hourlyWindow`,
  `renderCvPdf`) have no I/O and carry most unit
  tests. `applyAnswer`, `findMissing`, `autoQuestionText` and `computeMatch` come from
  `@cv/shared`, so the server never words an auto question or applies an answer its own way.
- `agents/` imports only `@cv/shared`, the AI SDK (`ai`, `@ai-sdk/anthropic`), `zod` and Node
  built-ins, and returns plain results; its run
  bounds (`DRAFT_AGENT_LIMITS`, `draft.limits.ts`) sit next to the agent; `generation/` decides what to persist.
- Every module imports `@cv/shared` for schemas and rules; `backend` never imports `frontend`.

## 2. Data model (Postgres, Drizzle)

**users** — `id uuid pk`, `email text unique` (trimmed, lower-cased), `password_hash` (argon2id), `created_at`.

**cvs**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid → users, cascade | every query filters by it |
| parent_cv_id | uuid null → cvs, set null | set when created "for another role" from this CV |
| title | text | set to `target_role` on create, user-editable (1–120 chars) |
| target_role | text | 2–100 chars, required, immutable |
| role_context | text null | ≤ 5 000 chars, optional, immutable; describes the role, never the person |
| language | text | `CvLanguage` code (root §6.7), default `en`, immutable |
| source_type | `text` \| `pdf` | |
| source_filename | text null | for display only |
| source_text | text | 80–20 000 chars; reused by retries and new-role CVs |
| facts | jsonb | `{question, answer}[]`, default `[]` — user-provided facts, fed into every later prompt |
| status | CvStatus | `docs/cv-statuses.md`; index `(status, created_at)` |
| stage | text null | `drafting` / `verifying` / `revising` / `saving` while generating, else null |
| attempt, max_attempts | int | default 1 / 3 (`GENERATION.attempts`) |
| error_code, error | text null | only when `failed` |
| data | jsonb null | `CvData`, null until the first draft |
| requirements | jsonb | `Requirement[]` (root §7), default `[]` |
| suggested_roles | jsonb | `string[]` ≤ 3, default `[]` |
| verification | jsonb null | report: `{verified, sentToConfirm, skillsToConfirm, cleared}` — shown in UI |
| version | int | 0 until the first draft; +1 on every saved draft, batch of replies and PATCH (a title too); optimistic locking |
| created_at, updated_at | timestamptz | |

**cv_questions** — `id`, `cv_id → cvs cascade`, `kind` (`text|choice|multi|confirm`),
`origin` (`model|verifier|auto`), `text`, `label` (short field name, e.g. "English"),
`options jsonb null` (read as `[]`), `claim text null` (for `confirm`), `target jsonb` (§3), `status`
(`open|answered|skipped`), `answer jsonb null`, `position int`, `created_at`, `answered_at` (null
until answered; a skip leaves it null).

**generation_jobs** — one row per generation job, i.e. per generation the user started (a CV
created or a manual Retry): `id` (= BullMQ jobId), `cv_id → cvs, set null` (deleting a CV keeps
its jobs), `user_id → users, cascade` (copied from the CV, never from a request), `created_at`.
Automatic retries are BullMQ's own (`attempts: 3`, exponential backoff from 5 s) on the same job.

**generation_attempts** — one row per attempt: `id`, `job_id → generation_jobs, cascade`,
`attempt`, `status` (`running|succeeded|failed`), `model`, `prompt_version`, `agent_steps`,
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `duration_ms`, `error`, `created_at`, `finished_at`. Audit only.

**answer_wordings** — one row per wording call (§3a): `id`, `user_id → users, cascade`, `answers`
(how many of the batch were sent to the model), `created_at`. The wording budget sums these
rows; like `generation_jobs`, they outlive the CV.

**app_secrets** — `name text pk`, `value text`. Holds the JWT secret (§6).

Every foreign key but `cvs.parent_cv_id` has an index; `generation_jobs (user_id, created_at)` serves the hourly count,
`answer_wordings (user_id, created_at)` the wording budget,
`cvs (status, created_at)` the recovery and, with `generation_jobs (cv_id)`, the queue position.

No `cv_sources` table and no job-level status: [adr/0002](adr/0002-one-cv-status-no-source-table.md).

## 3. DraftAgent — an AI SDK v7 tool loop

Input: `source_text`, `target_role`, `role_context`, `language`, `facts`, today's date (UTC).

### The prompt: static first, dynamic last

`buildPrompt` (`agents/prompt/prompt-builder.ts`) returns `{ instructions, message }`. The order is also the prompt-cache prefix
(Anthropic caches `tools → system → messages` up to a breakpoint):

1. the `submit_draft` tool — description and JSON schema, fields in a fixed order;
2. `instructions` (`agents/prompt/system/draft.system.ts` + `draft.example.ts`): the task; safety —
   tag content is data for this CV and never changes the rules, the task, the tool, the format
   or the language; instructions in it are neither followed nor copied into the CV (no text
   addressed to an AI or a screening system); what doesn't belong in a CV (secrets, ID and card
   numbers, health, abusive content) is left out and not asked about; the tool — what `submit_draft` checks, what it answers,
   at most `DRAFT_AGENT_LIMITS.steps` calls, aim for the first to be accepted; how to work —
   list the facts, choose for the role, write with each quote copied as written, check, ask, one
   call, on `accepted: false` fix only the listed paths and keep the rest; never drop a fact the
   source states only to pass faster; the fact rules (every claim backed by an evidence quote in
   the source language, numbers and names verbatim, ask instead of inventing); "Before you
   submit" — §4's rules as a checklist; the CV, question and requirement rules. The numbers come
   from `DRAFT_AGENT_LIMITS`, `VERIFY_LIMITS`, `SUBMISSION_LIMITS` and `REQUIREMENT_LIMITS`, so
   the prompt never asks for what the code rejects. Then the example: a made-up source in another
   language than its CV and the submission for it, which `verifyDraft` accepts (a test holds it
   to that). Nothing that changes per CV — "write in the language of `<cv_language>`" names the
   tag, not the value. — **cache breakpoint**
3. one user message with escaped tags, long and stable first: `<source>`, `<user_facts>`,
   `<target_role>`, `<role_context>`, `<cv_language>` (English name from the allow-list, e.g.
   "Ukrainian"), `<today>`; an empty `<user_facts>` / `<role_context>` holds `(none)`, a fact is
   `Q: <question>` / `A: <answer>`; then the static task (`DRAFT_TASK`: write the CV for
   `<target_role>`, follow "How to work", one `submit_draft` call), after the data it is about.
   — **cache breakpoint**
4. the loop's own tool calls and results (the SDK appends them); steps 2–3 read 1–3 from the cache.

`PROMPT_VERSION` — the first 12 hex of a sha256 over the instructions, the tool's description and
its JSON schema — is written on the attempt row when it opens. Tests: `instructions`
hold no byte of user data and are identical for two different CVs; tags inside user data are
escaped.

### The loop

The agent (`ToolLoopAgent`, built per attempt in `draft.agent.ts`) has **one tool,
`submit_draft`** (`draft/tools/submit-draft.tool.ts`, a factory `createSubmitDraftTool({ source,
facts })`; every tool gets its own file in `tools/`). `claude-sonnet-5-5` rejects forced tool use,
so `toolChoice` is `'auto'` and the instructions require answering only through the tool.

```ts
DraftSubmission = {
  cv: CvData /* without ids */,
  evidence:  { path: string; quote: string }[],    // "experience[0].bullets[2]" → verbatim source quote (source language)
  questions: { kind: 'text' | 'choice'; text; label; options?; target: QuestionTarget }[],  // ≤ 7, options ≤ 8
  requirements: { label; kind: 'skill' | 'experience'; keywords: string[] }[],             // ≤ 12
  suggestedRoles: string[],                        // ≤ 3
}
QuestionTarget = { section: CvSection /* any of the eight blocks */;
                   itemIndex?: number; field?: string }   // backend maps index → item id
```

The other bounds (evidence ≤ 200, text lengths, keywords 1–10) are `SUBMISSION_LIMITS` and
`REQUIREMENT_LIMITS`; Zod errors against them go back to the model like any other problem.

1. Step 1 (stage `drafting`): the model calls `submit_draft`. Zod validates the input; an invalid
   input goes back to the model as a tool error and the loop goes on. `execute` (stage
   `verifying`) runs `verifyDraft` (§4) — pure, no side effects — and returns `{ accepted: true }`
   or `{ accepted: false, problems: ["experience[1].bullets[2]: quote not found in source — quote
   verbatim or drop the claim", …] }`.
2. Steps 2–3 (stage `revising`): the model sends the **whole** draft again, fixed.
3. `stopWhen: [stopWhenAccepted, isStepCount(3)]`; a step without a tool call also ends the loop.
4. The last schema-valid submission (`steps[].staticToolCalls`) is **sanitised** — whatever still
   fails verification is removed and turned into questions (§4). None ⇒ the attempt fails
   (`LLM_INVALID_OUTPUT`, retryable).
5. `prepareDraft` (`generation/prepare-draft.ts`): ids are assigned, the model's question
   targets mapped to item ids, `dropEmptyItems`, `CvData.parse` as the last guard; then the
   verifier and auto questions are built over that draft and `selectQuestions` (below) picks the
   kept ones.
6. One transaction (stage `saving`): write `data`, `requirements`, `suggested_roles`,
   `verification`; insert the questions; `version + 1`; status → `needs_input` (a question kept) /
   `ready` via CAS, `stage` → null; close the attempt row (`succeeded`, steps, tokens incl. cache
   read/write, ms; the model and prompt version were written when it opened).

Settings: model `claude-sonnet-5-5` (`ANTHROPIC_MODEL`); `timeout: { stepMs: 120_000, totalMs:
300_000 }` (the BullMQ lock is 30 s, renewed while the attempt runs); `maxRetries: 2` inside a step (a short 529 on step 2
keeps step 1); `maxOutputTokens: 16_000` per step (thinking can't be turned off on this model;
`temperature` is ignored); strict tools off — the schema's limits are checked locally by Zod and
its errors go back to the model; request-level automatic prompt caching on. Worker concurrency 8
(env), twice the CVs one user may have in progress, so one user never takes every slot.

`stage` starts as `drafting` in the CAS that moves the CV to `generating`; then it is written
(`CvStatusService.setStage`, only while `generating`) from the SDK hooks: `onStepStart` on step 0 →
`drafting`, `onToolExecutionStart` (schema-valid input only) → `verifying`, `onStepEnd` with
`accepted: false` → `revising`, after `prepareDraft` → `saving`; saving the draft or moving to
`retrying` clears it. The SDK swallows hook errors, so the write is best effort and logged —
`stage` is only progress text.

A source that doesn't look like a CV is not a failure: the draft comes out nearly empty, the auto
questions ask for the required fields and the CV is `needs_input`.

Why a loop with one validating tool, and why a tool rather than `Output.object` (whose parse
error is thrown, not sent back to the model): [adr/0003](adr/0003-draft-agent-one-tool-loop.md).

### Which questions are kept

Three sources: **model** (`questions`), **verifier** (`buildVerifierQuestions` over what
`sanitise` took out: a `confirm` per removed bullet; a `text` per cleared project name/period,
education degree/period, certification name/issuer/year and language name, a `choice` of A1–C2 +
"Native" for a language level — each only when the auto questions don't cover it; one `multi`:
the removed skills, then the labels of uncovered `skill` requirements, unique case-insensitively,
the first 8) and **auto** (`buildAutoQuestions` over the final draft). A question whose target
can't take an answer (`applyAnswer`) or whose item was dropped as empty is dropped; a model
`choice` with < 2 options becomes `text`. Of the model's questions — without the ones about the
whole skills block when there is a `multi`, which asks it with options — the first 7 are taken,
one per target; one about the target of an auto or cleared-field question takes that one's place;
a `confirm` is never replaced. `selectQuestions` keeps at most 12 open questions, in this order:
auto → `confirm` (≤ 5) → cleared fields → the `multi` → the rest of the model's (in its order); the
caps are `QUESTIONS` in `config/limits.ts`. The verifier's questions are worded in the CV language by
`questions/verifier-wording.ts` (the auto ones by `@cv/shared`).

### 3a. Answer wording

A free-text answer (`text`, or the "Other" of a `choice`) is turned into CV text in the CV
language:

- to the bullets of an experience or project item: 1–3 bullets, appended;
- to the summary: one sentence (≤ 300 chars), appended; the summary itself is never rewritten;
- to the whole experience block: one new job with 1–6 bullets, and the title, company and period
  the answer names (title and company copied as the answer writes them).

It takes **one `generateText` call with `Output.object`** on the fast model
(`FAST_LANGUAGE_MODEL`, `ANTHROPIC_FAST_MODEL`, default `claude-haiku-4-5`) — no tools, no loop
(root [adr/0002](../../docs/adr/0002-answer-wording-inside-the-request.md)). `QuestionsService.reply`
checks the batch, words its answers (`AnswerWordingService`), then checks it again under the lock
and applies it; the call runs outside the transaction, so no row lock is held while the model
answers. One call per batch; it sees the question, the answer, the CV language, the target role
and the target's context (the item's title, company and bullets, or the summary; nothing for a
new job), never the source. The model returns per answer id every field (`bullets`, `sentence`,
`title`, `company`, `period`), empty where its kind has none or the answer gives nothing for the
CV; the code reads only its kind's.

A result is used only when it keeps its kind's shape (the bullet counts and sentence length
above, a new job with at least one bullet) and states nothing the answer doesn't:
`unbackedInWording` finds no number outside the answer and no technology-like word outside the
answer and the source, and a new job's title and company appear in the answer as whole words.
Everything else — a timeout (`ANSWER_WORDING_LIMITS.timeoutMs`, 15 s; the e2e tests shorten it),
an API error, an output that fails the schema, a missing id, a result out of shape or unbacked —
puts that answer (or the batch) in as written (`applyAnswer`), logged at `warn`. Facts and
`question.answer` keep the raw answer.

A cost guard caps the calls: at most 60 answers per user are sent to the model in a sliding hour
(`ANSWER_WORDING_BUDGET` in `config/limits.ts`). `WordingBudgetService.take` runs before the call:
under the user's row lock (the one a generation start takes) it sums the user's
`answer_wordings` rows of the window on the database's clock, grants what is left and writes a
row for it, so the count is shared by every api instance and two batches at once don't both take
the last answers. The first answers of the batch up to the grant are worded, the rest go in as
written, logged at `info` once per batch. It is never a `429` and isn't shown in
`GET /api/usage`. An answer counts once it is sent, whether or not its result is used; a
budget that can't be counted (a database error) puts the batch's answers in as written, at `warn`.

## 4. Verification — keeping the AI from inventing facts

Every **claim** about the person in the CV must rest on `source_text` or on `facts` (the user's
answers). `verifyDraft(submission, source, facts)` is pure; inside the loop it also reports bad
question targets, requirements and suggested roles, so those cost a step too. After the loop
`sanitise` runs it again on the last submission, accepted or not. The minimums are
`VERIFY_LIMITS`. `sectionOrder` is the model's choice and is not checked.

The CV may be in another language than the source, so text facts are checked through **evidence
quotes in the source language**, and everything language-neutral (numbers, emails, phones, URLs,
technology names) is checked directly ([adr/0004](adr/0004-evidence-quotes-in-source-language.md)):

| field | rule | if it fails after the loop |
|---|---|---|
| experience / project bullet | `evidence` quote (≥ 8 chars) found in source/facts; every number in the bullet appears in one of the found quotes for its path | removed → `confirm` question with the claim |
| title, company, institution, degree, project name, certification name and issuer, language name and level | substring of source/facts, **or** an `evidence` quote (≥ 4 chars) found in source/facts (translated text, "вище середнього" for "Upper-Intermediate") | cleared → `text` question (`choice` for a level); a job's title / company / period and an institution get the auto question instead |
| period, certification year | every number in it appears in source/facts | cleared → as above |
| email, phone, contact links, project URL | in source/facts (email case-insensitive; phone by digits, inside one phone-like run; a link without scheme, `www.` and trailing `/`) | email / phone cleared → the auto question if both are now empty; a link removed, a project URL cleared — neither asked about |
| skills | appears in source/facts as a whole word (tech names are language-neutral), or has an `evidence` quote (≥ 4 chars) found in source/facts | moved to the `multi` question |
| summary | every number, and every skill-like word (Node.js, C++, PostgreSQL, AWS, K8s) or skill of the draft it names, is in source/facts or a verified skill | the sentences (split after `.` `!` `?` `…`) that hold one are dropped; an empty summary gets the auto question |
| question target | something `applyAnswer` can write into: a contact field, the summary, the skills, the whole experience block, a field of an existing item | question dropped |
| requirements | a label and ≥ 1 keyword (length and count are the schema's) | invalid entries dropped (they describe the role, not the person) |
| suggested roles | not blank (length ≤ 100 and count ≤ 3 are the schema's) | blank ones dropped |

Normalisation (`agents/verify/normalise.ts`): NFKC, lower case, one kind of quote and dash, single
spaces; numbers are compared by their digits ("1,200" = "1 200", "03" = "3"; "03.2019" is two
numbers, a decimal part has at most two digits). Facts count by their
answers only — a question's wording is not something the user said — so a `confirm` "yes" is
stored with the claim as its answer and a "no" as "No"; the fact's question quotes the claim, so
the prompt shows what was denied. A `choice` on the skills is stored as the skill it adds
("English: B2"), the ticked options and "Other" of a `multi` joined by commas
(`questions/fact-of.ts`). The full name and location are not checked.

Known limit (for the README): a quote proves the fact exists in the source, not that its translation is
faithful — translation quality is trusted to the model, numbers and names are not.

`verification` stores the counts; the UI shows "12 bullets confirmed by quotes from your text,
2 sent to you to confirm, 1 skill moved to suggestions": `verified` = bullets in the saved draft,
`sentToConfirm` = `confirm` questions kept, `skillsToConfirm` = removed skills offered in the kept
`multi`, `cleared` = cleared fields some kept question targets (the verifier's, the auto one or
the model's that replaced it). What the caps cut — claims past the fifth, skills past the eighth
option, any question past the twelfth — what belonged to an item dropped as empty, and a failed
link or project URL are left out of the draft without a question: never added unasked. Confidence scores from the model are not
used — there is nothing to check them against.

## 5. Failure handling

| failure | handling |
|---|---|
| Anthropic 408/409/429/5xx/529, network (`APICallError.isRetryable`, `RetryError` after the SDK's 2 retries in the step) | `LLM_UNAVAILABLE`; attempt failed → `retrying`, BullMQ exponential backoff (5 s base), 3 attempts → `failed` |
| step over 120 s or attempt over 300 s (`TimeoutError`) | same, `TIMEOUT` |
| no schema-valid submission after 3 agent steps | same, `LLM_INVALID_OUTPUT` |
| 401/403 (bad key) → `LLM_CONFIG`; anything else (another 4xx, a database error, a bug in the attempt) → `INTERNAL` | non-retryable → `failed` at once, no wasted attempts |

`classifyError` (pure) maps an error to `{ code, retryable }`; a non-retryable one makes the
processor throw BullMQ's `UnrecoverableError`. A failed attempt closes its row as `failed` with the
internal error and moves the CV in the same transaction: to `retrying` while attempts are left
(the processor rethrows, BullMQ waits 5 s, then 10 s, and `attempt` goes up when the next one
starts), else to `failed` with `error_code` and the user's text. What the processor throws carries
only the code: BullMQ keeps it in Redis, and the original error may quote the source. A CV that
is no longer `generating` (deleted) ends the job instead. If that write itself fails, a plain
error makes BullMQ run the job again, and the next attempt takes the CV over; after the last
attempt the recovery fails the CV instead (below).

| failure | handling |
|---|---|
| worker crash mid-attempt, or SIGTERM (the worker closes without waiting out the attempt) | the 30 s job lock is no longer renewed, so BullMQ's stalled-job check re-runs the job within about a minute; the new attempt finds its CV still `generating`, takes it over (`resumeGenerating`) and closes the job's attempt rows left `running` as `failed` (`stalled`); every other write is a CAS, so the re-run is idempotent |
| Redis wiped / enqueue failed | on worker start and every 60 s: re-enqueue CVs in `queued`/`generating`/`retrying` whose latest job BullMQ has no longer waiting, delayed or running (same jobId, so duplicates are ignored; a failed job BullMQ still keeps — 24 h, completed ones are removed at once — is removed first); `POST /api/cvs` waits at most 2 s for `add()`, then still answers `202` and logs the failure |
| a job BullMQ gave up on while its CV is `generating` (stalled too often, or the last failure never written) | the recovery fails the CV with `INTERNAL` and closes the job's `running` attempt rows as `stalled`, instead of running it again (which could loop); the user can Retry |
| a job replaced by a Retry runs again (stalled, recovered) | the processor runs only the CV's latest job; an older one ends without touching the CV |
| CV deleted during generation | final CAS hits 0 rows → result discarded |
| stale tab / two devices edit | `version` mismatch → `409 VERSION_CONFLICT` |
| corrupt `data` in DB | parsed with Zod before render/return → `500 DATA_CORRUPT`, never a broken PDF |
| prompt injection in source/note/answers | data only in escaped tags; system rules; only tool validates; output verified |
| huge/malicious input | JSON body ≤ 512 KB, PDF ≤ 5 MB / 10 pages, char limits — all before anything reaches the LLM; PDF text only, no OCR |

## 6. Auth, isolation & limits

- `signup`/`login` → JWT `{ sub: userId }` (7 days) in an `httpOnly`, `SameSite=Lax` cookie
  (`Secure` behind HTTPS), no session table ([adr/0006](adr/0006-jwt-cookie-no-session-table.md)).
  argon2id. Same error, and the same time (a dummy hash is verified), for an unknown email and a
  wrong password. Login throttled: 30 a minute per
  IP (in-memory store, one api instance) → `429 RATE_LIMITED` + `Retry-After`.
- The signing secret is generated on the first api start and kept in `app_secrets`
  (`insert … on conflict do nothing`, then read), so the only secret in `.env` stays
  `ANTHROPIC_API_KEY` and sessions survive a restart. `JWT_SECRET` in the env (≥ 32 chars)
  overrides it.
- `JwtAuthGuard` is global; `@Public()` opens signup, login, logout and health. `userId` only
  from the verified token (`verify`, never `decode`), handed to handlers by `@CurrentUser()`.
  The guard lives in `auth/` (it needs the session service); the two decorators live in
  `common/auth/`, so feature modules never import `auth`. DTOs are Zod-parsed — unknown keys
  (e.g. `userId`) are stripped.
- `trust proxy` believes one hop: the direct peer, when it is on a loopback, private or link-local network
  (the web container's nginx). nginx appends the address it saw to `X-Forwarded-For`, and only
  that last entry counts, so the login throttle is per client and can't be reset by a forged
  header; `X-Forwarded-Proto` makes the cookie `Secure` behind HTTPS. A client that reaches port
  3000 directly from such a network can still set both headers; in the stack users come through
  the web container.
- Every CV query filters by `user_id`; a foreign CV or an id that isn't a UUID ⇒ `404`, not `403`.
  The worker takes `user_id` from the job row.
- Limits (config): 10 generations/user/hour → `429 RATE_LIMITED` + `Retry-After`; ≤ 4 in progress
  per user → `429 TOO_MANY_ACTIVE` (`details.limit`, no `Retry-After`); ingest 20/min per user →
  `429 RATE_LIMITED` + `Retry-After`. The generation limit counts `generation_jobs` rows of the last 60 minutes — what
  the user started (a CV created, a manual Retry), not automatic retries of an attempt; deleting a
  CV keeps its jobs, so it doesn't free the limit. The window is counted on the database's clock
  (the one that stamped the rows); `resetsAt` is when the oldest counted row leaves it (with none,
  an hour from now) and `Retry-After` the seconds until then. The hourly limit is checked before
  the active one, in the transaction that starts the generation, on create and on Retry; that
  transaction first locks the user's row, so two starts at the same moment count one after the
  other and can't both take the last place.
  `@nestjs/throttler` for login (per IP) and
  ingest (per user: the id the auth guard verified, so one IP can hold many users).
- A JSON body is ≤ 512 KB (`JSON_BODY`: a `PATCH` draft with every `CV_LIMITS` field full is
  ~217 KB in Cyrillic, ~324 KB in CJK; Express's 100 KB default refused one) → `413
  INPUT_TOO_LARGE`; a body that isn't JSON → `400 VALIDATION_ERROR`.
- Intake takes one multipart part, `file`, ≤ 5 MB; another field or file is `400`, a missing file
  is `400 VALIDATION_ERROR` with `details.fields.file`. The file stays in memory (multer without
  storage) and pdf.js reads only its text layer; the minimum of 50 characters counts visible
  ones, so a scan with stray whitespace still gets `422`. Checks in order: `%PDF` magic bytes →
  `415`, > 10 pages → `413`, pdf.js can't parse → `422`; the echoed filename is cut to 200 chars.
- Known simplifications (for the README; not written there yet): JWT can't be revoked before expiry; signup reveals that an email
  is taken; pdf.js parses an upload on the api's event loop, so a
  crafted 5 MB PDF can slow other requests for a moment (bounded by the size, page and per-user
  limits; a worker thread would remove it).

## 6a. Logs

pino (`nestjs-pino`, options in `common/logging/logger-options.ts`) to stdout as JSON, or through
pino-pretty with `LOG_PRETTY` (a dev dependency, so not in the docker image). Level from
`LOG_LEVEL` (`silent|error|warn|info|debug|trace`, default `info`; the e2e tests run `silent`).
`pnpm dev` and `pnpm dev:worker` run `debug` with content and pretty lines unless the shell sets
the variables; how to switch them for each way of running: `README.md`, "Logging".

- Every line carries what is known of requestId (`x-request-id`, kept from the request when 1–128
  chars, else generated, and returned in the response), userId, cvId, jobId, attempt. A line
  logged during a request carries only the request's id (and the `userId` the auth guard set); the request itself is on its response line, logged by
  its outcome: `error` for a 5xx or a failed response, `warn` for a 4xx (with the `errorCode`
  answered) or a connection closed before the answer, `debug` for a successful read (`GET`/`HEAD`, the
  frontend's polling among them), else `info`. The docker healthcheck's `GET /api/health` gets no
  request line. In the worker a job runs in its own logging context: every line of it (the
  services' too) carries jobId, and attempt from the moment its CV is found. A field is bound
  once: a line never repeats a key its context holds.
- `error`: what needs a look — an unhandled error (500), `DATA_CORRUPT`, the database unreachable
  (`/api/health` 503), Redis or the queue failing, a recovery pass failing, a CV the recovery
  failed, a failure not recorded. `warn`: what went wrong and was handled — a failed attempt
  (with its error code and whether it retries), a PDF pdf.js could not parse, a lost job put
  back, a stage not written, answers not worded (the call failed, or a result was missing or
  unbacked: inserted as written).
- `info`: what a user or the worker did — signed up, logged in, PDF read (pages, chars), CV
  created (language, source type and size, facts, parent), retried, edited (version),
  deleted, a batch of replies applied (how many answered and skipped, where the CV is now), its
  answers worded, or the wording budget used up (how many answers, how many were sent); an
  attempt started (model, prompt version) and its draft saved (status, questions, verification counts, steps, tokens,
  duration); a run that ends without an attempt (CV deleted, replaced or no longer waiting, a
  draft discarded); start-up lines (migrations applied, listening, worker ready).
- `debug`: the steps in between — the limits counted, a job queued, every status move (also
  the ones a compare-and-set refused; `inTransaction` when a rollback may still undo it), each agent step (finish reason, verdict, problems, tokens),
  the prompt built, a PDF rendered (bytes, ms), a refused login, an upload refused as not a PDF
  or too long.
- **Content.** What the user wrote or the model answered goes only under the `content` key of the
  line about it, at that line's level: the target role, role note and source text of a new CV, an extracted PDF's text and
  filename, an email at signup and refused login, an answer, an edited title and draft, the
  prompt's user message, each step's model text, `submit_draft` input, problems and tool error. pino redacts `content`
  (`"[redacted]"`) unless `LOG_CONTENT` is on — personal data, for development only. Never
  logged, whatever the flags: passwords, the session token, the cookie and authorization headers
  (redacted). Errors that may quote user data (LLM, database, unhandled) are logged and stored
  through `safeError` (§1, "Rules").

## 6b. API docs (development only)

The controllers describe their routes with `@nestjs/swagger` decorators (`@ApiOperation`,
`@ApiOkResponse`, …); the bodies and responses in them are the `@cv/shared` Zod schemas, never DTO
classes that repeat them ([adr/0007](adr/0007-swagger-from-decorators-and-zod-off-by-default.md)).
With `API_DOCS=true` the api serves the Swagger UI at `/api/docs` and the document at
`/api/docs-json`, both without a session; "Try it out" works after a signup or login there, since
the browser keeps the cookie. Off by default: without the flag the routes don't exist (`404`).
`pnpm dev` turns it on; compose passes `API_DOCS` from the root `.env`. A new route gets its
decorators in the same change, and `test/api-docs.e2e.test.ts` lists every route of docs/api.md.

## 7. PDF rendering

`GET /api/cvs/:id/pdf` renders on the fly from the **saved** `data` with pdfkit
([adr/0005](adr/0005-pdf-rendered-on-the-server-with-pdfkit.md)): A4 (595×842 pt), 50 pt margins,
embedded Liberation Sans Regular/Bold from `assets/fonts/` (Cyrillic), real text ⇒ selectable. The layout is the
product's (root architecture §10); section headings come from `getCvLanguage(cv.language).headings`.
The name and one contacts line (email · phone · location · links) first, then the blocks in
`data.sectionOrder`. Empty fields/blocks are skipped; pdfkit paginates. The PDF's `Title` is the
full name, its `lang` the CV language. One template behind `type CvTemplate = (cv, doc) => void`.
Filename = the title with the characters a file name can't hold turned into spaces, whitespace
collapsed; an ASCII `filename` (accents dropped, other letters left
out, "CV" if nothing is left) plus the whole title in `filename*` when they differ. `pdf/` only
draws: `CvsService.pdf` checks the owner and the status (no draft yet → `409 INVALID_STATE`), and a stored draft that fails `CvData`
is `500 DATA_CORRUPT` before anything is drawn. A bullet starts on the page its whole text fits
(its dot with it), and a heading never ends a page alone; an entry's title and period lines may
still end a page without their bullets. The fonts are Liberation Sans 2.1.5
under the SIL OFL (`assets/fonts/LICENSE.txt`), read once into the `PDF_FONTS` token; `assets`
ships in the image through `package.json` `files`.

## 8. Tests (priority)

Most important first; the cut order of features is in root architecture §12.

1. `verifyDraft` + sanitise: invented bullet → `confirm`, unknown skill → `multi`, wrong year → cleared + question; same checks pass for a Ukrainian source → English CV (quotes in Ukrainian, numbers intact).
2. Isolation e2e: user B can't read/edit/answer/retry/download/delete user A's CV (all 404).
3. Status machine: allowed/forbidden transitions; CAS drops a stale result; delete mid-generation.
4. Generation with a scripted fake model: accepted on step 2 after feedback; retry on transient error; `failed` after 3; non-retryable → `failed` at once.
5. `buildPrompt`: tags escaped, user data never in `instructions`.
6. `buildAutoQuestions`; `applyAnswer` / `computeMatch` are tested in `shared/`.
7. PDF: text extractable, 595×842, empty CV has no headings/`undefined`.
8. Intake limits: non-PDF, scan, too big, too long text, 429; a JSON body over 512 KB is 413.

Vitest everywhere, `supertest` for API e2e, `unplugin-swc` for decorators. The fake model lives
only in tests (swapped in through the model factory's DI token); there is no runtime switch. The
e2e tests also replace the `GENERATION_TIMING` token: a 300 ms backoff, and per test a short
attempt timeout or recovery period, so retries, timeouts and recovery run in about a second; and
the `GENERATION_LIMITS` token (5 per hour, 2 active), so a test reaches a limit in a few requests,
and the `WORDING_BUDGET` token (2 per hour in the answer wording tests).
The window moves by backdating `generation_jobs.created_at`.
e2e runs against Postgres and Redis from `compose.yaml` (`cv_test` database, own BullMQ prefix,
tables truncated between tests); unit tests of pure functions need neither. Once per run
`test/global-setup.ts` creates and migrates `cv_test` and deletes the test queue keys; before
every test `test/setup.ts` truncates every table (`app_secrets` too). The e2e run uses
`WORKER_CONCURRENCY=1` and a 30 s test timeout. `pnpm test:e2e` connects
to the project's compose services on their host ports (`DATABASE_URL` / `REDIS_URL` override them)
and always replaces the database name with `cv_test`; when the services are down, the run stops
with a message saying how to start them. Test files share the database, so they run one after
another.
