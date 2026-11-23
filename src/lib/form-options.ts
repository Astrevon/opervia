import "server-only";
import { listClients, listMembers } from "@/lib/data";

/** Options for the content form: active clients (with approver counts) and active agency members. */
export async function contentFormOptions(includeClientId?: string) {
  const [clients, members] = await Promise.all([listClients(), listMembers()]);
  const approvers = new Map<string, number>();
  for (const m of members) if (m.role === "client" && m.is_active && m.client_id) approvers.set(m.client_id, (approvers.get(m.client_id) ?? 0) + 1);
  return {
    clients: clients
      .filter((c) => c.is_active || c.id === includeClientId)
      .map((c) => ({ id: c.id, name: c.name, timezone: c.timezone, approvers: approvers.get(c.id) ?? 0 })),
    members: members
      .filter((m) => m.is_active && m.role !== "client")
      .map((m) => ({ id: m.user_id, name: m.profiles?.full_name || m.profiles?.email || "Unknown" })),
  };
}
