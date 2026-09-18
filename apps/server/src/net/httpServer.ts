import { timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

export interface HttpOptions {
  /** Serve the built client from this directory at `/`. Omit to serve only `/healthz`. */
  readonly staticDir?: string;
  /** Prometheus text for `GET /metrics`; omit to disable the endpoint. */
  readonly metricsText?: () => string;
  /**
   * Operator diagnostics behind `Authorization: Bearer <adminToken>` at `/admin/matches`
   * and `/admin/matches/<code>`. Both must be set for the endpoints to exist at all.
   */
  readonly adminToken?: string;
  readonly diagnostics?: {
    readonly listMatches: () => unknown;
    readonly describeMatch: (code: string) => unknown;
  };
  /** Set to false while shutting down so readiness probes stop sending traffic. */
  readonly isReady?: () => boolean;
  /** Public build identification for `GET /version` (no secrets: the same facts the client sees in `welcome`). */
  readonly version?: () => unknown;
}

/**
 * Sent with every response. The client is a same-origin app with no embedded third-party
 * content: it must not be framed (clickjacking), scripts must not be sniffed from other
 * types, and the referrer must not leak a match code in the URL to other sites.
 */
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "frame-ancestors 'none'",
} as const;

/** Constant-time comparison so the admin token cannot be guessed byte by byte from timing. */
function secretEquals(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
    if (url.pathname === "/version" && options.version !== undefined) {
      respond(response, 200, "application/json; charset=utf-8", JSON.stringify(options.version()));
      return;
    }
    if (url.pathname === "/readyz") {
      const ready = options.isReady?.() ?? true;
      respond(
        response,
        ready ? 200 : 503,
        "application/json; charset=utf-8",
        JSON.stringify({ ready }),
      );
      return;
    }
    if (url.pathname === "/metrics" && options.metricsText !== undefined) {
      respond(response, 200, "text/plain; version=0.0.4; charset=utf-8", options.metricsText());
      return;
    }
    if (url.pathname.startsWith("/admin/")) {
      serveDiagnostics(options, url.pathname, request, response);
      return;
    }
    if (root === undefined || (request.method !== "GET" && request.method !== "HEAD")) {
      respond(response, 404, "text/plain; charset=utf-8", "not found");
      return;
    }
    serveStatic(root, url.pathname, request, response);
  });
}

/**
 * Match diagnostics for operators: which matches exist, at what revision, round, and phase,
 * and one match's journal metadata. Never a token. A wrong or missing bearer token, or an
 * unconfigured token, answers 404 so the surface is invisible when it is not enabled.
 */
function serveDiagnostics(
  options: HttpOptions,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const { adminToken, diagnostics } = options;
  const header = request.headers.authorization ?? "";
  if (
    adminToken === undefined ||
    adminToken === "" ||
    diagnostics === undefined ||
    !secretEquals(header, `Bearer ${adminToken}`)
  ) {
    respond(response, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  if (pathname === "/admin/matches") {
    respond(
      response,
      200,
      "application/json; charset=utf-8",
      JSON.stringify(diagnostics.listMatches()),
    );
    return;
  }
  const match = /^\/admin\/matches\/([A-Z0-9]{1,16})$/.exec(pathname);
  const described = match?.[1] === undefined ? undefined : diagnostics.describeMatch(match[1]);
  if (described === undefined) {
    respond(response, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  respond(response, 200, "application/json; charset=utf-8", JSON.stringify(described));
}

function serveStatic(
  root: string,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    // A malformed percent-escape is a bad request, not an exception for the process.
    respond(response, 400, "text/plain; charset=utf-8", "bad request");
    return;
  }
  const relative = normalize(decoded);
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
    ...SECURITY_HEADERS,
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
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": type,
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
