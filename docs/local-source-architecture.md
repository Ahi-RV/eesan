# Local OneDrive source architecture

Stage 1 reads PDFs from the locally synced folder configured by `EESAN_ROOT`.

```text
LocalOneDriveProvider ──> DocumentCatalog ──> Stage 2 page index
       (PDF discovery)       (file metadata)      (text/OCR/search)
```

`LocalOneDriveProvider` supplies project-document records. `DocumentCatalog` persists scan metadata and reports additions, changes, unchanged files, and removals. A future Microsoft Graph provider only needs to provide the same `listProjectDocuments()` method; the catalog and page-level index remain unchanged.

Each project PDF is identified by its source provider plus relative path. Its project number is the filename without `.pdf`.

