# Issue tracker: backend

Work that changes only the internals of `backend/` lives in `backend/.scratch/`; everything else goes to
the root tracker. The conventions (folders, ticket files, `Status:` / `Blocked by:` lines,
wayfinding) are the root ones: [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md),
with `<tracker>` = `backend/.scratch`.

If a ticket here turns out to need a change to the contract (`docs/api.md`,
`docs/cv-statuses.md`, `shared/`), stop: create a root ticket for the contract change and
add it to this ticket's `Blocked by:` line.
