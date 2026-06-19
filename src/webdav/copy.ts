import pLimit from "p-limit";

import { notFound } from "./utils";
import {
  buildStoredHttpMetadata,
  isInternalPath,
  listAll,
  RequestHandlerParams,
  revokeShareForPath,
  WEBDAV_ENDPOINT,
  parseBucketPath,
} from "./utils";

function normalizeDestinationPath(destinationHeader: string, request: Request) {
  const destinationUrl = new URL(destinationHeader, request.url);
  if (!destinationUrl.pathname.startsWith(WEBDAV_ENDPOINT)) {
    throw new Response("Bad Request", { status: 400 });
  }

  const rawPath = destinationUrl.pathname.slice(WEBDAV_ENDPOINT.length);
  const pathParts = rawPath.split("/");
  const fakeContext = {
    request,
    env: { BUCKET: {} as R2Bucket },
    params: { path: pathParts },
  };
  const [, normalizedPath] = parseBucketPath(fakeContext);
  return normalizedPath.replace(/\/$/, "");
}

export async function handleRequestCopy({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  const dontOverwrite = request.headers.get("Overwrite") === "F";
  const destinationHeader = request.headers.get("Destination");
  if (destinationHeader === null)
    return new Response("Bad Request", { status: 400 });

  const src = await bucket.get(path);
  if (src === null) return notFound();

  let destination = "";
  try {
    destination = normalizeDestinationPath(destinationHeader, request);
  } catch (error) {
    return error instanceof Response
      ? error
      : new Response("Bad Request", { status: 400 });
  }

  if (isInternalPath(destination)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (
    destination === path ||
    (src.httpMetadata?.contentType === "application/x-directory" &&
      destination.startsWith(path + "/"))
  )
    return new Response("Bad Request", { status: 400 });

  // Check if the destination already exists
  const destinationExists = await bucket.head(destination);
  const sourceIsDirectory =
    src.httpMetadata?.contentType === "application/x-directory";

  if (dontOverwrite && destinationExists) {
    return new Response("Precondition Failed", { status: 412 });
  }

  if (
    sourceIsDirectory &&
    destinationExists &&
    destinationExists.httpMetadata?.contentType === "application/x-directory"
  ) {
    return new Response("Conflict", { status: 409 });
  }

  if (destinationExists) {
    await revokeShareForPath(env, destination);
  }

  await bucket.put(destination, src.body, {
    httpMetadata: buildStoredHttpMetadata(src.httpMetadata),
    customMetadata: src.customMetadata,
  });

  if (sourceIsDirectory) {
    const depth = request.headers.get("Depth") ?? "infinity";
    switch (depth) {
      case "0":
        break;
      case "infinity": {
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
        break;
      }
      default:
        return new Response("Bad Request", { status: 400 });
    }
  }

  if (destinationExists) {
    return new Response(null, { status: 204 });
  } else {
    return new Response("", { status: 201 });
  }
}
