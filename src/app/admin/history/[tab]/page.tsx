import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { HistoryView, type HistoryFilters, type HistoryTab } from "@/components/history-view";

const TITLES: Record<Exclude<HistoryTab, "all">, [string, string]> = {
  payments: ["Payment history", "Invoices generated, proofs uploaded, payments submitted, confirmed or rejected — with amounts, admins and timestamps."],
  subscriptions: ["Subscription history", "Created, plan and price changes, billing periods, activation, overdue, suspension, reactivation and cancellation."],
  audit: ["Admin audit trail", "Every administrative action: who did it, previous and new values, reason, internal notes and time."],
};

export async function generateMetadata({ params }: { params: Promise<{ tab: string }> }): Promise<Metadata> {
  const { tab } = await params;
  return { title: TITLES[tab as keyof typeof TITLES]?.[0] ?? "History" };
}

export default async function HistoryTabPage({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<HistoryFilters> }) {
  const { tab } = await params;
  if (!(tab in TITLES)) notFound();
  const [title, description] = TITLES[tab as keyof typeof TITLES];
  return (
    <>
      <PageHeader title={title} description={description} />
      <HistoryView tab={tab as HistoryTab} filters={await searchParams} />
    </>
  );
}
