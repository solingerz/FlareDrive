import pLimit from "p-limit";

import { encodeKey, FileItem } from "../../components/FileGrid";
import type { MultipartUploadCheckpoint, TransferTask } from "./transferQueue";

const WEBDAV_ENDPOINT = "/webdav/";
const THUMBNAIL_SIZE = 144;
const THUMBNAIL_TIMEOUT_MS = 3000;
const FD_SHA256_HEADER = "fd-sha256";
const FD_RESULT_SHA256_HEADER = "x-fd-sha256";
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_REQUEST_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 400;
const MULTIPART_MIN_CONCURRENCY = 2;
const MULTIPART_MAX_CONCURRENCY = 6;
const MULTIPART_INITIAL_CONCURRENCY = 3;

const SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function computeSha256Base64(file: File, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal);
  const content = await file.arrayBuffer();
  assertNotAborted(signal);
  const digest = await crypto.subtle.digest("SHA-256", content);
  assertNotAborted(signal);
  return arrayBufferToBase64(digest);
}

function assertUploadIntegrity(response: Response, expectedSha256Base64: string) {
  const actualSha256Base64 = response.headers.get(FD_RESULT_SHA256_HEADER)?.trim();
  if (!actualSha256Base64) {
    throw new Error("Missing server checksum");
  }
  if (actualSha256Base64 !== expectedSha256Base64) {
    throw new Error("Upload integrity check failed");
  }
}

class UploadSessionExpiredError extends Error {
  constructor(message = "Multipart upload session expired") {
    super(message);
    this.name = "UploadSessionExpiredError";
  }
}

function isMultipartSessionExpiredResponse(status: number, message: string): boolean {
  if (status === 404 || status === 410) return true;
  if (status !== 400) return false;
  return /10024|multipart upload does not exist/i.test(message);
}

export function isAbortError(
  error: unknown
): error is DOMException & { reason?: unknown } {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError(reason?: unknown): DOMException & { reason?: unknown } {
  const error = new DOMException("Aborted", "AbortError") as DOMException & {
    reason?: unknown;
  };
  error.reason = reason;
  return error;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError(signal.reason);
  }
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;

  const asNumber = Number.parseFloat(retryAfter);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1000;
  }

  const asDate = Date.parse(retryAfter);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return null;
}

function computeRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader ?? null);
  if (retryAfterMs !== null) return retryAfterMs;

  const exponential = BASE_RETRY_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(15_000, exponential + jitter);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal.reason));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Operation timed out")));
    }, timeoutMs);

    const onAbort = () => {
      finish(() => reject(createAbortError(signal?.reason)));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

function buildHeadersObject(headersString: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = headersString.trim() ? headersString.trim().split("\r\n") : [];

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    out[key] = value;
  }

  return out;
}

function xhrFetch(
  url: RequestInfo | URL,
  requestInit: RequestInit & {
    signal?: AbortSignal;
    onUploadProgress?: (progressEvent: ProgressEvent) => void;
  }
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const signal = requestInit.signal;
    if (signal?.aborted) {
      reject(createAbortError(signal.reason));
      return;
    }

    const xhr = new XMLHttpRequest();

    const method = requestInit.method ?? "GET";
    const requestUrl = url instanceof Request ? url.url : String(url);

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
    };

    const onAbort = () => {
      xhr.abort();
    };

    xhr.upload.onprogress = requestInit.onUploadProgress ?? null;
    xhr.open(method, requestUrl);

    const headers = new Headers(requestInit.headers);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));

    xhr.onload = () => {
      cleanup();
      const headersObject = buildHeadersObject(xhr.getAllResponseHeaders());
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: headersObject,
        })
      );
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error("Network request failed"));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error("Request timed out"));
    };

    xhr.onabort = () => {
      cleanup();
      reject(createAbortError(signal?.reason));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    if (
      requestInit.body instanceof Blob ||
      typeof requestInit.body === "string" ||
      requestInit.body instanceof ArrayBuffer
    ) {
      xhr.send(requestInit.body);
      return;
    }

    xhr.send();
  });
}

