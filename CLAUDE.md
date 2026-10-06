# Backend

NestJS API + BullMQ worker for the AI CV Builder. Where code goes, the tables, the generation
agent, verification, failure handling, auth and PDF rendering: `backend/docs/architecture.md`;
why: `backend/docs/adr/`; backend terms: `backend/GLOSSARY.md`. Product, containers and stack:
root `docs/architecture.md` §1–§4; API contract: `docs/api.md`; statuses: `docs/cv-statuses.md`.

Server work starts here, not with a root spec (root `workflow.md` §1). The design was grilled
from `.scratch/server/handoff.md`; the spec and the tickets being built are in
`.scratch/server/` (`spec.md`, `issues/`).

Dependencies are installed from the repo root (`pnpm install`): one workspace, one lockfile.
`@cv/shared` is consumed from its `dist`, so build it once (`pnpm --filter @cv/shared build`)
before the backend's typecheck, tests or build after a fresh clone.

## Commands

All from `backend/`, Node through nvm (root `CLAUDE.md`, "Environment"):

- `pnpm dev` / `pnpm dev:worker` — watch mode against the compose Postgres and Redis
  (`docker compose up postgres redis` here). Env comes from the root `.env`; only
  `ANTHROPIC_API_KEY` is required, `DATABASE_URL` / `REDIS_URL` default to the project's host
  ports (root `.env.example` lists the optional overrides). `pnpm dev` also serves the Swagger
  UI at `localhost:3000/api/docs` (`API_DOCS=true`); it is off everywhere else unless turned on.
  Both log at `debug`, with content, in pino-pretty lines (`LOG_LEVEL=debug LOG_CONTENT=true
  LOG_PRETTY=true`, architecture §6a).
- Checks before a commit: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`.
- `pnpm test:e2e` — against the same compose Postgres and Redis; set `DATABASE_URL` / `REDIS_URL`
  only if you changed the ports. Uses the `cv_test` database only.
- `pnpm db:generate` after a schema change; commit the SQL in `drizzle/`.

## Code rules

Write the code a senior NestJS reviewer would approve without comments: idiomatic Nest, typed end
to end, small modules with one job. When a rule here and a habit disagree, the rule wins; when
neither covers a case, follow the established NestJS / Node practice and say why in the PR.

**Types.** `strict` is on and stays on.
- No `any`: not written, not cast to (`as any`), not inferred. Data from outside (body, query, env,
  JSON columns, the model's output, a caught error) is `unknown` until a Zod schema or a type guard
  narrows it. Prefer `satisfies` and inference over `as`; a cast needs a one-line reason.
- No `@ts-ignore` / `@ts-nocheck`; `@ts-expect-error` only with a comment saying why.
- Request, response and domain types come from `@cv/shared` (`z.infer` of its schemas); the
  backend never redeclares a contract type. Row types come from the Drizzle schema
  (`typeof table.$inferSelect`).

**Modules and dependencies.**
- The module graph is acyclic and points one way: feature modules (`auth`, `cvs`, `questions`,
  `generation`, …) → `limits`, `agents`, `pdf` → `common`, `database`, `redis`, `config`. Lower
  modules never import higher ones; `agents/` imports only `@cv/shared`, the AI SDK and `zod`
  (the tool schemas), so the bounds of an agent run live next to the agent, not in `config/`.
- No circular imports between files and no `forwardRef` (both fail `pnpm lint`). If two modules
  need each other, move what they share into a lower module or invert the call (the caller passes
  a callback / the lower module returns data); never break a cycle with `forwardRef` or a lazy
  `require`.
- A module exports only what another module uses; everything else stays private to it. Other
  modules reach a CV only through `CvsService.getOwned`, and only `CvStatusService` writes
  `cvs.status` (architecture §1, "Rules").

**Nest conventions.**
- Dependencies come through constructor injection. Non-class values (the DB, Redis, the env, the
  model factory) get a `Symbol` token exported next to their module; no `new` of a service, no
  module-level singletons, no service locator (`moduleRef.get`) outside the entry points.
- Controllers are thin: parse input with `ZodValidationPipe` and a `@cv/shared` schema, take the
  user from the verified token, call one service method, map the result. No queries, no business
  rules and no `try/catch` for flow control in a controller.
- Logic that needs no I/O is a pure function in its own file with unit tests next to it; services
  orchestrate I/O around those functions. Writes that must agree happen in one transaction.
- Errors: throw `AppError(status, code, message, details)` with a code from `@cv/shared`; never
  answer with a hand-built body or a raw `HttpException`. Unexpected errors are left to the filter
  (logged, `500 INTERNAL`). Never swallow an error silently: handle it, or log it and rethrow.
- Configuration is read once by `parseEnv` and injected through the `ENV` token; nothing else reads
  `process.env`. Limits and timeouts live in `config/limits.ts`, not as literals in services.
- Logging goes through `PinoLogger` with structured fields (`{ cvId, jobId, err }`), never
  `console` (except in `run.ts` before the logger exists), at the level architecture §6a gives
  the kind of event. What the user wrote or the model answered (source text, answers, an email,
  the prompt, a submission) goes only under the line's `content` key (`CONTENT`), which is
  redacted unless `LOG_CONTENT` is on; passwords, tokens and the cookie are never logged.
- Every promise is awaited or explicitly handed off; long work belongs to the worker, not to a
  request. Resources a module opens (pools, connections, queues) are closed in its
  `onApplicationShutdown`.

**Tests.** Behaviour through the highest seam (HTTP for features, the function for pure logic);
no mocks of our own classes; the model is replaced only through the model factory's token
(architecture §8).

## Docker

`Dockerfile` (build context: the repo root) builds one image for both processes:
`node dist/main.js` (api) and `node dist/worker.js` (worker). It runs
`pnpm --filter backend deploy --prod`, so `package.json` must list what ships in `"files"`
(e.g. `["dist"]`), otherwise the whole folder is copied.

`compose.yaml` here is the backend on its own: api, worker, postgres, redis.

- `pnpm stack:backend` from the root, or `docker compose --env-file ../.env up --build` here.
- API on `localhost:3000`; postgres and redis are published on `127.0.0.1:55432` and
  `127.0.0.1:56379` for `pnpm dev` and `pnpm test:e2e` on the host. The ports are the project's
  own so they never collide with a Postgres or Redis installed on the machine; `POSTGRES_PORT`,
  `REDIS_PORT`, `API_PORT` in the root `.env` override them.
- The api healthcheck calls `GET /api/health`; the worker starts once the api is healthy, because
  the api runs the migrations.

## Committing

Follow the commit rules in the root `CLAUDE.md`; scope is `backend`.

## Agent skills

The root `CLAUDE.md` sections apply; this subproject narrows them:

- **Issue tracker:** work that changes only backend internals lives in `backend/.scratch/`
  (`backend/docs/agents/issue-tracker.md`). Anything touching the contract (`docs/api.md`,
  `docs/cv-statuses.md`, `shared/`) or the frontend goes to the root tracker.
- **Domain docs:** backend terms in `backend/GLOSSARY.md`, backend-only decisions in
  `backend/docs/adr/`; product terms in `shared/GLOSSARY.md` (`GLOSSARY-MAP.md` at the root).
