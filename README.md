# EESAN — Phase 1, Stage 2

EESAN uses a **locally synced Personal OneDrive folder**. It discovers project PDFs, derives project numbers from filenames, tracks file changes, and extracts text independently from every PDF page.

## What it does

- Configurable local source folder via `EESAN_ROOT`
- Recursive discovery of every PDF below that folder, including subfolders
- One PDF = one project; `PROJECT-10001.pdf` = project `PROJECT-10001`
- Persistent metadata catalog with added, modified, unchanged, and deleted detection
- Page-level embedded-text extraction and local text search
- OCR fallback when optional Tesseract and Poppler tools are configured
- Local-provider abstraction so Microsoft Graph can later be added without changing the page index/search design
- Health, scan, project-list, and project-lookup APIs

## Setup

1. Make sure your personal OneDrive folder is synced to this computer.
2. Create a folder named `EESAN` inside OneDrive and put a few project PDFs in it:

   ```text
   OneDrive/EESAN/
   ├── PROJECT-10001.pdf
   ├── PROJECT-10002.pdf
   └── Archive/
       └── PROJECT-09001.pdf
   ```

3. Copy `.env.example` to `.env`.
4. Set `EESAN_ROOT` to your local folder path. Use forward slashes on Windows:

   ```text
   EESAN_ROOT=C:/Users/your-windows-username/OneDrive/EESAN
   ```

5. Start EESAN:

   ```powershell
   node src/server.js
   ```

6. Open `http://localhost:3000` and select **Scan EESAN folder**.

## Stage 2 page extraction

Set `EESAN_PYTHON` to a Python 3 executable with the `pypdf` package installed. In this Codex setup it is already configured in your local `.env`. Restart EESAN after changing `.env`, then select **Extract page text**.

Pages containing embedded PDF text are indexed immediately. Pages without usable text are marked `needs_ocr` until you configure both `EESAN_TESSERACT` and `EESAN_PDFTOPPM`. This keeps OCR local; no PDF content is sent to a cloud service.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Confirms the server and local source configuration |
| POST | `/api/scan` | Scans recursively and records additions, changes, and removals |
| GET | `/api/projects` | Lists active project PDF records |
| GET | `/api/projects/:projectNumber` | Returns the PDF record(s) for one project number |
| GET | `/api/pdfs` | Alias for the active project-PDF list |
| POST | `/api/index` | Extracts and stores page-level text for all PDFs, or one `?project=` |
| GET | `/api/search?q=MH-101` | Searches indexed page text and returns project and page matches |

`POST /api/scan` returns counts for `added`, `modified`, `unchanged`, and `deleted`. The metadata catalog is stored in `data/documents.json`, which is excluded from Git. PDFs remain in your OneDrive folder.

## Architecture for later stages

`src/providers/local-onedrive-provider.js` is the current document source. It produces generic project-document records for `src/document-catalog.js`; a future Graph provider can provide the same records.

Stage 2 creates a page-level index for each project PDF. It extracts embedded PDF text first and uses OCR only for scanned pages. It can now search page text. Later stages will classify and highlight each page independently; a project PDF is never restricted to one drawing type. See [the page-level index design](docs/stage-2-index-design.md) and [the local source architecture](docs/local-source-architecture.md).

## Security notes

- Keep `.env` private; it is ignored by Git.
- `EESAN_ROOT` is the only source boundary; symbolic links are skipped.
- The Stage 1 catalog stores metadata only, not PDF contents.
- Microsoft Entra, Graph, OAuth, and cloud tokens are not used in this phase.

