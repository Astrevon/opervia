"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Info } from "lucide-react";
import { Button, Card, Field, FormMessage, Input, Select, Spinner, Textarea, buttonClass } from "@/components/ui";
import { localToIso, toLocalInput } from "@/components/action-dialog";
import { CONTENT_TYPES, PLATFORMS } from "@/lib/constants";
import { idle, type ActionState } from "@/lib/actions";

export type ContentFormValues = {
  client_id: string;
  title: string;
  content_type: string;
  platform: string;
  assignee_id: string | null;
  due_date: string | null;
  planned_publish_at: string | null;
  description: string;
  body: string;
};

export function ContentForm({
  action,
  clients,
  members,
  initial,
  cancelHref,
  submitLabel,
  lockClient,
  versionLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  clients: { id: string; name: string; approvers: number; timezone: string }[];
  members: { id: string; name: string }[];
  initial?: Partial<ContentFormValues>;
  cancelHref: string;
  submitLabel: string;
  lockClient?: boolean;
  versionLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [publishLocal, setPublishLocal] = useState(() => toLocalInput(initial?.planned_publish_at));
  const fe = state.fieldErrors ?? {};
  const client = clients.find((c) => c.id === clientId);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Approval package</h2>
          {versionLabel ? <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs text-ink-2">{versionLabel}</span> : null}
        </div>
        <div className="flex flex-col gap-5">
          <Field label="Title" htmlFor="title" required error={fe.title} hint="Internal name the client will also see, e.g. “Winter Blend launch carousel”.">
            <Input id="title" name="title" required minLength={3} maxLength={160} defaultValue={initial?.title} />
          </Field>
          <Field
            label="Caption / copy"
            htmlFor="body"
            error={fe.body}
            hint={
              <span className="flex justify-between gap-4">
                <span>Exactly as it will be published — hashtags, tags and emojis included.</span>
                <span className="tabular-nums">{body.length.toLocaleString()} / 10,000</span>
              </span>
            }
          >
            <Textarea id="body" name="body" rows={8} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} className="font-[450]" />
          </Field>
          <Field label="Description & notes for the reviewer" htmlFor="description" error={fe.description} hint="Context, links, sources, frame-by-frame notes or anything the approver should know.">
            <Textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={initial?.description} />
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-5 text-[15px] font-semibold">Details</h2>
          <div className="flex flex-col gap-4">
            <Field label="Client" htmlFor="client_id" required error={fe.client_id}>
              {lockClient ? <input type="hidden" name="client_id" value={clientId} /> : null}
              <Select
                id="client_id"
                name={lockClient ? undefined : "client_id"}
                required
                value={clientId}
                disabled={lockClient}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a client…
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {client && client.approvers === 0 ? (
              <div className="flex gap-2 rounded-lg border border-[#5a4513] bg-[#1f190b] px-3 py-2.5 text-xs text-[#f5d58a]">
                <Info className="mt-px size-3.5 shrink-0" />
                This client has no Client Approver yet. You can save a draft, but an admin must invite an approver before it can be sent.
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Platform" htmlFor="platform" required error={fe.platform}>
                <Select id="platform" name="platform" required defaultValue={initial?.platform ?? "instagram"}>
                  {PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Content type" htmlFor="content_type" required error={fe.content_type}>
                <Select id="content_type" name="content_type" required defaultValue={initial?.content_type ?? "post"}>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Assigned team member" htmlFor="assignee_id" error={fe.assignee_id}>
              <Select id="assignee_id" name="assignee_id" defaultValue={initial?.assignee_id ?? ""}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client response due" htmlFor="due_date" error={fe.due_date} hint="Required before sending. SOP default: P−3 (three business days before publishing).">
              <Input id="due_date" name="due_date" type="date" defaultValue={initial?.due_date ?? ""} />
            </Field>
            <Field
              label="Planned publish date & time"
              htmlFor="planned_local"
              error={fe.planned_publish_at}
              hint={`Optional. Entered in your browser's time zone${client ? `; client time zone is ${client.timezone}` : ""}. Once approved, this time is binding.`}
            >
              <Input id="planned_local" type="datetime-local" value={publishLocal} onChange={(e) => setPublishLocal(e.target.value)} />
              <input type="hidden" name="planned_publish_at" value={localToIso(publishLocal)} />
            </Field>
          </div>
        </Card>

        <div className="flex flex-col gap-3">
          <FormMessage error={state.error} />
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Spinner /> : null}
            {submitLabel}
          </Button>
          <Link href={cancelHref} className={buttonClass("ghost", "md")}>
            Cancel
          </Link>
          <p className="text-center text-xs text-subtle">Saving keeps this as a working version. Nothing is sent to the client until you choose “Send for approval”.</p>
        </div>
      </div>
    </form>
  );
}
