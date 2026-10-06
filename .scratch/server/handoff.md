# Server: handoff from the root

What the root knows before the backend grilling (2026-10-06). Read this, then grill; the spec this
work produces is `backend/.scratch/server/spec.md`.

## Sources

- Contract: `docs/api.md`, `docs/cv-statuses.md`, `@cv/shared` (schemas, status machine,
  `findMissing`, `autoQuestionText`, `computeMatch`). The backend adapts to it; a gap goes back to
  the root tracker as a ticket.
- Root decisions log: `.scratch/backend/decisions.md` (Q1–Q11). Q11: no root spec or root tickets
  for the server; the work starts here (`workflow.md` §1).
- Frontend mocks: `frontend/src/mocks` — a working picture of the server. Every endpoint, field
  and status code the frontend uses matches `api.md`. Generation: `queued` → `generating` with
  stages `drafting → verifying → revising → saving` → `needs_input` or `ready`; `retrying`
  between attempts; manual retry restarts at attempt 1.
- Design: `docs/architecture.md`, `docs/adr/`, `GLOSSARY.md` here.

## Settled at the root

- No AnswerAgent: an answer goes into the CV as written (`applyAnswer`, pure).
- A generation, for the hourly limit and `GET /api/usage`, is a CV created or a manual Retry;
  automatic retries don't count. Hourly counters are a sliding 60 minutes; `resetsAt` and
  `Retry-After` point at the moment the oldest counted event leaves it.
- `roleContext` (column `role_context`, prompt tag `<role_context>`, ≤ 5 000 chars).
- `sourceText` over 20 000 chars → `400 VALIDATION_ERROR` from the shared schema; `413` only for
  PDF over 5 MB or 10 pages.
- Auto questions: email and phone are two questions, each saying one is enough; texts come from
  `autoQuestionText`.

## What the mocks leave to the server

- the answer limit: 60 an hour, `429 RATE_LIMITED`;
- PDF checks: ≤ 10 pages (`413`), 20 uploads a minute (`429`), `422` for a PDF without text;
- `retrying` when the AI service is down: the mock's failure goes straight to `failed`.

## Open for the grilling

- Scaffold: the backend has no code yet (NestJS, Drizzle, BullMQ, `GET /api/health`, migrations).
- JWT secret: generate once and keep in Postgres, or take from `.env`.
- The fake model: only in tests, or also a runtime switch for running without `ANTHROPIC_API_KEY`.
- e2e: real Postgres and Redis from compose, or something lighter.
- One `generation_jobs` row per attempt vs. `id` = the BullMQ jobId.
- Ticket order: vertical slices, each checked by the frontend without mocks against
  `pnpm stack`.
