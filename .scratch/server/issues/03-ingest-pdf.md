# 03: Intake: PDF to text

**Blocked by:** 02 (auth)

**Status:** ready-for-agent

**Spec:** [../spec.md](../spec.md)

**What to build:** A signed-in user drops a PDF CV on the New CV screen and sees its text in the
background textarea to review; a scan, a non-PDF, a huge or a long file gets the error the
frontend already shows for it. The server stores nothing.

- [x] `POST /api/ingest/pdf`, multipart field `file`, auth required
- [x] Checks in order: body over 5 MB → `413 INPUT_TOO_LARGE`; content not starting with the `%PDF` magic bytes → `415 UNSUPPORTED_FILE` (a renamed `.txt` is rejected, a PDF named `.txt` is accepted); over 10 pages → `413 INPUT_TOO_LARGE`; broken PDF or under 50 chars of extracted text → `422 PDF_UNREADABLE`
- [x] `200 { text, pages, chars, filename }` with the text extracted by unpdf (text layer only, no OCR), `filename` echoed from the upload, ≤ 200 chars
- [x] Throttled at 20 a minute per user → `429 RATE_LIMITED` with `Retry-After`
- [x] Nothing is written to the database or disk; the file lives only in memory for the request
- [x] e2e with fixture PDFs: a two-page text PDF, an image-only PDF, a renamed text file, an 11-page PDF; the throttle
- [ ] Manual check: upload from the frontend on `pnpm stack` fills the textarea
  (on 2026-10-06 the same upload went through the web container's nginx with curl: a two-page
  PDF named `Резюме.pdf` came back with its text and name, a scan got 422; a browser upload is left)
