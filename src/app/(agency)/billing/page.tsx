import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CreditCard, Receipt, ShieldAlert, Wallet } from "lucide-react";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { BillingTimeline, Facts, InvoiceBadge, PeriodText, StatTile, SubscriptionBadge } from "@/components/billing-ui";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/session";
import {
  EVENT_COLUMNS,
  INVOICE_COLUMNS,
  OUTSTANDING,
  SUBSCRIPTION_COLUMNS,
  SUBSCRIPTION_STATUS,
  daysFromToday,
  formatMoney,
  suspensionLabel,
  type BillingEventRow,
  type InvoiceRow,
  type SubscriptionRow,
} from "@/lib/billing";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const s = await requireAdmin();
  const supabase = await createClient();
  const [{ data: sub }, { data: invoices }, { data: events }] = await Promise.all([
    supabase.from("subscriptions").select(SUBSCRIPTION_COLUMNS).eq("org_id", s.orgId).maybeSingle(),
    supabase.from("invoices").select(INVOICE_COLUMNS).eq("org_id", s.orgId).order("period_start", { ascending: false }).limit(50),
    supabase.from("billing_events").select(EVENT_COLUMNS).eq("org_id", s.orgId).order("created_at", { ascending: false }).limit(60),
  ]);
  const subscription = sub as SubscriptionRow | null;
  const all = (invoices ?? []) as InvoiceRow[];
  const outstanding = all.filter((i) => OUTSTANDING.includes(i.status));
  const totalDue = outstanding.reduce((n, i) => n + Number(i.amount), 0);
  const history = (events ?? []) as BillingEventRow[];

  if (s.org.is_demo && !subscription) {
    return (
      <>
        <PageHeader title="Billing" description="Subscription, invoices and payments for this workspace." />
        <Notice tone="amber" title="Demo workspace">
          This fictional demo workspace isn&apos;t billed. Real workspaces see their subscription, invoices and payment history here.
        </Notice>
      </>
    );
  }

  if (!subscription) {
    return (
      <>
        <PageHeader title="Billing" description="Subscription, invoices and payments for this workspace." />
        <Card>
          <EmptyState icon={<CreditCard className="size-5" />} title="No subscription yet" description="Opervia hasn't set up a subscription for this workspace yet. Contact Opervia if you think this is a mistake." />
        </Card>
      </>
    );
  }

  const suspended = subscription.status === "suspended";
  const oldestUnpaid = [...outstanding].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const dueIn = daysFromToday(subscription.next_payment_due_date);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your Opervia subscription, invoices and payments. Payments are made by bank transfer and confirmed by Opervia."
      />

      {suspended ? (
        <Notice tone="red" icon={<ShieldAlert className="size-5 text-[#fca5a5]" />} title="Your workspace access is suspended" className="mb-6">
          <div className="space-y-1.5">
            <p>
              <b>Why:</b> {subscription.suspension_message || suspensionLabel(subscription.suspension_reason)}
              {subscription.suspension_reason === "payment_overdue" ? " — payment wasn't verified within the grace period." : ""}
            </p>
            {oldestUnpaid ? (
              <p>
                <b>Unpaid invoice:</b>{" "}
                <Link className="text-brand-bright hover:underline" href={`/billing/invoices/${oldestUnpaid.id}`}>
                  {oldestUnpaid.invoice_number}
                </Link>{" "}
                · outstanding <b>{formatMoney(totalDue, subscription.currency)}</b>
              </p>
            ) : null}
            <p>
              <b>What to do:</b> open the invoice, transfer the amount to Opervia&apos;s bank account and upload your transfer receipt.
            </p>
            <p className="text-ink-2">
              {subscription.suspension_reason === "payment_overdue"
                ? "Access is restored automatically as soon as Opervia verifies your payment. Your content, settings and history are safe."
                : "Opervia will review your account before access is restored. Your content, settings and history are safe."}
            </p>
          </div>
        </Notice>
      ) : subscription.status === "overdue" && oldestUnpaid ? (
        <Notice tone="rose" title="Payment overdue" className="mb-6">
          Invoice {oldestUnpaid.invoice_number} was due {formatDate(oldestUnpaid.due_date)}. To avoid suspension, pay within the{" "}
          {subscription.grace_period_days}-day grace period (by {formatDate(addDays(oldestUnpaid.due_date, subscription.grace_period_days))}).
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Status" value={SUBSCRIPTION_STATUS[subscription.status].label} icon={Wallet} tone="text-[#8fb8ff]" />
        <StatTile label="Monthly price" value={formatMoney(subscription.monthly_price, subscription.currency)} icon={CreditCard} />
        <StatTile
          label="Next payment due"
          value={subscription.status === "cancelled" ? "—" : formatDate(subscription.next_payment_due_date)}
          icon={CalendarClock}
          tone={dueIn !== null && dueIn < 0 ? "text-[#fda4af]" : "text-ink-2"}
        />
        <StatTile label="Outstanding" value={formatMoney(totalDue, subscription.currency)} icon={Receipt} tone={totalDue > 0 ? "text-[#fcd34d]" : "text-ink-2"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Outstanding invoices" description="Open an invoice to see the bank details and upload your payment proof." />
            {outstanding.length ? (
              <ul className="divide-y divide-line">
                {outstanding.map((i) => (
                  <li key={i.id}>
                    <Link href={`/billing/invoices/${i.id}`} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-medium text-ink">{i.invoice_number}</span>
                          <InvoiceBadge status={i.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          <PeriodText start={i.period_start} end={i.period_end} /> · due {formatDate(i.due_date)}
                        </div>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(i.amount, i.currency)}</span>
                      <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Receipt className="size-5" />} title="You're all paid up" description="New invoices appear here a week before each billing period." />
            )}
          </Card>

          <Card>
            <CardHeader title="All invoices" />
            {all.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-subtle">
                    <tr className="border-b border-line">
                      <th className="px-5 py-2.5 font-medium">Invoice</th>
                      <th className="px-3 py-2.5 font-medium">Period</th>
                      <th className="px-3 py-2.5 font-medium">Due</th>
                      <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th className="px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {all.map((i) => (
                      <tr key={i.id} className="hover:bg-surface-2">
                        <td className="px-5 py-3">
                          <Link href={`/billing/invoices/${i.id}`} className="font-mono text-[13px] text-brand-bright hover:underline">
                            {i.invoice_number}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">
                          <PeriodText start={i.period_start} end={i.period_end} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(i.due_date)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(i.amount, i.currency)}</td>
                        <td className="px-5 py-3">
                          <InvoiceBadge status={i.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No invoices yet" />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Subscription" action={<SubscriptionBadge status={subscription.status} />} />
            <div className="p-5">
              <Facts
                items={[
                  ["Plan", subscription.plan_name],
                  ["Monthly price", formatMoney(subscription.monthly_price, subscription.currency)],
                  ["Billing cycle", "Monthly"],
                  ["Started", formatDate(subscription.start_date)],
                  ["Current period", <PeriodText key="p" start={subscription.current_period_start} end={subscription.current_period_end} />],
                  ["Grace period", `${subscription.grace_period_days} days after the due date`],
                ]}
              />
              <p className="mt-4 text-xs text-subtle">{SUBSCRIPTION_STATUS[subscription.status].hint}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Payment history" description="Every billing event for your workspace, newest first." />
            <BillingTimeline events={history} invoiceHref={(id) => `/billing/invoices/${id}`} />
          </Card>
          <LinkButton href="/dashboard" variant="ghost" className="self-start">
            Back to dashboard
          </LinkButton>
        </div>
      </div>
    </>
  );
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
