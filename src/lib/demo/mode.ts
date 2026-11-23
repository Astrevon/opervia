/**
 * DEMO MODE — local preview without Supabase.
 *
 * Enabled only by `npm run demo` (which sets OPERVIA_DEMO_MODE=1 and runs the
 * development server). It can never be active in a production build:
 * `next build` / `next start` always use real Supabase authentication.
 */
export function isDemoMode() {
  return process.env.OPERVIA_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";
}

/** Same flag, readable in browser code (inlined by the dev server). */
export const DEMO_MODE_CLIENT = process.env.NEXT_PUBLIC_OPERVIA_DEMO_MODE === "1" && process.env.NODE_ENV !== "production";

export const DEMO_COOKIE = "opervia_demo_user";
