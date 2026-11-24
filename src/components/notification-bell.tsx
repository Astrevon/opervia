"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CheckCircle2, CornerUpLeft, Send, XCircle, CalendarClock, RotateCcw, Receipt, ShieldAlert, UploadCloud, Clock } from "lucide-react";
import { cx, Spinner } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { fetchNotificationsAction, markNotificationsReadAction, type NotificationRow } from "@/app/actions/workspace";

const ICON: Record<string, typeof Bell> = {
  submitted: Send,
  resubmitted: RotateCcw,
  approved: CheckCircle2,
  revision_requested: CornerUpLeft,
  rejected: XCircle,
  scheduled: CalendarClock,
  reopened: RotateCcw,
  invoice_issued: Receipt,
  payment_due_soon: Clock,
  payment_overdue: ShieldAlert,
  payment_submitted: UploadCloud,
  payment_confirmed: CheckCircle2,
  payment_rejected: XCircle,
  subscription_suspended: ShieldAlert,
  subscription_reactivated: CheckCircle2,
  subscription_cancelled: XCircle,
};

const BILLING_TYPES = new Set(["invoice_issued", "payment_due_soon", "payment_overdue", "payment_confirmed", "payment_rejected", "subscription_suspended", "subscription_reactivated", "subscription_cancelled"]);

const POLL_MS = 30_000;

export function NotificationBell({ itemHref }: { itemHref: "agency" | "client" | "admin" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetchNotificationsAction();
      setItems(res.items);
      setUnread(res.unread);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Initial load + polling (in-app notifications only; no email/push).
    const first = setTimeout(load, 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openItem(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      setItems((all) => all?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
      markNotificationsReadAction([n.id]);
    }
    if (n.type === "payment_submitted") router.push("/admin/verification");
    else if (BILLING_TYPES.has(n.type)) router.push(itemHref === "admin" ? "/admin" : "/billing");
    else if (n.item_id) router.push(itemHref === "client" ? `/portal/review/${n.item_id}` : `/content/${n.item_id}`);
  }

  async function markAll() {
    await markNotificationsReadAction(null);
    await load();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative flex size-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-[18px]" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-canvas">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-16 z-50 animate-pop-in overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[var(--shadow-pop)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold">Notifications</div>
            <button
              onClick={markAll}
              disabled={!unread}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items === null && !failed ? (
              <div className="flex justify-center py-10 text-muted">
                <Spinner />
              </div>
            ) : failed ? (
              <div className="px-4 py-8 text-center text-sm text-muted">Couldn&apos;t load notifications. Try again shortly.</div>
            ) : items && items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted">You&apos;re all caught up.</div>
            ) : (
              <ul>
                {items!.map((n) => {
                  const Icon = ICON[n.type] ?? Bell;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => openItem(n)}
                        className={cx(
                          "flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors hover:bg-surface-2",
                          !n.read_at && "bg-[#155eef0d]",
                        )}
                      >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-ink">{n.title}</span>
                            {!n.read_at ? <span className="size-1.5 shrink-0 rounded-full bg-brand-bright" /> : null}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>
                          <span className="mt-1 block text-[11px] text-subtle">{relativeTime(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line px-4 py-2.5 text-[11px] text-subtle">In-app notifications only — email alerts are not enabled.</div>
        </div>
      ) : null}
    </div>
  );
}
