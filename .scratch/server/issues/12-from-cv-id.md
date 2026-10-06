# 12: A CV for another role from an existing CV

**Blocked by:** 05 (generation happy path)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md)

**What to build:** A user clicks a suggested-role chip on a finished CV and a new CV for that role
starts generating from the same source and the same answers, without re-entering anything; the
original is untouched. This is the last ticket and the first to cut if time runs short.

- [ ] `POST /api/cvs` with `fromCvId` (exactly one of `fromCvId` / `sourceText`, else `400`): `404` when the parent is missing or foreign; `409 INVALID_STATE` when the parent has no draft (`queued`/`generating`/`retrying`/`failed`); otherwise the new CV copies `source_type`, `source_filename`, `source_text` and `facts` from the parent, takes `targetRole`, `roleContext` and `language` from the body (language may differ from the parent's), sets `parent_cv_id`, and is queued like a new CV (limits apply)
- [ ] The parent's data, questions and status are unchanged; deleting the parent later sets the child's `parent_cv_id` to null
- [ ] e2e: a child gets a draft whose prompt carried the parent's facts (fake model records the prompt); `409` for a parent without a draft; `404` for another user's parent; `400` when both `fromCvId` and `sourceText` are sent
- [ ] Manual check on `pnpm stack`: the "also fits" chip creates and generates the new CV
