import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { InvoiceBadge, PeriodText } from "@/components/billing-ui";
import { ConfirmPaymentDialog, RejectPaymentDialog } from "@/components/billing-forms";
import { ProofCard } from "@/components/proof-card";
import { createClient } from "@/lib/supabase/server";
import { PROOF_COLUMNS, formatMoney, type InvoiceStatus, type ProofRow } from "@/lib/billing";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Payment verification" };

export default async function VerificationPage() {
  const supabase = await createClient();
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id,invoice_number,org_id,client_name,amount,currency,status,due_date,period_start,period_end,latest_proof_id")
    .eq("status", "pending_verification")
    .order("due_date");
  if (error) throw new Error(error.message);
  const ids = (invoices ?? []).map((i) => i.latest_proof_id).filter(Boolean) as string[];
  const { data: proofs } = ids.length ? await supabase.from("payment_proofs").select(PROOF_COLUMNS).in("id", ids) : { data: [] };
  const byId = new Map(((proofs ?? []) as ProofRow[]).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Payment verification"
        description="Clients' uploaded transfer receipts. Confirm only after the funds have actually arrived in the Opervia bank account."
      />
      {invoices?.length ? (
        <div className="flex flex-col gap-5">
          {invoices.map((i) => {
            const proof = i.latest_proof_id ? byId.get(i.latest_proof_id) : undefined;
            return (
              <Card key={i.id} className="p-5">
                <div className="grid gap-5 md:grid-cols-[1fr_320px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/clients/${i.org_id}`} className="text-[15px] font-semibold hover:text-brand-bright">
                        {i.client_name}
                      </Link>
                      <InvoiceBadge status={i.status as InvoiceStatus} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-subtle">Invoice</dt>
                        <dd>
                          <Link href={`/admin/invoices/${i.id}`} className="font-mono text-brand-bright hover:underline">
                            {i.invoice_number}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-subtle">Amount expected</dt>
                        <dd className="font-semibold">{formatMoney(i.amount, i.currency)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-subtle">Submitted</dt>
                        <dd>{proof ? formatDateTime(proof.submitted_at, "Asia/Jakarta") : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-subtle">Due date</dt>
                        <dd>{formatDate(i.due_date)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-subtle">Billing period</dt>
                        <dd>
                          <PeriodText start={i.period_start} end={i.period_end} />
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <ConfirmPaymentDialog
                        invoiceId={i.id}
                        invoiceNumber={i.invoice_number}
                        amount={i.amount}
                        currency={i.currency}
                        claimed={proof?.amount_claimed ?? null}
                        hasProof={Boolean(proof)}
                      />
                      <RejectPaymentDialog invoiceId={i.id} invoiceNumber={i.invoice_number} />
                    </div>
                  </div>
                  {proof ? <ProofCard proof={proof} currency={i.currency} expected={i.amount} /> : null}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<ClipboardCheck className="size-5" />} title="No payments waiting" description="When a client uploads a transfer receipt it appears here, and you get a notification." />
        </Card>
      )}
    </>
  );
}
