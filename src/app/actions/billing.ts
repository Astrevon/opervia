"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail, success, type ActionState } from "@/lib/actions";
import { idSchema, safeFileName } from "@/lib/validation";
import { PAYABLE, PROOF_MAX_BYTES, PROOF_TYPES, SUSPENSION_REASONS } from "@/lib/billing";

// Every action below is re-checked by the database function it calls
// (role, ownership, status rules). These checks only give friendlier errors.

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function refreshBilling() {
  revalidatePath("/billing", "layout");
  revalidatePath("/admin", "layout");
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const money = z.coerce.number({ message: "Enter an amount" }).positive("Enter an amount greater than 0").max(999_999_999_999);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

/* ---------------------------------------------------------------------------
 * Client (workspace admin): payment proof upload
 * ------------------------------------------------------------------------- */

const proofUploadSchema = z.object({
  invoiceId: idSchema,
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(PROOF_MAX_BYTES, "Payment proofs must be 10 MB or smaller"),
  type: z.string().refine((t) => PROOF_TYPES.includes(t), "Upload a JPG, PNG or PDF file"),
});

/** Step 1: validate the file and get a one-time signed upload URL in the private bucket. */
export async function prepareProofUploadAction(input: { invoiceId: string; fileName: string; size: number; type: string }) {
  const parsed = proofUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const session = await getSession();
  if (!session?.orgId || session.role !== "admin") return { ok: false as const, error: "Only workspace admins can submit payments." };
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id,org_id,status").eq("id", parsed.data.invoiceId).maybeSingle();
  if (!inv) return { ok: false as const, error: "Invoice not found." };
  if (!PAYABLE.includes(inv.status)) return { ok: false as const, error: "This invoice isn't waiting for a payment." };
  const path = `${inv.org_id}/${inv.id}/${randomUUID()}-${safeFileName(parsed.data.fileName)}`;
  const { data, error } = await supabase.storage.from("payment-proofs").createSignedUploadUrl(path);
  if (error || !data) return { ok: false as const, error: "Upload was refused. Check the file type and try again." };
  return { ok: true as const, path, token: data.token };
}

const submitSchema = z.object({
  path: z.string().min(10).max(500),
  file_name: z.string().trim().min(1, "Upload your payment proof first").max(200),
  amount: money,
  transfer_date: isoDate,
  sender_name: z.string().trim().min(2, "Enter the name on the sending account").max(120),
  sender_bank: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

/** Step 2: after the browser uploaded the file, submit it for verification. */
export async function submitPaymentProofAction(invoiceId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(invoiceId).success) return fail("Invalid invoice.");
  const parsed = submitSchema.safeParse({
    path: text(formData, "path"),
    file_name: text(formData, "file_name"),
    amount: text(formData, "amount").replace(/[^\d.]/g, ""),
    transfer_date: text(formData, "transfer_date"),
    sender_name: text(formData, "sender_name"),
    sender_bank: text(formData, "sender_bank"),
    note: text(formData, "note"),
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return fail(fe.path || fe.file_name ? "Upload your payment proof file first." : "Please fix the highlighted fields.", fe);
  }
  const v = parsed.data;
  try {
    await rpc("submit_payment_proof", {
      p_invoice_id: invoiceId,
      p_storage_path: v.path,
      p_file_name: v.file_name,
      p_amount: v.amount,
      p_transfer_date: v.transfer_date,
      p_sender_name: v.sender_name,
      p_sender_bank: v.sender_bank || null,
      p_note: v.note || null,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Payment submitted. Opervia will verify it once the transfer arrives.");
}

/* ---------------------------------------------------------------------------
 * Opervia billing admins
 * ------------------------------------------------------------------------- */

export async function confirmPaymentAction(invoiceId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(invoiceId).success) return fail("Invalid invoice.");
  const amount = money.safeParse(text(formData, "amount_received").replace(/[^\d.]/g, ""));
  if (!amount.success) return fail(amount.error.issues[0].message, { amount_received: amount.error.issues[0].message });
  if (formData.get("funds_checked") !== "on") {
    return fail("Tick the box to confirm you checked that the funds arrived in the bank account.", { funds_checked: "Required" });
  }
  try {
    await rpc("admin_confirm_payment", { p_invoice_id: invoiceId, p_amount_received: amount.data, p_note: text(formData, "note") || null });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Payment confirmed.");
}

export async function rejectPaymentAction(invoiceId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(invoiceId).success) return fail("Invalid invoice.");
  const reason = text(formData, "reason");
  if (reason.length < 5) return fail("Give the client a reason (at least 5 characters).", { reason: "At least 5 characters" });
  try {
    await rpc("admin_reject_payment", { p_invoice_id: invoiceId, p_reason: reason });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Payment rejected. The client has been notified.");
}

export async function suspendSubscriptionAction(subscriptionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(subscriptionId).success) return fail("Invalid subscription.");
  const reason = text(formData, "reason");
  if (!SUSPENSION_REASONS.some((r) => r.value === reason)) return fail("Choose a suspension reason.", { reason: "Required" });
  try {
    await rpc("admin_suspend_subscription", {
      p_subscription_id: subscriptionId,
      p_reason: reason,
      p_client_message: text(formData, "client_message") || null,
      p_internal_notes: text(formData, "internal_notes") || null,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Subscription suspended.");
}

export async function reactivateSubscriptionAction(subscriptionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(subscriptionId).success) return fail("Invalid subscription.");
  const reason = text(formData, "reason");
  if (reason.length < 5) return fail("Give a reason (at least 5 characters).", { reason: "At least 5 characters" });
  try {
    await rpc("admin_reactivate_subscription", {
      p_subscription_id: subscriptionId,
      p_reason: reason,
      p_internal_notes: text(formData, "internal_notes") || null,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Subscription reactivated.");
}

export async function cancelSubscriptionAction(subscriptionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(subscriptionId).success) return fail("Invalid subscription.");
  const reason = text(formData, "reason");
  if (reason.length < 5) return fail("Give a reason (at least 5 characters).", { reason: "At least 5 characters" });
  try {
    await rpc("admin_cancel_subscription", {
      p_subscription_id: subscriptionId,
      p_reason: reason,
      p_internal_notes: text(formData, "internal_notes") || null,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Subscription cancelled.");
}

export async function updateSubscriptionAction(subscriptionId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(subscriptionId).success) return fail("Invalid subscription.");
  const planId = text(formData, "plan_id");
  const priceRaw = text(formData, "monthly_price").replace(/[^\d.]/g, "");
  const graceRaw = text(formData, "grace_period_days");
  const reason = text(formData, "reason");
  if (planId && !idSchema.safeParse(planId).success) return fail("Choose a plan.", { plan_id: "Choose a plan" });
  const price = priceRaw ? money.safeParse(priceRaw) : null;
  if (price && !price.success) return fail(price.error.issues[0].message, { monthly_price: price.error.issues[0].message });
  const grace = graceRaw ? z.coerce.number().int().min(0).max(60).safeParse(graceRaw) : null;
  if (grace && !grace.success) return fail("Grace period must be 0–60 days.", { grace_period_days: "0–60 days" });
  if (reason.length < 5) return fail("Give a reason for the change (at least 5 characters).", { reason: "At least 5 characters" });
  try {
    await rpc("admin_update_subscription", {
      p_subscription_id: subscriptionId,
      p_plan_id: planId || null,
      p_monthly_price: price?.success ? price.data : null,
      p_grace_days: grace?.success ? grace.data : null,
      p_reason: reason,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Subscription updated. Changes apply to future invoices.");
}

export async function cancelInvoiceAction(invoiceId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(invoiceId).success) return fail("Invalid invoice.");
  const reason = text(formData, "reason");
  if (reason.length < 5) return fail("Give a reason (at least 5 characters).", { reason: "At least 5 characters" });
  try {
    await rpc("admin_cancel_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Invoice cancelled.");
}

export async function createSubscriptionAction(orgId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(orgId).success) return fail("Invalid workspace.");
  const planId = text(formData, "plan_id");
  const start = text(formData, "start_date");
  if (!idSchema.safeParse(planId).success) return fail("Choose a plan.", { plan_id: "Choose a plan" });
  if (start && !isoDate.safeParse(start).success) return fail("Use a valid start date.", { start_date: "Use a valid date" });
  try {
    await rpc("admin_create_subscription", { p_org_id: orgId, p_plan_id: planId, p_start_date: start || null });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Subscription created and first invoice issued.");
}

export async function runBillingNowAction(_: ActionState, __: FormData): Promise<ActionState> {
  void __;
  try {
    const res = (await rpc("admin_run_billing_jobs", {})) as Record<string, number | string | boolean>;
    refreshBilling();
    if (res?.skipped) return success("Another billing check is already running. Try again in a minute.");
    return success(
      `Billing check done: ${res.invoices_generated ?? 0} invoice(s) issued, ${res.invoices_marked_overdue ?? 0} marked overdue, ` +
        `${res.subscriptions_suspended ?? 0} suspended, ${res.reminders_sent ?? 0} reminder(s).`,
    );
  } catch (e) {
    return fail(e);
  }
}

const settingsSchema = z.object({
  bank_name: z.string().trim().max(120),
  account_holder: z.string().trim().max(160),
  account_number: z.string().trim().max(60),
  payment_instructions: z.string().trim().max(2000),
  default_grace_days: z.coerce.number().int().min(0, "0–60").max(60, "0–60"),
  invoice_lead_days: z.coerce.number().int().min(0, "0–28").max(28, "0–28"),
  first_invoice_due_days: z.coerce.number().int().min(0, "0–60").max(60, "0–60"),
  reminder_days_before: z.coerce.number().int().min(0, "0–28").max(28, "0–28"),
});

export async function saveBillingSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(Object.keys(settingsSchema.shape).map((k) => [k, text(formData, k)])));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return fail("Please fix the highlighted fields.", fe);
  }
  const v = parsed.data;
  try {
    await rpc("admin_save_billing_settings", {
      p_bank_name: v.bank_name,
      p_account_holder: v.account_holder,
      p_account_number: v.account_number,
      p_payment_instructions: v.payment_instructions,
      p_default_grace_days: v.default_grace_days,
      p_invoice_lead_days: v.invoice_lead_days,
      p_first_invoice_due_days: v.first_invoice_due_days,
      p_reminder_days_before: v.reminder_days_before,
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success("Bank account and billing rules saved. New invoices will use them.");
}

const planSchema = z.object({
  id: z.string().optional().transform((v) => (v ? v : null)).pipe(idSchema.nullable()),
  name: z.string().trim().min(2, "At least 2 characters").max(120),
  description: z.string().trim().max(1000).optional().default(""),
  monthly_price: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter code, e.g. IDR"),
});

export async function savePlanAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = planSchema.safeParse({
    id: text(formData, "id"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    monthly_price: text(formData, "monthly_price").replace(/[^\d.]/g, ""),
    currency: text(formData, "currency") || "IDR",
  });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return fail("Please fix the highlighted fields.", fe);
  }
  const v = parsed.data;
  try {
    await rpc("admin_save_plan", {
      p_id: v.id,
      p_name: v.name,
      p_description: v.description,
      p_monthly_price: v.monthly_price,
      p_currency: v.currency,
      p_is_active: formData.get("is_active") === "on",
      p_is_default: formData.get("is_default") === "on",
    });
  } catch (e) {
    return fail(e);
  }
  refreshBilling();
  return success(v.id ? "Plan saved." : "Plan created.");
}
