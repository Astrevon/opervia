"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSession, homeFor } from "@/lib/session";
import { fail, success, type ActionState } from "@/lib/actions";
import { clientSchema, fieldErrors, idSchema, inviteSchema } from "@/lib/validation";

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function siteUrl() {
  const { headers } = await import("next/headers");
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/* Onboarding --------------------------------------------------------------- */

export async function createWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const name = z.string().trim().min(2, "Name your workspace (at least 2 characters)").max(120).safeParse(formData.get("name"));
  if (!name.success) return fail(name.error.issues[0].message, { name: name.error.issues[0].message });
  try {
    await rpc("create_organization", { p_name: name.data });
  } catch (e) {
    return fail(e);
  }
  redirect("/dashboard?flash=welcome");
}

export async function acceptInviteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) return fail("This invitation link is not valid.");
  try {
    await rpc("accept_invitation", { p_token: token });
  } catch (e) {
    return fail(e);
  }
  const session = await getSession();
  redirect(`${homeFor(session)}?flash=joined`);
}

/* Clients ------------------------------------------------------------------ */

export async function saveClientAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = clientSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name") ?? "",
    contact_name: formData.get("contact_name") ?? "",
    contact_email: formData.get("contact_email") ?? "",
    timezone: formData.get("timezone") ?? "UTC",
    notes: formData.get("notes") ?? "",
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await rpc("upsert_client", {
      p_id: v.id,
      p_name: v.name,
      p_contact_name: v.contact_name,
      p_contact_email: v.contact_email,
      p_timezone: v.timezone,
      p_notes: v.notes,
      p_is_active: v.is_active,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/clients");
  revalidatePath("/team");
  return success(v.id ? "Client updated." : "Client added.");
}

/* Team & invitations ------------------------------------------------------- */

export async function createInviteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email") ?? "",
    full_name: formData.get("full_name") ?? "",
    role: formData.get("role") ?? "",
    client_id: formData.get("role") === "client" ? (formData.get("client_id") ?? "") : "",
  });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  let token: string;
  try {
    token = (await rpc("create_invitation", {
      p_email: v.email,
      p_role: v.role,
      p_client_id: v.client_id,
      p_full_name: v.full_name || null,
    })) as string;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team");
  return success("Invitation created.", { link: `${await siteUrl()}/signup?invite=${token}`, email: v.email });
}

export async function revokeInviteAction(invitationId: string): Promise<ActionState> {
  if (!idSchema.safeParse(invitationId).success) return fail("Invalid invitation.");
  try {
    await rpc("revoke_invitation", { p_invitation_id: invitationId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team");
  return success("Invitation revoked.");
}

export async function updateMemberAction(userId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(userId).success) return fail("Invalid member.");
  const role = String(formData.get("role") ?? "");
  if (!["admin", "team", "client"].includes(role)) return fail("Choose a role.", { role: "Choose a role" });
  const clientId = role === "client" ? String(formData.get("client_id") ?? "") : null;
  if (role === "client" && !idSchema.safeParse(clientId).success) return fail("Choose a client.", { client_id: "Choose a client" });
  try {
    await rpc("update_member", {
      p_user_id: userId,
      p_role: role,
      p_client_id: clientId,
      p_is_active: formData.get("is_active") === "on",
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/team");
  return success("Member updated.");
}

/* Settings ----------------------------------------------------------------- */

export async function updateOrganizationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const name = z.string().trim().min(2, "At least 2 characters").max(120).safeParse(formData.get("name"));
  if (!name.success) return fail(name.error.issues[0].message, { name: name.error.issues[0].message });
  try {
    await rpc("update_organization", { p_name: name.data, p_require_four_eyes: formData.get("require_four_eyes") === "on" });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return success("Workspace settings saved.");
}

export async function updateProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const name = z.string().trim().min(2, "At least 2 characters").max(120).safeParse(formData.get("full_name"));
  if (!name.success) return fail(name.error.issues[0].message, { full_name: name.error.issues[0].message });
  try {
    await rpc("update_my_profile", { p_full_name: name.data });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return success("Profile saved.");
}

/* Notifications ------------------------------------------------------------ */

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  item_id: string | null;
  read_at: string | null;
  created_at: string;
};

export async function fetchNotificationsAction(): Promise<{ items: NotificationRow[]; unread: number }> {
  const session = await getSession();
  if (!session) return { items: [], unread: 0 };
  const supabase = await createClient();
  const [{ data }, { count }] = await Promise.all([
    supabase.from("notifications").select("id,type,title,body,item_id,read_at,created_at").order("created_at", { ascending: false }).limit(25),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return { items: (data ?? []) as NotificationRow[], unread: count ?? 0 };
}

export async function markNotificationsReadAction(ids: string[] | null) {
  if (ids && !ids.every((i) => idSchema.safeParse(i).success)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  return { ok: !error };
}
