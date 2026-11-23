"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input, Spinner } from "@/components/ui";
import { idle } from "@/lib/actions";
import { acceptInviteAction, createWorkspaceAction } from "@/app/actions/workspace";

export function CreateWorkspaceForm({ defaultName }: { defaultName?: string }) {
  const [state, action, pending] = useActionState(createWorkspaceAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Agency workspace name" htmlFor="name" error={state.fieldErrors?.name} hint="You'll be the workspace admin. You can rename it later.">
        <Input id="name" name="name" required minLength={2} maxLength={120} defaultValue={defaultName} placeholder="e.g. Brightside Social" />
      </Field>
      <FormMessage error={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        Create workspace
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormMessage error={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        Accept invitation
      </Button>
    </form>
  );
}
