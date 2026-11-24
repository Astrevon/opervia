import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, LinkButton, Notice, PageHeader } from "@/components/ui";
import { BillingTimeline, Facts, InvoiceBadge, PeriodText } from "@/components/billing-ui";
import { CancelInvoiceDialog, ConfirmPaymentDialog, RejectPaymentDialog } from "@/components/billing-forms";
import { ProofCard } from "@/components/proof-card";
import { AuditList } from "@/components/audit-list";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import { EVENT_COLUMNS, INVOICE_COLUMNS, PAYABLE, PROOF_COLUMNS, formatMoney, type AuditRow, type BillingEventRow, type InvoiceRow, type ProofRow } from "@/lib/billing";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Invoice" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const inv = data as InvoiceRow;
  const [{ data: proofs }, { data: events }, { data: audit }, { data: verifier }] = await Promise.all([
    supabase.from("payment_proofs").select(PROOF_COLUMNS).eq("invoice_id", id).order("submitted_at", { ascending: false }),
    supabase.from("billing_events").select(EVENT_COLUMNS).eq("invoice_id", id).order("created_at", { ascending: false }),
    supabase.from("billing_audit_log").select("*").eq("entity_id", id).order("created_at", { ascending: false }),
    inv.verified_by ? supabase.from("profiles").select("full_name,email").eq("id", inv.verified_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const list = (proofs ?? []) as ProofRow[];
  const pending = list.find((p) => p.status === "pending") ?? null;

  return (
    <>
      <LinkButton href="/admin/invoices" variant="ghost" size="sm" className="-ml-2 mb-3">
        <ArrowLeft className="size-4" /> Invoices
      </LinkButton>
      <PageHeader
        eyebrow={
          <Link href={`/admin/clients/${inv.org_id}`} className="hover:text-ink">
            {inv.client_name}
          </Link>
        }
        title={<span className="font-mono">{inv.invoice_number}</span>}
        actions={
          <>
            <InvoiceBadge status={inv.status} className="text-sm" />
            {inv.status === "pending_verification" ? (
              <>
                <RejectPaymentDialog invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
                <ConfirmPaymentDialog invoiceId={inv.id} invoiceNumber={inv.invoice_number} amount={inv.amount} currency={inv.currency} claimed={pending?.amount_claimed ?? null} hasProof={Boolean(pending)} />
              </>
            ) : PAYABLE.includes(inv.status) ? (
              <>
                <CancelInvoiceDialog invoiceId={inv.id} invoiceNumber={inv.invoice_number} />
                <ConfirmPaymentDialog invoiceId={inv.id} invoiceNumber={inv.invoice_number} amount={inv.amount} currency={inv.currency} claimed={null} hasProof={false} />
              </>
            ) : null}
          </>
        }
      />
      {inv.status === "pending_verification" ? (
        <Notice tone="blue" title="Check your bank account before confirming" className="mb-6">
          The client uploaded a proof. A screenshot is not proof that the money arrived — confirm only after you see{" "}
          {formatMoney(inv.amount, inv.currency)} in the Opervia account.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Invoice" />
            <div className="p-5">
              <Facts
                items={[
                  ["Client", inv.client_name],
                  ["Billing contact", inv.client_email ?? "—"],
                  ["Plan", inv.plan_name],
                  ["Billing period", <PeriodText key="p" start={inv.period_start} end={inv.period_end} />],
                  ["Issued", formatDate(inv.issue_date)],
                  ["Due", formatDate(inv.due_date)],
                  ["Amount expected", <b key="a">{formatMoney(inv.amount, inv.currency)}</b>],
                  ["Amount received", inv.amount_paid !== null ? formatMoney(inv.amount_paid, inv.currency) : "—"],
                  ["Verified", inv.verified_at ? formatDateTime(inv.verified_at, "Asia/Jakarta") : "—"],
                  ["Verified by", verifier ? (verifier as { full_name: string; email: string }).full_name || (verifier as { email: string }).email : "—"],
                  ["Rejection reason", inv.rejection_reason ?? "—"],
                  ["Cancellation", inv.cancel_reason ?? "—"],
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Admin audit trail" />
            <AuditList rows={(audit ?? []) as AuditRow[]} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Payment proofs" description={`${list.length} submitted · all kept permanently`} />
            {list.length ? (
              <div className="flex flex-col gap-4 p-5">
                {list.map((p) => (
                  <ProofCard key={p.id} proof={p} currency={inv.currency} expected={inv.amount} />
                ))}
              </div>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">The client hasn&apos;t submitted a proof yet.</p>
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
