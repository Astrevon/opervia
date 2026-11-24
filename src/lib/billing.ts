// Billing constants and formatting. Safe to import from client and server code.
import type { Tone } from "@/lib/constants";

export type SubscriptionStatus = "active" | "pending_payment" | "overdue" | "suspended" | "cancelled";
export type InvoiceStatus = "unpaid" | "pending_verification" | "paid" | "rejected" | "overdue" | "cancelled";
export type ProofStatus = "pending" | "accepted" | "rejected";
export type SuspensionReason = "payment_overdue" | "client_requested" | "administrative_review" | "contract_issue" | "other";

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone; hint: string }> = {
  active: { label: "Active", tone: "emerald", hint: "Paid and in good standing." },
  pending_payment: { label: "Pending payment", tone: "amber", hint: "An invoice is waiting for payment." },
  overdue: { label: "Overdue", tone: "rose", hint: "An invoice is past its due date. Access continues during the grace period." },
  suspended: { label: "Suspended", tone: "red", hint: "Paid services are blocked until the issue is resolved." },
  cancelled: { label: "Cancelled", tone: "slate", hint: "The subscription has ended." },
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  unpaid: { label: "Unpaid", tone: "amber" },
  pending_verification: { label: "Pending verification", tone: "blue" },
  paid: { label: "Paid", tone: "emerald" },
  rejected: { label: "Rejected", tone: "red" },
  overdue: { label: "Overdue", tone: "rose" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export const PROOF_STATUS: Record<ProofStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for verification", tone: "blue" },
  accepted: { label: "Accepted", tone: "emerald" },
  rejected: { label: "Rejected", tone: "red" },
};

export const SUSPENSION_REASONS: { value: SuspensionReason; label: string }[] = [
  { value: "payment_overdue", label: "Payment overdue" },
  { value: "client_requested", label: "Client requested" },
  { value: "administrative_review", label: "Administrative review" },
  { value: "contract_issue", label: "Contract issue" },
  { value: "other", label: "Other" },
];
export const suspensionLabel = (r: string | null | undefined) => SUSPENSION_REASONS.find((x) => x.value === r)?.label ?? r ?? "—";

/** Invoice statuses that still need money. */
export const OUTSTANDING: InvoiceStatus[] = ["unpaid", "pending_verification", "rejected", "overdue"];
/** Invoice statuses the client can (re)submit a payment proof for. */
export const PAYABLE: InvoiceStatus[] = ["unpaid", "rejected", "overdue"];

export const BILLING_EVENT_LABEL: Record<string, string> = {
  invoice_generated: "Invoice generated",
  payment_reminder: "Payment reminder sent",
  proof_uploaded: "Payment proof uploaded",
  payment_submitted: "Payment submitted for verification",
  payment_confirmed: "Payment confirmed",
  payment_rejected: "Payment rejected",
  invoice_overdue: "Invoice overdue",
  invoice_cancelled: "Invoice cancelled",
  subscription_created: "Subscription created",
  plan_changed: "Plan changed",
  price_changed: "Price changed",
  grace_period_changed: "Grace period changed",
  period_extended: "Billing period updated",
  subscription_activated: "Subscription active",
  subscription_pending_payment: "Payment pending",
  subscription_overdue: "Subscription overdue",
  subscription_suspended: "Subscription suspended",
  subscription_reactivated: "Subscription reactivated",
  subscription_cancelled: "Subscription cancelled",
};

export const BILLING_EVENT_TONE: Record<string, Tone> = {
  invoice_generated: "slate",
  payment_reminder: "slate",
  proof_uploaded: "blue",
  payment_submitted: "blue",
  payment_confirmed: "emerald",
  payment_rejected: "red",
  invoice_overdue: "rose",
  invoice_cancelled: "slate",
  subscription_created: "blue",
  plan_changed: "blue",
  price_changed: "blue",
  grace_period_changed: "blue",
  period_extended: "emerald",
  subscription_activated: "emerald",
  subscription_pending_payment: "amber",
  subscription_overdue: "rose",
  subscription_suspended: "red",
  subscription_reactivated: "emerald",
  subscription_cancelled: "slate",
};

export const PAYMENT_EVENTS = Object.keys(BILLING_EVENT_LABEL).filter((k) => !k.startsWith("subscription_") && !["plan_changed", "price_changed", "grace_period_changed", "period_extended"].includes(k));
export const SUBSCRIPTION_EVENTS = Object.keys(BILLING_EVENT_LABEL).filter((k) => !PAYMENT_EVENTS.includes(k));

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  payment_confirmed: "Confirmed payment",
  payment_rejected: "Rejected payment",
  subscription_suspended: "Suspended subscription",
  subscription_reactivated: "Reactivated subscription",
  subscription_cancelled: "Cancelled subscription",
  subscription_updated: "Changed subscription",
  subscription_created: "Created subscription",
  invoice_cancelled: "Cancelled invoice",
  billing_settings_updated: "Updated bank & billing settings",
  plan_saved: "Saved plan",
  billing_run: "Ran daily billing check",
};

