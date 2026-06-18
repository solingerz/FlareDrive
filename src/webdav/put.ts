import {
  buildUploadHttpMetadata,
  isInternalPath,
  isThumbnailPath,
  RequestHandlerParams,
  revokeShareForPath,
  ROOT_OBJECT,
} from "./utils";

const FD_SHA256_HEADER = "fd-sha256";
const FD_RESULT_SHA256_HEADER = "x-fd-sha256";
const THUMBNAIL_DIGEST_PATTERN = /^[a-f0-9]{40}$/i;

function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function handleRequestPutMultipart({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  const url = new URL(request.url);

  const uploadId = new URLSearchParams(url.search).get("uploadId");
  const partNumberStr = new URLSearchParams(url.search).get("partNumber");
  if (!uploadId || !partNumberStr || !request.body)
    return new Response("Bad Request", { status: 400 });
  const multipartUpload = bucket.resumeMultipartUpload(path, uploadId);

  const partNumber = parseInt(partNumberStr);
  const uploadedPart = await multipartUpload.uploadPart(
    partNumber,
    request.body
  );

  return new Response(null, {
    headers: { "Content-Type": "application/json", etag: uploadedPart.etag },
  });
}

export async function handleRequestPut({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path) && !isThumbnailPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const searchParams = new URLSearchParams(new URL(request.url).search);
  if (searchParams.has("uploadId")) {
    return handleRequestPutMultipart({ bucket, path, request });
  }

  if (request.url.endsWith("/")) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Check if the parent directory exists
  if (!path.startsWith("_$flaredrive$/")) {
    const parentPath = path.replace(/(\/|^)[^/]*$/, "");
    const parentDir =
      parentPath === "" ? ROOT_OBJECT : await bucket.head(parentPath);
    if (parentDir === null) return new Response("Conflict", { status: 409 });
  }

  const thumbnail = request.headers.get("fd-thumbnail");
  if (thumbnail && !THUMBNAIL_DIGEST_PATTERN.test(thumbnail)) {
    return new Response("Invalid thumbnail digest", { status: 400 });
  }
  const expectedSha256Base64 = request.headers.get(FD_SHA256_HEADER)?.trim();
  let expectedSha256: ArrayBuffer | undefined;
  if (expectedSha256Base64) {
    try {
      expectedSha256 = decodeBase64ToArrayBuffer(expectedSha256Base64);
    } catch {
      return new Response("Invalid SHA-256 header", { status: 400 });
    }
  }
  const customMetadata = thumbnail ? { thumbnail } : undefined;

  await revokeShareForPath(env, path);

  const result = await bucket.put(path, request.body, {
    onlyIf: request.headers,
    httpMetadata: buildUploadHttpMetadata(request.headers),
    customMetadata,
    sha256: expectedSha256,
  });

  if (!result) return new Response("Preconditions failed", { status: 412 });

  const actualSha256Base64 = result.checksums.sha256
    ? encodeArrayBufferToBase64(result.checksums.sha256)
    : undefined;

  const headers = new Headers();
  headers.set("etag", result.httpEtag);
  if (expectedSha256Base64) {
    headers.set(FD_RESULT_SHA256_HEADER, expectedSha256Base64);
  } else if (actualSha256Base64) {
    headers.set(FD_RESULT_SHA256_HEADER, actualSha256Base64);
  }

  return new Response("", { status: 201, headers });
}
