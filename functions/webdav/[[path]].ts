import { notFound, parseBucketPath } from "./utils";
import { handleRequestCopy } from "./copy";
import { handleRequestDelete } from "./delete";
import { handleRequestGet } from "./get";
import { handleRequestHead } from "./head";
import { handleRequestMkcol } from "./mkcol";
import { handleRequestMove } from "./move";
import { handleRequestPropfind } from "./propfind";
import { handleRequestPut } from "./put";
import { RequestHandlerParams } from "./utils";
import { handleRequestPost } from "./post";
import { requireAuth } from "../../utils/auth";

async function handleRequestOptions() {
  return new Response(null, {
    headers: {
      Allow: Object.keys(HANDLERS).join(", "),
      DAV: "1",
    },
  });
}

async function handleMethodNotAllowed() {
  return new Response(null, { status: 405 });
}

const HANDLERS: Record<
  string,
  (context: RequestHandlerParams) => Promise<Response>
> = {
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

export const onRequest = async function (context: {
  request: Request;
  env: {
    WEBDAV_USERNAME: string;
    WEBDAV_PASSWORD: string;
    WEBDAV_PUBLIC_READ?: string;
    [key: string]: any;
  };
  params: any;
}) {
  const env = context.env;
  const request: Request = context.request;
  if (request.method === "OPTIONS") return handleRequestOptions();

  // 使用统一的认证中间件
  const authError = requireAuth(request, {
    username: env.WEBDAV_USERNAME,
    password: env.WEBDAV_PASSWORD,
    publicRead: env.WEBDAV_PUBLIC_READ === "1",
  });
  if (authError) return authError;

  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const method: string = (context.request as Request).method;
  const handler = HANDLERS[method] ?? handleMethodNotAllowed;
  
  const params: RequestHandlerParams = { bucket, path, request: context.request };
  if (method === 'DELETE' || method === 'MOVE') {
    params.env = context.env;
  }
  
  return handler(params);
};
