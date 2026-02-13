import { handleRequestCopy } from "../functions/webdav/copy";
import { handleRequestDelete } from "../functions/webdav/delete";
import { handleRequestGet } from "../functions/webdav/get";
import { handleRequestHead } from "../functions/webdav/head";
import { handleRequestMkcol } from "../functions/webdav/mkcol";
import { handleRequestMove } from "../functions/webdav/move";
import { handleRequestPost } from "../functions/webdav/post";
import { handleRequestPropfind } from "../functions/webdav/propfind";
import { handleRequestPut } from "../functions/webdav/put";
import { parseBucketPath } from "../functions/webdav/utils";
import { requireAuth, requireAuthSimple } from "../utils/auth";

type WorkerEnv = {
  ASSETS: Fetcher;
  BUCKET?: R2Bucket;
  SHARE_KV?: KVNamespace;
  SHARE_ENABLED?: string;
  SHARE_DEFAULT_EXPIRE_SECONDS?: string;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
  WEBDAV_PUBLIC_READ?: string;
  [key: string]: unknown;
};

type RequestHandlerParams = {
  bucket: R2Bucket;
  path: string;
  request: Request;
  env?: WorkerEnv;
};

type Handler = (context: RequestHandlerParams) => Promise<Response>;

const WEBDAV_BASE = "/webdav";

const WEBDAV_HANDLERS: Record<string, Handler> = {
  PROPFIND: handleRequestPropfind,
  MKCOL: handleRequestMkcol,
  HEAD: handleRequestHead,
  GET: handleRequestGet,
  POST: handleRequestPost,
  PUT: handleRequestPut,
  COPY: handleRequestCopy,
  MOVE: handleRequestMove,
  DELETE: handleRequestDelete,
};

function getWebdavPathSegments(pathname: string): string[] | null {
  if (pathname === WEBDAV_BASE || pathname === `${WEBDAV_BASE}/`) return [];
  if (!pathname.startsWith(`${WEBDAV_BASE}/`)) return null;
  const rawPath = pathname.slice(`${WEBDAV_BASE}/`.length);
  return rawPath.split("/");
}

function getWebdavParams(request: Request, env: WorkerEnv) {
  const pathname = new URL(request.url).pathname;
  const pathSegments = getWebdavPathSegments(pathname);
  if (pathSegments === null) return null;
  return parseBucketPath({
    request,
    env,
    params: { path: pathSegments },
  });
}

function handleWebdavOptions() {
  return new Response(null, {
    headers: {
      Allow: Object.keys(WEBDAV_HANDLERS).join(", "),
      DAV: "1",
    },
  });
}

function methodNotAllowed() {
  return new Response(null, { status: 405 });
}

function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleShareOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleSharePost(request: Request, env: WorkerEnv): Promise<Response> {
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
    const body = (await request.json()) as { filePath?: string };
    const filePath = body?.filePath;
    if (!filePath) return new Response("filePath is required", { status: 400 });

    const bucket = env.BUCKET;
    const kv = env.SHARE_KV;
    if (!bucket) return new Response("Bucket not found", { status: 500 });
    if (!kv) return new Response("KV binding SHARE_KV not found", { status: 500 });

    const meta = await bucket.head(filePath);
    if (!meta) return new Response("File not found", { status: 404 });

    const expireSeconds = Number.parseInt(
      env.SHARE_DEFAULT_EXPIRE_SECONDS || "3600",
      10
    );
    const pathKey = `path:${filePath}`;
    const existingToken = await kv.get(pathKey);
    if (existingToken) {
      await kv.delete(existingToken);
      await kv.delete(pathKey);
    }

    const token = generateShareToken();
    await kv.put(token, JSON.stringify({ filePath }), { expirationTtl: expireSeconds });
    await kv.put(pathKey, token, { expirationTtl: expireSeconds });

    const origin = new URL(request.url).origin;
    return new Response(
      JSON.stringify({
        shareUrl: `${origin}/s/${token}`,
        expireTime: new Date(Date.now() + expireSeconds * 1000).toISOString(),
        expireSeconds,
        fileName: filePath.split("/").pop() || "",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(message, { status: 500 });
  }
}

async function handleShareDownload(pathname: string, env: WorkerEnv): Promise<Response> {
  const token = pathname.slice("/s/".length);
  if (!token) return new Response("Bad Request", { status: 400 });

  const kv = env.SHARE_KV;
  const bucket = env.BUCKET;
  if (!kv) return new Response("KV binding SHARE_KV not found", { status: 500 });
  if (!bucket) return new Response("Bucket not found", { status: 500 });

  const rec = (await kv.get(token, "json")) as { filePath?: string } | null;
  const filePath = rec?.filePath;
  if (!filePath) return new Response("Link expired or invalid", { status: 410 });

  const obj = await bucket.get(filePath);
  if (!obj) return new Response("File not found", { status: 404 });

  const fileName = filePath.split("/").pop() || "file";
  const encodedName = encodeURIComponent(fileName);
  const headers = new Headers({
    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store",
  });
  if (obj.size) headers.set("Content-Length", `${obj.size}`);

  return new Response(obj.body, { status: 200, headers });
}

async function handleWebdavRequest(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleWebdavOptions();

  const authError = requireAuth(request, {
    username: env.WEBDAV_USERNAME,
    password: env.WEBDAV_PASSWORD,
    publicRead: env.WEBDAV_PUBLIC_READ === "1",
  });
  if (authError) return authError;

  const webdavParams = getWebdavParams(request, env);
  if (!webdavParams) return new Response("Not found", { status: 404 });
  const [bucket, path] = webdavParams;
  if (!bucket) return new Response("Not found", { status: 404 });

  const handler = WEBDAV_HANDLERS[request.method] ?? methodNotAllowed;
  const params: RequestHandlerParams = { bucket, path, request };
  if (request.method === "DELETE" || request.method === "MOVE") {
    params.env = env;
  }
  return handler(params);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/api/share") {
      if (request.method === "OPTIONS") return handleShareOptions();
      if (request.method === "POST") return handleSharePost(request, env);
      return methodNotAllowed();
    }

    if (pathname === WEBDAV_BASE || pathname.startsWith(`${WEBDAV_BASE}/`)) {
      return handleWebdavRequest(request, env);
    }

    if (pathname.startsWith("/s/")) {
      return handleShareDownload(pathname, env);
    }

    return env.ASSETS.fetch(request);
  },
};
