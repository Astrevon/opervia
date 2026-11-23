import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { DEMO_PEOPLE, getDb, nowIso, placeholderPng, type DemoDb, type Row } from "@/lib/demo/store";

/**
 * DEMO MODE engine: TypeScript ports of the database's RLS read rules and
 * workflow functions (supabase/migrations/*.sql), with the same messages.
 */

export class DemoError extends Error {}
const fail = (msg: string): never => {
  throw new DemoError(msg);
};

export function db() {
  return getDb(seed);
}

/* ---------- membership helpers ---------- */

export function membership(d: DemoDb, uid: string | null) {
  if (!uid) return null;
  return d.memberships.find((m) => m.user_id === uid && m.is_active) ?? null;
}

function requireMember(d: DemoDb, uid: string | null, roles: string[]) {
  if (!uid) fail("You must be signed in.");
  const m = membership(d, uid);
  if (!m) fail("Your account is not an active member of a workspace.");
  if (!roles.includes(m!.role)) fail(`Your role (${m!.role}) is not allowed to do this.`);
  return m!;
}

const isAgency = (m: Row | null) => Boolean(m && (m.role === "admin" || m.role === "team"));

export function canViewItem(d: DemoDb, uid: string | null, itemId: string) {
  const m = membership(d, uid);
  const i = d.content_items.find((x) => x.id === itemId);
  if (!m || !i || i.org_id !== m.org_id) return false;
  return isAgency(m) || (m.role === "client" && i.client_id === m.client_id && i.status !== "draft");
}

/* ---------- Row Level Security (read) ---------- */

export function visible(d: DemoDb, uid: string | null, table: string, r: Row): boolean {
  const m = membership(d, uid);
  const org = m?.org_id;
  switch (table) {
    case "organizations":
      return r.id === org;
    case "profiles": {
      if (r.id === uid) return true;
      const mm = d.memberships.find((x) => x.user_id === r.id && x.org_id === org);
      return Boolean(mm && (isAgency(m) || mm.role === "admin" || mm.role === "team" || mm.client_id === m?.client_id));
    }
    case "clients":
      return r.org_id === org && (isAgency(m) || r.id === m?.client_id);
    case "memberships":
      return r.user_id === uid || (r.org_id === org && isAgency(m));
    case "invitations":
      return r.org_id === org && m?.role === "admin";
    case "content_items":
      return r.org_id === org && (isAgency(m) || (r.client_id === m?.client_id && r.status !== "draft"));
    case "content_versions":
      return r.org_id === org && (isAgency(m) || (Boolean(r.submitted_at) && canViewItem(d, uid, r.item_id)));
    case "attachments": {
      if (r.org_id !== org) return false;
      if (isAgency(m)) return true;
      const v = d.content_versions.find((x) => x.id === r.version_id);
      return Boolean(v?.submitted_at) && canViewItem(d, uid, r.item_id);
    }
    case "approval_events":
      return r.org_id === org && (isAgency(m) || (r.visibility === "client" && canViewItem(d, uid, r.item_id)));
    case "notifications":
      return r.user_id === uid;
    default:
      return false;
  }
}

/* ---------- shared helpers (ports of private.*) ---------- */

const clean = (p: unknown, max: number) => {
  const v = String(p ?? "").trim();
  if (v.length > max) fail(`Text is too long (maximum ${max} characters).`);
  return v;
};
const validEmail = (p: string) => /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(p) && p.length <= 254;
const today = () => new Date().toISOString().slice(0, 10);
const touch = (d: DemoDb, r: Row) => (r.updated_at = nowIso(d));
const actorName = (d: DemoDb, uid: string | null) => {
  const p = d.profiles.find((x) => x.id === uid);
  return p ? p.full_name || p.email : "";
};

function logEvent(d: DemoDb, uid: string, item: Row, version: number, action: string, from: string | null, to: string, comment: string | null, visibility: "client" | "internal", metadata: Row = {}) {
  d.approval_events.push({
    id: randomUUID(),
    org_id: item.org_id,
    item_id: item.id,
    version_number: version,
    actor_id: uid,
    actor_name: actorName(d, uid),
    actor_role: membership(d, uid)?.role ?? "system",
    action,
    from_status: from,
    to_status: to,
    comment: comment && comment.trim() ? comment.trim() : null,
    visibility,
    metadata,
    created_at: nowIso(d),
  });
}

