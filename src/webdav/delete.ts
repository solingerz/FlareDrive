import pLimit from "p-limit";

import {
  encodeHref,
  isInternalPath,
  listAll,
  notFound,
  rejectUnexpectedBody,
  RequestHandlerParams,
  revokeShareForPath,
} from "./utils";

const DELETE_CONCURRENCY = 20;

type DeleteFailure = {
  key: string;
  status: number;
  message: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function multiStatusResponse(failures: DeleteFailure[]): Response {
  const responses = failures
    .map(({ key, status, message }) => {
      const href = escapeXml(encodeHref(key));
      const statusLine = escapeXml(message.replace(/\s+/g, " "));
      return `<response><href>${href}</href><status>HTTP/1.1 ${status} ${statusLine}</status></response>`;
    })
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">${responses}</multistatus>`,
    {
      status: 207,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    }
  );
}

function depthOf(key: string): number {
  return key.split("/").filter(Boolean).length;
}

export async function handleRequestDelete({
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

  const target = path === "" ? null : await bucket.head(path);
  if (path !== "" && target === null) return notFound();

  const isCollection =
    path === "" ||
    target?.httpMetadata?.contentType === "application/x-directory";

  // Non-collection resources are removed directly (RFC 4918, Section 9.6).
  if (!isCollection) {
    await revokeShareForPath(env, path);
    await bucket.delete(path);
    return new Response(null, { status: 204 });
  }

  // DELETE on a collection always acts as "Depth: infinity" (RFC 4918,
  // Section 9.6.1), so collect every internal member recursively first.
  const prefix = path === "" ? undefined : `${path}/`;
  const members: R2Object[] = [];
  for await (const member of listAll(bucket, prefix, true)) {
    members.push(member);
  }

  // Group members by depth and process the deepest level first, stopping at
  // the first failing level. This guarantees that if a member cannot be
  // deleted, none of its ancestors (including the collection itself) are
  // deleted, as required by RFC 4918, Section 9.6.1.
  const membersByDepth = new Map<number, R2Object[]>();
  for (const member of members) {
    const depth = depthOf(member.key);
    const level = membersByDepth.get(depth);
    if (level) level.push(member);
    else membersByDepth.set(depth, [member]);
  }

  const limit = pLimit(DELETE_CONCURRENCY);
  const failures: DeleteFailure[] = [];
  const depths = [...membersByDepth.keys()].sort((a, b) => b - a);

  for (const depth of depths) {
    const results = await Promise.all(
      membersByDepth.get(depth)!.map((member) =>
        limit(async (): Promise<DeleteFailure | null> => {
          try {
            if (
              member.httpMetadata?.contentType === "application/x-directory"
            ) {
              await revokeShareForPath(env, member.key);
            }
            await bucket.delete(member.key);
            return null;
          } catch (error) {
            return {
              key: member.key,
              status: 500,
              message:
                error instanceof Error && error.message
                  ? error.message
                  : "Internal Server Error",
            };
          }
        })
      )
    );

    for (const failure of results) {
      if (failure !== null) failures.push(failure);
    }

    if (failures.length > 0) break;
  }

  // Report member failures as 207 Multi-Status and keep the collection
  // (and its remaining ancestors) intact (RFC 4918, Section 9.6.1).
  if (failures.length > 0) return multiStatusResponse(failures);

  // All members are gone, so the collection itself can be removed last.
  if (path !== "") {
    await revokeShareForPath(env, path);
    await bucket.delete(path);
  }

  return new Response(null, { status: 204 });
}
