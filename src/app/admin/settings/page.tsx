import type { Metadata } from "next";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { BillingSettingsForm, PlanForm } from "@/components/billing-forms";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Bank account settings" };

export default async function BillingSettingsPage() {
  const supabase = await createClient();
  const [{ data: settings, error }, { data: plans }] = await Promise.all([
    supabase.from("billing_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("billing_plans").select("*").order("created_at"),
  ]);
  if (error || !settings) throw new Error(error?.message ?? "Billing settings are missing.");
  const configured = Boolean(settings.bank_name && settings.account_number);

  return (
    <>
      <PageHeader
        title="Bank account settings"
        description="Where clients transfer their payments, and the rules for invoices, grace periods and reminders. Only Opervia billing admins can change these; every change is in the audit trail."
      />
      {!configured ? (
        <Notice tone="amber" title="Add your bank account" className="mb-6">
          Clients can&apos;t see where to transfer until a bank name and account number are saved.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Bank transfer details & billing rules" description={`Last updated ${formatDateTime(settings.updated_at, "Asia/Jakarta")}`} />
          <div className="p-5">
            <BillingSettingsForm settings={settings} />
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Plans" description="Price changes apply to new subscriptions. To change an existing client's price, use “Change plan / price” on their page." />
          <div className="divide-y divide-line">
            {(plans ?? []).map((p) => (
              <div key={p.id} className="p-5">
                <PlanForm plan={p} />
              </div>
            ))}
            <div className="p-5">
              <div className="mb-3 text-sm font-medium">Add a plan</div>
              <PlanForm />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
