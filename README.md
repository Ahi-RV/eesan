# EESAN — Stage 1

Stage 1 proves that EESAN can securely connect a **personal Microsoft OneDrive** account and discover PDFs in the EESAN library. It deliberately does not download files, extract text, perform OCR, or create an index yet.

## What is included

- Microsoft delegated OAuth 2.0 sign-in for personal Microsoft accounts
- Read-only Microsoft Graph permissions: `Files.Read` and `User.Read`
- Server-side encrypted token persistence; no token is exposed to the browser
- OneDrive connection status, disconnect, health, and recursive PDF discovery APIs
- Required library layout validation for `/EESAN/Manhole/Duct`, `/EESAN/Manhole/Card`, `/EESAN/SLD`, `/EESAN/Termination`, and `/EESAN/Planmap`
- A small responsive connection page at `/`

## Microsoft Entra setup

1. Go to [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and create a new registration.
2. Give it a name such as `EESAN Local Development`.
3. Under **Supported account types**, select **Personal Microsoft accounts only**. (Using `consumers` in `.env` enforces the same choice.)
4. Add a **Web** redirect URI: `http://localhost:3000/api/auth/microsoft/callback`. It must exactly match `MICROSOFT_REDIRECT_URI`.
5. Under **API permissions**, add delegated Microsoft Graph permissions `Files.Read` and `User.Read`. Do not add write permissions.
6. Under **Certificates & secrets**, create a client secret and copy its value now.
7. Copy the Application (client) ID from the Overview page.

## Run locally

1. Copy `.env.example` to `.env` and fill in the client ID and secret.
2. Generate a token encryption key (PowerShell):

   ```powershell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
   ```

   Use the output as `TOKEN_ENCRYPTION_KEY`. Set a separate long random `SESSION_SECRET`.
3. Start the server:

   ```powershell
   node src/server.js
   ```
4. Open `http://localhost:3000`, choose **Connect OneDrive**, and sign in.

Create this structure in the connected OneDrive before testing (empty folders are fine):

```text
EESAN/
├── Manhole/Duct/
├── Manhole/Card/
├── SLD/
├── Termination/
└── Planmap/
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness and configuration state (never secrets) |
| GET | `/api/connection-status` | Session-specific OneDrive connection status |
| GET | `/api/auth/microsoft/login` | Starts Microsoft sign-in |
| POST | `/api/auth/disconnect` | Deletes the local encrypted token for this session |
| GET | `/api/pdfs` | Recursively lists PDFs in the configured library folders |

`GET /api/pdfs` returns `{ files, folders, missingFolders }`. A missing `EESAN` root produces a helpful `404`; individual library folders may be absent during initial setup and are reported in `missingFolders`.

## Security notes

- Keep `.env` private. It is ignored by Git.
- Refresh and access tokens are encrypted with AES-256-GCM in `data/sessions.json` and are never returned by an API response.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when `APP_BASE_URL` is HTTPS.
- OAuth uses state validation, PKCE, and an encrypted server-side session record.
- For a deployed version, place the app behind HTTPS and replace the JSON session store with a managed database/secret store.

## Stage 2 extension point

`src/graph.js` owns OneDrive traversal. A future `IndexingService` can consume its `{ id, name, path, webUrl, size, lastModifiedDateTime }` file records to download content, extract text, OCR scans, and write a search index without widening permissions.

