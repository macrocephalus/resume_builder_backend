# 11: Usage and the hourly generation limit

**Blocked by:** 04 (CVs without generation); root `.scratch/server-contract/issues/01-apply-answer-and-limits.md` (`Usage` without `answers`)

**Status:** done

**Spec:** [../spec.md](../spec.md)

**What to build:** The New CV screen shows "3 of 10 generations used this hour · the next one
frees up at 14:05"; the eleventh Create in an hour is refused with `RATE_LIMITED` and the exact
moment to retry; deleting a CV does not give the generation back.

- [x] `GET /api/usage`: `{ generations: { used, limit: 10, resetsAt }, active: { used, limit: 4 } } (raised from 2 after ticket 07)` per the updated shared schema; `used` = `generation_jobs` rows of the user created in the last 60 minutes (a CV created or a manual Retry; automatic attempts are not rows); `resetsAt` = when the oldest counted row leaves the window, or an hour from now when `used` is 0; `active` = CVs in `queued`/`generating`/`retrying`
- [x] `POST /api/cvs` and `POST /api/cvs/:id/retry` check the hourly limit before the active limit: at 10 → `429 RATE_LIMITED` with `Retry-After` (seconds until `resetsAt`) and `details.limit`; the count-then-insert race is accepted and noted in the README notes (listed under "Known simplifications (README)" in backend architecture §6; the README is not written yet)
- [x] Limits live in config and tests override them to small numbers
- [x] e2e: usage counts after creates and a Retry; a deleted CV still counts; the 11th create → `429` with a `Retry-After` matching `resetsAt`; after the window moves (clock injected or `created_at` backdated) the create succeeds; `active` drops when a CV reaches `ready`
- [ ] Manual check on `pnpm stack`: the usage line shows on New CV and the block notice appears at the limit — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet
