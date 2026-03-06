# FlareDrive

FlareDrive is a Cloudflare Worker + R2 based WebDAV drive with a React web UI.

It provides:
- Standard WebDAV access for common clients
- Browser uploads with multipart support for large files
- Optional temporary share links backed by KV
- Upload integrity headers (`fd-sha256` / `x-fd-sha256`)

## Architecture

- Frontend: React + Vite (`src/components`, `src/features`)
- Worker entry: `src/worker.ts`
- WebDAV / HTTP handlers: `src/webdav`
- Storage: Cloudflare R2 binding (`BUCKET`)
- Share metadata: Cloudflare KV binding (`SHARE_KV`, optional)

## Features

- File list, search, create folder, move/copy/delete
- Drag-and-drop uploads
- Multipart uploads for large files
- Thumbnail metadata support
- Temporary share links with expiration
- WebDAV protocol endpoints under `/webdav`

## Quick Start

### Prerequisites

- Cloudflare account
- R2 enabled with at least one bucket
- Node.js and npm

### Install

```bash
npm install
```

### Configure

1. Edit `wrangler.jsonc` and configure your bindings:
   - Uncomment and fill `r2_buckets` with your R2 bucket using the `BUCKET` binding name.
   - If you enable sharing, uncomment and fill `kv_namespaces` with the `SHARE_KV` binding.
   - `wrangler.jsonc.example` shows the same structure with example values.
2. Set secrets for authentication:

```bash
wrangler secret put WEBDAV_USERNAME
wrangler secret put WEBDAV_PASSWORD
```

3. Optional local development variables: copy `.dev.vars.example` to `.dev.vars`.

### Run Locally

```bash
npm run build:app
npm run dev:worker
```

### Deploy

```bash
npm run deploy
```

## Configuration

### Required Bindings

- `ASSETS`: static frontend assets binding
- `BUCKET`: R2 bucket binding for file storage

### Optional Bindings

- `SHARE_KV`: KV namespace for share links

### Environment Variables

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `WEBDAV_USERNAME` | Yes | - | Basic Auth username |
| `WEBDAV_PASSWORD` | Yes | - | Basic Auth password |
| `WEBDAV_PUBLIC_READ` | No | `false` | Allow unauthenticated `GET`/`HEAD`/`PROPFIND` |
| `SHARE_ENABLED` | No | `false` | Enable `/api/share` and `/s/<token>` |
| `SHARE_DEFAULT_EXPIRE_SECONDS` | No | `3600` | Share-link TTL in seconds |

## Upload Integrity Header

FlareDrive uses `fd-sha256` (client-provided SHA-256) and `x-fd-sha256` (server response) to validate uploads.

- Worker accepts `fd-sha256` for uploads.
- Worker returns `x-fd-sha256` using client-provided checksum when present.

## WebDAV

Endpoint:
- `https://<your-domain>/webdav`

Notes:
- Uses standard WebDAV paths.
- Typical operations (`PROPFIND`, `GET`, `PUT`, `DELETE`, `COPY`, `MOVE`, `MKCOL`) are supported.
- Large uploads are handled by the web UI multipart flow.

## Sharing

When `SHARE_ENABLED=true` and `SHARE_KV` is configured:

- `POST /api/share` creates expiring links.
- Download links are served via `/s/<token>`.
- Only one active token is kept per file path.

## Project Structure

```text
src/
  components/            # UI components
  features/              # Frontend feature modules (transfer/share)
  webdav/                # Worker-side auth + WebDAV handlers
  worker.ts              # Worker fetch entry
  App.tsx
  main.tsx
```

## Scripts

- `npm run dev:app` start Vite dev server
- `npm run build` build frontend assets
- `npm run dev:worker` run Worker locally via Wrangler
- `npm run typecheck:worker` type-check Worker code
- `npm run deploy` build + deploy

## Security Notes

- Always use strong `WEBDAV_USERNAME` / `WEBDAV_PASSWORD`.
- Keep `WEBDAV_PUBLIC_READ=false` unless public read access is intentional.
- Consider external rate-limiting controls in front of Basic Auth endpoints.

## Acknowledgments

WebDAV-related implementation is based on [r2-webdav](https://github.com/abersheeran/r2-webdav) by [abersheeran](https://github.com/abersheeran).
