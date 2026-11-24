import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Card, EmptyState, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { PeriodText, SubscriptionBadge } from "@/components/billing-ui";
import { createClient } from "@/lib/supabase/server";
import { SUBSCRIPTION_STATUS, formatMoney, type SubscriptionStatus } from "@/lib/billing";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Subscriptions" };

type Row = {
  id: string;
  org_id: string;
  plan_name: string;
  monthly_price: number;
  currency: string;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  next_payment_due_date: string | null;
  grace_period_days: number;
  organizations: { name: string } | null;
};

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status, q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("subscriptions")
    .select("id,org_id,plan_name,monthly_price,currency,status,current_period_start,current_period_end,next_payment_due_date,grace_period_days,organizations!inner(name)")
    .order("next_payment_due_date", { ascending: true, nullsFirst: false })
    .limit(500);
  if (status && status in SUBSCRIPTION_STATUS) query = query.eq("status", status);
  const term = (q ?? "").replace(/[%_,()]/g, "").trim().slice(0, 80);
  if (term) query = query.ilike("organizations.name", `%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader title="Subscriptions" description="One subscription per client workspace, each with its own monthly billing cycle." />
      <form className="mb-4 flex flex-col gap-2 sm:flex-row" method="get">
        <Input name="q" defaultValue={term} placeholder="Search client…" className="sm:max-w-xs" />
        <Select name="status" defaultValue={status ?? ""} className="sm:w-52">
          <option value="">All statuses</option>
          {Object.entries(SUBSCRIPTION_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      <Card>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 text-right font-medium">Monthly</th>
                  <th className="px-3 py-2.5 font-medium">Current period</th>
                  <th className="px-3 py-2.5 font-medium">Next due</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <Link href={`/admin/clients/${r.org_id}`} className="font-medium text-ink hover:text-brand-bright">
                        {r.organizations?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-muted">{r.plan_name}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(r.monthly_price, r.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">
                      <PeriodText start={r.current_period_start} end={r.current_period_end} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{r.status === "cancelled" ? "—" : formatDate(r.next_payment_due_date)}</td>
                    <td className="px-5 py-3">
                      <SubscriptionBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Users className="size-5" />} title="No subscriptions found" description="New agency workspaces get a subscription and their first invoice automatically when they sign up." />
        )}
      </Card>
    </>
  );
}
