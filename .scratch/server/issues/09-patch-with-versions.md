# 09: Manual edit with optimistic versions

**Blocked by:** 05 (generation happy path)

**Status:** done

**Spec:** [../spec.md](../spec.md)

**What to build:** A user edits the draft and the title in the editor and presses Save; a save
from a stale tab is refused with "Changed in another tab — reload latest"; removing a job entry
also closes the question about it, and the CV becomes `ready` if that was the last one.

- [x] `PATCH /api/cvs/:id`: `404` for a foreign CV; `409 INVALID_STATE` unless `needs_input`/`ready`; body is `version` plus `title` (1–120) and/or full `data` (`CvData`, client UUIDs checked for shape and uniqueness) — neither → `400`
- [x] `version` ≠ stored → `409 VERSION_CONFLICT` with `details.currentVersion`, nothing written
- [x] Before storing, the shared `dropEmptyItems` removes empty items and blank bullets, skills and links; `data` replaces the whole document including `sectionOrder`
- [x] Open questions whose target item is no longer in the draft become `skipped`; if no open question remains, CAS `needs_input → ready`; filling a field by hand does not close its question
- [x] One transaction; `200 { cv }` with `version + 1` (also for a title-only change); `updatedAt` moves so the list reorders
- [x] e2e: title only; data only; stale version → `409` and the stored draft unchanged; removing an item skips its question and flips to `ready`; empty item dropped; duplicate ids → `400`; PATCH on a `queued` CV → `409`; isolation matrix extended
- [ ] Manual check on `pnpm stack`: edit, Save, reload shows the change; two tabs reproduce the conflict notice — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet, so no draft to edit