export function formatMoney(amount: number | string | null | undefined, currency = "IDR") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "IDR" ? 0 : 2,
      minimumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US")}`;
  }
}

/** Today's date (YYYY-MM-DD) on the Asia/Jakarta calendar, which billing uses. */
export function jakartaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Whole days from today (Jakarta) to a YYYY-MM-DD date; negative when in the past. */
export function daysFromToday(date: string | null | undefined) {
  if (!date) return null;
  const a = Date.parse(`${jakartaToday()}T00:00:00Z`);
  const b = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"];
export const PROOF_ACCEPT = ".jpg,.jpeg,.png,.pdf";

/* Row shapes returned by the API --------------------------------------------- */

export type SubscriptionRow = {
  id: string;
  org_id: string;
  plan_id: string | null;
  plan_name: string;
  monthly_price: number;
  currency: string;
  status: SubscriptionStatus;
  billing_cycle: string;
  start_date: string;
  current_period_start: string;
  current_period_end: string;
  next_payment_due_date: string | null;
  grace_period_days: number;
  suspended_at: string | null;
  suspension_reason: SuspensionReason | null;
  suspension_message: string | null;
  last_reactivated_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type InvoiceRow = {
  id: string;
  invoice_number: string;
  org_id: string;
  subscription_id: string;
  client_name: string;
  client_email: string | null;
  plan_name: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  payment_instructions: { bank_name?: string; account_holder?: string; account_number?: string; payment_instructions?: string };
  latest_proof_id: string | null;
  amount_paid: number | null;
  paid_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};

export type ProofRow = {
  id: string;
  org_id: string;
  invoice_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  amount_claimed: number;
  transfer_date: string;
  sender_name: string;
  sender_bank: string | null;
  note: string | null;
  submitted_by: string | null;
  submitted_at: string;
  status: ProofStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
};

export type BillingEventRow = {
  id: string;
  org_id: string;
  subscription_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  client_name: string;
  category: "payment" | "subscription";
  event_type: string;
  actor_name: string;
  actor_kind: "client" | "admin" | "system";
  amount: number | null;
  currency: string | null;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type AuditRow = {
  id: string;
  org_id: string | null;
  client_name: string;
  admin_email: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  internal_notes: string | null;
  created_at: string;
};

export type BankDetails = { bank_name: string; account_holder: string; account_number: string; payment_instructions: string };

export const SUBSCRIPTION_COLUMNS =
  "id,org_id,plan_id,plan_name,monthly_price,currency,status,billing_cycle,start_date,current_period_start,current_period_end,next_payment_due_date,grace_period_days,suspended_at,suspension_reason,suspension_message,last_reactivated_at,cancelled_at,created_at";
export const INVOICE_COLUMNS =
  "id,invoice_number,org_id,subscription_id,client_name,client_email,plan_name,period_start,period_end,amount,currency,status,issue_date,due_date,payment_instructions,latest_proof_id,amount_paid,paid_at,verified_by,verified_at,rejection_reason,cancelled_at,cancel_reason,created_at";
export const PROOF_COLUMNS =
  "id,org_id,invoice_id,file_name,mime_type,size_bytes,amount_claimed,transfer_date,sender_name,sender_bank,note,submitted_by,submitted_at,status,reviewed_by,reviewed_at,review_reason";
export const EVENT_COLUMNS =
  "id,org_id,subscription_id,invoice_id,invoice_number,client_name,category,event_type,actor_name,actor_kind,amount,currency,from_value,to_value,reason,details,created_at";
