# Page-level project index

Each PDF is one project document. Its project number is its filename without the `.pdf` extension; for example, `PROJECT-10001.pdf` becomes `PROJECT-10001`.

```text
Project (PROJECT-10001)
  └── Project document (PROJECT-10001.pdf)
        ├── Page 3 ── Planmap ── MH-101, MH-102, MH-103
        ├── Page 4 ── Duct ───── MH-101
        ├── Page 6 ── Termination MH-101
        └── Page 7 ── Manhole Card MH-101
```

`src/index-model.js` defines the database schema to implement in Stage 2. It deliberately uses separate page classifications and detected entities tables: one page may have multiple drawing types and multiple manhole or cabinet numbers. It never assigns one drawing type to a whole PDF.

## Stage 2 indexing flow

1. Discover the Stage 1 `ProjectDocument` record from OneDrive.
2. Download that read-only PDF and create one `document_pages` record per page.
3. Extract embedded PDF text per page. Use OCR only for pages with missing or insufficient text.
4. Classify each page independently as Planmap, Duct, Termination, Manhole Card, SLD, or another applicable type. Store zero or more classifications.
5. Detect and normalize identifiers (such as `MH-101`) and store one `detected_entities` record per occurrence.
6. Search joins entities, pages, classifications, documents, and projects. A result contains project number, drawing type(s), matching text, and page number.

The PDF viewer will use the original document's OneDrive item ID and the indexed `page_number` to open the source document at the result page. Term highlighting can be added when the PDF viewer supports text-layer highlighting; scanned pages will use OCR coordinates where available.