export async function fetchPath(path: string, signal?: AbortSignal) {
  const res = await fetch(`${WEBDAV_ENDPOINT}${encodeKey(path)}`, {
    method: "PROPFIND",
    headers: { Depth: "1" },
    signal,
  });

  if (!res.ok) throw new Error("Failed to fetch");
  if (!res.headers.get("Content-Type")?.includes("application/xml"))
    throw new Error("Invalid response");

  const parser = new DOMParser();
  const text = await res.text();
  const document = parser.parseFromString(text, "application/xml");
  const items: FileItem[] = Array.from(document.querySelectorAll("response"))
    .filter(
      (response) =>
        decodeURIComponent(
          response.querySelector("href")?.textContent ?? ""
        ).slice(WEBDAV_ENDPOINT.length) !== path.replace(/\/$/, "")
    )
    .map((response) => {
      const href = response.querySelector("href")?.textContent;
      if (!href) throw new Error("Invalid response");
      const contentType = response.querySelector("getcontenttype")?.textContent;
      const size = response.querySelector("getcontentlength")?.textContent;
      const lastModified =
        response.querySelector("getlastmodified")?.textContent;
      const thumbnail = response.getElementsByTagNameNS(
        "flaredrive",
        "thumbnail"
      )[0]?.textContent;
      return {
        key: decodeURI(href).slice(WEBDAV_ENDPOINT.length),
        size: size ? Number(size) : 0,
        uploaded: lastModified!,
        httpMetadata: { contentType: contentType! },
        customMetadata: { thumbnail },
      } as FileItem;
    });
  return items;
}

async function generateThumbnailOnMainThread(file: File): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot create canvas context");

  if (file.type.startsWith("image/")) {
    const image = await new Promise<HTMLImageElement>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.src = URL.createObjectURL(file);
    });
    context.drawImage(image, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  } else if (file.type === "video/mp4") {
    const video = await new Promise<HTMLVideoElement>(
      async (resolve, reject) => {
        const video = document.createElement("video");
        video.muted = true;
        video.src = URL.createObjectURL(file);
        setTimeout(() => reject(new Error("Video load timeout")), 2000);
        await video.play();
        video.pause();
        video.currentTime = 0;
        resolve(video);
      }
    );
    context.drawImage(video, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  } else if (file.type === "application/pdf") {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).href;
    const pdf = await pdfjsLib.getDocument({ url: URL.createObjectURL(file) }).promise;
    const page = await pdf.getPage(1);
    const { width, height } = page.getViewport({ scale: 1 });
    const scale = THUMBNAIL_SIZE / Math.max(width, height);
    const viewport = page.getViewport({ scale });
    const renderContext = { canvas, viewport };
    await page.render(renderContext).promise;
  }

  const thumbnailBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to generate thumbnail"));
        return;
      }
      resolve(blob);
    }, "image/png")
  );

  return thumbnailBlob;
}

type ThumbnailWorkerResponse =
  | { id: string; ok: true; thumbnailBuffer: ArrayBuffer }
  | { id: string; ok: false; message: string };

async function generateImageThumbnailInWorker(
  file: File,
  signal?: AbortSignal
): Promise<Blob> {
  assertNotAborted(signal);

  const worker = new Worker(new URL("./thumbnail.worker.ts", import.meta.url), {
    type: "module",
  });

  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const fileBuffer = await file.arrayBuffer();

    return await new Promise<Blob>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(createAbortError(signal?.reason));
      };

      const onMessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
        const data = event.data;
        if (!data || data.id !== requestId) return;

        cleanup();

        if (!data.ok) {
          reject(new Error(data.message));
          return;
        }

        resolve(new Blob([data.thumbnailBuffer], { type: "image/png" }));
      };

      const onError = () => {
        cleanup();
        reject(new Error("Thumbnail worker failed"));
      };

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage(
        {
          id: requestId,
          mimeType: file.type,
          fileBuffer,
        },
        [fileBuffer]
      );
    });
  } finally {
    worker.terminate();
  }
}

async function generateThumbnail(file: File, signal?: AbortSignal) {
  assertNotAborted(signal);

  if (file.type.startsWith("image/")) {
    try {
      return await promiseWithTimeout(
        generateImageThumbnailInWorker(file, signal),
        THUMBNAIL_TIMEOUT_MS,
        signal
      );
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      return generateThumbnailOnMainThread(file);
    }
  }

  return generateThumbnailOnMainThread(file);
}

async function blobDigest(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
  const digestArray = Array.from(new Uint8Array(digest));
  const digestHex = digestArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return digestHex;
}

