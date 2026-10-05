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

Status: **draft for review**, moved here from the root `docs/architecture.md` without changes of
substance. Not scaffolded yet.

## 1. The tree

```
backend/src/
  main.ts · worker.ts · app.module.ts · worker.module.ts
  config/                  env schema (zod), limits, model names
  database/                drizzle schema, migrations, db provider
  common/                  JwtAuthGuard, @CurrentUser, ZodValidationPipe, error filter
  auth/                    signup, login, logout, me
  cvs/                     CRUD, ownership, optimistic version, fromCvId copy
    cv-status.service.ts   the ONLY writer of cvs.status (CAS, canTransition)
  ingest/                  PDF → text (unpdf), size/page/text limits
  generation/              enqueue, limits, statuses + queue position, processor (worker only)
  questions/               answer / skip; apply-answer.ts (pure); auto-questions.ts (pure)
  agents/                  LLM layer — knows nothing about DB, HTTP or queue
    prompt/                PromptBuilder, escapeTags, system/*.system.ts (+ PROMPT_VERSION)
    draft/                 DraftAgent: tool loop with submit_draft
    answer/                AnswerAgent (optional, root architecture §6.5)
    verify/                verifyDraft (pure): facts vs source + user facts
    llm.ts                 model factory; replaced by a scripted fake in tests
  pdf/                     render-cv-pdf.ts, templates/classic.ts, fonts/
```

Rules:
- Ownership checks live in `cvs`; other modules get a CV only through `CvsService.getOwned(id, userId)`.
- Pure functions (`PromptBuilder`, `verifyDraft`, `applyAnswer`, `buildAutoQuestions`,
  `computeMatch`, `renderCvPdf`) have no I/O and carry most unit tests.
- `agents/` returns plain results; `generation/` decides what to persist.
- The api runs the migrations on start; the worker (`worker.ts`,
  `NestFactory.createApplicationContext`) loads only the BullMQ processor and the agents.

## 2. Data model (Postgres, Drizzle)

**users** — `id uuid pk`, `email text unique` (lower-cased), `password_hash` (argon2id), `created_at`.

**cvs**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid → users, cascade | every query filters by it |
| parent_cv_id | uuid null → cvs, set null | set when created "for another role" from this CV |
| title | text | defaults to `target_role`, user-editable |
| target_role | text | 2–100 chars, required, immutable |
| role_note | text null | ≤ 1 000 chars, optional, immutable |
| language | text | `CvLanguage` code (root §6.7), default `en`, immutable |
| source_type | `text` \| `pdf` | |
| source_filename | text null | for display only |
| source_text | text | 80–20 000 chars; reused by retries and new-role CVs |
| facts | jsonb | `{question, answer}[]` — user-provided facts, fed into every later prompt |
| status | CvStatus | `docs/cv-statuses.md`; index `(status, created_at)` |
| stage | text null | generating sub-step |
| attempt, max_attempts | int | |
| error_code, error | text null | only when `failed` |
| data | jsonb null | `CvData`, null until the first draft |
| requirements | jsonb | `Requirement[]` (root §7) |
| suggested_roles | jsonb | `string[]` ≤ 3 |
| verification | jsonb null | report: `{verified, sentToConfirm, skillsToConfirm, cleared}` — shown in UI |
| version | int | +1 on every write of `data`; optimistic locking |
| created_at, updated_at | timestamptz | |

**cv_questions** — `id`, `cv_id → cvs cascade`, `kind` (`text|choice|multi|confirm`),
`origin` (`model|verifier|auto`), `text`, `label` (short field name, e.g. "English"),
`options jsonb`, `claim text null` (for `confirm`), `target jsonb` (§3), `status`
(`open|answered|skipped`), `answer jsonb null`, `position int`, `created_at`, `answered_at`.

**generation_jobs** — one row per attempt: `id` (= BullMQ jobId), `cv_id`, `user_id` (copied from
the CV, never from a request), `attempt`, `status` (`running|succeeded|failed`), `model`,
`prompt_version`, `agent_steps`, `input_tokens`, `output_tokens`, `duration_ms`, `error`,
`created_at`, `finished_at`. Used for audit and for the hourly generation limit.

