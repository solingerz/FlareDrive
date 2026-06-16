import {
  isInternalPath,
  isThumbnailPath,
  notFound,
  RequestHandlerParams,
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
  return new Response(null, { headers });
}
