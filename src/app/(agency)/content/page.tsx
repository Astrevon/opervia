import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus } from "lucide-react";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, cx } from "@/components/ui";
import { DueLabel, PersonChip, PlatformLabel } from "@/components/content-bits";
import { FilterBar } from "@/components/filter-bar";
import { ITEM_COLUMNS, listClients, listMembers, nameMap, type ItemRow } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/session";
import { STATUS, STATUS_ORDER, type Status } from "@/lib/constants";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Content" };

type Search = { status?: string; client?: string; q?: string; mine?: string };

export default async function ContentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const session = await requireAgency();
  const supabase = await createClient();
  const status = STATUS_ORDER.includes(sp.status as Status) ? (sp.status as Status) : null;
  const uuidRe = /^[0-9a-f-]{36}$/i;

  let query = supabase.from("content_items").select(ITEM_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  if (sp.client && uuidRe.test(sp.client)) query = query.eq("client_id", sp.client);
  if (sp.mine === "1") query = query.eq("assignee_id", session.userId);
  if (sp.q) query = query.ilike("title", `%${sp.q.replace(/[%_\\]/g, (m) => `\\${m}`).slice(0, 100)}%`);

  const [{ data, error }, clients, members] = await Promise.all([query, listClients(), listMembers()]);
  const items = (data ?? []) as unknown as ItemRow[];
  const names = nameMap(members);

  const tabParams = (s: Status | null) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (sp.client) p.set("client", sp.client);
    if (sp.q) p.set("q", sp.q);
    if (sp.mine) p.set("mine", sp.mine);
    const str = p.toString();
    return str ? `/content?${str}` : "/content";
  };

  return (
    <>
      <PageHeader
        title="Content"
        description="Every submission across your clients, with its current status and version."
        actions={
          <LinkButton href="/content/new">
            <Plus className="size-4" /> New submission
          </LinkButton>
        }
      />

      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1">
          {[null, ...STATUS_ORDER].map((s) => {
            const active = s === status;
            return (
              <Link
                key={s ?? "all"}
                href={tabParams(s)}
                scroll={false}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                  active ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {s ? STATUS[s].label : "All"}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mb-4">
        <Suspense>
          <FilterBar clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
        </Suspense>
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState title="Couldn't load content" description={error.message} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-5" />}
            title={status || sp.q || sp.client || sp.mine ? "No matching items" : "No content yet"}
            description={
              status || sp.q || sp.client || sp.mine
                ? "Try a different filter."
                : clients.length === 0
                  ? "Add a client first, then create your first submission."
                  : "Create your first submission to start the approval workflow."
            }
            action={
              clients.length === 0 && session.role === "admin" ? (
                <LinkButton href="/clients" size="sm">
                  Add a client
                </LinkButton>
              ) : (
                <LinkButton href="/content/new" size="sm">
                  New submission
                </LinkButton>
              )
            }
          />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-3 py-3 font-medium">Client</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Assignee</th>
                  <th className="px-3 py-3 font-medium">Client due</th>
                  <th className="px-5 py-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((it) => (
                  <tr key={it.id} className="group relative transition-colors hover:bg-surface-2">
                    <td className="max-w-[340px] px-5 py-3.5">
                      <Link href={`/content/${it.id}`} className="after:absolute after:inset-0">
                        <div className="truncate font-medium text-ink group-hover:text-white">{it.title}</div>
                        <div className="mt-0.5 truncate text-xs">
                          <PlatformLabel platform={it.platform} type={it.content_type} />
                          <span className="ml-2 font-mono text-[11px] text-subtle">v{it.current_version}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5 text-ink-2">{it.clients?.name}</td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={it.status} />
                    </td>
                    <td className="px-3 py-3.5 text-ink-2">
                      <PersonChip name={it.assignee_id ? names.get(it.assignee_id) : null} />
                    </td>
                    <td className="px-3 py-3.5 text-[13px]">
                      <DueLabel date={it.due_date} status={it.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-xs text-subtle">{relativeTime(it.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {items.map((it) => (
                <li key={it.id}>
                  <Link href={`/content/${it.id}`} className="block px-4 py-3.5 active:bg-surface-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{it.title}</div>
                        <div className="mt-0.5 truncate text-xs text-ink-2">{it.clients?.name}</div>
                      </div>
                      <StatusBadge status={it.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <PlatformLabel platform={it.platform} type={it.content_type} />
                      <DueLabel date={it.due_date} status={it.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {items.length === 200 ? <p className="mt-3 text-xs text-subtle">Showing the 200 most recently updated items. Use filters to narrow down.</p> : null}
    </>
  );
}