async function uploadWithRetry({
  url,
  method,
  body,
  headers,
  signal,
  onUploadProgress,
  maxRetries = MAX_REQUEST_RETRIES,
  onRetryableFailure,
  treatNotFoundAsSessionExpired = false,
}: {
  url: string;
  method: "PUT" | "POST";
  body: Blob | string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (progressEvent: ProgressEvent) => void;
  maxRetries?: number;
  onRetryableFailure?: (statusCode?: number) => void;
  treatNotFoundAsSessionExpired?: boolean;
}) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    assertNotAborted(signal);

    try {
      const response = await xhrFetch(url, {
        method,
        body,
        headers,
        signal,
        onUploadProgress,
      });

      if (response.ok) return response;

      if (
        treatNotFoundAsSessionExpired &&
        (response.status === 404 || response.status === 410)
      ) {
        throw new UploadSessionExpiredError();
      }

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        throw new Error((await response.text()) || `HTTP ${response.status}`);
      }

      onRetryableFailure?.(response.status);
      const delay = computeRetryDelayMs(attempt, response.headers.get("retry-after"));
      await sleep(delay, signal);
      continue;
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
      if (error instanceof UploadSessionExpiredError) throw error;

      const normalizedError =
        error instanceof Error ? error : new Error("Upload request failed");

      lastError = normalizedError;

      if (attempt === maxRetries) break;

      onRetryableFailure?.();
      const delay = computeRetryDelayMs(attempt, null);
      await sleep(delay, signal);
    }
  }

  throw lastError || new Error("Upload request failed");
}

