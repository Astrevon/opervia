import type { NextRequest } from "next/server";

/**
 * The origin the browser actually used (e.g. http://192.168.1.20:3000), so
 * redirects keep the same host and the session cookie stays valid.
 * `request.nextUrl` can report "localhost" when the server is bound to an IP.
 */
export function requestOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
