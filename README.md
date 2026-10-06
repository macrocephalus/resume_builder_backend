# AI CV Builder — backend

The NestJS API and the BullMQ worker of the AI CV Builder. One image, two processes:

- **api** (`dist/main.js`) — the REST API under `/api`: auth, PDF intake, CVs, questions, PDF
  export, usage. It runs the database migrations on start.
- **worker** (`dist/worker.js`) — runs the generations: one Claude agent per attempt, verification
  of every claim against the source, retries and the recovery of lost jobs.

Postgres holds the data and the status of every CV; Redis holds the queue.

More detail:

- `docs/architecture.md` — the inside: modules, tables, the agent, failures, auth, logs.
- `docs/adr/` — the decisions and why they were made.
- `GLOSSARY.md` — backend terms.
- The root `docs/api.md` — the HTTP contract.

## Run

From the repo root, with `ANTHROPIC_API_KEY` in the root `.env` (copied from `.env.example`):

| Command (repo root) | Starts |
|---|---|
| `pnpm stack` | the whole app: web on `localhost:8080`, api, worker, Postgres, Redis |
| `pnpm stack:backend` | api on `localhost:3000`, worker, Postgres, Redis |

For development on the host, from `backend/`:

```sh
pnpm install                       # once, from the repo root: one workspace, one lockfile
pnpm --filter @cv/shared build     # once after a fresh clone: the backend reads shared's dist
docker compose up postgres redis   # the project's own Postgres and Redis
pnpm dev                           # api in watch mode, Swagger UI at localhost:3000/api/docs
pnpm dev:worker                    # worker in watch mode
```

Checks:

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
pnpm test:e2e                      # against the compose Postgres and Redis, database cv_test
```

## Logging

### How it works

Both processes log through [pino](https://getpino.io) (`nestjs-pino`) to stdout, one JSON object
per line. In development the lines can go through pino-pretty instead:

```
[21:31:03.526] INFO: [CvsService] CV created
    cvId: "ae6c5309-…"
    jobId: "1067c864-…"
    sourceType: "pdf"
    sourceChars: 4211
    content: { "sourceText": "Olena Hnatiuk, …" }
```

**Levels.** Every event has a level, from the most to the least important:

| Level | What gets it |
|---|---|
| `error` | what needs a look: an unhandled error (500), a stored CV that fails its schema, Redis or the queue failing, a failure that could not be recorded |
| `warn` | what went wrong and was handled: a failed generation attempt (with its error code and whether it is retried), a PDF that could not be parsed, a lost job put back on the queue, any `4xx` answer (with its `errorCode`), a connection closed before the answer |
| `info` | what a user or the worker did: signed up, logged in, PDF read, CV created, edited, deleted, retried, a question answered or skipped; a generation attempt started, its draft saved (status, questions, verification, steps, tokens, duration); every non-read request |
| `debug` | the steps in between: the limits counted, a job queued, every status move, each step of the agent (its verdict, problems, tokens), the prompt, a PDF rendered, every successful read (`GET`, including the frontend's status polling) |

**Which line belongs to what.**

- Every request has an id: the `x-request-id` header the client sent, or a new UUID. The id comes
  back in the response's `x-request-id`.
- Each line logged during a request carries that `reqId` and, once the session is checked, the
  `userId`. The request's own line, written when it ends, carries the method, URL, status and
  time.
- In the worker every line of a job carries `jobId` and `attempt`, including the lines of the
  services the job calls. The lines about a CV carry `cvId`.
- To follow one CV, filter by `cvId`; to follow one generation, filter by `jobId`.

**Content.** Some fields hold what the user wrote or what the model answered: the source text,
an extracted PDF's text, answers, the email, the target role, an edited draft, the prompt, the
model's submissions and the problems found in them.

- These fields go only under a line's `content` key.
- pino replaces `content` with `"[redacted]"` unless `LOG_CONTENT` is on.
- The rest of a line (ids, counts, statuses, tokens, durations) is always logged.
- Passwords, the session token, the cookie and the `authorization` header are never logged,
  whatever the flags say.

### Turning it on and off

Three variables control it:

| Variable | Values | Default | What it does |
|---|---|---|---|
| `LOG_LEVEL` | `silent`, `error`, `warn`, `info`, `debug`, `trace` | `info` | the least important level written; `silent` writes nothing |
| `LOG_CONTENT` | `true`, `false` | `false` | writes `content` instead of `"[redacted]"`. Personal data: for development only |
| `LOG_PRETTY` | `true`, `false` | `false` | human-readable lines through pino-pretty instead of JSON. A dev dependency, so it is not in the docker image |

Where they come from:

| How you run it | Logs | To change |
|---|---|---|
| `pnpm dev`, `pnpm dev:worker` | `debug`, with content, pretty | prefix the command: `LOG_CONTENT=false pnpm dev`, `LOG_LEVEL=info pnpm dev:worker`, `LOG_PRETTY=false pnpm dev` (JSON) |
| `pnpm stack`, `pnpm stack:backend` (docker compose) | `info`, JSON, no content | `LOG_LEVEL=debug` in the root `.env`; compose passes only `LOG_LEVEL`, so content stays off |
| `pnpm start`, `pnpm start:worker` | `info`, JSON, no content | the shell's environment: `LOG_LEVEL=debug pnpm start` |
| e2e tests | `silent` | `test/helpers/env.ts` |

In `pnpm dev` a variable set in the shell wins over the script's default. The root `.env` does
not: the script sets all three before `.env` is read. Some examples:

```sh
pnpm dev                                   # everything: debug, content, pretty
LOG_CONTENT=false pnpm dev                 # debug, but source texts and answers redacted
LOG_LEVEL=info pnpm dev                    # only what users and the worker did
LOG_LEVEL=silent pnpm dev:worker           # a quiet worker
LOG_PRETTY=false pnpm dev | jq 'select(.cvId == "…")'   # JSON, filtered with jq
```