function notify(d: DemoDb, uid: string, item: Row, recipients: string[], type: string, title: string, body: string) {
  for (const r of new Set(recipients)) {
    if (!r || r === uid) continue;
    if (!d.memberships.some((m) => m.user_id === r && m.org_id === item.org_id && m.is_active)) continue;
    d.notifications.push({ id: randomUUID(), org_id: item.org_id, user_id: r, item_id: item.id, type, title, body, read_at: null, created_at: nowIso(d) });
  }
}

const clientApprovers = (d: DemoDb, clientId: string) =>
  d.memberships.filter((m) => m.client_id === clientId && m.role === "client" && m.is_active).map((m) => m.user_id);
const agencyWatchers = (d: DemoDb, item: Row) => [
  item.created_by,
  item.assignee_id,
  ...d.memberships.filter((m) => m.org_id === item.org_id && m.role === "admin" && m.is_active).map((m) => m.user_id),
];

function startNewVersion(d: DemoDb, uid: string, item: Row) {
  const old = d.content_versions.find((v) => v.item_id === item.id && v.version_number === item.current_version)!;
  const next = item.current_version + 1;
  const nv = {
    id: randomUUID(),
    org_id: item.org_id,
    item_id: item.id,
    version_number: next,
    description: old.description,
    body: old.body,
    change_summary: null,
    snapshot: null,
    created_by: uid,
    created_at: nowIso(d),
    updated_at: nowIso(d),
    submitted_at: null,
    submitted_by: null,
  };
  d.content_versions.push(nv);
  for (const a of d.attachments.filter((x) => x.version_id === old.id)) {
    d.attachments.push({ ...a, id: randomUUID(), version_id: nv.id, created_at: nowIso(d) });
  }
  return next;
}

function validateItemFields(d: DemoDb, org: string, a: Row) {
  const title = String(a.p_title ?? "").trim();
  if (title.length < 3) fail("Title must be at least 3 characters.");
  if (title.length > 160) fail("Title must be 160 characters or fewer.");
  if (!["post", "carousel", "short_video", "story", "other"].includes(a.p_content_type)) fail("Choose a valid content type.");
  if (!["instagram", "facebook", "linkedin", "tiktok", "other"].includes(a.p_platform)) fail("Choose a valid platform.");
  if (!d.clients.some((c) => c.id === a.p_client_id && c.org_id === org && c.is_active)) fail("Choose an active client from your workspace.");
  if (a.p_assignee_id && !d.memberships.some((m) => m.user_id === a.p_assignee_id && m.org_id === org && ["admin", "team"].includes(m.role) && m.is_active)) {
    fail("The assigned team member must be an active member of your agency.");
  }
}

function itemFor(d: DemoDb, id: string, org: string) {
  const i = d.content_items.find((x) => x.id === id && x.org_id === org);
  if (!i) fail("Content item not found.");
  return i!;
}

