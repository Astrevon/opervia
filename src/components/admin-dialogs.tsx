"use client";

import { useActionState, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Check, Copy, Link2, Pencil, Plus } from "lucide-react";
import { Modal } from "@/components/modal";
import { Button, Field, FormMessage, Input, Select, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { idle, type ActionState } from "@/lib/actions";
import { ROLES, type Role } from "@/lib/constants";
import {
  createInviteAction,
  revokeInviteAction,
  saveClientAction,
  updateMemberAction,
  updateOrganizationAction,
  updateProfileAction,
} from "@/app/actions/workspace";
import type { ClientRow } from "@/lib/data";

function useCloseOnSuccess(state: ActionState, close: () => void, message?: string) {
  const toast = useToast();
  useEffect(() => {
    if (state.at && state.ok) {
      close();
      toast("success", message ?? state.message ?? "Saved.");
    }
  }, [state, close, toast, message]);
}

/* Clients ------------------------------------------------------------------ */

export function ClientDialog({ client, trigger }: { client?: ClientRow; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant={client ? "ghost" : "primary"}
        size={client ? "sm" : "md"}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {trigger ?? (client ? <Pencil className="size-3.5" /> : (<><Plus className="size-4" /> Add client</>))}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={client ? `Edit ${client.name}` : "Add a client account"} description="Client approvers are invited from the Team page and only ever see this client&apos;s content.">
        <ClientForm key={key} client={client} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function ClientForm({ client, onDone }: { client?: ClientRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveClientAction, idle);
  useCloseOnSuccess(state, onDone);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      {client ? <input type="hidden" name="id" value={client.id} /> : null}
      <Field label="Client name" htmlFor="name" required error={fe.name}>
        <Input id="name" name="name" required minLength={2} maxLength={120} defaultValue={client?.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main contact" htmlFor="contact_name" error={fe.contact_name}>
          <Input id="contact_name" name="contact_name" maxLength={120} defaultValue={client?.contact_name ?? ""} />
        </Field>
        <Field label="Contact email" htmlFor="contact_email" error={fe.contact_email}>
          <Input id="contact_email" name="contact_email" type="email" maxLength={254} defaultValue={client?.contact_email ?? ""} />
        </Field>
      </div>
      <Field label="Client time zone" htmlFor="timezone" required error={fe.timezone} hint="SOP-002: deadlines and publish times use the client's time zone.">
        <Select id="timezone" name="timezone" defaultValue={client?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"}>
          {(zones.includes("UTC") ? zones : ["UTC", ...zones]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes" error={fe.notes} hint="Approval terms, brand notes, channels.">
        <Textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={client?.notes ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="is_active" defaultChecked={client?.is_active ?? true} className="size-4 accent-[#2878f0]" />
        Active (inactive clients can&apos;t receive new content)
      </label>
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {client ? "Save changes" : "Add client"}
        </Button>
      </div>
    </form>
  );
}

/* Invitations -------------------------------------------------------------- */

export function InviteDialog({ clients, defaultRole = "team" }: { clients: { id: string; name: string }[]; defaultRole?: Role }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> Invite someone
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite to your workspace" description="You'll get a private, single-use link to share with them.">
        <InviteForm key={key} clients={clients} defaultRole={defaultRole} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function InviteForm({ clients, defaultRole, onDone }: { clients: { id: string; name: string }[]; defaultRole: Role; onDone: () => void }) {
  const [state, action, pending] = useActionState(createInviteAction, idle);
  const [role, setRole] = useState<Role>(defaultRole);
  const [copied, setCopied] = useState(false);
  const fe = state.fieldErrors ?? {};
  const link = state.ok ? String(state.data?.link ?? "") : "";

  if (link) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-[#1f5c45] bg-[#0a211a] px-4 py-3 text-sm text-[#a7f3d0]">
          <Check className="mt-0.5 size-4 shrink-0" />
          <span>
            Invitation created for <b>{String(state.data?.email)}</b>. Send them this link yourself — this portal doesn&apos;t send emails.
          </span>
        </div>
        <div className="flex gap-2">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Invitation link" />
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-subtle">The link works once, expires in 14 days, and is shown only now. Create a new invitation if it&apos;s lost.</p>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" required error={fe.email}>
          <Input id="email" name="email" type="email" required maxLength={254} />
        </Field>
        <Field label="Name" htmlFor="full_name" error={fe.full_name}>
          <Input id="full_name" name="full_name" maxLength={120} />
        </Field>
      </div>
      <Field label="Role" htmlFor="role" required error={fe.role} hint={ROLES[role].description}>
        <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLES[r].label}
            </option>
          ))}
        </Select>
      </Field>
      {role === "client" ? (
        <Field label="Client account" htmlFor="client_id" required error={fe.client_id} hint="They will only see this client's submissions.">
          <Select id="client_id" name="client_id" required defaultValue="">
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
      ) : null}
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (role === "client" && clients.length === 0)}>
          {pending ? <Spinner /> : <Link2 className="size-4" />}
          Create invitation link
        </Button>
      </div>
    </form>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await revokeInviteAction(id);
          toast(res.ok ? "success" : "error", res.ok ? (res.message ?? "Revoked") : (res.error ?? "Failed"));
        })
      }
    >
      {pending ? <Spinner /> : null}
      Revoke
    </Button>
  );
}

