import { notFound } from "../webdav/utils";
import { RequestHandlerParams } from "../webdav/utils";

interface ShareRequest {
  filePath: string;
  expireSeconds?: number;
}

interface ShareResponse {
  shareUrl: string;
  expireTime: string;
  expireSeconds: number;
  fileName: string;
}

interface ShareContext {
  request: Request;
  env: {
    WEBDAV_USERNAME: string;
    WEBDAV_PASSWORD: string;
    SHARE_ENABLED?: string;
    SHARE_DEFAULT_EXPIRE_SECONDS?: string;
    BUCKET?: any;
    [key: string]: any;
  };
}

function validateAuth(request: Request, env: any): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  
  const expectedAuth = `Basic ${btoa(
    `${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`
  )}`;
  return auth === expectedAuth;
}

function generateShareToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createPresignedUrl(
  bucket: any,
  filePath: string,
  expireSeconds: number,
  request: Request
): Promise<string> {
  const object = await bucket.head(filePath);
  if (!object) {
    throw new Error('File not found');
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  const token = generateShareToken();
  
  const signedUrl = await bucket.createPresignedUrl({
    key: filePath,
    expiresIn: expireSeconds,
    method: 'GET',
  });

  return signedUrl;
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  
  if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
    return new Response("WebDAV protocol is not enabled", { status: 403 });
  }
  
  if (!validateAuth(request, env)) {
    return new Response("Unauthorized", { 
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="WebDAV"` }
    });
  }

  if (env.SHARE_ENABLED !== "true") {
    return new Response("Share functionality is disabled", { status: 403 });
  }

  try {
    const body: ShareRequest = await request.json();
    
    if (!body.filePath) {
      return new Response("filePath is required", { status: 400 });
    }

    const defaultExpireSeconds = parseInt(env.SHARE_DEFAULT_EXPIRE_SECONDS || "3600");
    
    let expireSeconds = body.expireSeconds || defaultExpireSeconds;
    
    if (expireSeconds < 60) {
      expireSeconds = 60;
    }

    const bucket = env.BUCKET || env[Object.keys(env).find(key => key.includes('BUCKET')) || ''];
    if (!bucket) {
      return new Response("Bucket not found", { status: 500 });
    }

    const shareUrl = await createPresignedUrl(bucket, body.filePath, expireSeconds, request);
    
    const expireTime = new Date(Date.now() + expireSeconds * 1000).toISOString();
    
    const fileName = body.filePath.split('/').pop() || '';

    const response: ShareResponse = {
      shareUrl,
      expireTime, 
      expireSeconds,
      fileName
    };

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });

  } catch (error) {
    console.error('Error creating share:', error);
    return new Response(error instanceof Error ? error.message : 'Internal server error', { 
      status: 500 
    });
  }
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
