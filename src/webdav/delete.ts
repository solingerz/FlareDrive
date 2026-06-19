import { isInternalPath, notFound, revokeShareForPath } from "./utils";
import { listAll, RequestHandlerParams } from "./utils";

export async function handleRequestDelete({
  bucket,
  path,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (path !== "") {
    const obj = await bucket.head(path);
    if (obj === null) return notFound();
    await revokeShareForPath(env, path);
    
    await bucket.delete(path);
    
    if (obj.httpMetadata?.contentType !== "application/x-directory")
      return new Response(null, { status: 204 });
  }

  const prefix = path === "" ? undefined : `${path}/`;
  const MAX_CLEANUP_PASSES = 3;

  for (let pass = 0; pass < MAX_CLEANUP_PASSES; pass++) {
    let deleted = 0;
    const children = listAll(bucket, prefix);
    for await (const child of children) {
      await revokeShareForPath(env, child.key);
      await bucket.delete(child.key);
      deleted++;
    }
    if (deleted === 0) break;
  }

  return new Response(null, { status: 204 });
}
