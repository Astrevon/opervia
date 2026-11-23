import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { ProfileForm } from "@/components/admin-dialogs";
import { requireClientUser } from "@/lib/session";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const s = await requireClientUser();
  return (
    <div className="mx-auto max-w-xl">
      <Link href="/portal" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to your content
      </Link>
      <Card>
        <CardHeader title="Your account" description={`Client approver for ${s.client?.name ?? "your organisation"}.`} />
        <div className="p-5">
          <ProfileForm fullName={s.fullName} email={s.email} />
        </div>
      </Card>
      <p className="mt-4 text-sm text-muted">
        To change your password, sign out and use <Link href="/forgot-password" className="text-ink-2 underline-offset-2 hover:underline">Forgot password</Link>.
      </p>
    </div>
  );
}
