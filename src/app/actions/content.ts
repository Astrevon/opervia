"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fail, success, type ActionState } from "@/lib/actions";
import { commentSchema, contentSchema, fieldErrors, idSchema, safeFileName, uploadRequestSchema } from "@/lib/validation";

function readContentForm(formData: FormData) {
  return contentSchema.safeParse({
    client_id: formData.get("client_id") ?? "",
    title: formData.get("title") ?? "",
    content_type: formData.get("content_type") ?? "",
    platform: formData.get("platform") ?? "",
    assignee_id: formData.get("assignee_id") ?? "",
    due_date: formData.get("due_date") ?? "",
    planned_publish_at: formData.get("planned_publish_at") ?? "",
    description: formData.get("description") ?? "",
    body: formData.get("body") ?? "",
  });
}

function refresh(itemId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/content");
  revalidatePath("/portal");
  if (itemId) {
    revalidatePath(`/content/${itemId}`);
    revalidatePath(`/portal/review/${itemId}`);
  }
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/* Create / edit ------------------------------------------------------------ */

export async function createContentAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = readContentForm(formData);
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  let id: string;
  try {
    id = (await rpc("create_content_item", {
      p_client_id: v.client_id,
      p_title: v.title,
      p_content_type: v.content_type,
      p_platform: v.platform,
      p_assignee_id: v.assignee_id,
      p_due_date: v.due_date,
      p_planned_publish_at: v.planned_publish_at,
      p_description: v.description,
      p_body: v.body,
    })) as string;
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  redirect(`/content/${id}?flash=created`);
}

export async function updateContentAction(itemId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const parsed = readContentForm(formData);
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  try {
    await rpc("update_content_item", {
      p_item_id: itemId,
      p_client_id: v.client_id,
      p_title: v.title,
      p_content_type: v.content_type,
      p_platform: v.platform,
      p_assignee_id: v.assignee_id,
      p_due_date: v.due_date,
      p_planned_publish_at: v.planned_publish_at,
      p_description: v.description,
      p_body: v.body,
    });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  redirect(`/content/${itemId}?flash=saved`);
}

/* Workflow transitions ----------------------------------------------------- */

export async function submitContentAction(itemId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const summary = String(formData.get("change_summary") ?? "").trim();
  const isResubmit = formData.get("mode") === "resubmit";
  if (isResubmit) {
    const ok = commentSchema(5, "Summarise what changed (at least 5 characters).").safeParse(summary);
    if (!ok.success) return fail(ok.error.issues[0].message, { change_summary: ok.error.issues[0].message });
  }
  try {
    await rpc("submit_content_item", { p_item_id: itemId, p_change_summary: summary || null });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  return success(isResubmit ? "Resubmitted to the client." : "Sent to the client for approval.");
}

async function clientDecision(
  fn: "approve_content_item" | "request_revision" | "reject_content_item",
  itemId: string,
  formData: FormData,
  message: string,
  commentRule?: { min: number; text: string },
): Promise<ActionState> {
  const session = await getSession();
  if (session?.role !== "client") return fail("Only client approvers can make this decision.");
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const version = Number(formData.get("version"));
  if (!Number.isInteger(version) || version < 1) return fail("Missing version. Refresh the page and try again.");
  const comment = String(formData.get("comment") ?? "").trim();
  if (commentRule) {
    const ok = commentSchema(commentRule.min, commentRule.text).safeParse(comment);
    if (!ok.success) return fail(ok.error.issues[0].message, { comment: ok.error.issues[0].message });
  }
  try {
    await rpc(fn, { p_item_id: itemId, p_version: version, p_comment: comment || null });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  return success(message);
}

export async function approveAction(itemId: string, _: ActionState, formData: FormData) {
  return clientDecision("approve_content_item", itemId, formData, "Approved. The team has been notified.");
}

export async function requestRevisionAction(itemId: string, _: ActionState, formData: FormData) {
  return clientDecision("request_revision", itemId, formData, "Revision request sent to the team.", {
    min: 5,
    text: "Describe the changes you need (at least 5 characters).",
  });
}

export async function rejectAction(itemId: string, _: ActionState, formData: FormData) {
  return clientDecision("reject_content_item", itemId, formData, "Item declined. The team has been notified.", {
    min: 5,
    text: "Tell the team why this item should not be used (at least 5 characters).",
  });
}

export async function scheduleAction(itemId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const when = String(formData.get("scheduled_for") ?? "");
  if (!when || Number.isNaN(Date.parse(when))) return fail("Choose a publishing date and time.", { scheduled_for: "Required" });
  if (Date.parse(when) <= Date.now()) return fail("Choose a time in the future.", { scheduled_for: "Must be in the future" });
  const note = String(formData.get("note") ?? "").trim();
  try {
    await rpc("schedule_content_item", { p_item_id: itemId, p_scheduled_for: new Date(when).toISOString(), p_note: note || null });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  return success("Scheduled for publishing.");
}

export async function unscheduleAction(itemId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const reason = String(formData.get("reason") ?? "").trim();
  const ok = commentSchema(5, "Give a reason (at least 5 characters).").safeParse(reason);
  if (!ok.success) return fail(ok.error.issues[0].message, { reason: ok.error.issues[0].message });
  try {
    await rpc("unschedule_content_item", { p_item_id: itemId, p_reason: reason });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  return success("Unscheduled. The item is back to Approved.");
}

export async function reopenAction(itemId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  const reason = String(formData.get("reason") ?? "").trim();
  const ok = commentSchema(5, "Give a reason (at least 5 characters).").safeParse(reason);
  if (!ok.success) return fail(ok.error.issues[0].message, { reason: ok.error.issues[0].message });
  try {
    await rpc("reopen_content_item", { p_item_id: itemId, p_reason: reason });
  } catch (e) {
    return fail(e);
  }
  refresh(itemId);
  return success("Reopened. A new version was created for your changes.");
}

export async function deleteDraftAction(itemId: string): Promise<ActionState> {
  if (!idSchema.safeParse(itemId).success) return fail("Invalid content item.");
  try {
    await rpc("delete_draft", { p_item_id: itemId });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return success("Draft deleted.");
}

/* Attachments -------------------------------------------------------------- */

/** Step 1: validate the file and get a one-time signed upload URL for this item. */
export async function prepareUploadAction(input: { itemId: string; fileName: string; size: number; type: string }) {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const session = await getSession();
  if (!session?.orgId || (session.role !== "admin" && session.role !== "team")) {
    return { ok: false as const, error: "Only agency members can upload files." };
  }
  const supabase = await createClient();
  const { data: item } = await supabase.from("content_items").select("id,org_id,status").eq("id", parsed.data.itemId).maybeSingle();
  if (!item) return { ok: false as const, error: "Content item not found." };
  if (!["draft", "revision_required"].includes(item.status)) return { ok: false as const, error: "This version is locked." };
  const path = `${item.org_id}/${item.id}/${randomUUID()}-${safeFileName(parsed.data.fileName)}`;
  const { data, error } = await supabase.storage.from("attachments").createSignedUploadUrl(path);
  if (error || !data) return { ok: false as const, error: "Upload was refused. Check the file type and try again." };
  return { ok: true as const, path, token: data.token };
}

/** Step 2: after the browser uploaded the bytes, attach the stored file to the working version. */
export async function registerAttachmentAction(input: { itemId: string; path: string; fileName: string }) {
  if (!idSchema.safeParse(input.itemId).success) return { ok: false as const, error: "Invalid content item." };
  try {
    await rpc("add_attachment", { p_item_id: input.itemId, p_storage_path: input.path, p_file_name: input.fileName.slice(0, 200) });
  } catch (e) {
    return { ok: false as const, error: fail(e).error! };
  }
  refresh(input.itemId);
  return { ok: true as const };
}

export async function removeAttachmentAction(itemId: string, attachmentId: string) {
  if (!idSchema.safeParse(attachmentId).success) return { ok: false as const, error: "Invalid attachment." };
  try {
    await rpc("remove_attachment", { p_attachment_id: attachmentId });
  } catch (e) {
    return { ok: false as const, error: fail(e).error! };
  }
  refresh(itemId);
  return { ok: true as const };
}

/** Form-friendly wrapper used by the confirmation dialog. */
export async function deleteDraftFormAction(itemId: string, _: ActionState, __: FormData): Promise<ActionState> {
  void __;
  const res = await deleteDraftAction(itemId);
  if (!res.ok) return res;
  redirect("/content?flash=deleted");
}
