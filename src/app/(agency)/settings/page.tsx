import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { OrganizationForm, ProfileForm } from "@/components/admin-dialogs";
import { requireAgency } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

const RULES = [
  ["No explicit approval, no publishing", "Only the client's named approver can approve. Silence never counts as approval."],
  ["Approved means this exact version", "Submitted versions are locked. Any later change creates a new version that needs new approval."],
  ["Revision requests need a comment", "Clients must say what to change; the team resubmits with a summary of what changed."],
  ["No approver, no sending", "Content can't be sent to a client account without an active Client Approver."],
  ["Four-eyes check", "The person who prepared the approved version doesn't schedule it (configurable below)."],
  ["Append-only history", "Every decision is recorded with actor, time, version and status change, and can't be edited."],
];

export default async function SettingsPage() {
  const s = await requireAgency();
  return (
    <>
      <PageHeader title="Settings" description="Your profile, workspace settings and the approval rules this portal enforces." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Your profile" />
            <div className="p-5">
              <ProfileForm fullName={s.fullName} email={s.email} />
            </div>
          </Card>
          {s.role === "admin" ? (
            <Card>
              <CardHeader title="Workspace" description="Only admins can change these." />
              <div className="p-5">
                <OrganizationForm name={s.org.name} requireFourEyes={s.org.require_four_eyes} />
              </div>
            </Card>
          ) : null}
        </div>
        <Card className="h-fit">
          <CardHeader title="Approval rules" description="Derived from SOP NSD-MOPS-SOP-002 and enforced in the database, not just the interface." />
          <ul className="divide-y divide-line">
            {RULES.map(([t, d]) => (
              <li key={t} className="px-5 py-3.5">
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-0.5 text-[13px] text-muted">{d}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
