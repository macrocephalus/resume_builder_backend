# Backend

NestJS API + BullMQ worker for the AI CV Builder. **Not scaffolded yet**: stack, modules and data
model are in `docs/architecture.md` (§3–§10); API contract: `docs/api.md`; statuses:
`docs/cv-statuses.md`.

Dependencies are installed from the repo root (`pnpm install`): one workspace, one lockfile.

## Docker

`Dockerfile` (build context: the repo root) builds one image for both processes:
`node dist/main.js` (api) and `node dist/worker.js` (worker). It runs
`pnpm --filter backend deploy --prod`, so `package.json` must list what ships in `"files"`
(e.g. `["dist"]`), otherwise the whole folder is copied.

`compose.yaml` here is the backend on its own: api, worker, postgres, redis.

- `pnpm stack:backend` from the root, or `docker compose --env-file ../.env up --build` here.
- API on `localhost:3000`; postgres and redis are published on `127.0.0.1` for `pnpm dev` on the
  host (`POSTGRES_PORT`, `REDIS_PORT`, `API_PORT` override the ports).
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
