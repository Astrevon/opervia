import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, CornerUpLeft, Hourglass, Info, XCircle } from "lucide-react";
import { Card, CardHeader, Notice, StatusBadge } from "@/components/ui";
import { ActionDialog } from "@/components/action-dialog";
import { AttachmentTile } from "@/components/attachment-tile";
import { DueLabel, HistoryTimeline } from "@/components/content-bits";
import { approveAction, rejectAction, requestRevisionAction } from "@/app/actions/content";
import { getItemBundle, type AttachmentRow } from "@/lib/data";
import { requireClientUser } from "@/lib/session";
import { CONTENT_TYPES, PLATFORMS, label } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireClientUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const bundle = await getItemBundle(id);
  if (!bundle) notFound();
  const { item, versions, attachments, events } = bundle;
  const tz = item.clients?.timezone ?? "UTC";

  // RLS only returns versions that were sent to the client.
  const shown = versions.find((v) => v.version_number === item.current_version) ?? versions[0];
  if (!shown) notFound();
  const files: AttachmentRow[] = attachments.filter((a) => a.version_id === shown.id);
  const older = versions.filter((v) => v.id !== shown.id);
  const pending = item.status === "pending_approval" && shown.version_number === item.current_version;
  const plannedAt = (shown.snapshot?.planned_publish_at as string | null | undefined) ?? item.planned_publish_at;
  const versionField = <input type="hidden" name="version" value={shown.version_number} />;

  return (
    <>
      <Link href="/portal" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to your content
      </Link>

      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} audience="client" />
          <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs text-ink-2">Version {shown.version_number}</span>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl">{item.title}</h1>
        <p className="mt-2 text-[15px] text-muted">
          {label(PLATFORMS, item.platform)} · {label(CONTENT_TYPES, item.content_type)}
          {plannedAt ? ` · planned for ${formatDateTime(plannedAt, tz)}` : ""}
        </p>
      </div>

      {/* Decision panel */}
      {pending ? (
        <Card className="mb-6 border-[#2a4a8a] bg-[linear-gradient(180deg,#0d1a33,#0b1220)] p-5 sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <Hourglass className="size-4 text-warn" /> Your decision is needed
              </div>
              <p className="mt-1 text-sm text-muted">
                Please respond by <DueLabel date={item.due_date} status={item.status} />. Nothing is published without your approval.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ActionDialog
                action={approveAction.bind(null, item.id)}
                trigger={
                  <>
                    <CheckCircle2 className="size-4" /> Approve
                  </>
                }
                triggerVariant="success"
                triggerSize="lg"
                title={`Approve version ${shown.version_number}?`}
                description="You're confirming that this exact version — the text and files shown on this page — may be published."
                confirmLabel="Yes, approve"
                confirmVariant="success"
                comment={{ name: "comment", label: "Comment (optional)", placeholder: "Anything the team should know?" }}
              >
                {versionField}
                <Notice tone="emerald" icon={<Info className="size-4 text-ok" />}>
                  If anything changes after you approve, the team must send it back to you as a new version.
                </Notice>
              </ActionDialog>
              <ActionDialog
                action={requestRevisionAction.bind(null, item.id)}
                trigger={
                  <>
                    <CornerUpLeft className="size-4" /> Request changes
                  </>
                }
                triggerVariant="secondary"
                triggerSize="lg"
                title="Request changes"
                description="Describe what should change. The team will update the content and send you a new version."
                confirmLabel="Send request"
                comment={{
                  name: "comment",
                  label: "What should change?",
                  required: true,
                  minLength: 5,
                  placeholder: "e.g. Please use the photo with the new packaging and change the date to 2 December.",
                  hint: "Be specific — list each change you need.",
                }}
              >
                {versionField}
              </ActionDialog>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3 text-right">
            <ActionDialog
              action={rejectAction.bind(null, item.id)}
              trigger={<>Decline this item</>}
              triggerVariant="ghost"
              triggerSize="sm"
              triggerClassName="text-muted"
              title="Decline this item?"
              description="Use this if the content should not be used at all. It will never be published. To get changes instead, use “Request changes”."
              confirmLabel="Decline item"
              confirmVariant="danger"
              comment={{ name: "comment", label: "Why shouldn't this be used?", required: true, minLength: 5 }}
            >
              {versionField}
            </ActionDialog>
          </div>
        </Card>
      ) : (
        <StatusNotice status={item.status} scheduledFor={item.scheduled_for} tz={tz} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex flex-col gap-6">
          {files.length ? (
            <Card className="p-4">
              <div className="mb-3 px-1 text-[13px] font-medium text-ink-2">Media & files</div>
              <ul className={files.length === 1 ? "grid gap-3" : "grid grid-cols-2 gap-3"}>
                {files.map((a) => (
                  <li key={a.id}>
                    <AttachmentTile a={a} large />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Caption / copy" description="Exactly as it will be published." />
            <div className="px-5 py-5">
              {shown.body ? (
                <div className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{shown.body}</div>
              ) : (
                <p className="text-sm text-subtle">No caption for this item.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {shown.change_summary ? (
            <Notice tone="blue" title={`What changed in version ${shown.version_number}`}>
              {shown.change_summary}
            </Notice>
          ) : null}
          {shown.description ? (
            <Card>
              <CardHeader title="Notes from the team" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-ink-2">{shown.description}</p>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="History" description="Every decision on this item, with the version it applies to." />
            <HistoryTimeline events={events} timeZone={tz} audience="client" />
          </Card>
          {older.length ? (
            <Card>
              <CardHeader title="Earlier versions" />
              <div className="divide-y divide-line">
                {older.map((v) => (
                  <details key={v.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm hover:bg-surface-2">
                      <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs">v{v.version_number}</span>
                      <span className="flex-1 text-muted">{formatDateTime(v.submitted_at, tz)}</span>
                      <span className="text-subtle transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <div className="whitespace-pre-wrap border-t border-line bg-surface-2/40 px-5 py-4 text-sm text-ink-2">{v.body || "No caption."}</div>
                    {attachments.filter((a) => a.version_id === v.id).length ? (
                      <ul className="grid grid-cols-3 gap-2 bg-surface-2/40 px-5 pb-4">
                        {attachments
                          .filter((a) => a.version_id === v.id)
                          .map((a) => (
                            <li key={a.id}>
                              <AttachmentTile a={a} />
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </details>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function StatusNotice({ status, scheduledFor, tz }: { status: string; scheduledFor: string | null; tz: string }) {
  const map: Record<string, { tone: "emerald" | "blue" | "rose" | "red" | "slate"; icon: React.ReactNode; title: string; text: string }> = {
    approved: { tone: "emerald", icon: <CheckCircle2 className="size-4 text-ok" />, title: "You approved this item", text: "The team will schedule exactly this version." },
    scheduled: {
      tone: "blue",
      icon: <CalendarClock className="size-4 text-brand-bright" />,
      title: "Scheduled for publishing",
      text: scheduledFor ? `Planned to go live ${formatDateTime(scheduledFor, tz)}.` : "Scheduled.",
    },
    revision_required: {
      tone: "rose",
      icon: <CornerUpLeft className="size-4 text-[#fda4af]" />,
      title: "The team is working on your changes",
      text: "You'll be notified when the updated version is ready for review.",
    },
    rejected: { tone: "red", icon: <XCircle className="size-4 text-danger" />, title: "You declined this item", text: "It will not be published." },
  };
  const m = map[status] ?? { tone: "slate" as const, icon: <Info className="size-4" />, title: "No action needed", text: "" };
  return (
    <Notice tone={m.tone} icon={m.icon} title={m.title} className="mb-6">
      {m.text}
    </Notice>
  );
}
