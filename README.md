# FlareDrive

Cloudflare R2 storage manager with Pages and Workers. Free 10 GB storage.
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

1. Fork this project and connect your fork with Cloudflare Pages
   - Select `Docusaurus` framework preset
   - Set `WEBDAV_USERNAME` and `WEBDAV_PASSWORD`
   - (Optional) Set `WEBDAV_PUBLIC_READ` to `1` to enable public read
   - (Optional) Set `SHARE_ENABLED` to `true` to enable file sharing feature
   - (Optional) Set `SHARE_DEFAULT_EXPIRE_SECONDS` to customize share link expiration time (default: 3600 seconds / 1 hour)
2. After initial deployment, bind your R2 bucket to `BUCKET` variable
3. (Optional) If you enabled file sharing, create a KV namespace and bind it to `SHARE_KV` variable
4. Retry deployment in `Deployments` page to apply the changes
5. (Optional) Add a custom domain

You can also deploy this project using Wrangler CLI:

```bash
npm run build
npx wrangler pages deploy build
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

**Note**: The file sharing feature requires a KV namespace binding (`SHARE_KV`). Make sure to create and bind a KV namespace in your Cloudflare Pages settings.

## Acknowledgments

WebDAV related code is based on [r2-webdav](
  https://github.com/abersheeran/r2-webdav
) project by [abersheeran](
  https://github.com/abersheeran
).
