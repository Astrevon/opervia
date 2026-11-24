import type { Metadata } from "next";
import Link from "next/link";
import { Ban } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ReactivateDialog } from "@/components/billing-forms";
import { createClient } from "@/lib/supabase/server";
import { OUTSTANDING, formatMoney, suspensionLabel } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Suspended clients" };

export default async function SuspendedPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id,org_id,status,suspended_at,suspension_reason,suspension_message,currency,organizations(name),invoices(amount,status)")
    .eq("status", "suspended")
    .order("suspended_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    id: string;
    org_id: string;
    suspended_at: string;
    suspension_reason: string;
    suspension_message: string | null;
    currency: string;
    organizations: { name: string } | null;
    invoices: { amount: number; status: string }[];
  }[];

  return (
    <>
      <PageHeader
        title="Suspended clients"
        description="Paid services are blocked for these workspaces. Payment-overdue suspensions lift automatically when you confirm the payment; manual ones need Reactivate."
      />
      <Card>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const owed = (r.invoices ?? []).filter((i) => OUTSTANDING.includes(i.status as never)).reduce((n, i) => n + Number(i.amount), 0);
              const auto = r.suspension_reason === "payment_overdue";
              return (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/clients/${r.org_id}`} className="font-medium hover:text-brand-bright">
                      {r.organizations?.name ?? "Workspace"}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted">
                      {suspensionLabel(r.suspension_reason)} · since {formatDateTime(r.suspended_at, "Asia/Jakarta")} · outstanding {formatMoney(owed, r.currency)}
                    </div>
                    {r.suspension_message ? <div className="mt-1 text-[13px] text-ink-2">“{r.suspension_message}”</div> : null}
                  </div>
                  {auto ? (
                    <span className="text-xs text-subtle">Lifts when payment is confirmed</span>
                  ) : (
                    <ReactivateDialog subscriptionId={r.id} clientName={r.organizations?.name ?? "this client"} cancelled={false} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<Ban className="size-5" />} title="No suspended clients" />
        )}
      </Card>
    </>
  );
}