async function createMultipartUpload({
  key,
  headers,
  signal,
}: {
  key: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<string> {
  assertNotAborted(signal);

  const response = await fetch(`${WEBDAV_ENDPOINT}${encodeKey(key)}?uploads`, {
    headers,
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }

  const { uploadId } = (await response.json()) as { uploadId: string };
  if (!uploadId) throw new Error("Missing multipart upload ID");
  return uploadId;
}

async function completeMultipartUpload({
  key,
  uploadId,
  parts,
  expectedSha256,
  signal,
}: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  expectedSha256?: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const completeParams = new URLSearchParams({ uploadId });

  // Unbounded loop: every iteration either returns or throws, so the
  // previous trailing throw after the loop was unreachable.
  for (let attempt = 0; ; attempt += 1) {
    assertNotAborted(signal);

    const response = await fetch(`${WEBDAV_ENDPOINT}${encodeKey(key)}?${completeParams}`, {
      method: "POST",
      headers: expectedSha256 ? { [FD_SHA256_HEADER]: expectedSha256 } : undefined,
      body: JSON.stringify({ parts }),
      signal,
    });

    if (response.ok) return response;

    const responseText = (await response.text()) || `HTTP ${response.status}`;
    if (isMultipartSessionExpiredResponse(response.status, responseText)) {
      throw new UploadSessionExpiredError(responseText);
    }

    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_REQUEST_RETRIES) {
      throw new Error(responseText);
    }

    const delay = computeRetryDelayMs(attempt, response.headers.get("retry-after"));
    await sleep(delay, signal);
  }
}

export async function multipartUpload(
  key: string,
  file: File,
  options?: {
    headers?: Record<string, string>;
    expectedSha256?: string;
    signal?: AbortSignal;
    resumeCheckpoint?: MultipartUploadCheckpoint;
    onCheckpoint?: (checkpoint: MultipartUploadCheckpoint | undefined) => void;
    onUploadProgress?: (progressEvent: { loaded: number; total: number }) => void;
  }
) {
  const headers = { ...(options?.headers || {}) };
  headers["content-type"] = file.type;

  let checkpoint: MultipartUploadCheckpoint | undefined = options?.resumeCheckpoint
    ? {
        uploadId: options.resumeCheckpoint.uploadId,
        uploadedParts: { ...options.resumeCheckpoint.uploadedParts },
      }
    : undefined;

  const emitCheckpoint = () => {
    if (!options?.onCheckpoint) return;

    if (!checkpoint) {
      options.onCheckpoint(undefined);
      return;
    }

    options.onCheckpoint({
      uploadId: checkpoint.uploadId,
      uploadedParts: { ...checkpoint.uploadedParts },
    });
  };

  const runMultipart = async () => {
    const totalChunks = Math.ceil(file.size / SIZE_LIMIT);
    const parts = Array.from({ length: totalChunks }, (_, i) => i + 1);
    const partProgress = Array.from({ length: totalChunks + 1 }, () => 0);

    if (!checkpoint?.uploadId) {
      const uploadId = await createMultipartUpload({
        key,
        headers,
        signal: options?.signal,
      });
      checkpoint = { uploadId, uploadedParts: {} };
      emitCheckpoint();
    }

    const uploadId = checkpoint.uploadId;

    for (const partNumber of parts) {
      if (!checkpoint.uploadedParts[partNumber]) continue;

      const chunk = file.slice((partNumber - 1) * SIZE_LIMIT, partNumber * SIZE_LIMIT);
      partProgress[partNumber] = chunk.size;
    }

    options?.onUploadProgress?.({
      loaded: partProgress.reduce((sum, value) => sum + value, 0),
      total: file.size,
    });

    let adaptiveConcurrency = MULTIPART_INITIAL_CONCURRENCY;
    const limit = pLimit(adaptiveConcurrency);
    let successStreak = 0;

    const lowerConcurrency = () => {
      adaptiveConcurrency = Math.max(
        MULTIPART_MIN_CONCURRENCY,
        Math.floor(adaptiveConcurrency / 2)
      );
      limit.concurrency = adaptiveConcurrency;
      successStreak = 0;
    };

    const raiseConcurrency = () => {
      successStreak += 1;
      if (successStreak < adaptiveConcurrency * 2) return;
      if (adaptiveConcurrency >= MULTIPART_MAX_CONCURRENCY) return;
      adaptiveConcurrency += 1;
      limit.concurrency = adaptiveConcurrency;
      successStreak = 0;
    };

    const uploadTasks = parts.map((partNumber) =>
      limit(async () => {
        assertNotAborted(options?.signal);

        const existingEtag = checkpoint?.uploadedParts[partNumber];
        if (existingEtag) {
          return { partNumber, etag: existingEtag };
        }

        const chunk = file.slice((partNumber - 1) * SIZE_LIMIT, partNumber * SIZE_LIMIT);
        const searchParams = new URLSearchParams({
          partNumber: partNumber.toString(),
          uploadId,
        });
        const uploadUrl = `${WEBDAV_ENDPOINT}${encodeKey(key)}?${searchParams}`;

        const response = await uploadWithRetry({
          url: uploadUrl,
          method: "PUT",
          headers,
          body: chunk,
          signal: options?.signal,
          treatNotFoundAsSessionExpired: true,
          onUploadProgress: (progressEvent) => {
            partProgress[partNumber] = progressEvent.loaded;
            options?.onUploadProgress?.({
              loaded: partProgress.reduce((sum, value) => sum + value, 0),
              total: file.size,
            });
          },
          onRetryableFailure: lowerConcurrency,
        });

        const etag = response.headers.get("etag");
        if (!etag) throw new Error(`Missing ETag for part ${partNumber}`);

        if (checkpoint) {
          checkpoint.uploadedParts[partNumber] = etag;
          emitCheckpoint();
        }

        partProgress[partNumber] = chunk.size;
        options?.onUploadProgress?.({
          loaded: partProgress.reduce((sum, value) => sum + value, 0),
          total: file.size,
        });

        raiseConcurrency();

        return { partNumber, etag };
      })
    );

    const uploadedParts = await Promise.all(uploadTasks);
    uploadedParts.sort((a, b) => a.partNumber - b.partNumber);

    return completeMultipartUpload({
      key,
      uploadId,
      parts: uploadedParts,
      expectedSha256: options?.expectedSha256,
      signal: options?.signal,
    });
  };

  try {
    const response = await runMultipart();
    emitCheckpoint();
    return response;
  } catch (error: unknown) {
    if (
      error instanceof UploadSessionExpiredError &&
      checkpoint?.uploadId
    ) {
      checkpoint = undefined;
      emitCheckpoint();
      const response = await runMultipart();
      emitCheckpoint();
      return response;
    }
    throw error;
  }
}

export async function copyPaste(source: string, target: string, move = false) {
  const uploadUrl = `${WEBDAV_ENDPOINT}${encodeKey(source)}`;
  const destinationUrl = new URL(
    `${WEBDAV_ENDPOINT}${encodeKey(target)}`,
    window.location.href
  );
  const res = await fetch(uploadUrl, {
    method: move ? "MOVE" : "COPY",
    headers: { Destination: destinationUrl.href },
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Failed to ${move ? "move" : "copy"}`);
  }
}

export async function downloadFile(path: string) {
  const fileName = path.replace(/\/$/, "").split("/").pop() || "download";
  const anchor = document.createElement("a");
  anchor.href = `${WEBDAV_ENDPOINT}${encodeKey(path)}`;
  anchor.download = fileName;
  anchor.click();
}

export async function deletePath(path: string) {
  const res = await fetch(`${WEBDAV_ENDPOINT}${encodeKey(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error((await res.text()) || "Delete failed");
}

export async function createFolder(cwd: string) {
  try {
    const folderName = window.prompt("Folder name");
    if (!folderName) return;
    if (folderName.includes("/")) {
      window.alert("Invalid folder name");
      return;
    }
    const folderKey = `${cwd}${folderName}`;
    const uploadUrl = `${WEBDAV_ENDPOINT}${encodeKey(folderKey)}`;
    const res = await fetch(uploadUrl, { method: "MKCOL" });
    if (!res.ok) throw new Error((await res.text()) || "Create folder failed");
  } catch (error) {
    console.error("Create folder failed", error);
    throw error;
  }
}

async function uploadThumbnail(
  digestHex: string,
  thumbnailBlob: Blob,
  signal?: AbortSignal
): Promise<void> {
  const thumbnailUploadUrl = `/webdav/_$flaredrive$/thumbnails/${digestHex}.png`;

  await uploadWithRetry({
    url: thumbnailUploadUrl,
    method: "PUT",
    body: thumbnailBlob,
    signal,
    maxRetries: 2,
  });
}

async function uploadSingleFile({
  remoteKey,
  file,
  headers,
  signal,
  onTaskProgress,
}: {
  remoteKey: string;
  file: File;
  headers: Record<string, string>;
  signal?: AbortSignal;
  onTaskProgress?: (event: { loaded: number; total: number }) => void;
}) {
  const uploadUrl = `${WEBDAV_ENDPOINT}${encodeKey(remoteKey)}`;

  return uploadWithRetry({
    url: uploadUrl,
    method: "PUT",
    headers,
    body: file,
    signal,
    onUploadProgress: (progressEvent) => {
      onTaskProgress?.({ loaded: progressEvent.loaded, total: file.size });
    },
  });
}

export async function processTransferTask({
  task,
  signal,
  onTaskProgress,
  onCheckpoint,
}: {
  task: TransferTask;
  signal?: AbortSignal;
  onTaskProgress?: (event: { loaded: number; total: number }) => void;
  onCheckpoint?: (checkpoint: MultipartUploadCheckpoint | undefined) => void;
}) {
  const { remoteKey, file } = task;
  if (task.type !== "upload" || !file) throw new Error("Invalid task");

  assertNotAborted(signal);
  const expectedSha256 = await computeSha256Base64(file, signal);

  let thumbnailDigest: string | null = null;

  if (
    file.type.startsWith("image/") ||
    file.type === "video/mp4" ||
    file.type === "application/pdf"
  ) {
    try {
      const thumbnailBlob = await promiseWithTimeout(
        generateThumbnail(file, signal),
        THUMBNAIL_TIMEOUT_MS,
        signal
      );
      const digestHex = await blobDigest(thumbnailBlob);
      await uploadThumbnail(digestHex, thumbnailBlob, signal);
      thumbnailDigest = digestHex;
    } catch (error: unknown) {
      if (isAbortError(error)) throw error;
    }
  }

  const headers: { "fd-thumbnail"?: string; "fd-sha256": string } = {
    [FD_SHA256_HEADER]: expectedSha256,
  };
  if (thumbnailDigest) headers["fd-thumbnail"] = thumbnailDigest;

  if (file.size >= SIZE_LIMIT) {
    const response = await multipartUpload(remoteKey, file, {
      headers,
      expectedSha256,
      signal,
      resumeCheckpoint: task.multipart,
      onCheckpoint,
      onUploadProgress: onTaskProgress,
    });
    assertUploadIntegrity(response, expectedSha256);
    return response;
  }

  const response = await uploadSingleFile({
    remoteKey,
    file,
    headers,
    signal,
    onTaskProgress,
  });
  assertUploadIntegrity(response, expectedSha256);
  return response;
}
