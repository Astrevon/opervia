import type { Metadata } from "next";
import Link from "next/link";
import { Building2, UserPlus } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ClientDialog } from "@/components/admin-dialogs";
import { listClients, listMembers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requireAgency } from "@/lib/session";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const session = await requireAgency();
  const isAdmin = session.role === "admin";
  const supabase = await createClient();
  const [clients, members, { data: items }] = await Promise.all([
    listClients(),
    listMembers(),
    supabase.from("content_items").select("client_id,status"),
  ]);
  const approvers = (id: string) => members.filter((m) => m.role === "client" && m.client_id === id && m.is_active);
  const open = (id: string) => (items ?? []).filter((i) => i.client_id === id && !["scheduled", "rejected"].includes(i.status)).length;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Client accounts and their named approvers. Each client approver sees only their own client's submissions."
        actions={isAdmin ? <ClientDialog /> : null}
      />
      <Card className="overflow-hidden">
        {clients.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="No clients yet"
            description={isAdmin ? "Add your first client account, then invite their approver." : "An admin needs to add client accounts."}
            action={isAdmin ? <ClientDialog /> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => {
              const a = approvers(c.id);
              return (
                <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-sm font-semibold text-ink-2">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        {!c.is_active ? <Badge>Inactive</Badge> : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {c.contact_name ? `${c.contact_name} · ` : ""}
                        {c.timezone}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:justify-end">
                    <div className="min-w-[180px]">
                      <div className="text-xs text-subtle">Client approvers</div>
                      {a.length ? (
                        <div className="truncate text-ink-2">{a.map((m) => m.profiles?.full_name).join(", ")}</div>
                      ) : (
                        <div className="text-warn">None — content can&apos;t be sent</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs text-subtle">Open items</div>
                      <Link href={`/content?client=${c.id}`} className="text-ink-2 hover:text-ink">
                        {open(c.id)}
                      </Link>
                    </div>
                    {isAdmin ? (
                      <div className="flex items-center gap-1">
                        {a.length === 0 ? (
                          <LinkButton href="/team" size="sm" variant="secondary">
                            <UserPlus className="size-3.5" /> Invite approver
                          </LinkButton>
                        ) : null}
                        <ClientDialog client={c} />
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