function loadForClientDecision(d: DemoDb, uid: string, id: string, version: number) {
  const m = requireMember(d, uid, ["client"]);
  const i = d.content_items.find((x) => x.id === id && x.org_id === m.org_id && x.client_id === m.client_id);
  if (!i) fail("Content item not found.");
  if (i!.status !== "pending_approval") fail("This item is not waiting for your decision.");
  if (version !== i!.current_version) fail(`A newer version is available. Refresh the page and review version ${i!.current_version}.`);
  return i!;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/* ---------- RPC functions ---------- */

type Fn = (d: DemoDb, uid: string | null, a: Row) => unknown;

export const RPC: Record<string, Fn> = {
  create_organization: () => fail("Creating new workspaces is disabled in demo mode. Pick a demo person on the sign-in page."),
  accept_invitation: () => fail("Accepting invitations needs a real account, which is disabled in demo mode."),

  get_invitation_preview: (d, _uid, a) => {
    const inv = d.invitations.find((i) => i.token_hash === hashToken(String(a.p_token ?? "")));
    if (!inv) return [];
    const org = d.organizations.find((o) => o.id === inv.org_id);
    const client = d.clients.find((c) => c.id === inv.client_id);
    return [{ organization_name: org?.name, email: inv.email, role: inv.role, client_name: client?.name ?? null, is_valid: !inv.accepted_at && !inv.revoked_at && new Date(inv.expires_at) > new Date() }];
  },

  create_invitation: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin"]);
    const email = String(a.p_email ?? "").trim().toLowerCase();
    if (!validEmail(email)) fail("Enter a valid email address.");
    if (!["admin", "team", "client"].includes(a.p_role)) fail("Choose a valid role.");
    if (a.p_role === "client") {
      if (!d.clients.some((c) => c.id === a.p_client_id && c.org_id === m.org_id && c.is_active)) fail("Choose an active client account for this client approver.");
    } else if (a.p_client_id) fail("Only client approvers are linked to a client account.");
    if (d.profiles.some((p) => p.email.toLowerCase() === email && d.memberships.some((x) => x.user_id === p.id))) {
      fail("An account with this email already belongs to a workspace.");
    }
    for (const i of d.invitations) if (i.org_id === m.org_id && i.email === email && !i.accepted_at && !i.revoked_at) i.revoked_at = nowIso(d);
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    d.invitations.push({
      id: randomUUID(), org_id: m.org_id, email, full_name: clean(a.p_full_name, 120) || null, role: a.p_role,
      client_id: a.p_role === "client" ? a.p_client_id : null, token_hash: hashToken(token), invited_by: uid,
      created_at: nowIso(d), expires_at: new Date(Date.now() + 14 * 86400000).toISOString(), accepted_at: null, revoked_at: null,
    });
    return token;
  },

  revoke_invitation: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin"]);
    const i = d.invitations.find((x) => x.id === a.p_invitation_id && x.org_id === m.org_id && !x.accepted_at && !x.revoked_at);
    if (!i) fail("Invitation not found or no longer pending.");
    i!.revoked_at = nowIso(d);
  },

  update_member: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin"]);
    const t = d.memberships.find((x) => x.user_id === a.p_user_id && x.org_id === m.org_id);
    if (!t) fail("Member not found.");
    if (!["admin", "team", "client"].includes(a.p_role)) fail("Choose a valid role.");
    if (a.p_role === "client" && !d.clients.some((c) => c.id === a.p_client_id && c.org_id === m.org_id)) fail("Choose a client account for this client approver.");
    const activeAdmins = d.memberships.filter((x) => x.org_id === m.org_id && x.role === "admin" && x.is_active).length;
    if (t!.role === "admin" && (a.p_role !== "admin" || !a.p_is_active) && activeAdmins <= 1) fail("A workspace needs at least one active admin.");
    t!.role = a.p_role;
    t!.client_id = a.p_role === "client" ? a.p_client_id : null;
    t!.is_active = a.p_is_active ?? true;
    touch(d, t!);
  },

  upsert_client: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin"]);
    const name = clean(a.p_name, 120);
    if (name.length < 2) fail("Client name must be at least 2 characters.");
    const email = String(a.p_contact_email ?? "").trim().toLowerCase() || null;
    if (email && !validEmail(email)) fail("Enter a valid contact email.");
    const tz = String(a.p_timezone ?? "").trim() || "UTC";
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      fail(`Unknown time zone: ${tz}`);
    }
    if (d.clients.some((c) => c.org_id === m.org_id && c.name.toLowerCase() === name.toLowerCase() && c.id !== a.p_id)) fail("A client with this name already exists.");
    const fields = { name, contact_name: clean(a.p_contact_name, 120) || null, contact_email: email, timezone: tz, notes: clean(a.p_notes, 2000) || null, is_active: a.p_is_active ?? true };
    if (!a.p_id) {
      const row = { id: randomUUID(), org_id: m.org_id, ...fields, created_by: uid, created_at: nowIso(d), updated_at: nowIso(d) };
      d.clients.push(row);
      return row.id;
    }
    const c = d.clients.find((x) => x.id === a.p_id && x.org_id === m.org_id);
    if (!c) fail("Client not found.");
    Object.assign(c!, fields);
    touch(d, c!);
    return c!.id;
  },

  update_organization: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin"]);
    const name = clean(a.p_name, 120);
    if (name.length < 2) fail("Workspace name must be at least 2 characters.");
    const o = d.organizations.find((x) => x.id === m.org_id)!;
    o.name = name;
    o.require_four_eyes = a.p_require_four_eyes ?? true;
    touch(d, o);
  },

  update_my_profile: (d, uid, a) => {
    if (!uid) fail("You must be signed in.");
    const name = clean(a.p_full_name, 120);
    if (name.length < 2) fail("Name must be at least 2 characters.");
    const p = d.profiles.find((x) => x.id === uid)!;
    p.full_name = name;
    touch(d, p);
  },

  create_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    validateItemFields(d, m.org_id, a);
    const item = {
      id: randomUUID(), org_id: m.org_id, client_id: a.p_client_id, title: String(a.p_title).trim(), content_type: a.p_content_type,
      platform: a.p_platform, assignee_id: a.p_assignee_id ?? uid, created_by: uid, status: "draft", current_version: 1,
      approved_version: null, revision_round: 0, due_date: a.p_due_date ?? null, planned_publish_at: a.p_planned_publish_at ?? null,
      first_submitted_at: null, last_submitted_at: null, approved_at: null, approved_by: null, scheduled_for: null, scheduled_by: null,
      created_at: nowIso(d), updated_at: nowIso(d),
    };
    d.content_items.push(item);
    d.content_versions.push({
      id: randomUUID(), org_id: m.org_id, item_id: item.id, version_number: 1, description: clean(a.p_description, 5000),
      body: clean(a.p_body, 10000), change_summary: null, snapshot: null, created_by: uid, created_at: nowIso(d),
      updated_at: nowIso(d), submitted_at: null, submitted_by: null,
    });
    logEvent(d, uid!, item, 1, "created", null, "draft", null, "internal");
    return item.id;
  },

  update_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (!["draft", "revision_required"].includes(i.status)) fail("Only drafts and items returned for revision can be edited.");
    if (i.status === "revision_required" && a.p_client_id !== i.client_id) fail("The client cannot be changed after the item was sent for approval.");
    validateItemFields(d, m.org_id, a);
    const v = d.content_versions.find((x) => x.item_id === i.id && x.version_number === i.current_version && !x.submitted_at);
    if (!v) fail("The working version is locked.");
    Object.assign(i, {
      client_id: a.p_client_id, title: String(a.p_title).trim(), content_type: a.p_content_type, platform: a.p_platform,
      assignee_id: a.p_assignee_id ?? null, due_date: a.p_due_date ?? null, planned_publish_at: a.p_planned_publish_at ?? null,
    });
    touch(d, i);
    v!.description = clean(a.p_description, 5000);
    v!.body = clean(a.p_body, 10000);
    touch(d, v!);
  },

  submit_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (!["draft", "revision_required"].includes(i.status)) fail("This item has already been sent for approval.");
    const resubmit = i.status === "revision_required";
    const v = d.content_versions.find((x) => x.item_id === i.id && x.version_number === i.current_version)!;
    if (v.submitted_at) fail("This version was already submitted.");
    const summary = clean(a.p_change_summary, 2000);
    if (!v.body.trim() && !d.attachments.some((x) => x.version_id === v.id)) fail("Add the caption/copy or at least one attachment before sending.");
    if (!i.due_date) fail("Set a client response due date before sending.");
    if (i.due_date < today()) fail("The client response due date is in the past.");
    if (i.planned_publish_at && i.planned_publish_at.slice(0, 10) < i.due_date) fail("The planned publish date must be on or after the client response due date.");
    if (resubmit && summary.length < 5) fail("Summarise what changed in this version (at least 5 characters).");
    if (clientApprovers(d, i.client_id).length === 0) fail("This client has no active Client Approver yet. Invite one before sending content for approval.");
    Object.assign(v, {
      submitted_at: nowIso(d), submitted_by: uid, change_summary: summary || null,
      snapshot: { title: i.title, content_type: i.content_type, platform: i.platform, due_date: i.due_date, planned_publish_at: i.planned_publish_at },
    });
    const from = i.status;
    Object.assign(i, { status: "pending_approval", last_submitted_at: nowIso(d), first_submitted_at: i.first_submitted_at ?? nowIso(d) });
    touch(d, i);
    logEvent(d, uid!, i, i.current_version, resubmit ? "resubmitted" : "submitted", from, "pending_approval", summary, "client");
    const due = new Date(`${i.due_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    notify(d, uid!, i, clientApprovers(d, i.client_id), resubmit ? "resubmitted" : "submitted",
      resubmit ? "Updated version ready for review" : "New content awaiting your approval", `${i.title} · v${i.current_version} · due ${due}`);
  },

  approve_content_item: (d, uid, a) => {
    const i = loadForClientDecision(d, uid!, a.p_item_id, Number(a.p_version));
    Object.assign(i, { status: "approved", approved_version: i.current_version, approved_at: nowIso(d), approved_by: uid });
    touch(d, i);
    logEvent(d, uid!, i, i.current_version, "approved", "pending_approval", "approved", clean(a.p_comment, 5000), "client");
    notify(d, uid!, i, agencyWatchers(d, i), "approved", "Client approved content", `${i.title} · v${i.current_version} approved by ${actorName(d, uid)}`);
  },

  request_revision: (d, uid, a) => {
    const i = loadForClientDecision(d, uid!, a.p_item_id, Number(a.p_version));
    const comment = clean(a.p_comment, 5000);
    if (comment.length < 5) fail("Describe the changes you need (at least 5 characters).");
    const decided = i.current_version;
    const next = startNewVersion(d, uid!, i);
    Object.assign(i, { status: "revision_required", current_version: next, revision_round: i.revision_round + 1 });
    touch(d, i);
    logEvent(d, uid!, i, decided, "revision_requested", "pending_approval", "revision_required", comment, "client", { revision_round: i.revision_round, next_version: next });
    notify(d, uid!, i, agencyWatchers(d, i), "revision_requested", "Client requested revisions", `${i.title} · v${decided}: ${comment.slice(0, 140)}`);
  },

  reject_content_item: (d, uid, a) => {
    const i = loadForClientDecision(d, uid!, a.p_item_id, Number(a.p_version));
    const comment = clean(a.p_comment, 5000);
    if (comment.length < 5) fail("Tell the team why this item should not be used (at least 5 characters).");
    i.status = "rejected";
    touch(d, i);
    logEvent(d, uid!, i, i.current_version, "rejected", "pending_approval", "rejected", comment, "client");
    notify(d, uid!, i, agencyWatchers(d, i), "rejected", "Client rejected content", `${i.title} · v${i.current_version}: ${comment.slice(0, 140)}`);
  },

  schedule_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (i.status !== "approved") fail("Only client-approved items can be scheduled.");
    if (i.approved_version !== i.current_version) fail("The version to schedule does not match the approved version.");
    const v = d.content_versions.find((x) => x.item_id === i.id && x.version_number === i.approved_version)!;
    const when = a.p_scheduled_for ? new Date(a.p_scheduled_for) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= (d.clock ?? Date.now())) fail("Choose a publishing date and time in the future.");
    const approvedTime = v.snapshot?.planned_publish_at ? new Date(v.snapshot.planned_publish_at) : null;
    if (approvedTime && approvedTime.getTime() !== when!.getTime()) {
      fail("The client approved publishing at a specific time. To change it, reopen the item and get the new date approved.");
    }
    const org = d.organizations.find((o) => o.id === m.org_id)!;
    if (org.require_four_eyes && (v.created_by === uid || v.submitted_by === uid)) fail("Four-eyes check: you prepared this version, so another team member must schedule it.");
    Object.assign(i, { status: "scheduled", scheduled_for: when!.toISOString(), scheduled_by: uid });
    touch(d, i);
    logEvent(d, uid!, i, i.current_version, "scheduled", "approved", "scheduled", clean(a.p_note, 2000), "client", {
      scheduled_for: when!.toISOString(), four_eyes_checked_by: actorName(d, uid),
    });
    notify(d, uid!, i, agencyWatchers(d, i), "scheduled", "Scheduled for publishing", `${i.title} · ${when!.toISOString().slice(0, 16).replace("T", " ")} UTC`);
  },

  unschedule_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (i.status !== "scheduled") fail("Only scheduled items can be unscheduled.");
    const reason = clean(a.p_reason, 2000);
    if (reason.length < 5) fail("Give a reason for unscheduling (at least 5 characters).");
    Object.assign(i, { status: "approved", scheduled_for: null, scheduled_by: null });
    touch(d, i);
    logEvent(d, uid!, i, i.current_version, "unscheduled", "scheduled", "approved", reason, "client");
  },

  reopen_content_item: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (!["approved", "scheduled"].includes(i.status)) fail("Only approved or scheduled items can be reopened.");
    const reason = clean(a.p_reason, 2000);
    if (reason.length < 5) fail("Give a reason for reopening (at least 5 characters).");
    const from = i.status;
    const decided = i.current_version;
    const next = startNewVersion(d, uid!, i);
    Object.assign(i, {
      status: "revision_required", current_version: next, revision_round: i.revision_round + 1,
      approved_version: null, approved_at: null, approved_by: null, scheduled_for: null, scheduled_by: null,
    });
    touch(d, i);
    logEvent(d, uid!, i, decided, "reopened", from, "revision_required", reason, "client", { next_version: next });
  },

  delete_draft: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (i.status !== "draft" || i.first_submitted_at) fail("Only drafts that were never sent to a client can be deleted.");
    if (m.role !== "admin" && i.created_by !== uid) fail("Only the author or an admin can delete this draft.");
    for (const t of ["content_items", "content_versions", "attachments", "approval_events", "notifications"] as const) {
      d[t] = d[t].filter((r) => (t === "content_items" ? r.id !== i.id : r.item_id !== i.id));
    }
  },

  add_attachment: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const i = itemFor(d, a.p_item_id, m.org_id);
    if (!["draft", "revision_required"].includes(i.status)) fail("Files can only be added to drafts and items returned for revision.");
    const v = d.content_versions.find((x) => x.item_id === i.id && x.version_number === i.current_version && !x.submitted_at);
    if (!v) fail("The working version is locked.");
    const path = String(a.p_storage_path ?? "");
    if (path.split("/")[0] !== m.org_id || path.split("/")[1] !== i.id) fail("Invalid file location.");
    const name = clean(a.p_file_name, 200);
    if (!name) fail("File name is required.");
    const obj = d.objects.get(path);
    if (!obj) fail("Uploaded file not found. Please upload it again.");
    if (d.attachments.filter((x) => x.version_id === v!.id).length >= 10) fail("A version can have at most 10 attachments.");
    const row = { id: randomUUID(), org_id: m.org_id, item_id: i.id, version_id: v!.id, storage_path: path, file_name: name, mime_type: obj!.mime, size_bytes: obj!.size, uploaded_by: uid, created_at: nowIso(d) };
    d.attachments.push(row);
    return row.id;
  },

  remove_attachment: (d, uid, a) => {
    const m = requireMember(d, uid, ["admin", "team"]);
    const att = d.attachments.find((x) => x.id === a.p_attachment_id && x.org_id === m.org_id);
    if (!att) fail("Attachment not found.");
    if (d.content_versions.find((v) => v.id === att!.version_id)?.submitted_at) fail("Attachments of a submitted version cannot be changed.");
    d.attachments = d.attachments.filter((x) => x.id !== att!.id);
  },

  mark_notifications_read: (d, uid, a) => {
    if (!uid) fail("You must be signed in.");
    const ids: string[] | null = a.p_ids ?? null;
    for (const n of d.notifications) if (n.user_id === uid && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = nowIso(d);
  },
};

/* ---------- Storage permission checks (ports of storage.objects policies) ---------- */

export function canUpload(d: DemoDb, uid: string | null, path: string) {
  const m = membership(d, uid);
  if (!isAgency(m)) return false;
  const [orgPart, itemPart] = path.split("/");
  return orgPart === m!.org_id && d.content_items.some((i) => i.id === itemPart && i.org_id === m!.org_id && ["draft", "revision_required"].includes(i.status));
}

export function canRead(d: DemoDb, uid: string | null, path: string) {
  const m = membership(d, uid);
  if (!m || path.split("/")[0] !== m.org_id) return false;
  if (isAgency(m)) return true;
  return d.attachments.some((a) => a.storage_path === path && d.content_versions.find((v) => v.id === a.version_id)?.submitted_at && canViewItem(d, uid, a.item_id));
}

/* ---------- Seed: the fictional Northstar Digital workspace ---------- */

function seed(d: DemoDb) {
  const [maya, leo, priya, jonas, ana] = DEMO_PEOPLE.map((p) => p.id);
  const start = Date.now() - 3 * 86400000;
  let step = 0;
  d.clock = start;
  const tick = () => (d.clock = start + ++step * 47 * 60000);
  const call = (uid: string, fn: string, args: Row = {}) => {
    tick();
    return RPC[fn](d, uid, args);
  };
  const dateIn = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const atIn = (n: number, h: number) => {
    const t = new Date(Date.now() + n * 86400000);
    t.setUTCHours(h, 0, 0, 0);
    return t.toISOString();
  };

  for (const p of DEMO_PEOPLE) d.profiles.push({ id: p.id, email: p.email, full_name: p.name, created_at: nowIso(d), updated_at: nowIso(d) });
  const org = { id: randomUUID(), name: "Northstar Digital", is_demo: true, require_four_eyes: true, created_by: maya, created_at: nowIso(d), updated_at: nowIso(d) };
  d.organizations.push(org);
  d.memberships.push({ id: randomUUID(), org_id: org.id, user_id: maya, role: "admin", client_id: null, is_active: true, created_at: nowIso(d), updated_at: nowIso(d) });

  const halden = call(maya, "upsert_client", { p_name: "Halden Coffee Roasters", p_contact_name: "Jonas Weller", p_contact_email: DEMO_PEOPLE[3].email, p_timezone: "Europe/Berlin", p_notes: "Fictional demo client. Specialty coffee roaster; Instagram and LinkedIn.", p_is_active: true }) as string;
  const verde = call(maya, "upsert_client", { p_name: "Verde Living Studio", p_contact_name: "Ana Ferreira", p_contact_email: DEMO_PEOPLE[4].email, p_timezone: "Europe/Lisbon", p_notes: "Fictional demo client. Sustainable interior design studio.", p_is_active: true }) as string;
  for (const [uid, role, client] of [[leo, "team", null], [priya, "team", null], [jonas, "client", halden], [ana, "client", verde]] as const) {
    d.memberships.push({ id: randomUUID(), org_id: org.id, user_id: uid, role, client_id: client, is_active: true, created_at: nowIso(d), updated_at: nowIso(d) });
  }

  const create = (uid: string, args: Row) => call(uid, "create_content_item", { p_assignee_id: uid, p_description: "", p_planned_publish_at: null, ...args }) as string;
  const attach = (itemId: string, name: string, a: number[], b: number[]) => {
    const path = `${org.id}/${itemId}/${randomUUID()}-${name}`;
    const bytes = placeholderPng(a, b);
    d.objects.set(path, { bytes, mime: "image/png", size: bytes.length });
    const item = d.content_items.find((i) => i.id === itemId)!;
    RPC.add_attachment(d, item.created_by, { p_item_id: itemId, p_storage_path: path, p_file_name: name });
  };
  const coffee = [[58, 36, 24], [196, 140, 92]], blue = [[7, 27, 66], [40, 120, 240]], green = [[16, 52, 40], [120, 186, 140]], sand = [[92, 72, 52], [232, 212, 180]];

  const winterAt = atIn(9, 8);
  const winterBody = "Meet Winter Blend ❄️☕ Dark chocolate, orange peel and a whisper of spice — roasted in small batches in Halden.\n\n";
  const a = create(leo, { p_client_id: halden, p_title: "Winter Blend launch carousel", p_content_type: "carousel", p_platform: "instagram", p_due_date: dateIn(4), p_planned_publish_at: winterAt, p_description: "5-slide carousel introducing the Winter Blend.", p_body: winterBody + "Available from Monday.\n\n#HaldenCoffee #WinterBlend" });
  attach(a, "winter-blend-slide-1.png", coffee[0], coffee[1]);
  attach(a, "winter-blend-slide-3.png", blue[0], blue[1]);
  call(leo, "submit_content_item", { p_item_id: a });
  call(jonas, "request_revision", { p_item_id: a, p_version: 1, p_comment: "Lovely! Please use the new matte bag photo on slide 3, and say 'from 2 December' instead of 'from Monday'." });
  call(leo, "update_content_item", { p_item_id: a, p_client_id: halden, p_title: "Winter Blend launch carousel", p_content_type: "carousel", p_platform: "instagram", p_assignee_id: leo, p_due_date: dateIn(4), p_planned_publish_at: winterAt, p_description: "5-slide carousel. Slide 3 now uses the matte bag photo.", p_body: winterBody + "Available from 2 December.\n\n#HaldenCoffee #WinterBlend" });
  call(leo, "submit_content_item", { p_item_id: a, p_change_summary: "Slide 3 now uses the matte bag photo; launch date changed to 2 December." });
  call(jonas, "approve_content_item", { p_item_id: a, p_version: 2, p_comment: "Perfect, approved." });
  call(priya, "schedule_content_item", { p_item_id: a, p_scheduled_for: winterAt, p_note: "Four-eyes check: scheduled post matches approved v2." });

  const b = create(priya, { p_client_id: halden, p_title: "Barista tips reel — latte art basics", p_content_type: "short_video", p_platform: "instagram", p_due_date: dateIn(2), p_planned_publish_at: atIn(6, 16), p_description: "30-second reel with three latte-art pours.", p_body: "Three pours every home barista can learn this weekend 🥛✨\n\n#LatteArt #HaldenCoffee" });
  attach(b, "latte-reel-cover.png", sand[0], sand[1]);
  call(priya, "submit_content_item", { p_item_id: b });

  const c = create(leo, { p_client_id: halden, p_title: "Holiday opening hours", p_content_type: "post", p_platform: "facebook", p_due_date: dateIn(3), p_planned_publish_at: atIn(12, 9), p_description: "Single image post with holiday hours.", p_body: "Our holiday hours 🎄\n24 Dec: 8:00–14:00\n25–26 Dec: closed\n31 Dec: 8:00–15:00" });
  attach(c, "holiday-hours.png", blue[0], blue[1]);
  call(leo, "submit_content_item", { p_item_id: c });
  call(jonas, "approve_content_item", { p_item_id: c, p_version: 1 });

  const dd = create(priya, { p_client_id: halden, p_title: "Customer spotlight: Café Lindqvist", p_content_type: "post", p_platform: "linkedin", p_due_date: dateIn(5), p_description: "LinkedIn post featuring a wholesale partner café.", p_body: "Partnering with Café Lindqvist since 2021 — here's how they built a neighbourhood favourite." });
  call(priya, "submit_content_item", { p_item_id: dd });
  call(jonas, "request_revision", { p_item_id: dd, p_version: 1, p_comment: "Please check the partnership year (I believe it's 2020) and tag their LinkedIn page." });

  create(leo, { p_client_id: halden, p_title: "Brewing guide teaser", p_content_type: "post", p_platform: "linkedin", p_due_date: dateIn(7), p_description: "Teaser for the brewing guide. Copy in progress.", p_body: "" });

  const f = create(priya, { p_client_id: verde, p_title: "Spring collection teaser story", p_content_type: "story", p_platform: "instagram", p_due_date: dateIn(3), p_planned_publish_at: atIn(8, 10), p_description: "3-frame story with a link sticker.", p_body: "Frame 3 sticker: 'Spring at Verde — 14 March'" });
  attach(f, "spring-story-frames.png", green[0], green[1]);
  call(priya, "submit_content_item", { p_item_id: f });
  call(ana, "request_revision", { p_item_id: f, p_version: 1, p_comment: "Frame 2 feels too dark. Could you use the linen close-up in daylight instead?" });
  call(priya, "submit_content_item", { p_item_id: f, p_change_summary: "Frame 2 replaced with the daylight linen close-up." });

  const gAt = atIn(5, 11);
  const gi = create(priya, { p_client_id: verde, p_title: "Sustainable materials explainer", p_content_type: "short_video", p_platform: "tiktok", p_due_date: dateIn(2), p_planned_publish_at: gAt, p_description: "45-second explainer on reclaimed oak, cork and recycled wool.", p_body: "Where our materials come from 🌿 #SustainableDesign #VerdeLiving" });
  attach(gi, "materials-cover.png", green[0], green[1]);
  call(priya, "submit_content_item", { p_item_id: gi });
  call(ana, "approve_content_item", { p_item_id: gi, p_version: 1, p_comment: "Approved — love it." });
  call(leo, "schedule_content_item", { p_item_id: gi, p_scheduled_for: gAt, p_note: "Four-eyes check passed against approved v1." });

  const h = create(leo, { p_client_id: verde, p_title: "Weekend flash sale announcement", p_content_type: "post", p_platform: "facebook", p_due_date: dateIn(2), p_description: "20% weekend sale.", p_body: "This weekend only: 20% off all cushions and throws 🛋️" });
  call(leo, "submit_content_item", { p_item_id: h });
  call(ana, "reject_content_item", { p_item_id: h, p_version: 1, p_comment: "We're not running discounts this quarter, so please don't use this." });

  create(leo, { p_client_id: verde, p_title: "Behind the scenes: studio tour", p_content_type: "short_video", p_platform: "instagram", p_due_date: dateIn(10), p_description: "Studio tour reel. Filming next week.", p_body: "" });

  d.clock = null;
}
