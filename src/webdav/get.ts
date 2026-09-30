import {
  encodeContentDispositionFilenameStar,
  isInternalPath,
  isThumbnailPath,
  notFound,
  RequestHandlerParams,
  toAsciiFilenameFallback,
} from "./utils";

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
  headers.set("Accept-Ranges", "bytes");

  const fileName = path.split("/").pop() || "file";
  const asciiName = toAsciiFilenameFallback(fileName);
  const encodedName = encodeContentDispositionFilenameStar(fileName);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
  );
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");

  let contentType = headers.get("Content-Type") || "application/octet-stream";
  // R2 populates `range` even for full reads, so only treat the response as
  // partial when the client actually sent a Range header.
  const hasRangeHeader = request.headers.get("Range") !== null;
  const range = hasRangeHeader ? obj.range : undefined;

  if (isTextFile(contentType, path)) {
    contentType = addUtf8Charset(contentType);
    headers.set("Content-Type", contentType);

    if (
      range === undefined &&
      contentType.toLowerCase().includes("text/html") &&
      obj.body
    ) {
      const contentLength = Number(headers.get("Content-Length"));
      const bodyWithCharset = addHtmlCharset(
        obj.body,
        Number.isFinite(contentLength) ? contentLength : null
      );
      headers.delete("Content-Length");
      if (isThumbnailPath(path)) headers.set("Cache-Control", "max-age=31536000");
      return new Response(bodyWithCharset, { headers });
    }
  }

  // R2 already applied the range, so the response must be a 206 with a
  // matching Content-Range header (RFC 9110, Section 14.4).
  if (range !== undefined) {
    const total = obj.size;
    // The runtime range object may expose `offset`/`length`/`suffix` via a
    // prototype, so members must be checked by value (an `in` check would
    // always see `suffix`).
    const { offset, length, suffix } = range as {
      offset?: number;
      length?: number;
      suffix?: number;
    };
    let start: number;
    let resolvedLength: number;

    if (suffix !== undefined) {
      resolvedLength = Math.min(suffix, total);
      start = total - resolvedLength;
    } else {
      start = offset ?? 0;
      resolvedLength = length ?? total - start;
    }

    if (resolvedLength > 0) {
      const end = start + resolvedLength - 1;
      headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
      headers.set("Content-Length", `${resolvedLength}`);
      return new Response(obj.body, { status: 206, headers });
    }
  }

  if (isThumbnailPath(path)) headers.set("Cache-Control", "max-age=31536000");
  return new Response(obj.body, { headers });
}
