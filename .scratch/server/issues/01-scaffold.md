# 01: Scaffold: api + worker, database, migrations, health, error shape, logs, e2e harness

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md)

**What to build:** A reviewer runs `docker compose up` from the repo root with only
`ANTHROPIC_API_KEY` in `.env` and gets five healthy containers; the api answers `GET /api/health`,
the worker starts once the api is healthy, and the frontend's web container reaches the api. A
developer runs the backend's unit and e2e tests against the compose Postgres and Redis. Nothing
else works yet — every other route is `404` — but every later ticket plugs into this shape.

- [x] The package replaces the `"type": "module"` stub: NestJS 11, CommonJS, `nest build` with SWC, scripts `build`, `start`, `start:worker`, `dev`, `typecheck` (`tsc --noEmit`), `lint` (oxlint), `format` (prettier), `test` (unit), `test:e2e`; `"files"` lists `dist`, the migrations folder and the fonts folder; the root `pnpm -r typecheck/lint/test/build` pick it up
- [x] Two entry points from one build: the api (HTTP, `/api` prefix, cookie parser, JSON logs, applies migrations at start, listens on 3000) and the worker (`createApplicationContext`, no HTTP, connects to Redis, runs nothing yet)
- [x] The environment is parsed by a Zod schema at start (database URL, Redis URL, Anthropic key, model with default `claude-sonnet-5-5`, worker concurrency with default 4, optional JWT secret, port); a missing or malformed variable stops the process with a message naming it
- [x] Drizzle schema for all tables of the backend architecture §2 (`users`, `cvs`, `cv_questions`, `generation_jobs` with `cv_id` set null on delete, `generation_attempts` cascading from the job, `app_secrets`), a committed generated migration, and a runner the api calls before listening
- [x] `GET /api/health` returns `200 { "status": "ok" }` when the database answers `SELECT 1` and `503` otherwise; no auth
- [x] One error filter produces `{ error: { code, message, details } }` for every error, with `500 INTERNAL` and a generic message for anything unexpected; one Zod validation pipe produces `400 VALIDATION_ERROR` with `details.fields` from a shared schema; an unknown route is `404 NOT_FOUND`
- [x] Logging via nestjs-pino: JSON to stdout, a request id on every request line, redaction of the cookie and authorization headers; the logger is the Nest logger in both processes
- [x] Shutdown hooks are enabled; SIGTERM closes the Postgres pool (api, worker) and the Redis connection (worker)
- [x] e2e harness: a separate `cv_test` database created if missing, migrations run once per test run, tables truncated between tests, a BullMQ prefix of its own; the run fails with a message saying to start `docker compose up postgres redis` when they are not reachable; a first e2e test calls `/api/health` and asserts the error shape on an unknown route
- [x] The Dockerfile builds (`pnpm --filter backend deploy --prod` ships only what `"files"` lists), `pnpm stack` from the root brings up web, api, worker, postgres and redis with api and worker healthy, and `pnpm stack:backend` works alone
- [x] `docs/architecture.md` §1 in `backend/` matches what was built (tree, scripts), if anything moved
