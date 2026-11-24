import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { AUDIT_ACTION_LABEL, type AuditRow } from "@/lib/billing";
import { formatDateTime } from "@/lib/format";

function describe(v: Record<string, unknown> | null) {
  if (!v) return "—";
  return Object.entries(v)
    .filter(([, x]) => x !== null && x !== undefined && x !== "")
    .map(([k, x]) => `${k.replaceAll("_", " ")}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`)
    .join(" · ");
}

/** Administrative audit trail (Opervia billing admins only). */
export function AuditList({ rows, showClient = false }: { rows: AuditRow[]; showClient?: boolean }) {
  if (!rows.length) return <EmptyState icon={<ScrollText className="size-5" />} title="No admin actions yet" />;
  return (
    <ol className="divide-y divide-line/60">
      {rows.map((a) => (
        <li key={a.id} className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-x-2 text-[13.5px]">
            <span className="font-medium text-ink">{AUDIT_ACTION_LABEL[a.action_type] ?? a.action_type}</span>
            {showClient && a.client_name ? <span className="text-xs text-muted">· {a.client_name}</span> : null}
          </div>
          <div className="mt-1 grid gap-0.5 text-xs text-muted">
            <div>
              <span className="text-subtle">Before:</span> {describe(a.previous_value)}
            </div>
            <div>
              <span className="text-subtle">After:</span> {describe(a.new_value)}
            </div>
          </div>
          {a.reason ? <div className="mt-1 text-[13px] text-ink-2">Reason: {a.reason}</div> : null}
          {a.internal_notes ? <div className="mt-1 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-[#fcd34d]">Internal: {a.internal_notes}</div> : null}
          <div className="mt-1 text-[11.5px] text-subtle">
            {formatDateTime(a.created_at, "Asia/Jakarta")} · {a.admin_email || "system"} · event {a.id.slice(0, 8)}
          </div>
        </li>
      ))}
    </ol>
  );
}
