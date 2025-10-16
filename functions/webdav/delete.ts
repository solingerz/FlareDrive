import { notFound } from "./utils";
import { listAll, RequestHandlerParams } from "./utils";

export async function handleRequestDelete({
  bucket,
  path,
  env,
}: RequestHandlerParams) {
  const kv = env?.SHARE_KV;
  
  if (path !== "") {
    const obj = await bucket.head(path);
    if (obj === null) return notFound();
    
    const pathKey = `path:${path}`;
    const token = await kv?.get(pathKey);
    
    if (token) {
      const tokenData = await kv?.get(token, "json") as { filePath: string } | null;
      
      if (tokenData && tokenData.filePath === path) {
        await kv?.delete(token);
        await kv?.delete(pathKey);
      }
    }
    
    await bucket.delete(path);
    
    if (obj.httpMetadata?.contentType !== "application/x-directory")
      return new Response(null, { status: 204 });
  }

  const children = listAll(bucket, path === "" ? undefined : `${path}/`);
  for await (const child of children) {
    const pathKey = `path:${child.key}`;
    const token = await kv?.get(pathKey);
    
    if (token) {
      const tokenData = await kv?.get(token, "json") as { filePath: string } | null;
      
      if (tokenData && tokenData.filePath === child.key) {
        await kv?.delete(token);
        await kv?.delete(pathKey);
      }
    }
    await bucket.delete(child.key);
  }

  return new Response(null, { status: 204 });
}
