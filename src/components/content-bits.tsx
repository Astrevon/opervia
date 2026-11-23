import Link from "next/link";
import { CalendarClock, CheckCircle2, CornerUpLeft, FilePlus2, Pencil, RotateCcw, Send, XCircle, CalendarX2, Undo2 } from "lucide-react";
import { Avatar, cx, StatusBadge } from "@/components/ui";
import { CONTENT_TYPES, EVENT_LABEL, PLATFORMS, ROLES, label, type Role, type Status } from "@/lib/constants";
import { daysUntil, formatDate, formatDateTime, relativeTime } from "@/lib/format";
import type { EventRow } from "@/lib/data";

export const EVENT_ICON: Record<string, typeof Send> = {
  created: FilePlus2,
  submitted: Send,
  resubmitted: RotateCcw,
  approved: CheckCircle2,
  revision_requested: CornerUpLeft,
  rejected: XCircle,
  scheduled: CalendarClock,
  unscheduled: CalendarX2,
  reopened: Undo2,
  updated: Pencil,
};

const EVENT_TONE: Record<string, string> = {
  approved: "text-[#6ee7b7] bg-[#34d39914] ring-[#34d39933]",
  revision_requested: "text-[#fda4af] bg-[#fb718514] ring-[#fb718533]",
  rejected: "text-[#fca5a5] bg-[#f8717114] ring-[#f8717133]",
  scheduled: "text-[#8fb8ff] bg-[#2878f01a] ring-[#2878f040]",
  submitted: "text-[#fcd34d] bg-[#fbbf2414] ring-[#fbbf2433]",
  resubmitted: "text-[#fcd34d] bg-[#fbbf2414] ring-[#fbbf2433]",
};

export function PlatformLabel({ platform, type }: { platform: string; type: string }) {
  return (
    <span className="text-muted">
      {label(PLATFORMS, platform)} · {label(CONTENT_TYPES, type)}
    </span>
  );
}

export function DueLabel({ date, status }: { date: string | null; status: Status }) {
  if (!date) return <span className="text-subtle">No due date</span>;
  const d = daysUntil(date);
  const active = status === "pending_approval";
  const overdue = active && d !== null && d < 0;
  const soon = active && d !== null && d >= 0 && d <= 1;
  return (
    <span className={cx(overdue ? "text-danger" : soon ? "text-warn" : "text-ink-2")}>
      {formatDate(date)}
      {active && d !== null ? (
        <span className="ml-1.5 text-xs text-subtle">{d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`}</span>
      ) : null}
    </span>
  );
}

/** Readable, auditable approval history (actor, action, time, status change, comment). */
export function HistoryTimeline({ events, timeZone, audience = "agency" }: { events: EventRow[]; timeZone?: string; audience?: "agency" | "client" }) {
  if (events.length === 0) return <p className="px-5 py-6 text-sm text-muted">No history yet.</p>;
  return (
    <ol className="relative px-5 py-5">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.action] ?? Pencil;
        const meta = e.metadata ?? {};
        return (
          <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
            {i < events.length - 1 ? <span className="absolute left-[15px] top-9 h-[calc(100%-28px)] w-px bg-line" aria-hidden /> : null}
            <span className={cx("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", EVENT_TONE[e.action] ?? "text-ink-2 bg-surface-3 ring-line-strong")}>
              <Icon className="size-[15px]" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="font-semibold text-ink">{e.actor_name || "System"}</span>
                <span className="text-ink-2">{(EVENT_LABEL[e.action] ?? e.action).toLowerCase()}</span>
                {e.version_number ? <span className="rounded bg-surface-3 px-1.5 py-px font-mono text-[11px] text-ink-2">v{e.version_number}</span> : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                <time dateTime={e.created_at} title={formatDateTime(e.created_at, "UTC")}>
                  {formatDateTime(e.created_at, timeZone ?? "UTC")}
                </time>
                <span>·</span>
                <span>{ROLES[e.actor_role as Role]?.label ?? e.actor_role}</span>
                {e.from_status && e.to_status && audience === "agency" ? (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge status={e.from_status as Status} className="scale-90" />
                      <span aria-hidden>→</span>
                      <StatusBadge status={e.to_status as Status} className="scale-90" />
                    </span>
                  </>
                ) : null}
              </div>
              {e.comment ? (
                <blockquote className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">{e.comment}</blockquote>
              ) : null}
              {typeof meta.scheduled_for === "string" ? (
                <div className="mt-1.5 text-xs text-muted">
                  Publishing {formatDateTime(meta.scheduled_for, timeZone ?? "UTC")}
                  {typeof meta.four_eyes_checked_by === "string" ? ` · four-eyes check by ${meta.four_eyes_checked_by}` : ""}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityRow({
  e,
  href,
}: {
  e: EventRow & { content_items: { title: string; status: Status } | null };
  href: string;
}) {
  const Icon = EVENT_ICON[e.action] ?? Pencil;
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
        <span className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", EVENT_TONE[e.action] ?? "text-ink-2 bg-surface-3 ring-line-strong")}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-2">
            <span className="font-medium text-ink">{e.actor_name}</span> {(EVENT_LABEL[e.action] ?? e.action).toLowerCase()}{" "}
            <span className="font-medium text-ink">{e.content_items?.title ?? "an item"}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-subtle">
            {relativeTime(e.created_at)}
            {e.version_number ? ` · v${e.version_number}` : ""}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function PersonChip({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-subtle">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" />
      <span className="truncate">{name}</span>
    </span>
  );
}
