import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { HistoryView, type HistoryFilters } from "@/components/history-view";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<HistoryFilters> }) {
  return (
    <>
      <PageHeader title="History" description="Every billing and subscription event across all clients — a permanent, append-only record." />
      <HistoryView tab="all" filters={await searchParams} />
    </>
  );
}