No `cv_sources` table and no job-level status: [adr/0002](adr/0002-one-cv-status-no-source-table.md).

## 3. DraftAgent — an AI SDK v7 tool loop

Input: `source_text`, `target_role`, `role_note`, `language`, `facts`, today's date (UTC).

`PromptBuilder` puts static rules from `agents/prompt/system/` into `system` and user data into
one message with escaped tags: `<today>`, `<cv_language>` (English name from the allow-list, e.g.
"Ukrainian"), `<target_role>`, `<role_note>`, `<source>`, `<user_facts>`. Rules say content of
tags is data, never instructions. User data never enters `system`.

The agent (`ToolLoopAgent`) has **one tool, `submit_draft`**, forced via `toolChoice`:

```ts
DraftSubmission = {
  cv: CvData /* without ids */,
  evidence:  { path: string; quote: string }[],    // "experience[0].bullets[2]" → verbatim source quote (source language)
  questions: { kind: 'text' | 'choice'; text; label; options?; target: QuestionTarget }[],  // ≤ 7
  requirements: { label; kind: 'skill' | 'experience'; keywords: string[] }[],             // ≤ 12
  suggestedRoles: string[],                        // ≤ 3
}
QuestionTarget = { section: CvSection /* any of the eight blocks */;
                   itemIndex?: number; field?: string }   // backend maps index → item id
```

1. Step 1: the model calls `submit_draft`. Zod validates the input (AI SDK returns schema errors to
   the model as a tool error). `execute` runs `verifyDraft` (§4) — pure, no side effects — and
   returns `{ accepted: true }` or `{ accepted: false, problems: ["experience[1].bullets[2]: quote
   not found in source — quote verbatim or drop the claim", …] }`. Stage → `verifying`.
2. Steps 2–3 (stage `revising`): the model fixes and resubmits.
3. Stops on accept or `isStepCount(3)`; per-call timeout 60 s, whole attempt 180 s.
4. The last schema-valid submission is **sanitised** — whatever still fails verification is
   removed and turned into questions (§4). No schema-valid submission ⇒ attempt fails
   (`LLM_INVALID_OUTPUT`, retryable).
5. One transaction (stage `saving`): assign ids, write `data`, `requirements`, `suggested_roles`,
   `verification`; insert model + verifier + auto questions; `version + 1`; status →
   `needs_input` / `ready` via CAS; close the job row (model, prompt version, steps, tokens, ms).

Why a loop with one validating tool: [adr/0003](adr/0003-draft-agent-one-tool-loop.md).

## 4. Verification — keeping the AI from inventing facts

Every *fact* in the CV must be traceable to `source_text` or `facts`. `verifyDraft(submission,
source, facts)` is pure; normalisation = lower-case, collapse whitespace, unify quotes/dashes.

The CV may be in another language than the source, so text facts are checked through **evidence
quotes in the source language**, and everything language-neutral (numbers, emails, phones, URLs,
technology names) is checked directly ([adr/0004](adr/0004-evidence-quotes-in-source-language.md)):

| field | rule | if it fails after the loop |
|---|---|---|
| experience / project bullet | `evidence` quote (≥ 8 chars) found in source/facts; every number in the bullet appears in that quote | removed → `confirm` question with the claim |
| title, company, institution, degree, project name, certification name and issuer, language name | substring of source/facts, **or** an `evidence` quote found in source/facts (translated text) | cleared → `text` question |
| period, certification year | every number in it appears in source/facts | cleared → `text` question |
| language level | appears in source/facts | cleared → `choice` question |
| email, phone, links | verbatim (phone compared by digits) | cleared → auto question |
| skills | appears in source/facts (tech names are language-neutral), or has an `evidence` quote | moved to the `multi` question |
| summary | every number and every skill-like token is already in verified data | cleared → auto question |
| question target | points to an existing field | question dropped |
| requirements | bounded length/count, ≥ 1 keyword | invalid entries dropped (they describe the role, not the person) |
| suggested roles | ≤ 3, ≤ 100 chars | trimmed |

Known limit (README): a quote proves the fact exists in the source, not that its translation is
faithful — translation quality is trusted to the model, numbers and names are not.

