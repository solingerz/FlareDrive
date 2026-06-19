import {
  listAll,
  RequestHandlerParams,
  ROOT_OBJECT,
  WEBDAV_ENDPOINT,
} from "./utils";

type DavProperties = {
  creationdate: string | undefined;
  displayname: string | undefined;
  getcontentlanguage: string | undefined;
  getcontentlength: string | undefined;
  getcontenttype: string | undefined;
  getetag: string | undefined;
  getlastmodified: string | undefined;
  resourcetype: string;
  "fd:thumbnail": string | undefined;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fromR2Object(object: R2Object | typeof ROOT_OBJECT): DavProperties {
  return {
    creationdate: object.uploaded.toUTCString(),
    displayname: object.httpMetadata?.contentDisposition,
    getcontentlanguage: object.httpMetadata?.contentLanguage,
    getcontentlength: object.size.toString(),
    getcontenttype: object.httpMetadata?.contentType,
    getetag: object.etag,
    getlastmodified: object.uploaded.toUTCString(),
    resourcetype:
      object.httpMetadata?.contentType === "application/x-directory"
        ? "<collection />"
        : "",
    "fd:thumbnail": object.customMetadata?.thumbnail,
  };
}

function formatResponse(item: R2Object | typeof ROOT_OBJECT): string {
  const properties = fromR2Object(item);
  const href = escapeXml(encodeURI(`${WEBDAV_ENDPOINT}${item.key}`));
  const props = Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      key === "resourcetype"
        ? `<${key}>${value}</${key}>`
        : `<${key}>${escapeXml(String(value))}</${key}>`
    )
    .join("");
  return `<response><href>${href}</href><propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
}

export async function handleRequestPropfind({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  const rootObject = path === "" ? ROOT_OBJECT : await bucket.head(path);
  if (!rootObject) return new Response("Not found", { status: 404 });
  const isDirectory =
    rootObject === ROOT_OBJECT ||
    rootObject.httpMetadata?.contentType === "application/x-directory";
  const depth = request.headers.get("Depth") ?? "infinity";

  const encoder = new TextEncoder();
  let isFirst = true;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:" xmlns:fd="flaredrive">`
        )
      );
      controller.enqueue(encoder.encode(formatResponse(rootObject)));

      if (isDirectory && ["1", "infinity"].includes(depth)) {
        const prefix = path === "" ? path : `${path}/`;
        for await (const object of listAll(
          bucket,
          prefix,
          depth === "infinity"
        )) {
          controller.enqueue(encoder.encode(formatResponse(object)));
        }
      }

      controller.enqueue(encoder.encode("</multistatus>"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 207,
    headers: { "Content-Type": "application/xml" },
  });
}
