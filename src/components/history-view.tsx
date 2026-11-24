import Link from "next/link";
import { Card, Input, Select, buttonClass, cx } from "@/components/ui";
import { BillingTimeline } from "@/components/billing-ui";
import { AuditList } from "@/components/audit-list";
import { createClient } from "@/lib/supabase/server";
import {
  AUDIT_ACTION_LABEL,
  BILLING_EVENT_LABEL,
  EVENT_COLUMNS,
  INVOICE_STATUS,
  PAYMENT_EVENTS,
  SUBSCRIPTION_EVENTS,
  type AuditRow,
  type BillingEventRow,
} from "@/lib/billing";

export type HistoryTab = "all" | "payments" | "subscriptions" | "audit";
export type HistoryFilters = { client?: string; invoice?: string; type?: string; status?: string; from?: string; to?: string };

const TABS: { tab: HistoryTab; label: string; href: string }[] = [
  { tab: "all", label: "All events", href: "/admin/history" },
  { tab: "payments", label: "Payment history", href: "/admin/history/payments" },
  { tab: "subscriptions", label: "Subscription history", href: "/admin/history/subscriptions" },
  { tab: "audit", label: "Admin audit trail", href: "/admin/history/audit" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = 300;
const clean = (v: string | undefined) => (v ?? "").replace(/[%_,()]/g, "").trim().slice(0, 80);

/** Shared History screen: search by client / invoice, filter by type, payment status and date range (Asia/Jakarta days). */
export async function HistoryView({ tab, filters }: { tab: HistoryTab; filters: HistoryFilters }) {
  const supabase = await createClient();
  const client = clean(filters.client);
  const invoice = clean(filters.invoice);
  const from = filters.from && DATE.test(filters.from) ? filters.from : "";
  const to = filters.to && DATE.test(filters.to) ? filters.to : "";
  const status = filters.status && filters.status in INVOICE_STATUS ? filters.status : "";
  const types = tab === "payments" ? PAYMENT_EVENTS : tab === "subscriptions" ? SUBSCRIPTION_EVENTS : Object.keys(BILLING_EVENT_LABEL);
  const type = tab === "audit" ? (filters.type && filters.type in AUDIT_ACTION_LABEL ? filters.type : "") : filters.type && types.includes(filters.type) ? filters.type : "";

  // Invoices matching the invoice-number / payment-status filters.
  let invoiceIds: string[] | null = null;
  if (invoice || status) {
    let q = supabase.from("invoices").select("id").limit(1000);
    if (invoice) q = q.ilike("invoice_number", `%${invoice}%`);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    invoiceIds = (data ?? []).map((r) => r.id);
  }

  let events: BillingEventRow[] = [];
  let audit: AuditRow[] = [];
  let truncated = false;
  if (invoiceIds === null || invoiceIds.length > 0) {
    if (tab === "audit") {
      let q = supabase.from("billing_audit_log").select("*").order("created_at", { ascending: false }).limit(LIMIT);
      if (client) q = q.ilike("client_name", `%${client}%`);
      if (type) q = q.eq("action_type", type);
      if (invoiceIds) q = q.in("entity_id", invoiceIds);
      if (from) q = q.gte("created_at", `${from}T00:00:00+07:00`);
      if (to) q = q.lte("created_at", `${to}T23:59:59.999+07:00`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      audit = (data ?? []) as AuditRow[];
      truncated = audit.length === LIMIT;
    } else {
      let q = supabase.from("billing_events").select(EVENT_COLUMNS).order("created_at", { ascending: false }).limit(LIMIT);
      if (tab === "payments") q = q.eq("category", "payment");
      if (tab === "subscriptions") q = q.eq("category", "subscription");
      if (client) q = q.ilike("client_name", `%${client}%`);
      if (type) q = q.eq("event_type", type);
      if (invoiceIds) q = q.in("invoice_id", invoiceIds);
      if (from) q = q.gte("created_at", `${from}T00:00:00+07:00`);
      if (to) q = q.lte("created_at", `${to}T23:59:59.999+07:00`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      events = (data ?? []) as BillingEventRow[];
      truncated = events.length === LIMIT;
    }
  }
  const typeOptions = tab === "audit" ? Object.entries(AUDIT_ACTION_LABEL) : types.map((t) => [t, BILLING_EVENT_LABEL[t]] as [string, string]);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            href={t.href}
            role="tab"
            aria-selected={t.tab === tab}
            className={cx(
              "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              t.tab === tab ? "bg-surface-3 text-ink ring-1 ring-line-strong" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_150px_150px_auto]">
        <Input name="client" defaultValue={client} placeholder="Client name…" aria-label="Search by client" />
        <Input name="invoice" defaultValue={invoice} placeholder="Invoice number…" aria-label="Search by invoice number" />
        <Select name="type" defaultValue={type} aria-label="Event type">
          <option value="">{tab === "audit" ? "All actions" : "All event types"}</option>
          {typeOptions.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Payment status">
          <option value="">Any payment status</option>
          {Object.entries(INVOICE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              Invoice {v.label.toLowerCase()}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={from} aria-label="From date" />
        <Input type="date" name="to" defaultValue={to} aria-label="To date" />
        <button className={buttonClass("secondary")}>Apply</button>
      </form>
      <Card>
        {tab === "audit" ? (
          <AuditList rows={audit} showClient />
        ) : (
          <BillingTimeline
            events={events}
            showClient
            invoiceHref={(id) => `/admin/invoices/${id}`}
            clientHref={(id) => `/admin/clients/${id}`}
            emptyText="No events match these filters."
          />
        )}
        <div className="border-t border-line px-5 py-3 text-xs text-subtle">
          Chronological, newest first. {truncated ? `Showing the latest ${LIMIT} — narrow the filters to see older entries. ` : ""}
          History is permanent: it can&apos;t be edited or deleted, by anyone.
        </div>
      </Card>
    </>
  );
}
