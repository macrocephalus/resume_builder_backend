# The PDF is rendered on the server with pdfkit

`GET /api/cvs/:id/pdf` draws the CV from the saved draft with pdfkit and a bundled Liberation Sans
(Latin, Cyrillic, Greek), so the text is real and selectable. One template sits behind `type CvTemplate = (cv, doc) => void`.

## Considered Options

- **Puppeteer / headless Chromium** — Chromium in the image, and HTML from user data is an
  injection surface.
- **LaTeX** — large image, escaping of user text.
- **@react-pdf/renderer** — React on the server for a single template.
