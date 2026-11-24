import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_KEY, SUPABASE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Optional Vercel Cron backup for the daily billing check (renewal invoices,
 * overdue marking, automatic suspension after the grace period, reminders).
 * The primary scheduler is pg_cron inside Supabase (job "opervia-billing-daily",
 * see supabase/migrations/20261124000002_billing_scheduler.sql).
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. The same secret is then
 * verified again inside the database (only its SHA-256 hash is stored there),
 * so no Supabase service-role key is needed. The job is idempotent: running
 * it twice on the same day changes nothing the second time.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) {
    // Backup not enabled: nothing to do (pg_cron in Supabase runs the check).
    return NextResponse.json({ ok: true, skipped: true, reason: "CRON_SECRET not set; the database scheduler runs the daily billing check." });
  }
  const header = request.headers.get("authorization") ?? "";
  if (!sameSecret(header, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("run_billing_jobs", { p_token: secret });
  if (error) {
    console.error("[billing-cron] failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  console.log("[billing-cron]", JSON.stringify(data));
  return NextResponse.json({ ok: true, result: data });
}
