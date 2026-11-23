"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select, Spinner } from "@/components/ui";

export function FilterBar({ clients, showMine = true }: { clients: { id: string; name: string }[]; showMine?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles…" className="pl-9" aria-label="Search titles" />
      </div>
      <Select value={params.get("client") ?? ""} onChange={(e) => update("client", e.target.value)} className="sm:w-56" aria-label="Filter by client">
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      {showMine ? (
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink-2 hover:border-[#33446a]">
          <input
            type="checkbox"
            className="size-4 accent-[#2878f0]"
            checked={params.get("mine") === "1"}
            onChange={(e) => update("mine", e.target.checked ? "1" : "")}
          />
          Assigned to me
        </label>
      ) : null}
      {pending ? <Spinner className="text-muted" /> : null}
    </div>
  );
}
