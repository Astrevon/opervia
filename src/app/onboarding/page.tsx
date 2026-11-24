import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInviteForm, CreateWorkspaceForm } from "@/components/onboarding-forms";
import { Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession, homeFor } from "@/lib/session";
import { ROLES, type Role } from "@/lib/constants";
import { signOutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role) redirect(homeFor(session));
  // Opervia billing admins don't need an agency workspace of their own.
  if (session.isBillingAdmin && !invite) redirect("/admin");

  const supabase = await createClient();
  const signOut = (
    <form action={signOutAction} className="mt-6 text-center">
      <button className="text-sm text-muted hover:text-ink">Sign out ({session.email})</button>
    </form>
  );

  // Membership exists but was deactivated by an admin.
  const { data: membership } = await supabase.from("memberships").select("is_active").eq("user_id", session.userId).maybeSingle();
  if (membership && !membership.is_active) {
    return (
      <AuthShell title="Access paused" subtitle="Your workspace admin has deactivated your access.">
        <Notice tone="amber" title="Contact your agency admin">They can reactivate your account from the Team page.</Notice>
        {signOut}
      </AuthShell>
    );
  }

  const token = invite && /^[a-f0-9]{64}$/.test(invite) ? invite : null;
  if (token) {
    const { data } = await supabase.rpc("get_invitation_preview", { p_token: token });
    const preview = (Array.isArray(data) ? data[0] : null) as
      | { organization_name: string; email: string; role: Role; client_name: string | null; is_valid: boolean }
      | null;
    if (!preview || !preview.is_valid) {
      return (
        <AuthShell title="Invitation unavailable" subtitle="This invitation link is invalid, expired or already used.">
          <Notice tone="amber" title="Ask your agency admin for a new link" />
          {signOut}
        </AuthShell>
      );
    }
    const emailMatches = preview.email.toLowerCase() === session.email.toLowerCase();
    return (
      <AuthShell
        title={`Join ${preview.organization_name}`}
        subtitle={`Invited as ${ROLES[preview.role].label}${preview.client_name ? ` for ${preview.client_name}` : ""}.`}
      >
        {emailMatches ? (
          <AcceptInviteForm token={token} />
        ) : (
          <Notice tone="amber" title="Wrong account">
            This invitation was sent to <b>{preview.email}</b>, but you&apos;re signed in as <b>{session.email}</b>. Sign out and use the invited address.
          </Notice>
        )}
        {signOut}
      </AuthShell>
    );
  }

  const { data: claims } = await supabase.auth.getClaims();
  const meta = (claims?.claims?.user_metadata ?? {}) as { workspace_name?: string };

  return (
    <AuthShell title="Create your agency workspace" subtitle="Your clients and team will be invited into this private workspace.">
      <CreateWorkspaceForm defaultName={meta.workspace_name} />
      <p className="mt-6 text-center text-sm text-muted">Joining an existing agency? Open the invitation link your admin sent you.</p>
      {signOut}
    </AuthShell>
  );
}
