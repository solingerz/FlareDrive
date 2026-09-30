import { handleRequestCopy } from "./copy";
import { handleRequestDelete } from "./delete";
import {
  isInternalPath,
  parseDestinationPath,
  rejectUnexpectedBody,
  RequestHandlerParams,
} from "./utils";

export async function handleRequestMove({
  bucket,
  path,
  request,
  env,
}: RequestHandlerParams) {
  if (isInternalPath(path)) {
    return new Response("Forbidden", { status: 403 });
  }

  const bodyError = rejectUnexpectedBody(request);
  if (bodyError) return bodyError;

  // MOVE only supports "Depth: infinity" (RFC 4918, Section 10.2).
  const depth = request.headers.get("Depth");
  if (depth !== null && depth !== "infinity") {
    return new Response("Bad Request", { status: 400 });
  }

  const destinationHeader = request.headers.get("Destination");
  let destination: string | null = null;
  if (destinationHeader) {
    try {
      destination = parseDestinationPath(destinationHeader, request, env);
    } catch {
      destination = null;
    }
  }
  const destinationExisted =
    destination !== null &&
    destination !== "" &&
    (await bucket.head(destination)) !== null;

  const response = await handleRequestCopy({ bucket, path, request, env });
  if (response.status !== 201 && response.status !== 204) return response;

  try {
    const deleteResponse = await handleRequestDelete({
      bucket,
      path,
      request,
      env,
    });
    if (deleteResponse.status !== 204) return deleteResponse;
    // RFC 4918, Section 9.9.4: 201 when a new mapping was created at the
    // destination, 204 when an existing mapping was replaced.
    return new Response(null, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("MOVE delete failed", { path, error: message });

    // Removing the destination after a failed MOVE would destroy data that
    // existed before the request, so only clean up a destination this
    // request actually created.
    if (destination && !destinationExisted) {
      try {
        await handleRequestDelete({ bucket, path: destination, request, env });
        console.log("MOVE rollback: deleted destination copy", { destination });
      } catch (rollbackError: unknown) {
        const rollbackMessage =
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError);
        console.error("MOVE rollback failed", {
          destination,
          error: rollbackMessage,
        });
      }
    } else if (destination) {
      console.error("MOVE rollback skipped: destination pre-existed", {
        destination,
      });
    }

    throw error;
  }
}
