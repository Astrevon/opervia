import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CornerUpLeft,
  Hourglass,
  Pencil,
  ShieldCheck,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Card, CardHeader, LinkButton, Notice, StatusBadge, cx } from "@/components/ui";
import { ActionDialog } from "@/components/action-dialog";
import { AttachmentManager } from "@/components/attachment-manager";
import { AttachmentTile } from "@/components/attachment-tile";
import { DueLabel, HistoryTimeline, PersonChip } from "@/components/content-bits";
import { FlashToast } from "@/components/toast";
import {
  deleteDraftFormAction,
  reopenAction,
  scheduleAction,
  submitContentAction,
  unscheduleAction,
} from "@/app/actions/content";
import { getItemBundle, listMembers, nameMap, type AttachmentRow, type VersionRow } from "@/lib/data";
import { requireAgency } from "@/lib/session";
import { CONTENT_TYPES, INCLUDED_REVISION_ROUNDS, PLATFORMS, label } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Content item" };

const FLASH: Record<string, string> = { created: "Draft saved as v1. Add files, then send it for approval.", saved: "Changes saved." };

export default async function ContentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ flash?: string }> }) {
  const [{ id }, { flash }] = await Promise.all([params, searchParams]);
  const session = await requireAgency();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [bundle, members] = await Promise.all([getItemBundle(id), listMembers()]);
  if (!bundle) notFound();
  const { item, versions, attachments, events } = bundle;
  const names = nameMap(members);
  const tz = item.clients?.timezone ?? "UTC";

  const byVersion = new Map<string, AttachmentRow[]>();
  for (const a of attachments) byVersion.set(a.version_id, [...(byVersion.get(a.version_id) ?? []), a]);
  const current = versions.find((v) => v.version_number === item.current_version)!;
  const currentFiles = byVersion.get(current?.id ?? "") ?? [];
  const editable = item.status === "draft" || item.status === "revision_required";
  const approvers = members.filter((m) => m.role === "client" && m.client_id === item.client_id && m.is_active);
  const approvedVersion = versions.find((v) => v.version_number === item.approved_version);
  const approvedTime = (approvedVersion?.snapshot?.planned_publish_at as string | null | undefined) ?? null;
  const authoredApproved = approvedVersion && (approvedVersion.created_by === session.userId || approvedVersion.submitted_by === session.userId);
  const fourEyesBlocked = session.org.require_four_eyes && Boolean(authoredApproved);
  const lastFeedback = events.find((e) => e.action === "revision_requested" || e.action === "reopened");
  const rejection = events.find((e) => e.action === "rejected");
  const previous = versions.filter((v) => v.submitted_at && v.version_number !== item.current_version);
  const currentSubmitted = Boolean(current?.submitted_at);

  return (
    <>
      <FlashToast message={flash ? FLASH[flash] : undefined} />
      <Link href="/content" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All content
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs text-ink-2">v{item.current_version}</span>
            {item.revision_round > 0 ? <span className="text-xs text-subtle">Revision round {item.revision_round}</span> : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{item.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {item.clients?.name} · {label(PLATFORMS, item.platform)} · {label(CONTENT_TYPES, item.content_type)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Status & next step */}
          <Card className="p-5">
            {item.status === "draft" ? (
              <StatusPanel
                icon={<Pencil className="size-4" />}
                title="Draft — not yet sent"
                text={
                  approvers.length
                    ? `When it's ready, send v${item.current_version} to ${approvers.map((a) => a.profiles?.full_name).join(", ")} for approval.`
                    : "This client has no active Client Approver yet. An admin must invite one before this can be sent."
                }
              >
                <LinkButton href={`/content/${item.id}/edit`} variant="secondary">
                  <Pencil className="size-4" /> Edit
                </LinkButton>
                <ActionDialog
                  action={submitContentAction.bind(null, item.id)}
                  trigger={<>Send for approval</>}
                  triggerVariant="primary"
                  title={`Send v${item.current_version} for approval?`}
                  description={`${item.clients?.name}'s approver will be notified in the portal. This version is locked once sent.`}
                  confirmLabel="Send to client"
                >
                  <SendChecklist due={item.due_date} body={current?.body ?? ""} files={currentFiles.length} approvers={approvers.length} />
                </ActionDialog>
                <ActionDialog
                  action={deleteDraftFormAction.bind(null, item.id)}
                  trigger={<>Delete draft</>}
                  triggerVariant="ghost"
                  title="Delete this draft?"
                  description="It was never sent to a client, so no approval history is lost. This can't be undone."
                  confirmLabel="Delete draft"
                  confirmVariant="danger"
                />
              </StatusPanel>
            ) : null}

            {item.status === "revision_required" ? (
              <StatusPanel
                tone="rose"
                icon={<CornerUpLeft className="size-4" />}
                title={`Revision required — working on v${item.current_version}`}
                text="Make the requested changes, then resubmit with a short summary of what changed."
              >
                <LinkButton href={`/content/${item.id}/edit`} variant="secondary">
                  <Pencil className="size-4" /> Edit v{item.current_version}
                </LinkButton>
                <ActionDialog
                  action={submitContentAction.bind(null, item.id)}
                  trigger={<>Resubmit to client</>}
                  triggerVariant="primary"
                  title={`Resubmit v${item.current_version}?`}
                  description="The client sees what changed and reviews this new version. Earlier versions are kept unchanged."
                  confirmLabel="Resubmit"
                  comment={{ name: "change_summary", label: "What changed in this version?", required: true, minLength: 5, placeholder: "e.g. Replaced slide 3 photo; corrected the launch date." }}
                >
                  <input type="hidden" name="mode" value="resubmit" />
                  <SendChecklist due={item.due_date} body={current?.body ?? ""} files={currentFiles.length} approvers={approvers.length} />
                </ActionDialog>
              </StatusPanel>
            ) : null}

            {item.status === "pending_approval" ? (
              <StatusPanel
                tone="amber"
                icon={<Hourglass className="size-4" />}
                title={`With the client — v${item.current_version}`}
                text={
                  <>
                    Waiting for {approvers.map((a) => a.profiles?.full_name).join(", ") || "the client approver"}. Response due <DueLabel date={item.due_date} status={item.status} />.
                    Items without explicit approval are never published.
                  </>
                }
              />
            ) : null}

            {item.status === "approved" ? (
              <StatusPanel
                tone="emerald"
                icon={<CheckCircle2 className="size-4" />}
                title={`Approved — v${item.approved_version}`}
                text={`Approved by ${events.find((e) => e.action === "approved")?.actor_name ?? "the client"} on ${formatDateTime(item.approved_at, tz)}. Schedule exactly this version.`}
              >
                {fourEyesBlocked ? (
                  <div className="flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink-2">
                    <ShieldCheck className="mt-px size-3.5 shrink-0 text-brand-bright" />
                    Four-eyes check: you prepared this version, so another team member or admin schedules it.
                  </div>
                ) : (
                  <ActionDialog
                    action={scheduleAction.bind(null, item.id)}
                    trigger={
                      <>
                        <CalendarClock className="size-4" /> Schedule for publishing
                      </>
                    }
                    triggerVariant="primary"
                    title="Schedule for publishing"
                    description={`Confirm the scheduled post matches approved v${item.approved_version} exactly. You're recorded as the four-eyes checker.`}
                    confirmLabel="Confirm & schedule"
                    dateTime={{
                      name: "scheduled_for",
                      label: "Publish at (your local time)",
                      defaultValue: approvedTime ?? item.planned_publish_at,
                      locked: Boolean(approvedTime),
                      hint: approvedTime
                        ? `Approved by the client for ${formatDateTime(approvedTime, tz)}. To change it, reopen the item.`
                        : `Client time zone: ${tz}.`,
                    }}
                    comment={{ name: "note", label: "Check note (optional)", placeholder: "e.g. Caption pasted from approved v2; previews checked." }}
                  />
                )}
                <ReopenDialog id={item.id} />
              </StatusPanel>
            ) : null}

            {item.status === "scheduled" ? (
              <StatusPanel
                tone="blue"
                icon={<CalendarClock className="size-4" />}
                title="Scheduled for publishing"
                text={`v${item.approved_version} publishes ${formatDateTime(item.scheduled_for, tz)} (client time). Scheduled by ${events.find((e) => e.action === "scheduled")?.actor_name ?? "a team member"}.`}
              >
                <ActionDialog
                  action={unscheduleAction.bind(null, item.id)}
                  trigger={<>Unschedule</>}
                  title="Unschedule this item?"
                  description="It goes back to Approved. Remember to remove it from your scheduling tool."
                  confirmLabel="Unschedule"
                  confirmVariant="danger"
                  comment={{ name: "reason", label: "Reason", required: true, minLength: 5, placeholder: "e.g. Client asked to hold the post." }}
                />
                <ReopenDialog id={item.id} />
              </StatusPanel>
            ) : null}

            {item.status === "rejected" ? (
              <StatusPanel tone="red" icon={<XCircle className="size-4" />} title="Rejected by the client" text="This item will not be published. Agree with the client whether to replace it with a new item or remove the slot.">
                {rejection?.comment ? <Quote who={rejection.actor_name} text={rejection.comment} /> : null}
              </StatusPanel>
            ) : null}

            {item.status === "revision_required" && lastFeedback?.comment ? (
              <div className="mt-4">
                <Quote who={lastFeedback.actor_name} text={lastFeedback.comment} label={lastFeedback.action === "reopened" ? "Reason for reopening" : `Feedback on v${lastFeedback.version_number}`} />
              </div>
            ) : null}
            {item.revision_round > INCLUDED_REVISION_ROUNDS ? (
              <Notice tone="amber" className="mt-4" icon={<AlertTriangle className="size-4 text-warn" />} title={`Revision round ${item.revision_round}`}>
                SOP-002 assumes {INCLUDED_REVISION_ROUNDS} client revision rounds are in scope. Inform the Head of Marketing Operations, who decides with the client whether this round is in scope.
              </Notice>
            ) : item.revision_round === INCLUDED_REVISION_ROUNDS && editable ? (
              <Notice tone="slate" className="mt-4" icon={<Info className="size-4 text-muted" />}>
                This is the last of the {INCLUDED_REVISION_ROUNDS} revision rounds assumed in scope (SOP-002 §8.4).
              </Notice>
            ) : null}
          </Card>

          {/* Current version */}
          <Card>
            <CardHeader
              title={`Version ${item.current_version}${editable ? " · working version" : ""}`}
              description={
                currentSubmitted
                  ? `Sent ${formatDateTime(current.submitted_at, tz)} by ${names.get(current.submitted_by ?? "") ?? "a team member"}`
                  : "Not sent yet — only your agency can see this version."
              }
              action={item.approved_version === item.current_version ? <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" />Approved version</span> : null}
            />
            <VersionBody version={current} />
            <div className="border-t border-line px-5 py-4">
              <div className="mb-3 text-[13px] font-medium text-ink-2">Attachments</div>
              {editable ? (
                <AttachmentManager itemId={item.id} attachments={currentFiles} />
              ) : currentFiles.length ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {currentFiles.map((a) => (
                    <li key={a.id}>
                      <AttachmentTile a={a} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-subtle">No attachments.</p>
              )}
            </div>
          </Card>

          {previous.length ? (
            <Card>
              <CardHeader title="Previous versions" description="Kept exactly as the client saw them. Never overwritten." />
              <div className="divide-y divide-line">
                {previous.map((v) => (
                  <details key={v.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 hover:bg-surface-2">
                      <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs">v{v.version_number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{v.change_summary ?? "Initial submission"}</span>
                      {item.approved_version === v.version_number ? <span className="text-xs text-ok">Approved</span> : null}
                      <span className="hidden text-xs text-subtle sm:block">{formatDateTime(v.submitted_at, tz)}</span>
                      <span className="text-subtle transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <div className="border-t border-line bg-surface-2/40">
                      <VersionBody version={v} />
                      {(byVersion.get(v.id) ?? []).length ? (
                        <ul className="grid grid-cols-3 gap-3 px-5 pb-5 sm:grid-cols-4">
                          {(byVersion.get(v.id) ?? []).map((a) => (
                            <li key={a.id}>
                              <AttachmentTile a={a} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Approval history" description={`Every action with actor, time (client time zone: ${tz}), status change and comment. Append-only.`} />
            <HistoryTimeline events={events} timeZone={tz} />
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line text-sm">
              <Row k="Client">{item.clients?.name}</Row>
              <Row k="Client time zone">{tz}</Row>
              <Row k="Platform">{label(PLATFORMS, item.platform)}</Row>
              <Row k="Content type">{label(CONTENT_TYPES, item.content_type)}</Row>
              <Row k="Assigned to">
                <PersonChip name={item.assignee_id ? names.get(item.assignee_id) : null} />
              </Row>
              <Row k="Created by">{item.created_by ? (names.get(item.created_by) ?? "—") : "—"}</Row>
              <Row k="Client response due">
                <DueLabel date={item.due_date} status={item.status} />
              </Row>
              <Row k="Planned publish">{item.planned_publish_at ? formatDateTime(item.planned_publish_at, tz) : <span className="text-subtle">Not set</span>}</Row>
              {item.scheduled_for ? <Row k="Scheduled for">{formatDateTime(item.scheduled_for, tz)}</Row> : null}
              <Row k="Approved version">{item.approved_version ? `v${item.approved_version}` : <span className="text-subtle">—</span>}</Row>
              <Row k="Client approvers">
                {approvers.length ? approvers.map((a) => a.profiles?.full_name).join(", ") : <span className="text-warn">None yet</span>}
              </Row>
            </dl>
          </Card>
          <Notice tone="slate" icon={<ShieldCheck className="size-4 text-muted" />}>
            <span className="text-xs leading-relaxed">
              Approved means this exact version. Any change after approval — even a typo — goes back to the client as a new version (SOP-002 §6).
            </span>
          </Notice>
        </aside>
      </div>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}

function StatusPanel({
  icon,
  title,
  text,
  tone = "slate",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  text: React.ReactNode;
  tone?: "slate" | "rose" | "amber" | "emerald" | "blue" | "red";
  children?: React.ReactNode;
}) {
  const ring = {
    slate: "bg-surface-3 text-ink-2",
    rose: "bg-[#fb718514] text-[#fda4af]",
    amber: "bg-[#fbbf2414] text-[#fcd34d]",
    emerald: "bg-[#34d39914] text-[#6ee7b7]",
    blue: "bg-[#2878f01a] text-[#8fb8ff]",
    red: "bg-[#f8717114] text-[#fca5a5]",
  }[tone];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", ring)}>{icon}</span>
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="mt-0.5 text-sm text-muted">{text}</div>
        </div>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

function Quote({ who, text, label: l }: { who: string; text: string; label?: string }) {
  return (
    <figure className="w-full rounded-xl border border-[#5c2330] bg-[#1d0d12] px-4 py-3">
      <figcaption className="mb-1 text-xs font-medium text-[#fda4af]">
        {l ?? "Comment"} · {who}
      </figcaption>
      <blockquote className="whitespace-pre-wrap text-sm text-ink">{text}</blockquote>
    </figure>
  );
}

function VersionBody({ version }: { version: VersionRow | undefined }) {
  if (!version) return null;
  return (
    <div className="grid gap-5 px-5 py-5">
      {version.change_summary ? (
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">What changed</div>
          <p className="text-sm text-ink">{version.change_summary}</p>
        </div>
      ) : null}
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-ink-2">Caption / copy</div>
        {version.body ? (
          <div className="whitespace-pre-wrap rounded-xl border border-line bg-surface-2 px-4 py-3.5 text-[14.5px] leading-relaxed text-ink">{version.body}</div>
        ) : (
          <p className="text-sm text-subtle">No caption yet.</p>
        )}
      </div>
      {version.description ? (
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">Description & notes</div>
          <p className="whitespace-pre-wrap text-sm text-ink-2">{version.description}</p>
        </div>
      ) : null}
    </div>
  );
}

function SendChecklist({ due, body, files, approvers }: { due: string | null; body: string; files: number; approvers: number }) {
  const checks = [
    { ok: body.trim().length > 0 || files > 0, text: "Caption/copy or at least one attachment" },
    { ok: Boolean(due), text: "Client response due date set" },
    { ok: approvers > 0, text: "Client has a named Client Approver" },
  ];
  return (
    <ul className="space-y-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      {checks.map((c) => (
        <li key={c.text} className="flex items-center gap-2">
          {c.ok ? <CheckCircle2 className="size-4 text-ok" /> : <AlertTriangle className="size-4 text-warn" />}
          <span className={c.ok ? "text-ink-2" : "text-[#f5d58a]"}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ReopenDialog({ id }: { id: string }) {
  return (
    <ActionDialog
      action={reopenAction.bind(null, id)}
      trigger={<>Reopen for changes</>}
      triggerVariant="ghost"
      title="Reopen for changes?"
      description="Use this when the client asks for a change after approval. A new version is created and must be approved again."
      confirmLabel="Reopen"
      comment={{ name: "reason", label: "Reason", required: true, minLength: 5, placeholder: "e.g. Client asked to update the offer end date." }}
    />
  );
}
