import { AgencyShell } from "@/components/agency-shell";
import { requireAgency } from "@/lib/session";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAgency();
  return (
    <AgencyShell orgName={s.org.name} isDemo={s.org.is_demo} userName={s.fullName} userEmail={s.email} role={s.role}>
      {children}
    </AgencyShell>
  );
}
