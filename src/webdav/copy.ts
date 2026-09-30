import pLimit from "p-limit";

import { handleRequestDelete } from "./delete";
import {
  buildStoredHttpMetadata,
  isDirectoryMetadata,
  isInternalPath,
  listAll,
  notFound,
  parentPathOf,
  parseDestinationPath,
  rejectUnexpectedBody,
  RequestHandlerParams,
  revokeShareForPath,
  WEBDAV_ENDPOINT,
} from "./utils";

export async function handleRequestCopy({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const bodyError = rejectUnexpectedBody(request);
  if (bodyError) return bodyError;

  // The Overwrite header is defined as "T" or "F" (RFC 4918, Section 10.6).
  const overwriteHeader = request.headers.get("Overwrite");
  if (
    overwriteHeader !== null &&
    overwriteHeader !== "T" &&
    overwriteHeader !== "F"
  ) {
    return new Response("Bad Request", { status: 400 });
  }
  const dontOverwrite = overwriteHeader === "F";

  const destinationHeader = request.headers.get("Destination");
  if (destinationHeader === null) {
    return new Response("Bad Request", { status: 400 });
  }

  let destinationUrl: URL;
  try {
    destinationUrl = new URL(destinationHeader, request.url);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (
    destinationUrl.host !== new URL(request.url).host ||
    !destinationUrl.pathname.startsWith(WEBDAV_ENDPOINT)
  ) {
    // RFC 4918, Section 9.8.5: destination on another server or namespace.
    return new Response("Bad Gateway", { status: 502 });
  }

  const src = await bucket.get(path);
  if (src === null) return notFound();

  let destination = "";
  try {
    destination = parseDestinationPath(destinationHeader, request, {
      BUCKET: {} as R2Bucket,
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : new Response("Bad Request", { status: 400 });
  }

  if (isInternalPath(destination)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Copying a resource onto itself (or onto the root collection) must fail
  // (RFC 4918, Sections 9.8.3 and 9.8.5).
  if (destination === "" || destination === path) {
    return new Response("Forbidden", { status: 403 });
  }

  const sourceIsDirectory = isDirectoryMetadata(src.httpMetadata);
  const depth = request.headers.get("Depth") ?? "infinity";

  if (sourceIsDirectory) {
    if (depth !== "0" && depth !== "infinity") {
      return new Response("Bad Request", { status: 400 });
    }
    // An infinite-depth COPY of a collection into one of its own members is
    // impossible (RFC 4918, Section 9.8.3).
    if (destination.startsWith(`${path}/`)) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // The destination parent collection must already exist; intermediate
  // collections are never created automatically (RFC 4918, Section 9.8.5).
  const destinationParentPath = parentPathOf(destination);
  if (destinationParentPath !== "") {
    const destinationParent = await bucket.head(destinationParentPath);
    if (
      destinationParent === null ||
      !isDirectoryMetadata(destinationParent.httpMetadata)
    ) {
      return new Response("Conflict", { status: 409 });
    }
  }

  const destinationExists = await bucket.head(destination);

  if (dontOverwrite && destinationExists !== null) {
    return new Response("Precondition Failed", { status: 412 });
  }

  if (destinationExists !== null) {
    if (isDirectoryMetadata(destinationExists.httpMetadata)) {
      // Removing the destination would also remove the source when the
      // source lives inside it.
      if (path.startsWith(`${destination}/`)) {
        return new Response("Conflict", { status: 409 });
      }
      // Overwriting a collection replaces it entirely (RFC 4918,
      // Section 9.8.1: the destination is removed before the copy).
      const deleteResponse = await handleRequestDelete({
        bucket,
        path: destination,
        request,
        env,
      });
      if (deleteResponse.status !== 204) return deleteResponse;
    } else {
      await revokeShareForPath(env, destination);
    }
  }

  await bucket.put(destination, src.body, {
    httpMetadata: buildStoredHttpMetadata(src.httpMetadata),
    customMetadata: src.customMetadata,
  });

  if (sourceIsDirectory && depth === "infinity") {
    const prefix = path + "/";
    const copy = async (object: R2Object) => {
      const target = `${destination}/${object.key.slice(prefix.length)}`;
      const srcObject = await bucket.get(object.key);
      if (srcObject === null) return;
      await bucket.put(target, srcObject.body, {
        httpMetadata: buildStoredHttpMetadata(object.httpMetadata),
        customMetadata: object.customMetadata,
      });
    };
    const limit = pLimit(20);
    const promises = [];
    for await (const object of listAll(bucket, prefix, true)) {
      promises.push(limit(() => copy(object)));
    }
    await Promise.all(promises);
  }

  return new Response(null, {
    status: destinationExists !== null ? 204 : 201,
  });
}
