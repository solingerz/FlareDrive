import { isInternalPath, RequestHandlerParams } from "./utils";
import { handleRequestCopy } from "./copy";
import { handleRequestDelete } from "./delete";

export async function handleRequestMove({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const response = await handleRequestCopy({ bucket, path, request });
  if (response.status >= 400) return response;

  try {
    return await handleRequestDelete({ bucket, path, request, env });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("MOVE delete failed", { path, destination: response.headers.get("Location"), error: message });
    throw error;
  }
}
