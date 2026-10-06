# One status per CV; no source table, no job-level status

A CV is generated once; targeting another role creates a new CV that copies `source_text` and
`facts`. So the source lives on the `cvs` row, and the CV has one status string that the UI maps
directly (`docs/cv-statuses.md`). `generation_jobs` keeps one row per started generation for the
hourly limit and `generation_attempts` one per attempt for audit, but neither is a second status
the UI has to combine.

## Considered Options

- **A `cv_sources` table shared by CVs** (proposed in the OpenAI design chat) — a join without a
  use case while a CV is never regenerated.
- **CV status + job status** — two strings the UI would have to reconcile into one screen.

## Consequences

Revisit both if "regenerate this CV" is ever added.
