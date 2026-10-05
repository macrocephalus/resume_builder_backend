# Generation runs as a BullMQ job; the CV status lives in Postgres

Generation takes tens of seconds and must survive a page reload, an api restart and a worker
crash, so the api only enqueues a job and the worker runs it. BullMQ on Redis gives retries with
backoff, concurrency control and stalled-job detection out of the box. Postgres stays the only
source of truth: the CV status, stage and attempt are written there, so the UI never depends on
Redis, and losing Redis loses no data (the worker re-enqueues unfinished CVs on start, the jobId
dedups).

## Considered Options

- **A background promise inside the api request** — lost on restart or crash, no retries, no
  concurrency limit.
- **pg-boss (queue in Postgres, no Redis)** — one moving part fewer, but less familiar under a
  10-hour budget.
- **Vercel `WorkflowAgent`** — solves the same problem; skipped for the same reason.
