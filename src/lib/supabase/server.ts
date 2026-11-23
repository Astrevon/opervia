import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL, assertPublicEnv } from "@/lib/env";
import { isDemoMode } from "@/lib/demo/mode";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function supabaseClient(cookieStore: CookieStore) {
  assertPublicEnv();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session on every request, so this is safe.
        }
      },
    },
  });
}

/**
 * Supabase client bound to the signed-in user's session cookies.
 * Every query runs as that user, so Row Level Security applies.
 * In DEMO MODE (npm run demo, development only) an in-memory stand-in is returned.
 */
export async function createClient(): Promise<ReturnType<typeof supabaseClient>> {
  const cookieStore = await cookies();
  if (isDemoMode()) {
    const { createDemoClient } = await import("@/lib/demo/client");
    return createDemoClient(cookieStore) as unknown as ReturnType<typeof supabaseClient>;
  }
  return supabaseClient(cookieStore);
}
