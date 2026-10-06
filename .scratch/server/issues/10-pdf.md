# 10: PDF download

**Blocked by:** 05 (generation happy path)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md) · design: `backend/docs/architecture.md` §7, ADR 0005, root architecture §10

**What to build:** A user presses Download PDF and gets an A4 file named after the CV whose text
can be selected and searched, in the CV's language with the blocks in the order they chose, with
Cyrillic rendered correctly and no empty headings.

- [x] `GET /api/cvs/:id/pdf`: `404` for a foreign CV; `409 INVALID_STATE` unless `needs_input`/`ready`; `200 application/pdf` with `Content-Disposition: attachment; filename="<sanitised title>.pdf"` (ASCII fallback plus `filename*` for non-Latin titles)
- [x] Rendered on the fly from the **saved** `data` with pdfkit: A4 595×842 pt, 50 pt margins, Liberation Sans Regular and Bold embedded from the bundled fonts folder; contacts first, then the blocks in `sectionOrder` with headings from the shared `CV_LANGUAGES[cv.language]`; empty fields and blocks skipped (shared `isSectionEmpty`); pdfkit paginates; one template behind `CvTemplate = (cv, doc) => void`
- [x] Stored `data` that fails `CvData.parse` → `500 DATA_CORRUPT` (also on `GET /api/cvs/:id`), never a half-rendered PDF
- [x] Unit tests: the page size is 595×842; the extracted text contains the name, a bullet and a Ukrainian heading for a `uk` CV; a draft with only a name has no section headings and no "undefined"; blocks appear in `sectionOrder`
- [x] e2e: download for `ready`, `409` for `queued`, `DATA_CORRUPT` for a corrupted row; isolation matrix extended
- [ ] Manual check on `pnpm stack`: the file opens, text is selectable, Cyrillic is right — not done: no `ANTHROPIC_API_KEY` in the root `.env` yet, so no generated draft (the renderer was checked by eye on a Ukrainian sample)
