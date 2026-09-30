import {
  encodeContentDispositionFilenameStar,
  isInternalPath,
  isThumbnailPath,
  notFound,
  RequestHandlerParams,
  toAsciiFilenameFallback,
} from "./utils";

export async function handleRequestHead({
  bucket,
  path,
}: RequestHandlerParams) {
  if (isInternalPath(path) && !isThumbnailPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const obj = await bucket.head(path);
  if (obj === null) return notFound();

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

  return new Response(null, { headers });
}
