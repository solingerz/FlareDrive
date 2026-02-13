# FlareDrive

Cloudflare R2 storage manager powered by a single Cloudflare Worker. Free 10 GB storage.
Free serverless backend with a limit of 100,000 invocation requests per day.
[More about pricing](https://developers.cloudflare.com/r2/platform/pricing/)

## Features

- Upload large files
- Create folders
- Search files
- Image/video/PDF thumbnails
- File sharing with expirable links
- WebDAV endpoint
- Drag and drop upload

## Usage

### Installation

Before starting, you should make sure that

- you have created a [Cloudflare](https://dash.cloudflare.com/) account
- your payment method is added
- R2 service is activated and at least one bucket is created

Steps:

1. Install dependencies
   - `npm install`
2. Configure Worker bindings in `wrangler.toml`
   - Bind your R2 bucket to `BUCKET`
   - (Optional) Bind KV to `SHARE_KV` for file sharing
3. Set runtime secrets / vars in Worker
   - Required: `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`
   - Optional: `WEBDAV_PUBLIC_READ=1`
   - Optional: `SHARE_ENABLED=true`
   - Optional: `SHARE_DEFAULT_EXPIRE_SECONDS=3600`
4. Deploy
   - `npm run deploy`
5. (Optional) Add a custom domain to the Worker

Local development:

```bash
npm run build:app
npm run dev:worker
```

### WebDAV endpoint

You can use any client (such as [Cx File Explorer](https://play.google.com/store/apps/details?id=com.cxinventor.file.explorer), [BD File Manager](https://play.google.com/store/apps/details?id=com.liuzho.file.explorer))
that supports the WebDAV protocol to access your files.
Fill the endpoint URL as `https://<your-domain.com>/webdav` and use the username and password you set.

However, the standard WebDAV protocol does not support large file (≥128MB) uploads due to the limitation of Cloudflare Workers.
You must upload large files through the web interface which supports chunked uploads.

### File Sharing

If you have enabled the file sharing feature by setting `SHARE_ENABLED` to `true`, you can create temporary share links for your files:

- Share links are generated through the web interface
- Each share link has an expiration time (default: 1 hour, configurable via `SHARE_DEFAULT_EXPIRE_SECONDS`)
- Share links are accessible at `https://<your-domain.com>/s/<token>`
- Only one active share link can exist per file at a time
- Creating a new share link for a file will invalidate any existing share link for that file
- Share links automatically expire after the configured time period

**Note**: The file sharing feature requires a KV namespace binding (`SHARE_KV`).

## Acknowledgments

WebDAV related code is based on [r2-webdav](
  https://github.com/abersheeran/r2-webdav
) project by [abersheeran](
  https://github.com/abersheeran
).
