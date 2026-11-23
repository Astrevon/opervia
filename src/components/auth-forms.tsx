"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { Button, Field, FormMessage, Input, Spinner } from "@/components/ui";
import { idle } from "@/lib/actions";
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/app/actions/auth";

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-subtle hover:text-ink"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {notice ? <FormMessage error={notice} /> : null}
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-[13px] text-muted hover:text-ink">
          Forgot password?
        </Link>
      </div>
      <FormMessage error={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        New agency?{" "}
        <Link href="/signup" className="font-medium text-brand-bright hover:underline">
          Create a workspace
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm({ invite, inviteEmail }: { invite?: string; inviteEmail?: string }) {
  const [state, action, pending] = useActionState(signUpAction, idle);
  if (state.ok && state.data?.confirm) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <MailCheck className="mx-auto size-8 text-brand-bright" />
        <h2 className="mt-3 font-semibold">Confirm your email</h2>
        <p className="mt-1 text-sm text-muted">{state.message}</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {invite ? <input type="hidden" name="invite" value={invite} /> : null}
      <Field label="Full name" htmlFor="full_name" error={state.fieldErrors?.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" required minLength={2} maxLength={120} />
      </Field>
      <Field label="Work email" htmlFor="email" error={state.fieldErrors?.email} hint={inviteEmail ? "Use the address your invitation was sent to." : undefined}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={inviteEmail} readOnly={Boolean(inviteEmail)} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password} hint="At least 10 characters, with a letter and a number.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} maxLength={72} />
      </Field>
      {!invite ? (
        <Field label="Agency workspace name" htmlFor="workspace" error={state.fieldErrors?.workspace} hint="You'll be the admin of this workspace.">
          <Input id="workspace" name="workspace" required minLength={2} maxLength={120} placeholder="e.g. Brightside Social" />
        </Field>
      ) : null}
      <FormMessage error={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        {invite ? "Create account & join" : "Create workspace"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href={invite ? `/login?next=${encodeURIComponent(`/onboarding?invite=${invite}`)}` : "/login"} className="font-medium text-brand-bright hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <FormMessage error={state.ok ? undefined : state.error} success={state.ok ? state.message : undefined} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        Send reset link
      </Button>
      <p className="text-center text-sm text-muted">
        <Link href="/login" className="hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, idle);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="New password" htmlFor="password" error={state.fieldErrors?.password} hint="At least 10 characters, with a letter and a number.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} maxLength={72} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required minLength={10} maxLength={72} />
      </Field>
      <FormMessage error={state.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        Update password
      </Button>
    </form>
  );
}
