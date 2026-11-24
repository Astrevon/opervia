import { Download, ExternalLink, FileText } from "lucide-react";
import { ProofBadge } from "@/components/billing-ui";
import { cx } from "@/components/ui";
import { formatMoney, type ProofRow } from "@/lib/billing";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";

/** A submitted payment proof with an inline preview (images) served through a short-lived signed URL. */
export function ProofCard({ proof: p, currency, expected }: { proof: ProofRow; currency: string; expected: number }) {
  const url = `/api/billing/proofs/${p.id}`;
  const mismatch = Number(p.amount_claimed) < Number(expected);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
      {p.mime_type.startsWith("image/") ? (
        <a href={url} target="_blank" rel="noreferrer" className="block bg-black/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Payment proof ${p.file_name}`} className="max-h-80 w-full object-contain" loading="lazy" />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3 bg-black/20 px-4 py-6 text-sm text-brand-bright hover:underline">
          <FileText className="size-6" /> Open PDF
        </a>
      )}
      <div className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium">{p.file_name}</span>
          <ProofBadge status={p.status} />
        </div>
        <div className={cx("text-sm", mismatch ? "text-[#fca5a5]" : "text-ink-2")}>
          Claimed {formatMoney(p.amount_claimed, currency)}
          {mismatch ? ` — less than the invoice (${formatMoney(expected, currency)})` : ""}
        </div>
        <div className="text-xs text-muted">
          Transferred {formatDate(p.transfer_date)} by {p.sender_name}
          {p.sender_bank ? ` · ${p.sender_bank}` : ""} · {formatBytes(p.size_bytes)}
        </div>
        {p.note ? <div className="text-[13px] text-ink-2">“{p.note}”</div> : null}
        <div className="text-[11.5px] text-subtle">Submitted {formatDateTime(p.submitted_at, "Asia/Jakarta")}</div>
        {p.reviewed_at ? (
          <div className="text-[11.5px] text-subtle">
            Reviewed {formatDateTime(p.reviewed_at, "Asia/Jakarta")}
            {p.review_reason ? ` — ${p.review_reason}` : ""}
          </div>
        ) : null}
        <div className="flex gap-3 pt-1 text-xs">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-bright hover:underline">
            <ExternalLink className="size-3" /> Open
          </a>
          <a href={`${url}?download`} className="inline-flex items-center gap-1 text-brand-bright hover:underline">
            <Download className="size-3" /> Download
          </a>
        </div>
      </div>
    </div>
  );
}
