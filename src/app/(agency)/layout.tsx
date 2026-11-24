import { AgencyShell } from "@/components/agency-shell";
import { getWorkspaceAccess, requireAgency } from "@/lib/session";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAgency();
  const access = await getWorkspaceAccess();
  return (
    <AgencyShell
      orgName={s.org.name}
      isDemo={s.org.is_demo}
      userName={s.fullName}
      userEmail={s.email}
      role={s.role}
      access={access || s.isBillingAdmin ? { status: access?.status ?? null, serviceActive: access?.serviceActive ?? true, isBillingAdmin: s.isBillingAdmin } : null}
    >
      {children}
    </AgencyShell>
  );
}
