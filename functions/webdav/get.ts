import { notFound } from "./utils";
import { RequestHandlerParams } from "./utils";

function isTextFile(contentType: string, path: string): boolean {
  const textTypes = [
    'text/plain',
    'text/html',
    'text/css',
    'text/javascript',
    'text/xml',
    'application/json',
    'application/xml',
    'application/javascript',
  ];
  
  if (textTypes.some(type => contentType.toLowerCase().includes(type))) {
    return true;
  }
  
  const textExtensions = [
    '.txt', '.html', '.htm', '.css', '.js', '.json', '.xml',
    '.md', '.log', '.csv', '.ts', '.jsx', '.tsx', '.vue',
    '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.php',
    '.rb', '.go', '.rs', '.swift', '.kt', '.scala'
  ];
  
  return textExtensions.some(ext => path.toLowerCase().endsWith(ext));
}

function addUtf8Charset(contentType: string): string {
  if (contentType.includes('charset=')) {
    return contentType;
  }
  return contentType + '; charset=utf-8';
}

async function addHtmlCharset(content: ReadableStream): Promise<ReadableStream> {
  const reader = content.getReader();
  const decoder = new TextDecoder('utf-8');
  let html = '';
  
  try {
    let done = false;
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        html += decoder.decode(value, { stream: true });
      }
    }
    html += decoder.decode(); // flush remaining bytes
  } finally {
    reader.releaseLock();
  }
  
  if (html.includes('<meta charset=') || html.includes('<meta http-equiv="content-type"')) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      }
    });
  }
  
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const insertIndex = html.indexOf(headMatch[0]) + headMatch[0].length;
    const charsetMeta = '\n<meta charset="utf-8" />';
    html = html.slice(0, insertIndex) + charsetMeta + html.slice(insertIndex);
  } else {
    const htmlMatch = html.match(/<html[^>]*>/i);
    if (htmlMatch) {
      const insertIndex = html.indexOf(htmlMatch[0]) + htmlMatch[0].length;
      const headWithCharset = '\n<head><meta charset="utf-8" /></head>';
      html = html.slice(0, insertIndex) + headWithCharset + html.slice(insertIndex);
    }
  }
  
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    }
  });
}

export async function handleRequestGet({
  bucket,
  path,
  request,
}: RequestHandlerParams) {
  const obj = await bucket.get(path, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (obj === null) return notFound();
  if (!("body" in obj))
    return new Response("Preconditions failed", { status: 412 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  
  let contentType = headers.get('Content-Type') || 'application/octet-stream';
  
  if (isTextFile(contentType, path)) {
    contentType = addUtf8Charset(contentType);
    headers.set('Content-Type', contentType);
    
    if (contentType.toLowerCase().includes('text/html') && obj.body) {
      const bodyWithCharset = await addHtmlCharset(obj.body);
      if (path.startsWith("_$flaredrive$/thumbnails/"))
        headers.set("Cache-Control", "max-age=31536000");
      return new Response(bodyWithCharset, { headers });
    }
  }
  
  if (path.startsWith("_$flaredrive$/thumbnails/"))
    headers.set("Cache-Control", "max-age=31536000");
  return new Response(obj.body, { headers });
}
