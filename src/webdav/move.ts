import { isInternalPath, RequestHandlerParams, WEBDAV_ENDPOINT, parseBucketPath } from "./utils";
import { handleRequestCopy } from "./copy";
import { handleRequestDelete } from "./delete";

function parseDestinationEnv(destinationHeader: string, request: Request, env: any): string | null {
  try {
    const destinationUrl = new URL(destinationHeader, request.url);
    if (!destinationUrl.pathname.startsWith(WEBDAV_ENDPOINT)) return null;
    const rawPath = destinationUrl.pathname.slice(WEBDAV_ENDPOINT.length);
    const pathParts = rawPath.split("/");
    const [, normalizedPath] = parseBucketPath({
      request,
      env,
      params: { path: pathParts },
    });
    return normalizedPath.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function handleRequestMove({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const response = await handleRequestCopy({ bucket, path, request, env });
  if (response.status >= 400) return response;

  try {
    return await handleRequestDelete({ bucket, path, request, env });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("MOVE delete failed", { path, error: message });

    const destinationHeader = request.headers.get("Destination");
    const destination = destinationHeader
      ? parseDestinationEnv(destinationHeader, request, env)
      : null;
    if (destination) {
      try {
        await bucket.delete(destination);
        console.log("MOVE rollback: deleted destination copy", { destination });
      } catch (rollbackErr: unknown) {
        const rbMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        console.error("MOVE rollback failed", { destination, error: rbMsg });
      }
    }

    throw error;
  }
}
