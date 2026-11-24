import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { BillingTimeline, Facts, InvoiceBadge, PeriodText, SubscriptionBadge } from "@/components/billing-ui";
import { CancelSubscriptionDialog, CreateSubscriptionDialog, EditSubscriptionDialog, ReactivateDialog, SuspendDialog } from "@/components/billing-forms";
import { AuditList } from "@/components/audit-list";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import {
  EVENT_COLUMNS,
  INVOICE_COLUMNS,
  OUTSTANDING,
  SUBSCRIPTION_COLUMNS,
  formatMoney,
  suspensionLabel,
  type AuditRow,
  type BillingEventRow,
  type InvoiceRow,
  type SubscriptionRow,
} from "@/lib/billing";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Client billing" };

export default async function ClientBillingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!idSchema.safeParse(orgId).success) notFound();
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id,name,is_demo,created_at").eq("id", orgId).maybeSingle();
  if (!org) notFound();
  const [{ data: sub }, { data: invoices }, { data: events }, { data: audit }, { data: admins }, { data: plans }] = await Promise.all([
    supabase.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("org_id", orgId).maybeSingle(),
    supabase.from("invoices").select(INVOICE_COLUMNS).eq("org_id", orgId).order("period_start", { ascending: false }),
    supabase.from("billing_events").select(EVENT_COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
    supabase.from("billing_audit_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(100),
    supabase.from("memberships").select("user_id,role,is_active,profiles(full_name,email)").eq("org_id", orgId).eq("role", "admin"),
    supabase.from("billing_plans").select("id,name,monthly_price,currency,is_active").order("monthly_price"),
  ]);
  const s = sub as SubscriptionRow | null;
  const inv = (invoices ?? []) as InvoiceRow[];
  const outstanding = inv.filter((i) => OUTSTANDING.includes(i.status)).reduce((n, i) => n + Number(i.amount), 0);
  const planOptions = (plans ?? []) as { id: string; name: string; monthly_price: number; currency: string; is_active: boolean }[];
  const contacts = (admins ?? []) as unknown as { user_id: string; is_active: boolean; profiles: { full_name: string; email: string } | null }[];

  return (
    <>
      <LinkButton href="/admin/subscriptions" variant="ghost" size="sm" className="-ml-2 mb-3">
        <ArrowLeft className="size-4" /> Subscriptions
      </LinkButton>
      <PageHeader
        eyebrow="Client"
        title={org.name}
        description={`Workspace created ${formatDate(org.created_at)}${org.is_demo ? " · fictional demo workspace (not billed)" : ""}`}
        actions={
          s ? (
            <>
              <EditSubscriptionDialog subscriptionId={s.id} planId={s.plan_id} price={s.monthly_price} currency={s.currency} graceDays={s.grace_period_days} plans={planOptions} />
              {s.status === "suspended" || s.status === "cancelled" ? (
                <ReactivateDialog subscriptionId={s.id} clientName={org.name} cancelled={s.status === "cancelled"} />
              ) : (
                <SuspendDialog subscriptionId={s.id} clientName={org.name} />
              )}
              {s.status !== "cancelled" ? <CancelSubscriptionDialog subscriptionId={s.id} clientName={org.name} /> : null}
            </>
          ) : (
            <CreateSubscriptionDialog orgId={org.id} plans={planOptions} />
          )
        }
      />

      {s?.status === "suspended" ? (
        <Notice tone="red" title={`Suspended since ${formatDateTime(s.suspended_at, "Asia/Jakarta")} — ${suspensionLabel(s.suspension_reason)}`} className="mb-6">
          {s.suspension_reason === "payment_overdue"
            ? "Confirming the overdue payment reactivates the workspace automatically."
            : "Manual suspension: confirming a payment will NOT lift it. Use Reactivate once the issue is resolved."}
          {s.suspension_message ? <div className="mt-1">Message to client: “{s.suspension_message}”</div> : null}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Subscription" action={<SubscriptionBadge status={s?.status} />} />
            <div className="p-5">
              {s ? (
                <Facts
                  items={[
                    ["Subscription ID", <span key="id" className="font-mono text-xs">{s.id}</span>],
                    ["Plan", s.plan_name],
                    ["Monthly price", formatMoney(s.monthly_price, s.currency)],
                    ["Billing cycle", "Monthly"],
                    ["Start date", formatDate(s.start_date)],
                    ["Current period", <PeriodText key="p" start={s.current_period_start} end={s.current_period_end} />],
                    ["Next payment due", s.status === "cancelled" ? "—" : formatDate(s.next_payment_due_date)],
                    ["Grace period", `${s.grace_period_days} days`],
                    ["Suspension date", s.suspended_at ? formatDateTime(s.suspended_at, "Asia/Jakarta") : "—"],
                    ["Suspension reason", s.suspension_reason ? suspensionLabel(s.suspension_reason) : "—"],
                    ["Outstanding", formatMoney(outstanding, s.currency)],
                    ["Last reactivated", s.last_reactivated_at ? formatDateTime(s.last_reactivated_at, "Asia/Jakarta") : "—"],
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">This workspace has no subscription.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Billing contacts" description="Active workspace admins" />
            <ul className="divide-y divide-line">
              {contacts.length ? (
                contacts.map((c) => (
                  <li key={c.user_id} className="px-5 py-3 text-sm">
                    <div className="font-medium">{c.profiles?.full_name || "—"}</div>
                    <div className="text-xs text-muted">
                      {c.profiles?.email} {c.is_active ? "" : "· deactivated"}
                    </div>
                  </li>
                ))
              ) : (
                <li className="px-5 py-4 text-sm text-muted">No admins.</li>
              )}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Admin audit trail" description="Internal — never shown to the client" />
            <AuditList rows={(audit ?? []) as AuditRow[]} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Invoices" />
            {inv.length ? (
              <ul className="divide-y divide-line">
                {inv.map((i) => (
                  <li key={i.id}>
                    <Link href={`/admin/invoices/${i.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[13px]">{i.invoice_number}</div>
                        <div className="text-xs text-muted">
                          <PeriodText start={i.period_start} end={i.period_end} /> · due {formatDate(i.due_date)}
                        </div>
                      </div>
                      <span className="text-sm tabular-nums">{formatMoney(i.amount, i.currency)}</span>
                      <InvoiceBadge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<ScrollText className="size-5" />} title="No invoices" />
            )}
          </Card>
          <Card>
            <CardHeader title="History" description="Payment and subscription events, newest first" />
            <BillingTimeline events={(events ?? []) as BillingEventRow[]} invoiceHref={(id) => `/admin/invoices/${id}`} />
          </Card>
        </div>
      </div>
    </>
  );
}
