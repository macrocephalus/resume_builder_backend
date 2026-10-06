# 07: Failures: classification, retrying, failed, manual Retry, recovery, stalled attempts

**Blocked by:** 05 (generation happy path)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md) · design: `backend/docs/architecture.md` §5, ADR 0001

**What to build:** When Anthropic is overloaded the user sees "Attempt 2 of 3 failed, retrying…"
and then a draft; when the key is wrong they see "The AI service is not configured on the server"
at once and can press Retry later; a CV whose worker died or whose queue was wiped comes back on
its own within a minute. Nothing ever stays `generating` forever.

- [x] `classifyError` is pure: retryable `APICallError` / `RetryError` (408, 409, 429, 5xx, 529, network) → `LLM_UNAVAILABLE`; `TimeoutError` → `TIMEOUT`; no schema-valid submission → `LLM_INVALID_OUTPUT`; 401/403 → `LLM_CONFIG` (not retryable); anything else → `INTERNAL` (not retryable); user messages as in `docs/cv-statuses.md`
- [x] The processor on a failed attempt closes the attempt row as `failed` with the internal error, then: retryable with attempts left → CAS `generating → retrying`, rethrow so BullMQ backs off (5 s base, exponential) and increments the attempt on the next run; retryable with no attempts left or not retryable → CAS `generating → failed` with `error_code` and `error`, and throw BullMQ's `UnrecoverableError` so no attempt is wasted
- [x] `POST /api/cvs/:id/retry`: only from `failed` (else `409 INVALID_STATE`), `404` for a foreign CV; creates a new `generation_jobs` row (counts toward the hourly limit from ticket 11), resets `attempt` to 1, clears the error, CAS `failed → queued`, enqueues; `202 { cv }`; `429 TOO_MANY_ACTIVE` applies
- [x] Queue recovery runs on worker start and every 60 s: CVs in `queued`/`generating`/`retrying` whose latest job has no live BullMQ job are re-added with the same jobId; a stalled re-run finds the job's attempt rows left `running` and closes them as `failed` with error `stalled` before opening a new one
- [x] Shutdown: on SIGTERM the worker closes the BullMQ worker without waiting out a running attempt; the attempt is picked up by stalled-job detection
- [x] e2e with the fake model: 529 on attempt 1 then success → CV passed through `retrying` with `attempt` 2 and ended with a draft; three 529s → `failed` with `LLM_UNAVAILABLE`; 401 → `failed` with `LLM_CONFIG` after one attempt; a model that never calls the tool → `LLM_INVALID_OUTPUT`, retried; a model that honours the abort signal and hangs → `TIMEOUT` (with test-shortened timeouts); manual Retry from `failed` produces a draft and a second job row; Redis flushed while a CV is `queued` → recovered on the next sweep; a `running` attempt row from a dead worker is closed as `stalled`
- [ ] Manual check on `pnpm stack`: a wrong `ANTHROPIC_API_KEY` fails a CV at once with the configured message; Retry works after fixing the key — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet
