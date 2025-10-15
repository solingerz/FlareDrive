import { requireAuthSimple } from "../../utils/auth";

interface ShareRequest {
  filePath: string;
}

interface ShareResponse {
  shareUrl: string;
  expireTime: string;
  expireSeconds: number;
  fileName: string;
}

/**
 * 生成安全的随机分享 token
 */
function generateShareToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;

  // 使用统一的认证中间件 (POST 请求始终需要认证)
  const authError = requireAuthSimple(
    request,
    env.WEBDAV_USERNAME,
    env.WEBDAV_PASSWORD
  );
  if (authError) return authError;

  if (env.SHARE_ENABLED !== "true") {
    return new Response("Share functionality is disabled", { status: 403 });
  }

  try {
    const body: ShareRequest = await request.json();
    if (!body?.filePath) {
      return new Response("filePath is required", { status: 400 });
    }

    const expireSeconds = parseInt(env.SHARE_DEFAULT_EXPIRE_SECONDS || "3600", 10);

    const bucket = env.BUCKET;
    const kv = env.SHARE_KV;
    if (!bucket) return new Response("Bucket not found", { status: 500 });
    if (!kv) return new Response("KV binding SHARE_KV not found", { status: 500 });

    const meta = await bucket.head(body.filePath);
    if (!meta) return new Response("File not found", { status: 404 });

    const token = generateShareToken();
    await kv.put(token, JSON.stringify({ filePath: body.filePath }), {
      expirationTtl: expireSeconds,
    });

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/s/${token}`;
    const expireTime = new Date(Date.now() + expireSeconds * 1000).toISOString();
    const fileName = body.filePath.split("/").pop() || "";

    const response: ShareResponse = {
      shareUrl,
      expireTime,
      expireSeconds,
      fileName,
    };

    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return new Response(error?.message || "Internal server error", { status: 500 });
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
