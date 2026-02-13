const THUMBNAIL_SIZE = 144;

type ThumbnailRequest = {
  id: string;
  mimeType: string;
  fileBuffer: ArrayBuffer;
};

type ThumbnailResponse =
  | { id: string; ok: true; thumbnailBuffer: ArrayBuffer }
  | { id: string; ok: false; message: string };

function assertCanvasSupport() {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is not supported");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap is not supported");
  }
}

async function generateImageThumbnail(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<ArrayBuffer> {
  assertCanvasSupport();

  const blob = new Blob([buffer], { type: mimeType });
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot create canvas context");

    context.drawImage(bitmap, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const out = await canvas.convertToBlob({ type: "image/png" });
    return await out.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<ThumbnailRequest>) => {
  const { id, mimeType, fileBuffer } = event.data;

  try {
    const thumbnailBuffer = await generateImageThumbnail(fileBuffer, mimeType);
    const response: ThumbnailResponse = { id, ok: true, thumbnailBuffer };
    (self as DedicatedWorkerGlobalScope).postMessage(response, [thumbnailBuffer]);
  } catch (error: unknown) {
    const response: ThumbnailResponse = {
      id,
      ok: false,
      message: error instanceof Error ? error.message : "Thumbnail worker failed",
    };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
};

export {};
