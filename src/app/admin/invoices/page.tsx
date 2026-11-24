import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Card, EmptyState, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { InvoiceBadge, PeriodText } from "@/components/billing-ui";
import { createClient } from "@/lib/supabase/server";
import { INVOICE_STATUS, OUTSTANDING, formatMoney, type InvoiceStatus } from "@/lib/billing";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Invoices" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id,invoice_number,org_id,client_name,period_start,period_end,amount,currency,status,issue_date,due_date,verified_at")
    .order("issue_date", { ascending: false })
    .order("invoice_number", { ascending: false })
    .limit(500);
  if (sp.status === "open") query = query.in("status", OUTSTANDING);
  else if (sp.status && sp.status in INVOICE_STATUS) query = query.eq("status", sp.status);
  const term = (sp.q ?? "").replace(/[%_,()]/g, "").trim().slice(0, 80);
  if (term) query = query.or(`invoice_number.ilike.%${term}%,client_name.ilike.%${term}%`);
  if (sp.from && DATE.test(sp.from)) query = query.gte("issue_date", sp.from);
  if (sp.to && DATE.test(sp.to)) query = query.lte("issue_date", sp.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const total = rows.filter((r) => OUTSTANDING.includes(r.status as InvoiceStatus)).reduce((n, r) => n + Number(r.amount), 0);

  return (
    <>
      <PageHeader title="Invoices" description="Every invoice issued to every client. One invoice per subscription and billing period." />
      <form className="mb-4 flex flex-col flex-wrap gap-2 sm:flex-row" method="get">
        <Input name="q" defaultValue={term} placeholder="Invoice number or client…" className="sm:max-w-xs" />
        <Select name="status" defaultValue={sp.status ?? ""} className="sm:w-52">
          <option value="">All statuses</option>
          <option value="open">Unpaid (all open)</option>
          {Object.entries(INVOICE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} className="sm:w-40" aria-label="Issued from" />
        <Input type="date" name="to" defaultValue={sp.to} className="sm:w-40" aria-label="Issued to" />
        <button className={buttonClass("secondary")}>Filter</button>
      </form>
      <Card>
        {rows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-subtle">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 font-medium">Invoice</th>
                    <th className="px-3 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Period</th>
                    <th className="px-3 py-2.5 font-medium">Due</th>
                    <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <Link href={`/admin/invoices/${r.id}`} className="font-mono text-[13px] text-brand-bright hover:underline">
                          {r.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/admin/clients/${r.org_id}`} className="hover:text-brand-bright">
                          {r.client_name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">
                        <PeriodText start={r.period_start} end={r.period_end} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(r.due_date)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                      <td className="px-5 py-3">
                        <InvoiceBadge status={r.status as InvoiceStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-5 py-3 text-xs text-subtle">
              {rows.length} invoice(s){rows.length === 500 ? " (latest 500)" : ""} · open amount in this list: {formatMoney(total)}
            </div>
          </>
        ) : (
          <EmptyState icon={<Receipt className="size-5" />} title="No invoices found" />
        )}
      </Card>
    </>
  );
}