/* Members ------------------------------------------------------------------ */

export function MemberDialog({
  member,
  clients,
  isSelf,
}: {
  member: { user_id: string; name: string; email: string; role: Role; client_id: string | null; is_active: boolean };
  clients: { id: string; name: string }[];
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        aria-label={`Edit ${member.name}`}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={member.name} description={member.email}>
        <MemberForm key={key} member={member} clients={clients} isSelf={isSelf} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function MemberForm({
  member,
  clients,
  isSelf,
  onDone,
}: {
  member: { user_id: string; role: Role; client_id: string | null; is_active: boolean };
  clients: { id: string; name: string }[];
  isSelf: boolean;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updateMemberAction.bind(null, member.user_id), idle);
  const [role, setRole] = useState<Role>(member.role);
  useCloseOnSuccess(state, onDone);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Role" htmlFor="m-role" hint={ROLES[role].description} error={state.fieldErrors?.role}>
        <Select id="m-role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLES[r].label}
            </option>
          ))}
        </Select>
      </Field>
      {role === "client" ? (
        <Field label="Client account" htmlFor="m-client" error={state.fieldErrors?.client_id}>
          <Select id="m-client" name="client_id" defaultValue={member.client_id ?? ""} required>
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
      ) : null}
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="is_active" defaultChecked={member.is_active} className="size-4 accent-[#2878f0]" />
        Active — {isSelf ? "you can't remove the last admin" : "deactivated members lose access immediately"}
      </label>
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

/* Settings forms ----------------------------------------------------------- */

export function OrganizationForm({ name, requireFourEyes }: { name: string; requireFourEyes: boolean }) {
  const [state, action, pending] = useActionState(updateOrganizationAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Workspace name" htmlFor="org-name" error={state.fieldErrors?.name}>
        <Input id="org-name" name="name" defaultValue={name} required minLength={2} maxLength={120} />
      </Field>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <input type="checkbox" name="require_four_eyes" defaultChecked={requireFourEyes} className="mt-0.5 size-4 accent-[#2878f0]" />
        <span className="text-sm">
          <span className="font-medium text-ink">Require a four-eyes check when scheduling</span>
          <span className="mt-0.5 block text-muted">
            The person who prepared or sent the approved version can&apos;t schedule it — someone else confirms it matches (SOP-002 §5.2, §8.6). Recommended.
          </span>
        </span>
      </label>
      <FormMessage error={state.ok ? undefined : state.error} success={state.ok ? state.message : undefined} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save workspace
        </Button>
      </div>
    </form>
  );
}

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Full name" htmlFor="full_name" error={state.fieldErrors?.full_name} hint="Shown in the approval history.">
        <Input id="full_name" name="full_name" defaultValue={fullName} required minLength={2} maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="email-ro">
        <Input id="email-ro" value={email} readOnly disabled />
      </Field>
      <FormMessage error={state.ok ? undefined : state.error} success={state.ok ? state.message : undefined} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}