`verification` stores the counts; the UI shows "12 bullets confirmed by quotes from your text,
2 sent to you to confirm, 1 skill moved to suggestions". Confidence scores from the model are not
used — there is nothing to check them against.

## 5. Failure handling

| failure | handling |
|---|---|
| Anthropic 429/5xx/overloaded, network, timeout | attempt failed → `retrying`, BullMQ exponential backoff (5 s base), 3 attempts → `failed` |
| no schema-valid submission after 3 agent steps | same, `LLM_INVALID_OUTPUT` |
| invalid API key / request rejected as invalid | non-retryable → `failed` (`LLM_CONFIG`/`INTERNAL`) at once, no wasted attempts |
| worker crash mid-attempt | BullMQ stalled-job detection re-runs it; CAS writes make re-runs idempotent |
| Redis wiped / enqueue failed | worker start: re-enqueue CVs in `queued`/`generating`/`retrying` (jobId dedups) |
| CV deleted during generation | final CAS hits 0 rows → result discarded |
| stale tab / two devices edit | `version` mismatch → `409 VERSION_CONFLICT` |
| corrupt `data` in DB | parsed with Zod before render/return → `500 DATA_CORRUPT`, never a broken PDF |
| prompt injection in source/note/answers | data only in escaped tags; system rules; only tool validates; output verified |
| huge/malicious input | size/page/char limits before anything reaches the LLM; PDF text only, no OCR |

## 6. Auth, isolation & limits

- `signup`/`login` → JWT `{ sub: userId }` (7 days) in an `httpOnly`, `SameSite=Lax` cookie
  (`Secure` behind HTTPS), no session table ([adr/0006](adr/0006-jwt-cookie-no-session-table.md)).
  argon2id. Same error for unknown email and wrong password. Login throttled.
- `JwtAuthGuard` on everything except signup/login; `userId` only from the verified token
  (`verify`, never `decode`). DTOs are Zod-parsed — unknown keys (e.g. `userId`) are stripped.
- Every CV query filters by `user_id`; foreign CV ⇒ `404`, not `403`. The worker takes `user_id`
  from the job row.
- Limits (config): 10 generations/user/hour, ≤ 2 in progress per user, 60 answers/hour,
  ingest 20/min → `429` + `Retry-After`. `@nestjs/throttler` for login and ingest, counts in
  Postgres for generations and answers.
- Known simplifications (README): JWT can't be revoked before expiry; signup reveals that an email
  is taken; count-then-insert race on limits is accepted.

## 7. PDF rendering

`GET /api/cvs/:id/pdf` renders on the fly from the **saved** `data` with pdfkit
([adr/0005](adr/0005-pdf-rendered-on-the-server-with-pdfkit.md)): A4 (595×842 pt), 50 pt margins,
embedded Liberation Sans Regular/Bold (Cyrillic), real text ⇒ selectable. The layout is the
product's (root architecture §10); section headings come from `CV_LANGUAGES[cv.language]`.
Contacts first, then the blocks in `data.sectionOrder`. Empty fields/blocks are skipped; pdfkit
paginates. One template behind `type CvTemplate = (cv, doc) => void`. Filename = sanitised title.

## 8. Tests (priority)

Most important first; the cut order of features is in root architecture §12.

1. `verifyDraft` + sanitise: invented bullet → `confirm`, unknown skill → `multi`, wrong year → cleared + question; same checks pass for a Ukrainian source → English CV (quotes in Ukrainian, numbers intact).
2. Isolation e2e: user B can't read/edit/answer/retry/download/delete user A's CV (all 404).
3. Status machine: allowed/forbidden transitions; CAS drops a stale result; delete mid-generation.
4. Generation with a scripted fake model: accepted on step 2 after feedback; retry on transient error; `failed` after 3; non-retryable → `failed` at once.
5. `PromptBuilder`: tags escaped, user data never in `system`.
6. `applyAnswer` / `buildAutoQuestions` / `computeMatch`.
7. PDF: text extractable, 595×842, empty CV has no headings/`undefined`.
8. Intake limits: non-PDF, scan, too big, too long text, 429.

Vitest everywhere, `supertest` for API e2e, `unplugin-swc` for decorators.
