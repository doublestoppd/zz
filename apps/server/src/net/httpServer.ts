import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

export interface HttpOptions {
  /** Serve the built client from this directory at `/`. Omit to serve only `/healthz`. */
  readonly staticDir?: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * The plain HTTP side of the server: a health check for load balancers and, optionally,
 * the static client bundle so one process can serve the whole game. The WebSocket server
 * attaches to this same listener.
 */
export function createHttpServer(options: HttpOptions): Server {
  const root = options.staticDir === undefined ? undefined : resolve(options.staticDir);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      respond(response, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
      return;
    }
    if (root === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
      respond(response, 404, "text/plain; charset=utf-8", "not found");
      return;
    }
    serveStatic(root, url.pathname, request, response);
  });
}

function serveStatic(
  root: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const relative = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  const file = join(root, relative);
  // Never serve anything outside the static directory, whatever the URL says.
  if (!file.startsWith(root + sep)) {
    respond(response, 403, "text/plain; charset=utf-8", "forbidden");
    return;
  }
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    respond(response, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": file.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function respond(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  response.end(body);
}
