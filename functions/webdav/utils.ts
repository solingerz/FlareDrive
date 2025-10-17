export interface RequestHandlerParams {
  bucket: R2Bucket;
  path: string;
  request: Request;
  env?: any;
}

export const WEBDAV_ENDPOINT = "/webdav/";

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

  const path = safeJoin((params.path || []) as string[]);
  return [bucket as R2Bucket, path];
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
      if (!obj.key.startsWith("_$flaredrive$/")) yield obj;

    if (r2Objects.truncated) cursor = r2Objects.cursor;
  } while (r2Objects.truncated);
}
