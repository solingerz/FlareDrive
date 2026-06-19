import {
  isInternalPath,
  isThumbnailPath,
  notFound,
  RequestHandlerParams,
} from "./utils";

function toAsciiFilenameFallback(fileName: string): string {
  if (/^[\x20-\x7E]+$/.test(fileName)) return fileName;
  const normalized = fileName.normalize("NFKD");
  return normalized
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .replace(/[/;:]/g, "_")
    .trim() || "download";
}

function encodeContentDispositionFilenameStar(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function isTextFile(contentType: string, path: string): boolean {
  const ct = contentType.toLowerCase();
  if (
    ct.startsWith("text/") ||
    ct.includes("application/json") ||
    ct.includes("application/xml") ||
    ct.includes("application/javascript")
  ) {
    return true;
  }

  const textExtensions = [
    ".txt", ".html", ".htm", ".css", ".js", ".json", ".xml",
    ".md", ".log", ".csv", ".ts", ".jsx", ".tsx", ".vue",
    ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".php",
    ".rb", ".go", ".rs", ".swift", ".kt", ".scala",
  ];
  const lowerPath = path.toLowerCase();
  return textExtensions.some((ext) => lowerPath.endsWith(ext));
}

function addUtf8Charset(contentType: string): string {
  if (contentType.includes("charset=")) return contentType;
  return contentType + "; charset=utf-8";
}

const MAX_HTML_REWRITE_SIZE = 1024 * 1024;

function addHtmlCharset(
  content: ReadableStream,
  contentLength: number | null
): ReadableStream {
  if (contentLength !== null && contentLength > MAX_HTML_REWRITE_SIZE)
    return content;

  return new HTMLRewriter()
    .on("head", {
      element(element: Element) {
        element.prepend('<meta charset="utf-8" />');
      },
    })
    .transform(new Response(content))
    .body as ReadableStream;
}

export async function handleRequestGet({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  if (isInternalPath(path) && !isThumbnailPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const obj = await bucket.get(path, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (obj === null) return notFound();
  if (!("body" in obj))
    return new Response("Preconditions failed", { status: 412 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-cache");

  const fileName = path.split("/").pop() || "file";
  const asciiName = toAsciiFilenameFallback(fileName);
  const encodedName = encodeContentDispositionFilenameStar(fileName);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
  );
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");

  let contentType = headers.get("Content-Type") || "application/octet-stream";

  if (isTextFile(contentType, path)) {
    contentType = addUtf8Charset(contentType);
    headers.set("Content-Type", contentType);

    if (contentType.toLowerCase().includes("text/html") && obj.body) {
      const contentLength = Number(headers.get("Content-Length"));
      const bodyWithCharset = addHtmlCharset(
        obj.body,
        Number.isFinite(contentLength) ? contentLength : null
      );
      headers.delete("Content-Length");
      if (path.startsWith("_$flaredrive$/thumbnails/"))
        headers.set("Cache-Control", "max-age=31536000");
      return new Response(bodyWithCharset, { headers });
    }
  }

  if (path.startsWith("_$flaredrive$/thumbnails/"))
    headers.set("Cache-Control", "max-age=31536000");
  return new Response(obj.body, { headers });
}
