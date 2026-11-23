import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CornerUpLeft, Hourglass, Layers, Plus, Activity } from "lucide-react";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, StatusBadge, cx } from "@/components/ui";
import { ActivityRow, PlatformLabel } from "@/components/content-bits";
import { FlashToast } from "@/components/toast";
import { ITEM_COLUMNS, countByStatus, recentActivity, type ItemRow } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/session";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

const FLASH: Record<string, string> = { welcome: "Your workspace is ready.", joined: "Welcome aboard!", password: "Password updated." };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ flash?: string }> }) {
  const { flash } = await searchParams;
  const session = await requireAgency();
  const supabase = await createClient();

  const [{ counts, total }, activity, attention, upcoming] = await Promise.all([
    countByStatus(),
    recentActivity(10),
    supabase
      .from("content_items")
      .select(ITEM_COLUMNS)
      .in("status", ["revision_required", "approved"])
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase.from("content_items").select(ITEM_COLUMNS).eq("status", "scheduled").order("scheduled_for", { ascending: true }).limit(5),
  ]);
  const attentionItems = (attention.data ?? []) as unknown as ItemRow[];
  const upcomingItems = (upcoming.data ?? []) as unknown as ItemRow[];

  const stats = [
    { label: "Total submissions", value: total, icon: Layers, href: "/content", tone: "text-ink-2" },
    { label: "Pending approval", value: counts.pending_approval, icon: Hourglass, href: "/content?status=pending_approval", tone: "text-[#fcd34d]" },
    { label: "Revision requests", value: counts.revision_required, icon: CornerUpLeft, href: "/content?status=revision_required", tone: "text-[#fda4af]" },
    { label: "Approved", value: counts.approved, icon: CheckCircle2, href: "/content?status=approved", tone: "text-[#6ee7b7]" },
    { label: "Scheduled", value: counts.scheduled, icon: CalendarClock, href: "/content?status=scheduled", tone: "text-[#8fb8ff]" },
  ];

  const firstName = session.fullName.split(" ")[0] || "there";

  return (
    <>
      <FlashToast message={flash ? FLASH[flash] : undefined} />
      <PageHeader
        eyebrow={session.org.name}
        title={`Good to see you, ${firstName}`}
        description="Where every content item stands, from draft to scheduled for publishing."
        actions={
          <LinkButton href="/content/new">
            <Plus className="size-4" /> New submission
          </LinkButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {stats.map(({ label, value, icon: Icon, href, tone }, i) => (
          <Link
            key={label}
            href={href}
            className={cx(
              "group animate-slide-up rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-line-strong sm:p-5",
              i === 0 && "col-span-2 md:col-span-1",
            )}
            style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-muted">{label}</span>
              <Icon className={cx("size-4", tone)} />
            </div>
            <div className="mt-3 text-[30px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
            <div className="mt-3 flex items-center gap-1 text-xs text-subtle transition-colors group-hover:text-ink-2">
              View <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Needs your attention" description="Revision requests to work on and approved items to schedule." />
            {attentionItems.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nothing waiting on the team" description="Revision requests and approved items ready to schedule will appear here." />
            ) : (
              <ul className="divide-y divide-line">
                {attentionItems.map((it) => (
                  <li key={it.id}>
                    <Link href={`/content/${it.id}`} className="flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.title}</div>
                        <div className="mt-0.5 truncate text-xs">
                          <span className="text-ink-2">{it.clients?.name}</span> · <PlatformLabel platform={it.platform} type={it.content_type} />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-subtle">{it.status === "approved" ? "Ready to schedule" : `Revise v${it.current_version}`}</span>
                        <StatusBadge status={it.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Scheduled content" description="Approved versions queued for publishing." />
            {upcomingItems.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing scheduled yet" description="Approved items appear here once a team member schedules them." />
            ) : (
              <ul className="divide-y divide-line">
                {upcomingItems.map((it) => (
                  <li key={it.id}>
                    <Link href={`/content/${it.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2">
                      <div className="flex w-14 shrink-0 flex-col items-center rounded-lg border border-[#1e3a70] bg-[#0b1730] py-1.5 text-[#8fb8ff]">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">
                          {it.scheduled_for ? new Date(it.scheduled_for).toLocaleString("en-GB", { month: "short", timeZone: it.clients?.timezone ?? "UTC" }) : "—"}
                        </span>
                        <span className="text-lg font-semibold leading-tight text-ink">
                          {it.scheduled_for ? new Date(it.scheduled_for).toLocaleString("en-GB", { day: "numeric", timeZone: it.clients?.timezone ?? "UTC" }) : ""}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{it.title}</div>
                        <div className="mt-0.5 truncate text-xs text-muted">
                          {it.clients?.name} · {formatDateTime(it.scheduled_for, it.clients?.timezone ?? "UTC")}
                        </div>
                      </div>
                      <span className="hidden text-xs text-subtle sm:block">v{it.approved_version}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Recent activity" description="Every approval action, as recorded." />
          {activity.length === 0 ? (
            <EmptyState icon={<Activity className="size-5" />} title="No activity yet" description="Create your first submission to get started." action={<LinkButton href="/content/new" size="sm">New submission</LinkButton>} />
          ) : (
            <ul className="divide-y divide-line/70 py-1">
              {activity.map((e) => (
                <ActivityRow key={e.id} e={e} href={`/content/${e.item_id}`} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {counts.pending_approval > 0 ? (
        <p className="mt-6 text-xs text-subtle">
          {counts.pending_approval} item{counts.pending_approval === 1 ? " is" : "s are"} with clients.{" "}
          <Link className="text-ink-2 underline-offset-2 hover:underline" href="/content?status=pending_approval">
            See due dates
          </Link>
        </p>
      ) : null}
    </>
  );
}

