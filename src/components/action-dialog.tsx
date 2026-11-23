"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { Button, Field, FormMessage, Input, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { idle, type ActionState } from "@/lib/actions";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

type CommentField = { name: string; label: string; placeholder?: string; required?: boolean; minLength?: number; hint?: string };
type DateTimeField = { name: string; label: string; defaultValue?: string | null; locked?: boolean; hint?: string };

/**
 * A button that opens a confirmation dialog and runs a server action.
 * Optional comment / date-time fields are validated in the browser and again on the server.
 */
export function ActionDialog({
  action,
  trigger,
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerClassName,
  title,
  description,
  children,
  confirmLabel,
  confirmVariant = "primary",
  comment,
  dateTime,
  redirectTo,
}: {
  action: ServerAction;
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: "sm" | "md" | "lg";
  triggerClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  comment?: CommentField;
  dateTime?: DateTimeField;
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={title} description={description}>
        <ActionForm
          key={session}
          action={action}
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant}
          comment={comment}
          dateTime={dateTime}
          redirectTo={redirectTo}
          onBusy={setBusy}
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        >
          {children}
        </ActionForm>
      </Modal>
    </>
  );
}

function ActionForm({
  action,
  confirmLabel,
  confirmVariant,
  comment,
  dateTime,
  redirectTo,
  onBusy,
  onCancel,
  onDone,
  children,
}: {
  action: ServerAction;
  confirmLabel: string;
  confirmVariant: ButtonVariant;
  comment?: CommentField;
  dateTime?: DateTimeField;
  redirectTo?: string;
  onBusy: (b: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const [localDt, setLocalDt] = useState(() => toLocalInput(dateTime?.defaultValue));
  const toast = useToast();
  const router = useRouter();

  useEffect(() => onBusy(pending), [pending, onBusy]);

  useEffect(() => {
    if (!state.at || !state.ok) return;
    onDone();
    toast("success", state.message ?? "Done.");
    if (redirectTo) router.push(redirectTo);
  }, [state, toast, redirectTo, router, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}
      {dateTime ? (
        <Field
          label={dateTime.label}
          htmlFor={`${dateTime.name}-local`}
          hint={dateTime.hint}
          required
          error={state.fieldErrors?.[dateTime.name]}
        >
          <Input
            id={`${dateTime.name}-local`}
            type="datetime-local"
            required
            value={localDt}
            readOnly={dateTime.locked}
            onChange={(e) => setLocalDt(e.target.value)}
            className={dateTime.locked ? "cursor-not-allowed opacity-80" : undefined}
          />
          <input type="hidden" name={dateTime.name} value={localToIso(localDt)} />
        </Field>
      ) : null}
      {comment ? (
        <Field label={comment.label} htmlFor={comment.name} hint={comment.hint} required={comment.required} error={state.fieldErrors?.[comment.name]}>
          <Textarea
            id={comment.name}
            name={comment.name}
            placeholder={comment.placeholder}
            required={comment.required}
            minLength={comment.minLength}
            maxLength={5000}
            rows={4}
            autoFocus
          />
        </Field>
      ) : null}
      <FormMessage error={state.ok ? undefined : state.error} />
      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={confirmVariant} disabled={pending}>
          {pending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Browser-local datetime-local value -> ISO timestamp (UTC). */
export function localToIso(local: string) {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
