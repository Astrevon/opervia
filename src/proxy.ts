import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "@/lib/env";
import { requestOrigin } from "@/lib/origin";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";

// /api/cron authenticates itself with CRON_SECRET (no user session).
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth", "/api/cron"];

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out
 * visitors to /login. This is only an optimistic check — every page, server
 * action and database function verifies the user again.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // DEMO MODE (development only): a demo-person cookie stands in for a session.
  if (isDemoMode()) {
    if (!request.cookies.get(DEMO_COOKIE) && !isPublic && !path.startsWith("/api/demo/")) {
      const url = new URL("/login", requestOrigin(request));
      url.searchParams.set("next", path + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic) {
    const url = new URL("/login", requestOrigin(request));
    url.searchParams.set("next", path + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|opervia-mark.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
