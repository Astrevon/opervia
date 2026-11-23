import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignInForm } from "@/components/auth-forms";
import { getSession, homeFor } from "@/lib/session";
import { isDemoMode } from "@/lib/demo/mode";
import { DemoPicker } from "@/components/demo-picker";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const session = await getSession();
  if (session) redirect(homeFor(session));
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (isDemoMode()) {
    return (
      <AuthShell title="Choose a demo person" subtitle="Preview the agency dashboard and the client portal with fictional Northstar Digital data.">
        <DemoPicker />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to review, approve and track your content.">
      <SignInForm next={safe} notice={error === "link" ? "That link is invalid or has expired. Sign in, or request a new link." : undefined} />
    </AuthShell>
  );
}
