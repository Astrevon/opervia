import type { Metadata } from "next";
import { Mail, Users } from "lucide-react";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { InviteDialog, MemberDialog, RevokeInviteButton } from "@/components/admin-dialogs";
import { listClients, listMembers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/session";
import { ROLES, type Role } from "@/lib/constants";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireAdmin();
  const supabase = await createClient();
  const [members, clients, { data: invites }] = await Promise.all([
    listMembers(),
    listClients(),
    supabase
      .from("invitations")
      .select("id,email,full_name,role,client_id,created_at,expires_at")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const activeClients = clients.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }));
  const allClients = clients.map((c) => ({ id: c.id, name: c.name }));
  const pending = (invites ?? []).filter((i) => new Date(i.expires_at) > new Date());

  const groups: { title: string; roles: Role[] }[] = [
    { title: "Agency team", roles: ["admin", "team"] },
    { title: "Client approvers", roles: ["client"] },
  ];

  return (
    <>
      <PageHeader
        title="Team & access"
        description="Agency admins and content team members, plus the client approvers for each client account."
        actions={<InviteDialog clients={activeClients} />}
      />
      <div className="flex flex-col gap-6">
        {groups.map((g) => {
          const list = members.filter((m) => g.roles.includes(m.role));
          return (
            <Card key={g.title} className="overflow-hidden">
              <CardHeader title={g.title} description={`${list.filter((m) => m.is_active).length} active`} />
              {list.length === 0 ? (
                <EmptyState icon={<Users className="size-5" />} title="Nobody here yet" description="Invite someone with a private link." />
              ) : (
                <ul className="divide-y divide-line">
                  {list.map((m) => {
                    const name = m.profiles?.full_name || m.profiles?.email || "Unknown";
                    return (
                      <li key={m.user_id} className="flex items-center gap-3 px-5 py-3.5">
                        <Avatar name={name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{name}</span>
                            {m.user_id === session.userId ? <span className="text-xs text-subtle">(you)</span> : null}
                          </div>
                          <div className="truncate text-xs text-muted">{m.profiles?.email}</div>
                        </div>
                        <div className="hidden text-right sm:block">
                          <div className="text-sm text-ink-2">{ROLES[m.role].label}</div>
                          {m.client_id ? <div className="text-xs text-subtle">{clientName.get(m.client_id)}</div> : null}
                        </div>
                        {m.is_active ? <Badge tone="emerald" dot>Active</Badge> : <Badge>Deactivated</Badge>}
                        <MemberDialog
                          member={{ user_id: m.user_id, name, email: m.profiles?.email ?? "", role: m.role, client_id: m.client_id, is_active: m.is_active }}
                          clients={allClients}
                          isSelf={m.user_id === session.userId}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}

        <Card className="overflow-hidden">
          <CardHeader title="Pending invitations" description="Single-use links that haven't been accepted yet." />
          {pending.length === 0 ? (
            <EmptyState icon={<Mail className="size-5" />} title="No pending invitations" />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.full_name || i.email}</div>
                    <div className="truncate text-xs text-muted">
                      {i.email} · {ROLES[i.role as Role].label}
                      {i.client_id ? ` · ${clientName.get(i.client_id)}` : ""}
                    </div>
                  </div>
                  <div className="hidden text-xs text-subtle sm:block">Expires {formatDate(i.expires_at)}</div>
                  <RevokeInviteButton id={i.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
