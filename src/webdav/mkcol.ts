import {
  isDirectoryMetadata,
  isInternalPath,
  parentPathOf,
  rejectUnexpectedBody,
  RequestHandlerParams,
  ROOT_OBJECT,
} from "./utils";

export async function handleRequestMkcol({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const bodyError = rejectUnexpectedBody(request);
  if (bodyError) return bodyError;

  // MKCOL can only be executed on an unmapped URL; the root is always mapped
  // (RFC 4918, Section 9.3.1).
  if (path === "") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const resource = await bucket.head(path);
  if (resource !== null) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // The parent collection must already exist; intermediate collections are
  // never created automatically (RFC 4918, Section 9.3.1).
  const parentPath = parentPathOf(path);
  const parentDir =
    parentPath === "" ? ROOT_OBJECT : await bucket.head(parentPath);
  if (parentDir === null || !isDirectoryMetadata(parentDir.httpMetadata)) {
    return new Response("Conflict", { status: 409 });
  }

  await bucket.put(path, "", {
    httpMetadata: { contentType: "application/x-directory" },
  });

  return new Response("Created", { status: 201 });
}
