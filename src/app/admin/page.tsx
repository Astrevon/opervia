import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Ban, Building2, CircleCheck, ClipboardCheck, Receipt, TrendingUp } from "lucide-react";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BillingTimeline, InvoiceBadge, StatTile, SubscriptionBadge } from "@/components/billing-ui";
import { CreateSubscriptionDialog, RunBillingButton } from "@/components/billing-forms";
import { createClient } from "@/lib/supabase/server";
import { EVENT_COLUMNS, formatMoney, type BillingEventRow, type InvoiceStatus, type SubscriptionStatus } from "@/lib/billing";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

type Overview = {
  total_clients: number;
  active_subscriptions: number;
  pending_payment_subscriptions: number;
  pending_verification: number;
  unpaid_invoices: number;
  overdue_subscriptions: number;
  suspended_subscriptions: number;
  verified_revenue_this_month: number;
  revenue_currency: string;
  month_start: string;
  last_run: { at: string; source: string; summary: Record<string, number> } | null;
};

export default async function AdminOverview() {
  const supabase = await createClient();
  const [{ data: ov, error }, { data: pending }, { data: attention }, { data: events }, { data: orgs }, { data: plans }] = await Promise.all([
    supabase.rpc("admin_billing_overview"),
    supabase
      .from("invoices")
      .select("id,invoice_number,client_name,amount,currency,status,due_date,org_id")
      .eq("status", "pending_verification")
      .order("due_date")
      .limit(6),
    supabase
      .from("subscriptions")
      .select("id,org_id,status,next_payment_due_date,monthly_price,currency,organizations(name)")
      .in("status", ["overdue", "suspended"])
      .order("next_payment_due_date")
      .limit(8),
    supabase.from("billing_events").select(EVENT_COLUMNS).order("created_at", { ascending: false }).limit(12),
    supabase.from("organizations").select("id,name,is_demo,created_at,subscriptions(id)").eq("is_demo", false).order("created_at", { ascending: false }),
    supabase.from("billing_plans").select("id,name,monthly_price,currency,is_active").order("monthly_price"),
  ]);
  if (error) throw new Error(error.message);
  const o = ov as Overview;
  const cur = o.revenue_currency ?? "IDR";
  const unbilled = ((orgs ?? []) as { id: string; name: string; subscriptions: { id: string }[] | { id: string } | null }[]).filter(
    (x) => !x.subscriptions || (Array.isArray(x.subscriptions) && x.subscriptions.length === 0),
  );

  return (
    <>
      <PageHeader
        eyebrow="Opervia billing"
        title="Overview"
        description="Manual bank-transfer subscriptions: who has paid, what needs verifying and who is overdue."
        actions={<RunBillingButton />}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <StatTile label="Total clients" value={o.total_clients} icon={Building2} href="/admin/subscriptions" />
        <StatTile label="Active subscriptions" value={o.active_subscriptions} icon={CircleCheck} tone="text-[#6ee7b7]" href="/admin/subscriptions?status=active" />
        <StatTile label="Pending verification" value={o.pending_verification} icon={ClipboardCheck} tone="text-[#8fb8ff]" href="/admin/verification" />
        <StatTile label="Unpaid invoices" value={o.unpaid_invoices} icon={Receipt} tone="text-[#fcd34d]" href="/admin/invoices?status=open" />
        <StatTile label="Overdue subscriptions" value={o.overdue_subscriptions} icon={AlertTriangle} tone="text-[#fda4af]" href="/admin/subscriptions?status=overdue" />
        <StatTile label="Suspended subscriptions" value={o.suspended_subscriptions} icon={Ban} tone="text-[#fca5a5]" href="/admin/suspended" />
        <StatTile label="Pending payment" value={o.pending_payment_subscriptions} icon={Receipt} href="/admin/subscriptions?status=pending_payment" />
        <StatTile label="Verified revenue this month" value={formatMoney(o.verified_revenue_this_month, cur)} icon={TrendingUp} tone="text-[#6ee7b7]" />
      </div>
      <p className="mt-3 text-xs text-subtle">
        Daily check runs automatically at 00:05 WIB.{" "}
        {o.last_run ? (
          <>
            Last run {formatDateTime(o.last_run.at, "Asia/Jakarta")} ({o.last_run.source}): {o.last_run.summary.invoices_generated ?? 0} issued,{" "}
            {o.last_run.summary.invoices_marked_overdue ?? 0} overdue, {o.last_run.summary.subscriptions_suspended ?? 0} suspended.
          </>
        ) : (
          "It hasn't run yet."
        )}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Waiting for verification" action={<LinkButton href="/admin/verification" variant="ghost" size="sm">Open queue</LinkButton>} />
          {pending?.length ? (
            <ul className="divide-y divide-line">
              {pending.map((i) => (
                <li key={i.id}>
                  <Link href={`/admin/invoices/${i.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.client_name}</div>
                      <div className="font-mono text-xs text-muted">{i.invoice_number}</div>
                    </div>
                    <span className="text-sm tabular-nums">{formatMoney(i.amount, i.currency)}</span>
                    <InvoiceBadge status={i.status as InvoiceStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<ClipboardCheck className="size-5" />} title="Nothing to verify" description="New payment proofs from clients appear here." />
          )}
        </Card>
        <Card>
          <CardHeader title="Needs attention" description="Overdue and suspended subscriptions" />
          {attention?.length ? (
            <ul className="divide-y divide-line">
              {attention.map((x) => {
                const org = x.organizations as unknown as { name: string } | null;
                return (
                  <li key={x.id}>
                    <Link href={`/admin/clients/${x.org_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{org?.name ?? "Workspace"}</div>
                        <div className="text-xs text-muted">Due {formatDate(x.next_payment_due_date)}</div>
                      </div>
                      <span className="text-sm tabular-nums">{formatMoney(x.monthly_price, x.currency)}</span>
                      <SubscriptionBadge status={x.status as SubscriptionStatus} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<CircleCheck className="size-5" />} title="All clients are in good standing" />
          )}
        </Card>
      </div>

      {unbilled.length ? (
        <Card className="mt-6">
          <CardHeader title="Workspaces without a subscription" description="These workspaces aren't being billed yet." />
          <ul className="divide-y divide-line">
            {unbilled.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-5 py-3">
                <Link href={`/admin/clients/${x.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {x.name}
                </Link>
                <CreateSubscriptionDialog orgId={x.id} plans={(plans ?? []) as { id: string; name: string; monthly_price: number; currency: string; is_active: boolean }[]} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="Latest billing activity" action={<LinkButton href="/admin/history" variant="ghost" size="sm">Full history</LinkButton>} />
        <BillingTimeline
          events={(events ?? []) as BillingEventRow[]}
          showClient
          invoiceHref={(id) => `/admin/invoices/${id}`}
          clientHref={(id) => `/admin/clients/${id}`}
        />
      </Card>
    </>
  );
}
