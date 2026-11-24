import Link from "next/link";
import type { ReactNode } from "react";
import { Banknote, CircleAlert, CircleCheck, Clock, FileText, History, Landmark, Receipt, ShieldOff, UploadCloud } from "lucide-react";
import { Badge, cx, EmptyState } from "@/components/ui";
import {
  BILLING_EVENT_LABEL,
  BILLING_EVENT_TONE,
  INVOICE_STATUS,
  PROOF_STATUS,
  SUBSCRIPTION_STATUS,
  formatMoney,
  type BankDetails,
  type BillingEventRow,
  type InvoiceStatus,
  type ProofStatus,
  type SubscriptionStatus,
} from "@/lib/billing";
import { formatDate, formatDateTime } from "@/lib/format";

export function SubscriptionBadge({ status, className }: { status: SubscriptionStatus | null | undefined; className?: string }) {
  if (!status) return <Badge className={className}>No subscription</Badge>;
  const m = SUBSCRIPTION_STATUS[status];
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

export function InvoiceBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const m = INVOICE_STATUS[status];
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

export function ProofBadge({ status }: { status: ProofStatus }) {
  const m = PROOF_STATUS[status];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

/** Simple label/value grid. */
export function Facts({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-subtle">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatTile({ label, value, href, tone = "text-ink-2", icon: Icon }: { label: string; value: ReactNode; href?: string; tone?: string; icon: typeof Receipt }) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        <Icon className={cx("size-4", tone)} />
      </div>
      <div className="mt-3 truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
    </>
  );
  const cls = "block rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-all sm:p-5";
  return href ? (
    <Link href={href} className={cx(cls, "hover:-translate-y-0.5 hover:border-line-strong")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function BankDetailsBox({ bank, amount, currency, invoiceNumber }: { bank: Partial<BankDetails> | null; amount: number; currency: string; invoiceNumber: string }) {
  const configured = Boolean(bank?.bank_name && bank?.account_number);
  return (
    <div className="rounded-xl border border-[#1e3a70] bg-[#0b1730] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Landmark className="size-4 text-[#8fb8ff]" /> Bank transfer details
      </div>
      {configured ? (
        <Facts
          items={[
            ["Bank", bank!.bank_name],
            ["Account holder", bank!.account_holder || "—"],
            ["Account number", <span key="n" className="font-mono text-[15px] tracking-wide">{bank!.account_number}</span>],
            ["Amount to transfer", <span key="a" className="font-semibold">{formatMoney(amount, currency)}</span>],
            ["Transfer reference", <span key="r" className="font-mono">{invoiceNumber}</span>],
          ]}
        />
      ) : (
        <p className="text-sm text-ink-2">Opervia hasn&apos;t published its bank details yet. Please contact Opervia before transferring.</p>
      )}
      {bank?.payment_instructions ? <p className="mt-3 whitespace-pre-line border-t border-[#1e3a70] pt-3 text-[13px] text-ink-2">{bank.payment_instructions}</p> : null}
    </div>
  );
}

const EVENT_ICON: Record<string, typeof Receipt> = {
  invoice_generated: Receipt,
  payment_reminder: Clock,
  proof_uploaded: UploadCloud,
  payment_submitted: UploadCloud,
  payment_confirmed: CircleCheck,
  payment_rejected: CircleAlert,
  invoice_overdue: CircleAlert,
  invoice_cancelled: FileText,
  subscription_suspended: ShieldOff,
  subscription_reactivated: CircleCheck,
  subscription_activated: CircleCheck,
  price_changed: Banknote,
};

/**
 * Chronological billing history. `invoiceHref` builds links to invoices;
 * `showClient` adds the workspace name (admin views).
 */
export function BillingTimeline({
  events,
  invoiceHref,
  clientHref,
  showClient = false,
  emptyText = "No billing events yet.",
}: {
  events: BillingEventRow[];
  invoiceHref?: (id: string) => string;
  clientHref?: (orgId: string) => string;
  showClient?: boolean;
  emptyText?: string;
}) {
  if (!events.length) return <EmptyState icon={<History className="size-5" />} title="Nothing here yet" description={emptyText} />;
  return (
    <ol className="relative">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.event_type] ?? History;
        const tone = BILLING_EVENT_TONE[e.event_type] ?? "slate";
        const ring: Record<string, string> = {
          slate: "text-ink-2",
          blue: "text-[#8fb8ff]",
          emerald: "text-[#6ee7b7]",
          amber: "text-[#fcd34d]",
          rose: "text-[#fda4af]",
          red: "text-[#fca5a5]",
        };
        return (
          <li key={e.id} className="flex gap-3 border-b border-line/60 px-5 py-3.5 last:border-b-0">
            <span className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3", ring[tone])}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13.5px] font-medium text-ink">{BILLING_EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                {e.invoice_number && e.invoice_id ? (
                  invoiceHref ? (
                    <Link href={invoiceHref(e.invoice_id)} className="font-mono text-xs text-brand-bright hover:underline">
                      {e.invoice_number}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-muted">{e.invoice_number}</span>
                  )
                ) : null}
                {e.amount !== null ? <span className="text-xs font-medium text-ink-2">{formatMoney(e.amount, e.currency ?? "IDR")}</span> : null}
                {showClient ? (
                  clientHref ? (
                    <Link href={clientHref(e.org_id)} className="text-xs text-muted hover:text-ink">
                      · {e.client_name}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted">· {e.client_name}</span>
                  )
                ) : null}
              </div>
              {e.from_value || e.to_value ? (
                <div className="mt-0.5 text-xs text-subtle">
                  {e.from_value ? <>{e.from_value.replaceAll("_", " ")} → </> : null}
                  {e.to_value?.replaceAll("_", " ")}
                </div>
              ) : null}
              {e.reason ? <div className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{e.reason}</div> : null}
              <div className="mt-1 text-[11.5px] text-subtle">
                {formatDateTime(e.created_at, "Asia/Jakarta")} · {e.actor_kind === "system" ? "Automatic" : e.actor_name || (e.actor_kind === "admin" ? "Opervia" : "Client")}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PeriodText({ start, end }: { start: string; end: string }) {
  return (
    <span>
      {formatDate(start)} – {formatDate(end)}
    </span>
  );
}
