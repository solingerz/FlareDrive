import { isInternalPath, notFound, RequestHandlerParams } from "./utils";

const FD_SHA256_HEADER = "fd-sha256";
const FD_RESULT_SHA256_HEADER = "x-fd-sha256";
const THUMBNAIL_DIGEST_PATTERN = /^[a-f0-9]{40}$/i;

function encodeArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function handleRequestPostCreateMultipart({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  const thumbnail = request.headers.get("fd-thumbnail");
  if (thumbnail && !THUMBNAIL_DIGEST_PATTERN.test(thumbnail)) {
    return new Response("Invalid thumbnail digest", { status: 400 });
  }
  const customMetadata = thumbnail ? { thumbnail } : undefined;

  const multipartUpload = await bucket.createMultipartUpload(path, {
    httpMetadata: request.headers,
    customMetadata,
  });

  const { key, uploadId } = multipartUpload;
  return new Response(JSON.stringify({ key, uploadId }));
}

export async function handleRequestPostCompleteMultipart({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  const url = new URL(request.url);
  const uploadId = new URLSearchParams(url.search).get("uploadId");
  if (!uploadId) return notFound();
  const expectedSha256Base64 = request.headers.get(FD_SHA256_HEADER)?.trim();
  const multipartUpload = bucket.resumeMultipartUpload(path, uploadId);

  const completeBody: { parts: Array<any> } = await request.json();

  if (!completeBody || typeof completeBody !== "object") {
    return new Response("Bad Request", { status: 400 });
  }

  const { parts } = completeBody;
  if (!Array.isArray(parts) || !parts.every(
    (p: any) => p && typeof p === "object" && typeof p.partNumber === "number" && typeof p.etag === "string"
  )) {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const object = await multipartUpload.complete(parts);
    const actualSha256Base64 = object.checksums.sha256
      ? encodeArrayBufferToBase64(object.checksums.sha256)
      : undefined;

    const headers = new Headers({ etag: object.httpEtag });
    if (expectedSha256Base64) {
      headers.set(FD_RESULT_SHA256_HEADER, expectedSha256Base64);
    } else if (actualSha256Base64) {
      headers.set(FD_RESULT_SHA256_HEADER, actualSha256Base64);
    }

    return new Response(null, {
      headers,
    });
  } catch (error: any) {
    console.error("Multipart complete failed", error);
    return new Response("Invalid multipart upload", { status: 400 });
  }
}

export const handleRequestPost = async function ({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  if (searchParams.has("uploads")) {
    return handleRequestPostCreateMultipart({ bucket, path, request });
  }

  if (searchParams.has("uploadId")) {
    return handleRequestPostCompleteMultipart({ bucket, path, request });
  }

  return new Response("Method not allowed", { status: 405 });
};
