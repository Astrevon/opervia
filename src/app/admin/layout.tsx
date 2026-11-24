import type { Metadata } from "next";
import { AdminShell } from "@/components/admin-shell";
import { createClient } from "@/lib/supabase/server";
import { requireBillingAdmin } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Billing admin", template: "%s · Opervia Billing" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireBillingAdmin();
  const supabase = await createClient();
  const [{ count: pending }, { count: suspended }] = await Promise.all([
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "pending_verification"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "suspended"),
  ]);
  return (
    <AdminShell userName={s.fullName} userEmail={s.email} pendingCount={pending ?? 0} suspendedCount={suspended ?? 0} hasWorkspace={Boolean(s.role)}>
      {children}
    </AdminShell>
  );
}
