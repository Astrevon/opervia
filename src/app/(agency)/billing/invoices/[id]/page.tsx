import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { Card, CardHeader, LinkButton, Notice, PageHeader } from "@/components/ui";
import { BankDetailsBox, BillingTimeline, Facts, InvoiceBadge, PeriodText, ProofBadge } from "@/components/billing-ui";
import { PaymentProofForm } from "@/components/billing-forms";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validation";
import { EVENT_COLUMNS, INVOICE_COLUMNS, PAYABLE, PROOF_COLUMNS, formatMoney, type BankDetails, type BillingEventRow, type InvoiceRow, type ProofRow } from "@/lib/billing";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const s = await requireAdmin();
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (!inv) notFound();
  const invoice = inv as InvoiceRow;
  const [{ data: proofs }, { data: events }, { data: bank }] = await Promise.all([
    supabase.from("payment_proofs").select(PROOF_COLUMNS).eq("invoice_id", id).order("submitted_at", { ascending: false }),
    supabase.from("billing_events").select(EVENT_COLUMNS).eq("invoice_id", id).order("created_at", { ascending: false }),
    supabase.rpc("get_payment_details"),
  ]);
  const proofList = (proofs ?? []) as ProofRow[];
  const payable = PAYABLE.includes(invoice.status);
  // Current bank details for unpaid invoices (in case they changed), the snapshot otherwise.
  const bankInfo = (payable ? (bank as BankDetails | null) : null) ?? invoice.payment_instructions;

  return (
    <>
      <LinkButton href="/billing" variant="ghost" size="sm" className="-ml-2 mb-3">
        <ArrowLeft className="size-4" /> Billing
      </LinkButton>
      <PageHeader eyebrow="Invoice" title={<span className="font-mono">{invoice.invoice_number}</span>} actions={<InvoiceBadge status={invoice.status} className="text-sm" />} />

      {invoice.status === "pending_verification" ? (
        <Notice tone="blue" title="Payment submitted — waiting for verification" className="mb-6">
          Opervia checks that the transfer has arrived in its bank account, then confirms the payment. You&apos;ll get a notification.
        </Notice>
      ) : invoice.status === "rejected" ? (
        <Notice tone="red" title="Your payment couldn't be confirmed" className="mb-6">
          <p>{invoice.rejection_reason}</p>
          <p className="mt-1">Please check the details and upload a new payment proof below.</p>
        </Notice>
      ) : invoice.status === "overdue" ? (
        <Notice tone="rose" title="This invoice is overdue" className="mb-6">
          It was due {formatDate(invoice.due_date)}. Pay now to avoid (or end) a suspension of your workspace.
        </Notice>
      ) : invoice.status === "paid" ? (
        <Notice tone="emerald" title="Paid — thank you" className="mb-6">
          Payment of {formatMoney(invoice.amount_paid ?? invoice.amount, invoice.currency)} was confirmed on {formatDateTime(invoice.verified_at, "Asia/Jakarta")}.
        </Notice>
      ) : invoice.status === "cancelled" ? (
        <Notice tone="slate" title="Cancelled" className="mb-6">
          This invoice no longer needs payment{invoice.cancel_reason ? `: ${invoice.cancel_reason}` : "."}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Invoice details" />
            <div className="p-5">
              <Facts
                items={[
                  ["Billed to", invoice.client_name],
                  ["Contact", invoice.client_email ?? "—"],
                  ["Plan", invoice.plan_name],
                  ["Billing period", <PeriodText key="p" start={invoice.period_start} end={invoice.period_end} />],
                  ["Issued", formatDate(invoice.issue_date)],
                  ["Due date", formatDate(invoice.due_date)],
                  ["Amount", <span key="a" className="text-base font-semibold">{formatMoney(invoice.amount, invoice.currency)}</span>],
                  ["Status", <InvoiceBadge key="s" status={invoice.status} />],
                ]}
              />
            </div>
          </Card>

          {payable ? (
            <Card>
              <CardHeader title="Pay this invoice" description="1. Transfer the amount · 2. Upload your receipt · 3. Opervia confirms" />
              <div className="flex flex-col gap-5 p-5">
                <BankDetailsBox bank={bankInfo} amount={invoice.amount} currency={invoice.currency} invoiceNumber={invoice.invoice_number} />
                <PaymentProofForm invoiceId={invoice.id} amount={invoice.amount} currency={invoice.currency} defaultSender={s.org.name} />
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Payment proofs" description="Kept permanently, including rejected ones." />
            {proofList.length ? (
              <ul className="divide-y divide-line">
                {proofList.map((p) => (
                  <li key={p.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <a href={`/api/billing/proofs/${p.id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sm text-brand-bright hover:underline">
                        <FileText className="size-4 shrink-0" />
                        <span className="truncate">{p.file_name}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                      <ProofBadge status={p.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {formatMoney(p.amount_claimed, invoice.currency)} · sent {formatDate(p.transfer_date)} by {p.sender_name}
                      {p.sender_bank ? ` (${p.sender_bank})` : ""} · {formatBytes(p.size_bytes)}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-subtle">Submitted {formatDateTime(p.submitted_at, "Asia/Jakarta")}</div>
                    {p.status === "rejected" && p.review_reason ? <div className="mt-1.5 text-[13px] text-[#fca5a5]">Rejected: {p.review_reason}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No payment proof submitted yet.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Invoice history" />
            <BillingTimeline events={(events ?? []) as BillingEventRow[]} />
          </Card>
        </div>
      </div>
    </>
  );
}
