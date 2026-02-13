type ShareEnv = {
  SHARE_KV?: KVNamespace;
  BUCKET?: R2Bucket;
};

export const onRequestGet: PagesFunction<ShareEnv> = async ({ params, env }) => {
  const token = params?.token as string | undefined;
  if (!token) return new Response("Bad Request", { status: 400 });

  const kv = env.SHARE_KV;
  const bucket = env.BUCKET;
  if (!kv) return new Response("KV binding SHARE_KV not found", { status: 500 });
  if (!bucket) return new Response("Bucket not found", { status: 500 });

  const rec = (await kv.get(token, "json")) as { filePath: string } | null;
  if (!rec?.filePath) return new Response("Link expired or invalid", { status: 410 });

  const obj = await bucket.get(rec.filePath);
  if (!obj) return new Response("File not found", { status: 404 });

  const filename = rec.filePath.split("/").pop() || "file";
  const encodedFilename = encodeURIComponent(filename);
  const headers: Record<string, string> = {
    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename.replace(/\"/g, "")}"; filename*=UTF-8''${encodedFilename}`,
    "Cache-Control": "no-store",
  };
  if (obj.size) headers["Content-Length"] = String(obj.size);

  return new Response(obj.body, { status: 200, headers });
};
