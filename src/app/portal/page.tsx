/* eslint-disable @next/next/no-img-element -- previews are short-lived signed URLs */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Inbox, PartyPopper } from "lucide-react";
import { Card, CardHeader, EmptyState, StatusBadge, buttonClass, cx } from "@/components/ui";
import { DueLabel, PlatformLabel } from "@/components/content-bits";
import { FlashToast } from "@/components/toast";
import { ITEM_COLUMNS, type ItemRow } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requireClientUser } from "@/lib/session";
import { formatDateTime, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Your content" };

const FLASH: Record<string, string> = { joined: "Welcome! You can now review content here.", password: "Password updated." };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ flash?: string }> }) {
  const { flash } = await searchParams;
  const s = await requireClientUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_items").select(ITEM_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  const items = (data ?? []) as unknown as ItemRow[];

  // First image of each item's current version, for thumbnails (RLS only returns sent versions).
  const pendingIds = items.filter((i) => i.status === "pending_approval").map((i) => i.id);
  const thumbs = new Map<string, string>();
  if (pendingIds.length) {
    const { data: atts } = await supabase
      .from("attachments")
      .select("id,item_id,mime_type,content_versions!inner(version_number)")
      .in("item_id", pendingIds)
      .like("mime_type", "image/%");
    for (const a of (atts ?? []) as unknown as { id: string; item_id: string; content_versions: { version_number: number } }[]) {
      const it = items.find((i) => i.id === a.item_id);
      if (it && a.content_versions.version_number === it.current_version && !thumbs.has(a.item_id)) thumbs.set(a.item_id, a.id);
    }
  }

  const pending = items.filter((i) => i.status === "pending_approval").sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const inRevision = items.filter((i) => i.status === "revision_required");
  const done = items.filter((i) => ["approved", "scheduled", "rejected"].includes(i.status));
  const first = s.fullName.split(" ")[0] || "there";

  return (
    <>
      <FlashToast message={flash ? FLASH[flash] : undefined} />
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-3xl">Hi {first}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {pending.length === 0
            ? "Nothing is waiting for your review right now."
            : `${pending.length} item${pending.length === 1 ? " is" : "s are"} waiting for your review.`}
        </p>
      </div>

      {error ? <Card><EmptyState title="Couldn't load your content" description="Please refresh the page in a moment." /></Card> : null}

      <section aria-labelledby="to-review">
        <h2 id="to-review" className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-subtle">
          To review
        </h2>
        {pending.length === 0 ? (
          <Card>
            <EmptyState icon={<PartyPopper className="size-5" />} title="You're all caught up" description="When the team sends you something to approve, it appears here and in your notifications." />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {pending.map((it, i) => (
              <Link
                key={it.id}
                href={`/portal/review/${it.id}`}
                className="group animate-slide-up overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-[#2a4a8a]"
                style={{ animationDelay: `${i * 50}ms`, animationFillMode: "backwards" }}
              >
                <div className="relative aspect-[16/9] bg-[#050913]">
                  {thumbs.get(it.id) ? (
                    <img src={`/api/attachments/${thumbs.get(it.id)}`} alt="" className="size-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                  ) : (
                    <div className="flex size-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#155eef26,transparent_60%)]">
                      <Inbox className="size-8 text-subtle" />
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white backdrop-blur">v{it.current_version}</span>
                </div>
                <div className="p-5">
                  <div className="text-[17px] font-semibold leading-snug">{it.title}</div>
                  <div className="mt-1 text-sm">
                    <PlatformLabel platform={it.platform} type={it.content_type} />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className="text-muted">Please respond by </span>
                      <DueLabel date={it.due_date} status={it.status} />
                    </div>
                    <span className={cx(buttonClass("primary", "sm"), "pointer-events-none")}>
                      Review <ArrowRight className="size-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {inRevision.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-subtle">Being revised by the team</h2>
          <Card>
            <ItemList items={inRevision} />
          </Card>
        </section>
      ) : null}

      <section className="mt-10">
        <Card>
          <CardHeader title="Decided" description="Items you've approved or declined, and what's scheduled." />
          {done.length === 0 ? <EmptyState icon={<CheckCircle2 className="size-5" />} title="No decisions yet" /> : <ItemList items={done} />}
        </Card>
      </section>
    </>
  );
}

function ItemList({ items }: { items: ItemRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.id}>
          <Link href={`/portal/review/${it.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium">{it.title}</div>
              <div className="mt-0.5 truncate text-[13px]">
                <PlatformLabel platform={it.platform} type={it.content_type} />
                {it.status === "scheduled" && it.scheduled_for ? (
                  <span className="text-ink-2">
                    {" "}
                    · <CalendarClock className="inline size-3.5 -translate-y-px" /> {formatDateTime(it.scheduled_for, it.clients?.timezone ?? "UTC")}
                  </span>
                ) : (
                  <span className="text-subtle"> · updated {relativeTime(it.updated_at)}</span>
                )}
              </div>
            </div>
            <StatusBadge status={it.status} audience="client" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
