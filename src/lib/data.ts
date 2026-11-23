import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Role, Status } from "@/lib/constants";

export type ItemRow = {
  id: string;
  title: string;
  status: Status;
  content_type: string;
  platform: string;
  client_id: string;
  assignee_id: string | null;
  created_by: string | null;
  current_version: number;
  approved_version: number | null;
  revision_round: number;
  due_date: string | null;
  planned_publish_at: string | null;
  scheduled_for: string | null;
  last_submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  clients: { name: string; timezone: string } | null;
};

export type VersionRow = {
  id: string;
  version_number: number;
  description: string;
  body: string;
  change_summary: string | null;
  snapshot: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  submitted_by: string | null;
};

export type AttachmentRow = {
  id: string;
  version_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type EventRow = {
  id: string;
  item_id: string;
  version_number: number | null;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MemberRow = {
  user_id: string;
  role: Role;
  client_id: string | null;
  is_active: boolean;
  created_at: string;
  profiles: { full_name: string; email: string } | null;
};

export type ClientRow = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  timezone: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export const ITEM_COLUMNS =
  "id,title,status,content_type,platform,client_id,assignee_id,created_by,current_version,approved_version,revision_round,due_date,planned_publish_at,scheduled_for,last_submitted_at,approved_at,created_at,updated_at,clients(name,timezone)";

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

export async function listMembers() {
  const supabase = await createClient();
  const res = await supabase.from("memberships").select("user_id,role,client_id,is_active,created_at,profiles(full_name,email)").order("created_at");
  return must(res, "team members") as unknown as MemberRow[];
}

export async function listClients() {
  const supabase = await createClient();
  const res = await supabase.from("clients").select("id,name,contact_name,contact_email,timezone,notes,is_active,created_at").order("name");
  return must(res, "clients") as ClientRow[];
}

export function nameMap(members: MemberRow[]) {
  const m = new Map<string, string>();
  for (const x of members) m.set(x.user_id, x.profiles?.full_name || x.profiles?.email || "Unknown");
  return m;
}

export async function getItemBundle(id: string) {
  const supabase = await createClient();
  const { data: item, error } = await supabase.from("content_items").select(ITEM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load content: ${error.message}`);
  if (!item) return null;
  const [versions, attachments, events] = await Promise.all([
    supabase
      .from("content_versions")
      .select("id,version_number,description,body,change_summary,snapshot,created_by,created_at,submitted_at,submitted_by")
      .eq("item_id", id)
      .order("version_number", { ascending: false }),
    supabase.from("attachments").select("id,version_id,file_name,mime_type,size_bytes,created_at").eq("item_id", id).order("created_at"),
    supabase
      .from("approval_events")
      .select("id,item_id,version_number,actor_id,actor_name,actor_role,action,from_status,to_status,comment,metadata,created_at")
      .eq("item_id", id)
      .order("created_at", { ascending: false }),
  ]);
  return {
    item: item as unknown as ItemRow,
    versions: must(versions, "versions") as VersionRow[],
    attachments: must(attachments, "attachments") as AttachmentRow[],
    events: must(events, "history") as EventRow[],
  };
}

export async function countByStatus() {
  const supabase = await createClient();
  const statuses: Status[] = ["draft", "pending_approval", "revision_required", "approved", "scheduled", "rejected"];
  const results = await Promise.all(
    statuses.map((s) => supabase.from("content_items").select("id", { count: "exact", head: true }).eq("status", s)),
  );
  const counts = {} as Record<Status, number>;
  statuses.forEach((s, i) => {
    if (results[i].error) throw new Error(`Could not load counts: ${results[i].error!.message}`);
    counts[s] = results[i].count ?? 0;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

export async function recentActivity(limit = 12) {
  const supabase = await createClient();
  const res = await supabase
    .from("approval_events")
    .select("id,item_id,version_number,actor_name,actor_role,action,from_status,to_status,comment,created_at,content_items(title,status)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return must(res, "activity") as unknown as (EventRow & { content_items: { title: string; status: Status } | null })[];
}
