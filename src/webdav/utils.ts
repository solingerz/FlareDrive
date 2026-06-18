export interface RequestHandlerParams {
  bucket: R2Bucket;
  path: string;
  request: Request;
  env?: any;
}

export const WEBDAV_ENDPOINT = "/webdav/";

const INTERNAL_PREFIX = "_$flaredrive$/";
const THUMBNAIL_PATH_PATTERN = /^_\$flaredrive\$\/thumbnails\/[a-f0-9]{40}\.png$/i;

export function isInternalPath(path: string): boolean {
  return path === "_$flaredrive$" || path.startsWith(INTERNAL_PREFIX);
}

export function isThumbnailPath(path: string): boolean {
  return THUMBNAIL_PATH_PATTERN.test(path);
}

export const ROOT_OBJECT = {
  key: "",
  uploaded: new Date(),
  httpMetadata: {
    contentType: "application/x-directory",
    contentDisposition: undefined,
    contentLanguage: undefined,
  },
  customMetadata: undefined,
  size: 0,
  etag: undefined,
};

export function notFound() {
  return new Response("Not found", { status: 404 });
}

function safeMetadataValue(
  value: string | null,
  maxLength: number
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) return undefined;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return undefined;
  return trimmed;
}

export function buildUploadHttpMetadata(headers: Headers): R2HTTPMetadata {
  const metadata: R2HTTPMetadata = {};
  const contentType = safeMetadataValue(headers.get("Content-Type"), 255);
  const contentLanguage = safeMetadataValue(
    headers.get("Content-Language"),
    128
  );

  if (contentType) metadata.contentType = contentType;
  if (contentLanguage) metadata.contentLanguage = contentLanguage;

  return metadata;
}

export function buildStoredHttpMetadata(
  source: R2HTTPMetadata | undefined
): R2HTTPMetadata {
  const metadata: R2HTTPMetadata = {};
  const contentType = safeMetadataValue(source?.contentType ?? null, 255);
  const contentLanguage = safeMetadataValue(source?.contentLanguage ?? null, 128);

  if (contentType) metadata.contentType = contentType;
  if (contentLanguage) metadata.contentLanguage = contentLanguage;

  return metadata;
}

export async function revokeShareForPath(
  env: { SHARE_KV?: KVNamespace } | undefined,
  path: string
): Promise<void> {
  const kv = env?.SHARE_KV;
  if (!kv || !path) return;

  const pathKey = `path:${path}`;
  const token = await kv.get(pathKey);
  if (!token) return;

  const tokenData = (await kv.get(token, "json")) as { filePath?: string } | null;
  if (tokenData?.filePath === path) {
    await kv.delete(token);
  }
  await kv.delete(pathKey);
}

function safeJoin(segments: string[]): string {
  const out: string[] = [];
  for (const raw of segments) {
    const s = decodeURIComponent(String(raw));
    if (s.includes("/") || s.includes("\\") || s.includes("\0")) {
      throw new Response("Bad path", { status: 400 });
    }
    if (s === "" || s === ".") continue;
    if (s === "..") {
      if (!out.length) throw new Response("Path escapes root", { status: 403 });
      out.pop();
    } else {
      out.push(s);
    }
  }
  return out.join("/");
}

export function parseBucketPath(context: any): [R2Bucket, string] {
  const { request, env, params } = context;
  const driveid = new URL(request.url).hostname.replace(/\..*/, "");
  const bucket = env[driveid] || env["BUCKET"];
  if (!bucket) throw new Response("Unknown bucket", { status: 400 });

  const rawParts = (params.path || []) as string[];
  const normalizedPath = safeJoin(rawParts);
  return [bucket as R2Bucket, normalizedPath];
}

export async function* listAll(
  bucket: R2Bucket,
  prefix?: string,
  isRecursive: boolean = false
) {
  let cursor: string | undefined = undefined;
  do {
    var r2Objects = await bucket.list({
      prefix: prefix,
      delimiter: isRecursive ? undefined : "/",
      cursor: cursor,
      // @ts-ignore
      include: ["httpMetadata", "customMetadata"],
    });

    for await (const obj of r2Objects.objects)
      if (!isInternalPath(obj.key)) yield obj;

    if (r2Objects.truncated) cursor = r2Objects.cursor;
  } while (r2Objects.truncated);
}
