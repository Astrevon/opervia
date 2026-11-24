"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Paperclip, Play } from "lucide-react";
import { ActionDialog } from "@/components/action-dialog";
import { Button, Field, FormMessage, Input, Select, Spinner, Textarea, cx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createClient } from "@/lib/supabase/client";
import { idle } from "@/lib/actions";
import { formatBytes } from "@/lib/format";
import { PROOF_ACCEPT, PROOF_MAX_BYTES, PROOF_TYPES, SUSPENSION_REASONS, formatMoney, jakartaToday, type BankDetails } from "@/lib/billing";
import {
  cancelInvoiceAction,
  cancelSubscriptionAction,
  confirmPaymentAction,
  createSubscriptionAction,
  prepareProofUploadAction,
  reactivateSubscriptionAction,
  rejectPaymentAction,
  runBillingNowAction,
  saveBillingSettingsAction,
  savePlanAction,
  submitPaymentProofAction,
  suspendSubscriptionAction,
  updateSubscriptionAction,
} from "@/app/actions/billing";

/* ---------------------------------------------------------------------------
 * Client: upload payment proof
 * ------------------------------------------------------------------------- */

export function PaymentProofForm({ invoiceId, amount, currency, defaultSender }: { invoiceId: string; amount: number; currency: string; defaultSender: string }) {
  const [state, formAction, pending] = useActionState(submitPaymentProofAction.bind(null, invoiceId), idle);
  const [file, setFile] = useState<{ path: string; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.at && state.ok) {
      toast("success", state.message ?? "Submitted.");
      router.refresh();
    }
  }, [state, toast, router]);

  async function upload(f: File) {
    const type = f.type || "application/octet-stream";
    if (!PROOF_TYPES.includes(type)) return toast("error", "Upload a JPG, PNG or PDF file.");
    if (f.size > PROOF_MAX_BYTES) return toast("error", "Payment proofs must be 10 MB or smaller.");
    setUploading(true);
    try {
      const prep = await prepareProofUploadAction({ invoiceId, fileName: f.name, size: f.size, type });
      if (!prep.ok) throw new Error(prep.error);
      const { error } = await createClient()
        .storage.from("payment-proofs")
        .uploadToSignedUrl(prep.path, prep.token, await f.arrayBuffer(), { contentType: type });
      if (error) throw new Error(error.message);
      setFile({ path: prep.path, name: f.name, size: f.size });
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="path" value={file?.path ?? ""} />
      <input type="hidden" name="file_name" value={file?.name ?? ""} />
      <Field label="Payment proof (transfer receipt or screenshot)" required hint="JPG, PNG or PDF · up to 10 MB. Stored privately — only you and Opervia can see it.">
        <div
          className={cx(
            "flex items-center gap-3 rounded-xl border border-dashed px-4 py-4",
            file ? "border-[#1f5c45] bg-[#0a211a]" : "border-line-strong bg-surface-2/50",
          )}
        >
          {uploading ? (
            <span className="flex items-center gap-2 text-sm text-ink-2">
              <Spinner /> Uploading…
            </span>
          ) : file ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
              <CheckCircle2 className="size-4 shrink-0 text-ok" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-subtle">{formatBytes(file.size)}</span>
            </span>
          ) : (
            <span className="flex-1 text-sm text-muted">No file chosen yet.</span>
          )}
          <Button type="button" variant="secondary" size="sm" disabled={uploading || pending} onClick={() => inputRef.current?.click()}>
            <Paperclip className="size-3.5" /> {file ? "Replace" : "Choose file"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={PROOF_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount transferred" htmlFor="amount" required error={state.fieldErrors?.amount} hint={`Invoice total: ${formatMoney(amount, currency)}`}>
          <Input id="amount" name="amount" inputMode="decimal" required defaultValue={String(amount)} />
        </Field>
        <Field label="Transfer date" htmlFor="transfer_date" required error={state.fieldErrors?.transfer_date}>
          <Input id="transfer_date" name="transfer_date" type="date" required defaultValue={jakartaToday()} max={jakartaToday()} />
        </Field>
        <Field label="Name on the sending account" htmlFor="sender_name" required error={state.fieldErrors?.sender_name}>
          <Input id="sender_name" name="sender_name" required minLength={2} maxLength={120} defaultValue={defaultSender} />
        </Field>
        <Field label="Sending bank" htmlFor="sender_bank" hint="Optional, e.g. BCA, Mandiri">
          <Input id="sender_bank" name="sender_bank" maxLength={120} />
        </Field>
      </div>
      <Field label="Note for Opervia" htmlFor="note" hint="Optional">
        <Textarea id="note" name="note" maxLength={1000} rows={2} />
      </Field>
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">Uploading a proof doesn&apos;t mark the invoice as paid. Opervia confirms once the funds arrive.</p>
        <Button type="submit" disabled={!file || uploading || pending}>
          {pending ? <Spinner /> : <FileUp className="size-4" />}
          Submit for verification
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------
 * Admin: payment verification
 * ------------------------------------------------------------------------- */

export function ConfirmPaymentDialog({ invoiceId, invoiceNumber, amount, currency, claimed, hasProof, size = "md" }: {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  claimed: number | null;
  hasProof: boolean;
  size?: "sm" | "md";
}) {
  return (
    <ActionDialog
      action={confirmPaymentAction.bind(null, invoiceId)}
      trigger={<>Confirm payment</>}
      triggerVariant="success"
      triggerSize={size}
      title={`Confirm payment for ${invoiceNumber}`}
      description="Only confirm after you've checked the bank account and the funds have actually arrived. An uploaded screenshot is not proof of receipt."
      confirmLabel="Confirm funds received"
      confirmVariant="success"
    >
      <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
        Invoice total <b className="text-ink">{formatMoney(amount, currency)}</b>
        {claimed !== null ? (
          <>
            {" "}· client says they sent <b className="text-ink">{formatMoney(claimed, currency)}</b>
          </>
        ) : null}
      </div>
      <Field label="Amount received in the bank account" htmlFor="amount_received" required>
        <Input id="amount_received" name="amount_received" inputMode="decimal" required defaultValue={String(amount)} />
      </Field>
      <Field label={hasProof ? "Note (optional)" : "How did you confirm the funds arrived?"} htmlFor="note" required={!hasProof}>
        <Textarea id="note" name="note" rows={2} maxLength={1000} required={!hasProof} minLength={hasProof ? undefined : 5} placeholder="e.g. Seen on BCA statement, 24 Nov" />
      </Field>
      <label className="flex items-start gap-2.5 text-sm text-ink-2">
        <input type="checkbox" name="funds_checked" required className="mt-0.5 size-4 accent-emerald-500" />I checked the bank account and the funds have arrived.
      </label>
    </ActionDialog>
  );
}

export function RejectPaymentDialog({ invoiceId, invoiceNumber, size = "md" }: { invoiceId: string; invoiceNumber: string; size?: "sm" | "md" }) {
  return (
    <ActionDialog
      action={rejectPaymentAction.bind(null, invoiceId)}
      trigger={<>Reject</>}
      triggerVariant="danger"
      triggerSize={size}
      title={`Reject payment for ${invoiceNumber}`}
      description="The client sees your reason and can upload a new proof. The rejected proof is kept in the history."
      confirmLabel="Reject payment"
      confirmVariant="danger"
      comment={{ name: "reason", label: "Reason (shown to the client)", required: true, minLength: 5, placeholder: "e.g. We haven't received the funds yet / the amount is Rp 100.000 short" }}
    />
  );
}

export function CancelInvoiceDialog({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  return (
    <ActionDialog
      action={cancelInvoiceAction.bind(null, invoiceId)}
      trigger={<>Cancel invoice</>}
      triggerVariant="ghost"
      title={`Cancel ${invoiceNumber}?`}
      description="The invoice stays in the history as cancelled and no longer needs payment. This can't be undone."
      confirmLabel="Cancel invoice"
      confirmVariant="danger"
      comment={{ name: "reason", label: "Reason", required: true, minLength: 5 }}
    />
  );
}

/* ---------------------------------------------------------------------------
 * Admin: subscription management
 * ------------------------------------------------------------------------- */

export function SuspendDialog({ subscriptionId, clientName }: { subscriptionId: string; clientName: string }) {
  return (
    <ActionDialog
      action={suspendSubscriptionAction.bind(null, subscriptionId)}
      trigger={<>Suspend</>}
      triggerVariant="danger"
      title={`Suspend ${clientName}?`}
      description="Paid services stop immediately for everyone in this workspace. Their data, settings and history are kept. Only an admin can lift a manual suspension."
      confirmLabel="Suspend subscription"
      confirmVariant="danger"
    >
      <Field label="Reason" htmlFor="reason" required>
        <Select id="reason" name="reason" required defaultValue="">
          <option value="" disabled>
            Choose a reason…
          </option>
          {SUSPENSION_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message to the client" htmlFor="client_message" hint="Optional. Shown on their billing page.">
        <Textarea id="client_message" name="client_message" rows={2} maxLength={1000} />
      </Field>
      <Field label="Internal notes" htmlFor="internal_notes" hint="Optional. Only Opervia admins can see these (audit trail).">
        <Textarea id="internal_notes" name="internal_notes" rows={2} maxLength={2000} />
      </Field>
    </ActionDialog>
  );
}

export function ReactivateDialog({ subscriptionId, clientName, cancelled }: { subscriptionId: string; clientName: string; cancelled: boolean }) {
  return (
    <ActionDialog
      action={reactivateSubscriptionAction.bind(null, subscriptionId)}
      trigger={<>Reactivate</>}
      triggerVariant="success"
      title={`Reactivate ${clientName}?`}
      description={
        cancelled
          ? "Billing restarts today: a new first invoice is issued and service access is restored."
          : "Service access is restored now. Any unpaid invoice still follows the normal due-date and grace-period rules."
      }
      confirmLabel="Reactivate"
      confirmVariant="success"
    >
      <Field label="Reason (shown to the client)" htmlFor="reason" required>
        <Textarea id="reason" name="reason" rows={2} required minLength={5} maxLength={1000} />
      </Field>
      <Field label="Internal notes" htmlFor="internal_notes" hint="Optional. Only Opervia admins can see these.">
        <Textarea id="internal_notes" name="internal_notes" rows={2} maxLength={2000} />
      </Field>
    </ActionDialog>
  );
}

export function CancelSubscriptionDialog({ subscriptionId, clientName }: { subscriptionId: string; clientName: string }) {
  return (
    <ActionDialog
      action={cancelSubscriptionAction.bind(null, subscriptionId)}
      trigger={<>Cancel subscription</>}
      triggerVariant="ghost"
      title={`Cancel ${clientName}'s subscription?`}
      description="Paid services stop, open invoices are cancelled and no new invoices are issued. Data and history are kept. You can reactivate later."
      confirmLabel="Cancel subscription"
      confirmVariant="danger"
    >
      <Field label="Reason (shown to the client)" htmlFor="reason" required>
        <Textarea id="reason" name="reason" rows={2} required minLength={5} maxLength={1000} />
      </Field>
      <Field label="Internal notes" htmlFor="internal_notes" hint="Optional. Only Opervia admins can see these.">
        <Textarea id="internal_notes" name="internal_notes" rows={2} maxLength={2000} />
      </Field>
    </ActionDialog>
  );
}

type PlanOption = { id: string; name: string; monthly_price: number; currency: string; is_active: boolean };

export function EditSubscriptionDialog({ subscriptionId, planId, price, currency, graceDays, plans }: {
  subscriptionId: string;
  planId: string | null;
  price: number;
  currency: string;
  graceDays: number;
  plans: PlanOption[];
}) {
  return (
    <ActionDialog
      action={updateSubscriptionAction.bind(null, subscriptionId)}
      trigger={<>Change plan / price</>}
      triggerVariant="secondary"
      title="Change plan, price or grace period"
      description="Changes apply to invoices issued from now on. Existing invoices keep their amount. Every change is recorded in the history."
      confirmLabel="Save changes"
    >
      <Field label="Plan" htmlFor="plan_id">
        <Select id="plan_id" name="plan_id" defaultValue={planId ?? ""}>
          <option value="">Keep current plan</option>
          {plans
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatMoney(p.monthly_price, p.currency)}/month
              </option>
            ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Monthly price (${currency})`} htmlFor="monthly_price" hint="Leave empty to use the plan's price">
          <Input id="monthly_price" name="monthly_price" inputMode="decimal" defaultValue={String(price)} />
        </Field>
        <Field label="Grace period (days)" htmlFor="grace_period_days">
          <Input id="grace_period_days" name="grace_period_days" type="number" min={0} max={60} defaultValue={graceDays} />
        </Field>
      </div>
      <Field label="Reason for the change" htmlFor="reason" required>
        <Textarea id="reason" name="reason" rows={2} required minLength={5} maxLength={1000} />
      </Field>
    </ActionDialog>
  );
}

export function CreateSubscriptionDialog({ orgId, plans }: { orgId: string; plans: PlanOption[] }) {
  const active = plans.filter((p) => p.is_active);
  return (
    <ActionDialog
      action={createSubscriptionAction.bind(null, orgId)}
      trigger={<>Start subscription</>}
      triggerVariant="primary"
      triggerSize="sm"
      title="Start a subscription"
      description="Creates the subscription and issues the first invoice immediately."
      confirmLabel="Start subscription"
    >
      <Field label="Plan" htmlFor="plan_id" required>
        <Select id="plan_id" name="plan_id" required defaultValue={active[0]?.id ?? ""}>
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatMoney(p.monthly_price, p.currency)}/month
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Start date" htmlFor="start_date" hint="Leave empty to start today (Asia/Jakarta).">
        <Input id="start_date" name="start_date" type="date" />
      </Field>
    </ActionDialog>
  );
}

export function RunBillingButton() {
  return (
    <ActionDialog
      action={runBillingNowAction}
      trigger={
        <>
          <Play className="size-3.5" /> Run daily check now
        </>
      }
      triggerVariant="secondary"
      triggerSize="sm"
      title="Run the daily billing check now?"
      description="Issues due renewal invoices, marks overdue invoices, suspends subscriptions whose grace period has ended and sends reminders. It runs automatically every night at 00:05 WIB, and running it twice never creates duplicates."
      confirmLabel="Run now"
    />
  );
}

/* ---------------------------------------------------------------------------
 * Admin: settings
 * ------------------------------------------------------------------------- */

export function BillingSettingsForm({ settings }: { settings: BankDetails & { default_grace_days: number; invoice_lead_days: number; first_invoice_due_days: number; reminder_days_before: number } }) {
  const [state, action, pending] = useActionState(saveBillingSettingsAction, idle);
  const toast = useToast();
  useEffect(() => {
    if (state.at && state.ok) toast("success", state.message ?? "Saved.");
  }, [state, toast]);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank name" htmlFor="bank_name" error={fe.bank_name}>
          <Input id="bank_name" name="bank_name" maxLength={120} defaultValue={settings.bank_name} placeholder="e.g. BCA" />
        </Field>
        <Field label="Account holder name" htmlFor="account_holder" error={fe.account_holder}>
          <Input id="account_holder" name="account_holder" maxLength={160} defaultValue={settings.account_holder} placeholder="e.g. PT Opervia ..." />
        </Field>
      </div>
      <Field label="Bank account number" htmlFor="account_number" error={fe.account_number}>
        <Input id="account_number" name="account_number" maxLength={60} defaultValue={settings.account_number} className="font-mono" />
      </Field>
      <Field label="Payment instructions" htmlFor="payment_instructions" hint="Shown to clients on every invoice." error={fe.payment_instructions}>
        <Textarea
          id="payment_instructions"
          name="payment_instructions"
          rows={3}
          maxLength={2000}
          defaultValue={settings.payment_instructions}
          placeholder="Please use the invoice number as the transfer reference, then upload your transfer receipt."
        />
      </Field>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Field label="Grace period (days)" htmlFor="default_grace_days" hint="For new subscriptions" error={fe.default_grace_days}>
          <Input id="default_grace_days" name="default_grace_days" type="number" min={0} max={60} required defaultValue={settings.default_grace_days} />
        </Field>
        <Field label="Issue renewal invoice" htmlFor="invoice_lead_days" hint="Days before the period" error={fe.invoice_lead_days}>
          <Input id="invoice_lead_days" name="invoice_lead_days" type="number" min={0} max={28} required defaultValue={settings.invoice_lead_days} />
        </Field>
        <Field label="First invoice due in" htmlFor="first_invoice_due_days" hint="Days after sign-up" error={fe.first_invoice_due_days}>
          <Input id="first_invoice_due_days" name="first_invoice_due_days" type="number" min={0} max={60} required defaultValue={settings.first_invoice_due_days} />
        </Field>
        <Field label="Reminder" htmlFor="reminder_days_before" hint="Days before due" error={fe.reminder_days_before}>
          <Input id="reminder_days_before" name="reminder_days_before" type="number" min={0} max={28} required defaultValue={settings.reminder_days_before} />
        </Field>
      </div>
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save bank & billing settings
        </Button>
      </div>
    </form>
  );
}

export function PlanForm({ plan }: { plan?: PlanOption & { description: string | null; is_default: boolean } }) {
  const [state, action, pending] = useActionState(savePlanAction, idle);
  const toast = useToast();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.at && state.ok) {
      toast("success", state.message ?? "Saved.");
      if (!plan) formRef.current?.reset();
      router.refresh();
    }
  }, [state, toast, plan, router]);
  const fe = state.fieldErrors ?? {};
  const uid = plan?.id ?? "new";
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={plan?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_90px]">
        <Field label="Plan name" htmlFor={`name-${uid}`} error={fe.name}>
          <Input id={`name-${uid}`} name="name" required minLength={2} maxLength={120} defaultValue={plan?.name} placeholder="e.g. Standard" />
        </Field>
        <Field label="Monthly price" htmlFor={`price-${uid}`} error={fe.monthly_price}>
          <Input id={`price-${uid}`} name="monthly_price" inputMode="decimal" required defaultValue={plan ? String(plan.monthly_price) : ""} placeholder="500000" />
        </Field>
        <Field label="Currency" htmlFor={`cur-${uid}`} error={fe.currency}>
          <Input id={`cur-${uid}`} name="currency" maxLength={3} required defaultValue={plan?.currency ?? "IDR"} className="uppercase" />
        </Field>
      </div>
      <Field label="Description" htmlFor={`desc-${uid}`}>
        <Input id={`desc-${uid}`} name="description" maxLength={1000} defaultValue={plan?.description ?? ""} />
      </Field>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="is_active" defaultChecked={plan ? plan.is_active : true} className="size-4 accent-blue-500" /> Active
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="is_default" defaultChecked={plan?.is_default ?? false} className="size-4 accent-blue-500" /> Default for new workspaces
        </label>
        <div className="flex-1" />
        <Button type="submit" size="sm" variant={plan ? "secondary" : "primary"} disabled={pending}>
          {pending ? <Spinner /> : null}
          {plan ? "Save plan" : "Add plan"}
        </Button>
      </div>
      <FormMessage error={state.ok ? undefined : state.error} />
    </form>
  );
}
