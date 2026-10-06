# 04: CVs without generation: create → queued, list, statuses, get, delete, two active

**Blocked by:** 02 (auth)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md)

**What to build:** A user creates a CV from the real frontend and sees it `queued` with "N ahead
of you", in the list and on its page; they can delete it; a third CV while two are in progress is
refused. Nobody can see or touch another user's CV. The generation job is written and put on the
queue, but no worker picks it up yet.

- [x] `POST /api/cvs` with a new source: shared schema (`targetRole` 2–100, `roleContext` ≤ 5 000, `language` from the allow-list with default `en`, `sourceText` 80–20 000, `sourceType`, `sourceFilename` ≤ 200) → `400 VALIDATION_ERROR` naming the field; `429 TOO_MANY_ACTIVE` when the user already has 2 CVs in `queued`/`generating`/`retrying`; otherwise in one transaction a `cvs` row (`queued`, title = target role, `attempt` 1, `max_attempts` 3) and a `generation_jobs` row, then the BullMQ job added with jobId = job row id; `202 { cv }` with `data: null` — also when `add()` throws (logged)
- [x] `fromCvId` is rejected with `400` for now (ticket 12 adds it); the schema still accepts the shape
- [x] `GET /api/cvs`: `{ items: CvSummary[] }` of the user's CVs by `updatedAt` desc; `match` null without a draft, `openQuestions` 0
- [x] `GET /api/cvs/statuses?ids=`: 1–50 ids (`400` otherwise); `{ items: CvStatusInfo[] }` for the user's CVs among them, unknown and foreign ids silently omitted; `queuePosition` = number of `queued` CVs (all users) created earlier + 1, null outside `queued`
- [x] `GET /api/cvs/:id`: `{ cv }` with questions, requirements, verification; `404 NOT_FOUND` for a missing or foreign id
- [x] `DELETE /api/cvs/:id`: `204` in any status; rows cascade (questions), `generation_jobs.cv_id` becomes null; `404` for a foreign id
- [x] `CvsService.getOwned(id, userId)` is the only way to a CV and throws the `404`; the mapper builds `Cv` / `CvSummary` / `CvStatusInfo` from a row with the shared `computeMatch`
- [x] `CvStatusService` exists as the only writer of `cvs.status`: checks `canTransition` and updates with compare-and-set on the allowed from-statuses, returning whether a row was changed (used from ticket 05 on; unit-tested here)
- [x] e2e: creation and queue position with two users, `TOO_MANY_ACTIVE` on the third CV, and the isolation matrix — user B gets `404` on get, delete, statuses (omitted), and every later route (PATCH, retry, pdf, answer, skip) of user A's CV; the matrix is written now and extended by each later ticket
- [ ] Manual check: create from the frontend on `pnpm stack` → "In queue" card; delete works
  (on 2026-10-06 the same requests went to the backend stack with curl: create → queued, position 1,
  list, statuses, delete; with Redis stopped create still answered 202 in 2 s and logged; the
  browser check is left: the web image currently fails to build, see the frontend Dockerfile)
