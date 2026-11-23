import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignUpForm } from "@/components/auth-forms";
import { Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession, homeFor } from "@/lib/session";
import { ROLES, type Role } from "@/lib/constants";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const token = invite && /^[a-f0-9]{64}$/.test(invite) ? invite : undefined;
  const session = await getSession();
  if (session) redirect(token ? `/onboarding?invite=${token}` : homeFor(session));

  let preview: { organization_name: string; email: string; role: Role; client_name: string | null; is_valid: boolean } | null = null;
  if (token) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_invitation_preview", { p_token: token });
    preview = (Array.isArray(data) ? data[0] : null) ?? null;
  }

  if (token && (!preview || !preview.is_valid)) {
    return (
      <AuthShell title="Invitation unavailable" subtitle="This invitation link is invalid, expired or already used.">
        <Notice tone="amber" title="Ask your agency admin for a new link">
          Invitation links work once and expire after 14 days.
        </Notice>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={preview ? `Join ${preview.organization_name}` : "Create your agency workspace"}
      subtitle={
        preview
          ? `You've been invited as ${ROLES[preview.role].label}${preview.client_name ? ` for ${preview.client_name}` : ""}.`
          : "Set up a private workspace for your team and clients."
      }
    >
      <SignUpForm invite={token} inviteEmail={preview?.email} />
    </AuthShell>
  );
}
